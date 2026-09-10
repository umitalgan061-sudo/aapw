const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = (value) => clamp(finite(value), 0, 1);
const smoothstep = (edge0, edge1, value) => {
  const span = Math.max(1e-6, edge1 - edge0);
  const t = clamp01((value - edge0) / span);
  return t * t * (3 - 2 * t);
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

const stableStringify = (value) => JSON.stringify(value, Object.keys(value || {}).sort());

const normalizeSample = (sample = {}) => ({
  x: finite(sample.x),
  y: finite(sample.y),
  z: finite(sample.z),
  elevation: finite(sample.elevation),
  slope: clamp01(sample.slope),
  moisture: clamp01(sample.moisture),
  waterDistance: Math.max(0, finite(sample.waterDistance, 9999)),
  biome: typeof sample.biome === 'string' ? sample.biome : 'unknown',
  canonicalHeight: finite(sample.canonicalHeight),
  renderedHeight: finite(sample.renderedHeight),
  colliderHeight: finite(sample.colliderHeight),
  waterCoverage: clamp01(sample.waterCoverage),
  shallowDepth: Math.max(0, finite(sample.shallowDepth, 0)),
  foam: clamp01(sample.foam),
  visibleSeam: Boolean(sample.visibleSeam),
  visibleRectangularWater: Boolean(sample.visibleRectangularWater),
  visibleWaterMoire: Boolean(sample.visibleWaterMoire),
  visibleTextureTiling: Boolean(sample.visibleTextureTiling),
  blackSky: Boolean(sample.blackSky),
  assetReady: sample.assetReady !== false,
  road: Boolean(sample.road),
  settlement: Boolean(sample.settlement),
});

const normalizeWeights = (weights) => {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total <= 1e-6) return { grass: 1, soil: 0, mud: 0, rock: 0, scree: 0, snow: 0, wetEdge: 0, foam: 0 };
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / total]));
};

const surfaceResponse = (sample) => {
  const alpine = smoothstep(0.62, 0.9, sample.elevation);
  const steep = smoothstep(0.42, 0.82, sample.slope);
  const wet = smoothstep(0, 18, 18 - sample.waterDistance) * sample.moisture;
  const shore = smoothstep(0, 16, 16 - sample.waterDistance);
  const permanentSnow = sample.biome === 'alpine' || sample.biome === 'snow';
  const snow = permanentSnow ? clamp(0.58 + alpine * 0.32, 0, 1) : alpine * 0.24;
  const rock = clamp(steep * 0.72 + sample.elevation * 0.08, 0, 1);
  const scree = clamp(steep * (1 - snow) * 0.44, 0, 1);
  return normalizeWeights({
    grass: clamp((1 - steep) * (1 - snow) * (1 - shore * 0.4), 0, 1),
    soil: clamp((1 - snow) * (1 - rock) * 0.32, 0, 1),
    mud: clamp(wet * 0.52, 0, 1),
    rock,
    scree,
    snow,
    wetEdge: clamp(shore * wet * 0.82, 0, 1),
    foam: clamp(sample.foam * shore * 0.68, 0, 1),
  });
};

const waterResponse = (sample) => {
  const shore = smoothstep(0, 14, 14 - sample.waterDistance);
  const deep = smoothstep(0.2, 3.5, sample.shallowDepth);
  return {
    category: sample.waterCoverage <= 0 ? 'land' : deep > 0.75 ? 'deep' : shore > 0.35 ? 'shore' : 'shallow',
    opacity: clamp(0.34 + deep * 0.42 + (1 - shore) * 0.12, 0.2, 0.92),
    roughness: clamp(0.58 - deep * 0.24 + shore * 0.1, 0.24, 0.78),
    normalEnergy: clamp(0.2 + shore * 0.22 + deep * 0.12, 0.12, 0.58),
    antiMoire: sample.visibleWaterMoire || sample.visibleRectangularWater,
    cyanSuppression: sample.waterCoverage > 0 && (shore > 0.35 || sample.visibleRectangularWater),
  };
};

const grounding = (sample) => {
  const heightDrift = Math.abs(sample.renderedHeight - sample.colliderHeight);
  const canonicalDrift = Math.abs(sample.renderedHeight - sample.canonicalHeight);
  const invalidGround = heightDrift > 0.35 || canonicalDrift > 0.55;
  const excluded = sample.waterCoverage > 0.08 || sample.slope > 0.9 || sample.road || sample.settlement || !sample.assetReady || invalidGround;
  return {
    eligible: !excluded,
    exclusionReason: excluded ? (invalidGround ? 'ground-parity' : sample.waterCoverage > 0.08 ? 'water' : sample.slope > 0.9 ? 'cliff' : sample.road ? 'road' : sample.settlement ? 'settlement' : 'asset-not-ready') : null,
    parity: { heightDrift, canonicalDrift, acceptable: !invalidGround },
  };
};

export const createEnvironmentSurfaceResponseV46 = (input = {}) => {
  const samples = Array.isArray(input.samples) ? input.samples.map(normalizeSample) : [];
  const observations = samples.map((sample, index) => ({
    index,
    world: { x: sample.x, y: sample.y, z: sample.z },
    biome: sample.biome,
    surface: surfaceResponse(sample),
    water: waterResponse(sample),
    grounding: grounding(sample),
    risks: {
      seam: sample.visibleSeam,
      rectangularWater: sample.visibleRectangularWater,
      waterMoire: sample.visibleWaterMoire,
      textureTiling: sample.visibleTextureTiling,
      blackSky: sample.blackSky,
    },
  }));
  const summary = {
    sampleCount: observations.length,
    riskCounts: Object.fromEntries(['seam', 'rectangularWater', 'waterMoire', 'textureTiling', 'blackSky'].map((key) => [key, observations.filter((row) => row.risks[key]).length])),
    groundedVegetationEligible: observations.filter((row) => row.grounding.eligible).length,
    acceptableParity: observations.filter((row) => row.grounding.parity.acceptable).length,
    camera: { width: 1536, height: 1024, projection: 'orthographic', fovDegrees: 90, deterministic: true },
  };
  const output = { version: 'v46', observations, summary };
  return deepFreeze({ ...output, digest: stableStringify(output) });
};

export const applyEnvironmentSurfaceResponseV46 = (target, plan) => {
  if (!target || typeof target !== 'object') return false;
  if (!plan || typeof plan !== 'object') return false;
  target.environmentSurfaceResponseV46 = plan;
  return true;
};
