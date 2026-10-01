const EPSILON = 1e-6;
const SEA_LEVEL = 0;
const MAX_WEIGHT = 1;
const MIN_ROUGHNESS = 0.18;
const MAX_ROUGHNESS = 0.98;

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / Math.max(EPSILON, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * clamp01(t);
const hash = (x, y, seed = 0) => {
  let h = (Math.imul(Math.floor(x * 374761393), 668265263) ^ Math.imul(Math.floor(y * 1274126177), 2246822519) ^ Math.floor(seed * 1009)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const boundedObject = (value) => (value && typeof value === 'object' ? value : {});

function normalizeContext(input = {}) {
  const value = boundedObject(input);
  const x = Number.isFinite(value.x) ? value.x : 0;
  const z = Number.isFinite(value.z) ? value.z : 0;
  const height = Number.isFinite(value.height) ? value.height : SEA_LEVEL;
  const slope = clamp01(value.slope);
  const moisture = clamp01(value.moisture);
  const temperature = clamp(value.temperature, -1, 1);
  const waterDistance = Number.isFinite(value.waterDistance) ? Math.max(0, value.waterDistance) : 9999;
  const biome = typeof value.biome === 'string' ? value.biome.toLowerCase() : 'temperate';
  const roadDistance = Number.isFinite(value.roadDistance) ? Math.max(0, value.roadDistance) : 9999;
  const settlementDistance = Number.isFinite(value.settlementDistance) ? Math.max(0, value.settlementDistance) : 9999;
  const canonicalWater = clamp01(value.canonicalWater);
  const groundConfidence = clamp01(value.groundConfidence);
  const cameraDistance = Number.isFinite(value.cameraDistance) ? Math.max(0, value.cameraDistance) : 0;
  const seed = Number.isFinite(value.seed) ? value.seed : 20260908;
  return { x, z, height, slope, moisture, temperature, waterDistance, biome, roadDistance, settlementDistance, canonicalWater, groundConfidence, cameraDistance, seed };
}

function continuousNoise(context, wavelength, phase = 0) {
  const x = context.x / Math.max(1, wavelength) + phase;
  const z = context.z / Math.max(1, wavelength) - phase * 0.7;
  const base = 0.5 + 0.5 * Math.sin(x * 1.618 + Math.sin(z * 0.77 + phase));
  const jitter = hash(x, z, context.seed + phase * 17.0);
  return clamp01(lerp(base, jitter, 0.16));
}

function deriveSurfaceWeights(context) {
  const snowClimate = smoothstep(0.35, 0.95, -context.temperature);
  const snowHeight = smoothstep(28, 120, context.height);
  const waterProximity = 1 - smoothstep(1.5, 42, context.waterDistance);
  const steepRock = smoothstep(0.34, 0.86, context.slope);
  const wetSoil = context.moisture * (1 - steepRock) * (1 - snowClimate);
  const sand = waterProximity * (1 - context.moisture) * (1 - steepRock) * (1 - snowClimate);
  const mud = context.moisture * waterProximity * (1 - steepRock * 0.55);
  const rock = Math.max(steepRock, snowClimate * 0.32);
  const snow = snowClimate * lerp(0.55, 1, snowHeight) * (1 - context.canonicalWater);
  const grassClimate = smoothstep(-0.35, 0.65, context.temperature);
  const grass = (1 - rock) * (1 - snow) * (1 - sand * 0.75) * grassClimate * (1 - context.canonicalWater);
  const soil = (1 - snow) * (1 - rock * 0.55) * (1 - context.canonicalWater);
  const weights = { grass, soil, mud, sand, rock, snow, wetEdge: waterProximity * (1 - context.canonicalWater) };
  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  for (const key of Object.keys(weights)) weights[key] = clamp01(weights[key] / total);
  return weights;
}

function deriveBreakup(context) {
  const macro = continuousNoise(context, 420, 0.13);
  const meso = continuousNoise(context, 96, 0.71);
  const micro = continuousNoise(context, 17, 1.37);
  const antiTiling = clamp01(0.42 + 0.22 * Math.sin(context.x * 0.007 + context.z * 0.004) + 0.18 * Math.cos(context.x * 0.003 - context.z * 0.009));
  const normalEnergy = lerp(0.04, 0.78, 1 - smoothstep(180, 1200, context.cameraDistance));
  return { macro, meso, micro, antiTiling, normalEnergy };
}

function derivePlacement(context, weights) {
  const sea = context.canonicalWater >= 0.5 || context.height < SEA_LEVEL;
  const steep = context.slope >= 0.82;
  const road = context.roadDistance < 10;
  const settlement = context.settlementDistance < 35;
  const grounded = context.groundConfidence >= 0.55;
  const vegetationAllowed = !sea && !steep && !road && grounded && weights.snow < 0.86;
  const rockAllowed = !sea && grounded && (weights.rock > 0.18 || steep);
  return {
    sea,
    steep,
    road,
    settlement,
    grounded,
    vegetationAllowed,
    rockAllowed,
    exclusionReason: sea ? 'canonical-water' : steep ? 'steep-slope' : road ? 'road-clearance' : !grounded ? 'low-ground-confidence' : null,
  };
}

function deriveMaterialResponse(context, weights, breakup) {
  const roughnessBase = lerp(0.92, 0.48, weights.wetEdge) + weights.rock * 0.08 - weights.snow * 0.06;
  const roughness = clamp(roughnessBase + (breakup.meso - 0.5) * 0.08, MIN_ROUGHNESS, MAX_ROUGHNESS);
  const wetness = clamp01(weights.mud * 0.72 + weights.wetEdge * 0.86 + context.moisture * 0.18);
  const albedoVariation = clamp(-0.14 + breakup.macro * 0.23 + breakup.micro * 0.08, -0.2, 0.24);
  const normalStrength = clamp01(breakup.normalEnergy * (0.45 + breakup.antiTiling * 0.42));
  return { roughness, wetness, albedoVariation, normalStrength, ao: clamp01(0.38 + context.slope * 0.24 + weights.rock * 0.18) };
}

export function evaluateTerrainContext(input = {}) {
  const context = normalizeContext(input);
  const weights = deriveSurfaceWeights(context);
  const breakup = deriveBreakup(context);
  const placement = derivePlacement(context, weights);
  const material = deriveMaterialResponse(context, weights, breakup);
  const snowline = smoothstep(0.25, 0.72, weights.snow + context.slope * 0.18);
  const shorelineBlend = smoothstep(0.05, 0.95, weights.wetEdge + (1 - context.canonicalWater) * 0.08);
  return Object.freeze({
    version: 'terrain-context-layer-v12',
    coordinate: Object.freeze({ x: context.x, z: context.z }),
    surface: Object.freeze({ ...weights }),
    breakup: Object.freeze({ ...breakup }),
    material: Object.freeze({ ...material }),
    placement: Object.freeze({ ...placement }),
    masks: Object.freeze({ snowline, shorelineBlend }),
    provenance: Object.freeze({ canonicalWater: context.canonicalWater, groundConfidence: context.groundConfidence, biome: context.biome }),
  });
}

export function sampleTerrainContextGrid({ originX = 0, originZ = 0, step = 24, width = 5, height = 5, context = {} } = {}) {
  const safeWidth = Math.max(1, Math.min(64, Math.floor(width)));
  const safeHeight = Math.max(1, Math.min(64, Math.floor(height)));
  const cells = [];
  for (let row = 0; row < safeHeight; row += 1) {
    for (let col = 0; col < safeWidth; col += 1) {
      cells.push(evaluateTerrainContext({ ...context, x: originX + col * step, z: originZ + row * step }));
    }
  }
  return Object.freeze(cells);
}

export function summarizeTerrainContext(result) {
  const value = boundedObject(result);
  const surface = boundedObject(value.surface);
  const placement = boundedObject(value.placement);
  return Object.freeze({
    version: value.version || 'unknown',
    dominantSurface: Object.entries(surface).sort((a, b) => b[1] - a[1])[0]?.[0] || 'soil',
    snowline: clamp01(value.masks?.snowline),
    shorelineBlend: clamp01(value.masks?.shorelineBlend),
    vegetationAllowed: placement.vegetationAllowed === true,
    rockAllowed: placement.rockAllowed === true,
    exclusionReason: placement.exclusionReason || null,
    finite: Number.isFinite(value.material?.roughness) && Number.isFinite(value.breakup?.normalEnergy),
  });
}

export const TERRAIN_CONTEXT_LAYER_POLICY = Object.freeze({
  version: 'terrain-context-layer-v12',
  canonicalHeightMutation: false,
  canonicalHydrologyMutation: false,
  gridTerm: false,
  pindexTerm: false,
  finiteOutputs: true,
  boundedWeights: true,
  editorRuntimeImport: false,
});

export default evaluateTerrainContext;
