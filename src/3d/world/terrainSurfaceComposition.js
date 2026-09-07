/**
 * World-space terrain surface composition for shipped terrain chunks.
 * Render-only: never mutates canonical height, hydrology, collider, road, or settlement data.
 * @module world/terrainSurfaceComposition
 */

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : a));
const smoothstep = (a, b, x) => {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const fract = (v) => v - Math.floor(v);

export const TERRAIN_SURFACE_COMPOSITION_POLICY = Object.freeze({
  id: 'terrain-surface-composition-world-space-v1',
  role: 'render-only-material-response',
  canonicalAuthority: 'owner-map-height-hydrology-collider',
  uvMode: 'world-space',
  antiTiling: true,
  shorelineHaloSuppression: true,
  mobileSafe: true,
  maxAlbedoDelta: 0.18,
  maxRoughnessDelta: 0.16,
  maxNormalGain: 0.22,
});

export function hash2(x, z, seed = 0) {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 74.3) * 43758.5453123;
  return fract(n);
}

export function valueNoise2(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uz;
}

export function ridgedNoise2(x, z, seed = 0) {
  return 1 - Math.abs(valueNoise2(x, z, seed) * 2 - 1);
}

export function fbmWorldNoise(worldX, worldZ, seed = 0) {
  let amplitude = 0.5;
  let frequency = 0.0037;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < 5; octave += 1) {
    total += valueNoise2(worldX * frequency, worldZ * frequency, seed + octave * 17) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return total / weight;
}

export function domainWarp(worldX, worldZ, seed = 0) {
  const low = fbmWorldNoise(worldX + 191.3, worldZ - 83.1, seed + 3);
  const high = fbmWorldNoise(worldX - 517.7, worldZ + 71.9, seed + 7);
  return Object.freeze({ x: (low - 0.5) * 72, z: (high - 0.5) * 72 });
}

export function macroBreakup(worldX, worldZ, seed = 0) {
  const warp = domainWarp(worldX, worldZ, seed);
  const continental = fbmWorldNoise(worldX + warp.x, worldZ + warp.z, seed + 11);
  const ridge = ridgedNoise2(worldX * 0.0021 + warp.x * 0.01, worldZ * 0.0021 + warp.z * 0.01, seed + 23);
  return clamp01(continental * 0.68 + ridge * 0.32);
}

export function mesoBreakup(worldX, worldZ, seed = 0) {
  const low = valueNoise2(worldX * 0.018, worldZ * 0.018, seed + 31);
  const mid = valueNoise2(worldX * 0.041, worldZ * 0.041, seed + 37);
  const cross = valueNoise2(worldX * 0.013 - worldZ * 0.009, worldZ * 0.021 + worldX * 0.004, seed + 41);
  return clamp01(low * 0.45 + mid * 0.35 + cross * 0.20);
}

export function microBreakup(worldX, worldZ, seed = 0) {
  const a = valueNoise2(worldX * 0.21, worldZ * 0.21, seed + 53);
  const b = valueNoise2(worldX * 0.37, worldZ * 0.37, seed + 59);
  const c = valueNoise2(worldX * 0.61, worldZ * 0.61, seed + 61);
  return clamp01(a * 0.50 + b * 0.30 + c * 0.20);
}

export function resolveTerrainSurfaceFactors(context = {}) {
  const worldX = Number(context.worldX) || 0;
  const worldZ = Number(context.worldZ) || 0;
  const seed = Number(context.seed) || 0;
  const height01 = clamp01(context.height01);
  const slope01 = clamp01(context.slope01);
  const moisture01 = clamp01(context.moisture01);
  const waterDistanceMeters = Math.max(0, Number(context.waterDistanceMeters) || 0);
  const biome = String(context.biome || 'temperate');
  const macro = macroBreakup(worldX, worldZ, seed);
  const meso = mesoBreakup(worldX, worldZ, seed);
  const micro = microBreakup(worldX, worldZ, seed);
  const shoreline = 1 - smoothstep(0, 32, waterDistanceMeters);
  const wet = Math.max(moisture01, shoreline * 0.92);
  const snow = biome === 'alpine' || biome === 'tundra'
    ? smoothstep(0.54, 0.90, height01) * (1 - slope01 * 0.16)
    : smoothstep(0.82, 0.98, height01) * 0.38;
  const rock = Math.max(slope01 * 0.72, smoothstep(0.62, 0.92, height01) * 0.44);
  const grass = clamp01((1 - rock) * (1 - snow) * (1 - wet * 0.28));
  const soil = clamp01(1 - grass - snow * 0.72 - rock * 0.55);
  return Object.freeze({
    macro, meso, micro, shoreline, wet, snow, rock, grass, soil,
    erosionBreakup: clamp01(macro * 0.44 + meso * 0.38 + micro * 0.18),
  });
}

