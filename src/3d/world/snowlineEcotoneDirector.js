/**
 * Snowline ecotone director.
 *
 * Render-facing only: it consumes canonical terrain/hydrology samples and returns
 * bounded material, relief and placement signals. It never mutates canonical
 * height, collider, hydrology, road or settlement sources.
 */

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const smoothstep = (edge0, edge1, value) => {
  const span = Math.max(1e-6, edge1 - edge0);
  const t = clamp01((value - edge0) / span);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (value) => value - Math.floor(value);

function hash2(x, y, seed) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return fract(value);
}

function normalizeWeights(weights) {
  const clean = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, clamp01(value)]));
  const total = Object.values(clean).reduce((sum, value) => sum + value, 0);
  if (total <= 1e-6) return { snow: 0, firn: 0, scree: 0, rock: 0, grass: 1, shrub: 0 };
  return Object.fromEntries(Object.entries(clean).map(([key, value]) => [key, value / total]));
}

export function createSnowlineEcotoneSignal(input = {}) {
  const terrain = input.terrain ?? {};
  const climate = input.climate ?? {};
  const hydrology = input.hydrology ?? {};
  const seed = finite(input.seed, 13.37);
  const x = finite(input.x);
  const z = finite(input.z);
  const height = finite(terrain.height);
  const slope = clamp01(terrain.slope);
  const aspect = finite(terrain.aspect);
  const moisture = clamp01(terrain.moisture);
  const waterDistance = Math.max(0, finite(hydrology.waterDistance, 9999));
  const snowline = finite(climate.snowline, 140);
  const treeline = finite(climate.treeline, snowline * 0.72);
  const temperature = finite(climate.temperature, 0.35);
  const persistence = clamp01(climate.snowPersistence ?? 0.6);
  const windExposure = clamp01(climate.windExposure ?? 0.35);
  const waterMask = smoothstep(0, 12, waterDistance);
  const heightSnow = smoothstep(snowline - 22, snowline + 18, height);
  const frozen = smoothstep(0.62, 0.18, temperature);
  const slopeBreak = smoothstep(0.32, 0.82, slope);
  const ridgeExposure = clamp01(0.45 + 0.35 * slopeBreak + 0.2 * Math.abs(Math.sin(aspect)));
  const localNoise = 0.65 + 0.35 * hash2(x * 0.011, z * 0.013, seed);
  const leePocket = 1 - windExposure * (0.45 + 0.35 * Math.abs(Math.cos(aspect)));
  const snowPotential = clamp01(heightSnow * (0.55 + 0.45 * frozen) * persistence * waterMask * localNoise);
  const rockExposure = clamp01(slopeBreak * (0.45 + 0.45 * ridgeExposure) + (1 - snowPotential) * 0.12);
  const firn = clamp01(snowPotential * (0.45 + 0.35 * ridgeExposure));
  const powder = clamp01(snowPotential * (0.75 + 0.25 * leePocket));
  const treelineFade = smoothstep(treeline - 18, treeline + 14, height);
  const ecotone = clamp01(1 - Math.abs(height - treeline) / 22) * (1 - slopeBreak * 0.55);
  const vegetationCapacity = clamp01((1 - treelineFade) * (1 - slopeBreak * 0.45) * (0.72 + 0.28 * moisture));
  const scaleVariation = 0.88 + 0.24 * hash2(x * 0.021 + 4, z * 0.017 - 3, seed + 4.2);
  const microRelief = lerp(0.1, 0.85, clamp01(0.35 * snowPotential + 0.45 * rockExposure + 0.2 * ecotone));
  const normalEnergy = clamp01(0.28 + 0.58 * (1 - clamp01(input.cameraDistance / 1800)));

  const weights = normalizeWeights({
    snow: powder,
    firn,
    scree: rockExposure * (0.42 + 0.35 * slopeBreak),
    rock: rockExposure * 0.75,
    grass: vegetationCapacity * (1 - snowPotential) * (1 - slopeBreak * 0.35),
    shrub: vegetationCapacity * (1 - snowPotential) * (0.35 + 0.35 * moisture),
  });

  return {
    version: 1,
    finite: true,
    canonicalMutation: false,
    ecotone: {
      snowline: clamp01(heightSnow),
      treeline: clamp01(treelineFade),
      transition: ecotone,
      leePocket: clamp01(leePocket),
      windwardExposure: ridgeExposure,
    },
    material: {
      weights,
      macroVariation: clamp01(0.35 + 0.45 * localNoise),
      microVariation: clamp01(0.2 + 0.55 * microRelief),
      antiTiling: clamp01(0.62 + 0.25 * Math.abs(Math.sin((x + z) * 0.017 + seed))),
      normalEnergy,
      roughness: clamp01(0.58 + 0.25 * snowPotential + 0.08 * rockExposure),
    },
    relief: {
      microRelief,
      talusBias: clamp01(0.25 + 0.6 * rockExposure * slopeBreak),
      snowDriftBias: clamp01(0.3 + 0.6 * powder * leePocket),
      scaleVariation,
    },
    placement: {
      vegetationAllowed: vegetationCapacity > 0.14 && snowPotential < 0.7 && waterDistance > 3,
      rockAllowed: rockExposure > 0.18 && slope < 0.94,
      grounded: terrain.groundConfidence === undefined ? true : clamp01(terrain.groundConfidence) > 0.72,
      exclusionReason: waterDistance <= 3 ? 'water-proximity' : snowPotential > 0.84 ? 'persistent-snow' : slope >= 0.94 ? 'near-vertical-slope' : null,
    },
  };
}

export function summarizeSnowlineEcotone(signal) {
  const safe = signal ?? {};
  const weights = safe.material?.weights ?? {};
  return {
    finite: safe.finite === true,
    canonicalMutation: safe.canonicalMutation === true,
    snow: finite(weights.snow),
    firn: finite(weights.firn),
    scree: finite(weights.scree),
    rock: finite(weights.rock),
    grass: finite(weights.grass),
    shrub: finite(weights.shrub),
    vegetationAllowed: safe.placement?.vegetationAllowed === true,
    rockAllowed: safe.placement?.rockAllowed === true,
    grounded: safe.placement?.grounded === true,
  };
}
