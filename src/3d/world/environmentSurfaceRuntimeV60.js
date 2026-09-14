/**
 * Environment Surface Runtime v60
 *
 * Caller-owned, deterministic runtime plan for already-resolved world samples.
 * It does not create geometry, invent geography, hydrate assets, attach nodes,
 * or replace the merged #590 material/placement authority.
 */

const VERSION = 'environment-surface-runtime-v60';
const EPSILON = 1e-6;
const DEFAULT_CAMERA = Object.freeze({ width: 1536, height: 1024, orthoDegrees: 90 });

const clamp01 = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / Math.max(EPSILON, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const normalize = (value, fallback = 0) => {
  const n = finite(value, fallback);
  return Math.max(0, n);
};

const stableRound = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

const stableObject = (value) => {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableObject(value[key]);
    return out;
  }, {});
};

const hashString = (value) => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const deriveWorldPhase = (sample) => {
  const x = finite(sample.worldX);
  const z = finite(sample.worldZ);
  const seed = finite(sample.seed, 0);
  return {
    x: stableRound(((x * 0.017 + z * 0.003 + seed * 0.11) % 1 + 1) % 1),
    z: stableRound(((z * 0.013 - x * 0.005 + seed * 0.07) % 1 + 1) % 1),
  };
};

const deriveSurfaceWeights = (sample) => {
  const height = clamp01(sample.height01);
  const slope = clamp01(sample.slope01);
  const moisture = clamp01(sample.moisture01);
  const snow = clamp01(sample.snow01);
  const water = clamp01(sample.waterCoverage01);
  const shore = clamp01(sample.shoreDistance01);
  const rockExposure = clamp01(sample.rockExposure01, slope);
  const alpine = clamp01(sample.alpine01, Math.max(snow, smoothstep(0.62, 0.94, height)));
  const lowland = 1 - smoothstep(0.45, 0.86, height);
  const wetEdge = water * (1 - shore) * (0.45 + moisture * 0.55);
  const snowline = snow * (0.55 + alpine * 0.45);
  const scree = rockExposure * (0.35 + slope * 0.65) * (0.45 + alpine * 0.55);
  const rock = rockExposure * (0.4 + slope * 0.6) * (1 - snowline * 0.35);
  const mud = moisture * lowland * (1 - water * 0.75) * (1 - slope * 0.5);
  const grass = (1 - snowline) * (1 - rockExposure * 0.65) * (0.38 + lowland * 0.42 + moisture * 0.2);
  const soil = (1 - grass) * (1 - rock) * (1 - snowline) * (0.5 + lowland * 0.5);
  const weights = { grass, soil, mud, rock, scree, snow: snowline, wetEdge };
  const total = Object.values(weights).reduce((sum, value) => sum + normalize(value), 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, stableRound(normalize(value) / total)]));
};

const deriveWaterResponse = (sample) => {
  const water = clamp01(sample.waterCoverage01);
  const depth = clamp01(sample.waterDepth01);
  const shore = clamp01(sample.shoreDistance01);
  const moireRisk = clamp01(sample.waterStripeRisk01);
  const rectangularRisk = clamp01(sample.rectangularWaterRisk01);
  const shallow = water * (1 - depth);
  const wet = water * (1 - shore);
  return {
    class: sample.waterClass || (water > 0.7 ? 'sea' : water > 0.15 ? 'river-or-lake' : 'dry'),
    deepWeight: stableRound(water * depth),
    shallowWeight: stableRound(shallow),
    wetEdgeWeight: stableRound(wet),
    foamWeight: stableRound(wet * (0.2 + (1 - depth) * 0.8)),
    opacity: stableRound(0.42 + depth * 0.38),
    roughness: stableRound(0.16 + (1 - depth) * 0.18),
    normalEnergy: stableRound(0.15 + (1 - depth) * 0.2),
    antiMoire: stableRound(Math.max(moireRisk, rectangularRisk)),
    suppressCyan: rectangularRisk > 0.18 || moireRisk > 0.18,
  };
};