export function composeSurfaceResponse(context = {}) {
  const factors = resolveTerrainSurfaceFactors(context);
  const albedo = clamp(
    (factors.macro - 0.5) * TERRAIN_SURFACE_COMPOSITION_POLICY.maxAlbedoDelta
      + (factors.meso - 0.5) * 0.07
      - factors.shoreline * 0.03,
    -TERRAIN_SURFACE_COMPOSITION_POLICY.maxAlbedoDelta,
    TERRAIN_SURFACE_COMPOSITION_POLICY.maxAlbedoDelta,
  );
  const roughness = clamp(
    factors.rock * 0.09 + factors.soil * 0.06 - factors.wet * 0.13
      + (factors.micro - 0.5) * TERRAIN_SURFACE_COMPOSITION_POLICY.maxRoughnessDelta,
    -TERRAIN_SURFACE_COMPOSITION_POLICY.maxRoughnessDelta,
    TERRAIN_SURFACE_COMPOSITION_POLICY.maxRoughnessDelta,
  );
  const normalGain = clamp(
    factors.rock * 0.12 + factors.meso * 0.08 + factors.micro * 0.06
      + factors.snow * 0.02,
    0,
    TERRAIN_SURFACE_COMPOSITION_POLICY.maxNormalGain,
  );
  return Object.freeze({
    ...factors,
    albedoDelta: albedo,
    roughnessDelta: roughness,
    normalGain,
    wetEdge: smoothstep(0.08, 0.82, factors.shoreline) * (1 - factors.snow),
  });
}

export function sampleSurfaceGrid(origin, size, divisions, context = {}) {
  const count = Math.max(1, Math.floor(divisions));
  const samples = [];
  for (let z = 0; z <= count; z += 1) {
    for (let x = 0; x <= count; x += 1) {
      const u = x / count;
      const v = z / count;
      samples.push(composeSurfaceResponse({
        ...context,
        worldX: origin.x + u * size.x,
        worldZ: origin.z + v * size.z,
      }));
    }
  }
  return samples;
}

export function createTerrainSurfaceMaterialManifest(context = {}) {
  const response = composeSurfaceResponse(context);
  return Object.freeze({
    policyId: TERRAIN_SURFACE_COMPOSITION_POLICY.id,
    worldSpace: true,
    canonicalAuthority: TERRAIN_SURFACE_COMPOSITION_POLICY.canonicalAuthority,
    factors: Object.freeze({
      grass: response.grass,
      soil: response.soil,
      rock: response.rock,
      snow: response.snow,
      wet: response.wet,
    }),
    response: Object.freeze({
      albedoDelta: response.albedoDelta,
      roughnessDelta: response.roughnessDelta,
      normalGain: response.normalGain,
      wetEdge: response.wetEdge,
    }),
    deterministicKey: [
      Number(context.worldX) || 0,
      Number(context.worldZ) || 0,
      Number(context.seed) || 0,
      String(context.biome || 'temperate'),
    ].join('|'),
  });
}

export function assertSurfaceResponseSafe(response) {
  const values = [
    response?.albedoDelta,
    response?.roughnessDelta,
    response?.normalGain,
    response?.wetEdge,
  ];
  if (!values.every(Number.isFinite)) throw new Error('terrain surface response must be finite');
  if (Math.abs(response.albedoDelta) > TERRAIN_SURFACE_COMPOSITION_POLICY.maxAlbedoDelta) {
    throw new Error('terrain albedo response exceeded bounded policy');
  }
  if (Math.abs(response.roughnessDelta) > TERRAIN_SURFACE_COMPOSITION_POLICY.maxRoughnessDelta) {
    throw new Error('terrain roughness response exceeded bounded policy');
  }
  if (response.normalGain < 0 || response.normalGain > TERRAIN_SURFACE_COMPOSITION_POLICY.maxNormalGain) {
    throw new Error('terrain normal response exceeded bounded policy');
  }
  return true;
}
