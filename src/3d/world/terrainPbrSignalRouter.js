/**
 * Render-facing terrain PBR signal router.
 *
 * This module deliberately consumes canonical samples and returns bounded
 * material weights only. It does not mutate terrain height, hydrology,
 * coastline, roads, settlements, colliders, or placement authority.
 *
 * The router is intended to be adopted by the shipped terrain material path
 * after owner overlap review. Keeping the signal contract isolated lets
 * scene/runtime consumers share the same deterministic material response
 * without re-implementing slope, moisture, snowline, shoreline, or anti-tiling
 * logic in multiple lanes.
 */

const EPSILON = 1e-6;
const DEFAULTS = Object.freeze({
  macroScale: 0.00047,
  mesoScale: 0.0031,
  microScale: 0.047,
  shorelineWidth: 0.085,
  snowlineWidth: 0.14,
  rockSlopeStart: 0.34,
  rockSlopeFull: 0.78,
  wetnessFalloff: 0.62,
  ambientVariation: 0.16,
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function smoothstep(edge0, edge1, value) {
  const width = Math.max(EPSILON, edge1 - edge0);
  const t = clamp01((value - edge0) / width);
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * clamp01(t);
}

function hash2(x, z, seed) {
  let h = (Math.imul(Math.trunc(x * 1009), 374761393) ^ Math.imul(Math.trunc(z * 9176), 668265263) ^ Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const n00 = hash2(x0, z0, seed);
  const n10 = hash2(x0 + 1, z0, seed);
  const n01 = hash2(x0, z0 + 1, seed);
  const n11 = hash2(x0 + 1, z0 + 1, seed);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sz);
}

function fractalNoise(x, z, seed) {
  const a = valueNoise2(x, z, seed);
  const b = valueNoise2(x * 2.13 + 17.1, z * 1.87 - 9.4, seed + 17);
  const c = valueNoise2(x * 5.07 - 3.2, z * 4.61 + 5.8, seed + 53);
  return clamp01(a * 0.58 + b * 0.29 + c * 0.13);
}

function normalizeContext(input = {}) {
  const x = finite(input.x);
  const z = finite(input.z);
  const height = finite(input.height);
  const slope = clamp01(input.slope);
  const moisture = clamp01(input.moisture);
  const temperature = clamp01(input.temperature);
  const waterDistance = Math.max(0, finite(input.waterDistance, 1e6));
  const biome = typeof input.biome === 'string' ? input.biome : 'temperate';
  const seed = Math.trunc(finite(input.seed, 1));
  const cameraDistance = Math.max(0, finite(input.cameraDistance, 0));
  const canonical = input.canonical === true;
  return { x, z, height, slope, moisture, temperature, waterDistance, biome, seed, cameraDistance, canonical };
}

function safeWeights(weights) {
  const keys = ['grass', 'soil', 'mud', 'rock', 'scree', 'snow', 'wet', 'shoreline'];
  const out = {};
  let total = 0;
  for (const key of keys) {
    out[key] = clamp01(weights[key]);
    total += out[key];
  }
  if (total <= EPSILON) return Object.fromEntries(keys.map((key) => [key, key === 'soil' ? 1 : 0]));
  for (const key of keys) out[key] /= total;
  return out;
}

export function createTerrainPbrSignalRouter(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const seedSalt = Math.trunc(finite(config.seedSalt, 0));

  return Object.freeze({
    sample(input = {}) {
      const context = normalizeContext(input);
      const { x, z, height, slope, moisture, temperature, waterDistance, biome, seed, cameraDistance } = context;
      const shore = 1 - smoothstep(0, Math.max(EPSILON, config.shorelineWidth), waterDistance);
      const snowBand = smoothstep(1 - config.snowlineWidth, 1 + config.snowlineWidth, 0.62 + temperature * -0.8 + height * 0.001);
      const rockSlope = smoothstep(config.rockSlopeStart, config.rockSlopeFull, slope);
      const wet = clamp01((1 - waterDistance / Math.max(EPSILON, config.wetnessFalloff)) * 0.82 + moisture * 0.35);
      const macro = fractalNoise(x * config.macroScale, z * config.macroScale, seed + seedSalt);
      const meso = fractalNoise(x * config.mesoScale + 31.4, z * config.mesoScale - 18.2, seed + seedSalt + 71);
      const micro = fractalNoise(x * config.microScale - 9.1, z * config.microScale + 4.7, seed + seedSalt + 149);
      const variation = lerp(1 - config.ambientVariation, 1 + config.ambientVariation, macro);
      const highland = smoothstep(0.58, 0.9, clamp01(0.45 + height * 0.001));
      const cold = clamp01((0.55 - temperature) * 1.7);
      const exposedRock = clamp01(rockSlope * 0.72 + highland * 0.28);
      const scree = clamp01(exposedRock * (0.35 + meso * 0.45) * (1 - shore * 0.35));
      const snow = clamp01(snowBand * (0.58 + cold * 0.42) * (1 - exposedRock * 0.48));
      const mud = clamp01(moisture * 0.58 + shore * 0.32 + (biome === 'marsh' ? 0.22 : 0));
      const grass = clamp01((1 - rockSlope) * (1 - snow * 0.78) * (0.6 + macro * 0.4) * (biome === 'alpine' ? 0.62 : 1));
      const soil = clamp01(0.24 + meso * 0.3 + moisture * 0.22 - grass * 0.18 - snow * 0.14);
      const wetLayer = clamp01(wet * (1 - snow * 0.65));
      const shoreline = clamp01(shore * (0.58 + micro * 0.42));
      const weights = safeWeights({ grass, soil, mud, rock: exposedRock, scree, snow, wet: wetLayer, shoreline });
      const detailFade = 1 - smoothstep(22, 180, cameraDistance);
      const antiTiling = clamp01(0.38 + macro * 0.27 + meso * 0.23 + micro * 0.12);
      const normalStrength = lerp(0.22, 0.82, detailFade) * (0.74 + micro * 0.26);
      const roughness = clamp01(0.42 + weights.rock * 0.19 + weights.snow * 0.08 + weights.wet * -0.18 + meso * 0.1);
      const albedoLift = lerp(0.92, 1.06, variation / (1 + config.ambientVariation));
      return Object.freeze({
        accepted: context.canonical,
        reason: context.canonical ? 'canonical-context' : 'non-canonical-context',
        biome,
        weights,
        signals: Object.freeze({ macro, meso, micro, shore, snowBand, rockSlope, wet, detailFade, antiTiling }),
        pbr: Object.freeze({ roughness, normalStrength, albedoLift }),
        invariants: Object.freeze({ canonicalHeightMutated: false, canonicalHydrologyMutated: false, canonicalPlacementMutated: false }),
      });
    },
  });
}

export function validateTerrainPbrSignal(signal) {
  if (!signal || typeof signal !== 'object') return { valid: false, reasons: ['missing-signal'] };
  const reasons = [];
  if (signal.accepted !== true) reasons.push('non-canonical-context');
  if (!signal.weights || Math.abs(Object.values(signal.weights).reduce((sum, value) => sum + value, 0) - 1) > 1e-5) reasons.push('weights-not-normalized');
  if (!signal.pbr || !Number.isFinite(signal.pbr.roughness) || !Number.isFinite(signal.pbr.normalStrength)) reasons.push('non-finite-pbr');
  if (signal.invariants?.canonicalHeightMutated || signal.invariants?.canonicalHydrologyMutated || signal.invariants?.canonicalPlacementMutated) reasons.push('canonical-mutation');
  return { valid: reasons.length === 0, reasons };
}