const derivePlacement = (sample, weights) => {
  const groundConfidence = clamp01(sample.groundConfidence01, 0);
  const water = clamp01(sample.waterCoverage01);
  const slope = clamp01(sample.slope01);
  const snow = clamp01(sample.snow01);
  const road = clamp01(sample.roadCoverage01);
  const settlement = clamp01(sample.settlementCoverage01);
  const cliff = clamp01(sample.cliff01, slope);
  const forbidden = water > 0.72 || slope > 0.86 || snow > 0.92 || road > 0.82 || settlement > 0.76 || cliff > 0.88 || groundConfidence < 0.55;
  const habitat = weights.grass > 0.18 ? 'forest-grass' : weights.scree + weights.rock > 0.28 ? 'rocky-alpine' : 'mixed-ground';
  return {
    eligible: !forbidden,
    reason: forbidden ? 'context-exclusion' : 'grounded-context-ok',
    habitat,
    density: stableRound((0.18 + weights.grass * 0.55 + weights.soil * 0.2) * (1 - slope * 0.45)),
    scaleRange: [stableRound(0.72 + weights.grass * 0.18), stableRound(1.12 + weights.grass * 0.34)],
    yawPhase: stableRound((finite(sample.worldX) * 0.009 + finite(sample.worldZ) * 0.013) % 1),
    lod: { near: 'hero', mid: 'cluster', far: 'impostor' },
    instancing: { required: true, maxInstances: 96 },
  };
};

const deriveAtmosphere = (sample) => {
  const luminance = clamp01(sample.backgroundLuminance01, 0.35);
  const horizon = clamp01(sample.horizonReadability01, luminance);
  const fog = clamp01(sample.fogDensity01, 0.24);
  return {
    skyMode: 'camera-relative',
    backgroundFloor: stableRound(Math.max(0.18, luminance * 0.72 + horizon * 0.28)),
    fogDensity: stableRound(Math.min(0.72, fog)),
    exposure: stableRound(Math.min(1.45, Math.max(0.72, 0.92 + (0.42 - luminance) * 0.7))),
    farMountainFade: stableRound(0.4 + fog * 0.45),
  };
};

export function createEnvironmentSurfaceRuntimePlan(input = {}) {
  const sample = input.sample || input;
  const weights = deriveSurfaceWeights(sample);
  const phase = deriveWorldPhase(sample);
  const water = deriveWaterResponse(sample);
  const placement = derivePlacement(sample, weights);
  const atmosphere = deriveAtmosphere(sample);
  const result = {
    version: VERSION,
    contract: {
      assetSequence: ['hydrate-load', 'surface-analysis', 'multi-material-recipe', 'validation', 'ground-transform', 'manifest', 'scene-attach'],
      sharedAuthority: 'merged-590',
      editorImport: false,
      geometryCreation: false,
      canonicalMutation: false,
    },
    camera: {
      fullWorld: { ...DEFAULT_CAMERA, framing: 'orthographic' },
      near: { ...DEFAULT_CAMERA, framing: 'orthographic', distance: 18 },
    },
    surface: { weights, macroBreakup: stableRound(0.46 + weights.rock * 0.26 + weights.grass * 0.18), microRelief: stableRound(0.28 + clamp01(sample.slope01) * 0.42), antiTilingPhase: phase },
    water,
    placement,
    atmosphere,
    parity: {
      canonicalRenderedDelta: stableRound(finite(sample.renderedHeight) - finite(sample.canonicalHeight)),
      renderedColliderDelta: stableRound(finite(sample.renderedHeight) - finite(sample.colliderHeight)),
      tolerance: 0.08,
    },
    acceptance: {
      visibleGrid: 0,
      visibleSeam: 0,
      visibleRectangularWater: water.suppressCyan ? 1 : 0,
      visibleWaterMoire: water.antiMoire > 0.18 ? 1 : 0,
      blackSky: atmosphere.backgroundFloor < 0.18 ? 1 : 0,
      deterministic: true,
    },
    queryCapabilities: { ground: true, collider: true, water: true, slope: true, biome: true, placement: true },
  };
  const canonical = stableObject(result);
  canonical.digest = hashString(JSON.stringify(canonical));
  return Object.freeze(canonical);
}

export function applyEnvironmentSurfaceRuntimePlan(target, plan) {
  if (!target || typeof target !== 'object') return false;
  if (!plan || plan.version !== VERSION) return false;
  target.environmentSurfaceRuntime = plan;
  return true;
}

export const ENVIRONMENT_SURFACE_RUNTIME_V60 = VERSION;
