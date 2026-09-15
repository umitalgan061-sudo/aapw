const clamp = (value, min, max, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const lerp = (a, b, t) => a + (b - a) * t;

export const ACCEPTANCE_CAMERA_PROFILES = Object.freeze({
  fullWorld: Object.freeze({ width: 1536, height: 1024, projection: 'orthographic', yaw: 0.785398, pitch: -1.047198 }),
  far: Object.freeze({ width: 1536, height: 1024, projection: 'orthographic', yaw: 0.785398, pitch: -0.872665 }),
  nearCenter: Object.freeze({ width: 1536, height: 1024, projection: 'orthographic', yaw: 0.523599, pitch: -0.610865 }),
  nearNorthwest: Object.freeze({ width: 1536, height: 1024, projection: 'orthographic', yaw: 1.047198, pitch: -0.610865 }),
});

const normalizeBands = ({ elevation, slope, moisture, waterDistance, biome }) => {
  const normalizedElevation = clamp(elevation, 0, 1, 0.5);
  const normalizedSlope = clamp(slope, 0, 1, 0);
  const normalizedMoisture = clamp(moisture, 0, 1, 0.5);
  const normalizedWaterDistance = clamp(waterDistance, 0, 1, 1);
  const isAlpine = normalizedElevation >= 0.78;
  const isSnowline = normalizedElevation >= 0.88 && normalizedSlope < 0.82;
  const isShore = normalizedWaterDistance <= 0.1;
  const isWetEdge = normalizedWaterDistance <= 0.22 && normalizedMoisture >= 0.55;
  const isForest = String(biome || '').toLowerCase().includes('forest');
  const isScree = normalizedSlope >= 0.7 && normalizedElevation >= 0.62;
  return { normalizedElevation, normalizedSlope, normalizedMoisture, normalizedWaterDistance, isAlpine, isSnowline, isShore, isWetEdge, isForest, isScree };
};

export const buildEnvironmentVisualAdoption = (sample = {}) => {
  const bands = normalizeBands(sample);
  const grass = clamp((1 - bands.normalizedSlope) * (1 - bands.normalizedElevation * 0.8) * (0.35 + bands.normalizedMoisture * 0.65), 0, 1);
  const rock = clamp(bands.normalizedSlope * 0.9 + bands.normalizedElevation * 0.35, 0, 1);
  const scree = bands.isScree ? clamp(0.35 + bands.normalizedSlope * 0.55, 0, 1) : 0;
  const snow = bands.isSnowline ? clamp((bands.normalizedElevation - 0.82) * 5.6 + 0.12, 0, 1) : 0;
  const wetEdge = bands.isWetEdge ? clamp((0.22 - bands.normalizedWaterDistance) * 5 + bands.normalizedMoisture * 0.35, 0, 1) : 0;
  const foam = bands.isShore ? clamp((0.1 - bands.normalizedWaterDistance) * 8, 0, 1) : 0;
  const soil = clamp(1 - Math.max(grass, rock, snow, scree) * 0.72, 0, 1);
  const total = grass + soil + rock + scree + snow + wetEdge + foam || 1;
  const surface = Object.freeze({ grass: grass / total, soil: soil / total, rock: rock / total, scree: scree / total, snow: snow / total, wetEdge: wetEdge / total, foam: foam / total });

  const canonicalHeight = finite(sample.canonicalHeight, 0);
  const renderedHeight = finite(sample.renderedHeight, canonicalHeight);
  const colliderHeight = finite(sample.colliderHeight, canonicalHeight);
  const parity = Object.freeze({ renderedDelta: Math.abs(renderedHeight - canonicalHeight), colliderDelta: Math.abs(colliderHeight - canonicalHeight), pass: Math.abs(renderedHeight - colliderHeight) <= 0.08 });

  const water = Object.freeze({ deep: clamp(bands.normalizedWaterDistance * 1.2, 0, 1), shallow: clamp(1 - bands.normalizedWaterDistance * 5, 0, 1), wetEdge, foam, rectangularCoverageRisk: Boolean(sample.rectangularCoverageRisk), moireRisk: Boolean(sample.moireRisk), cyanSuppression: clamp(0.2 + bands.normalizedWaterDistance * 0.65, 0, 1) });
  const vegetation = Object.freeze({ eligible: !sample.underwater && !sample.steepCliff && !sample.permanentSnow && !sample.onRoad && !sample.inSettlement && parity.pass, density: bands.isForest ? 0.72 : bands.isAlpine ? 0.12 : 0.38, clusterBias: bands.isForest ? 0.86 : bands.isWetEdge ? 0.58 : 0.32, lodBias: bands.isAlpine ? 0.78 : 0.46, instancingRequired: bands.isForest });
  const atmosphere = Object.freeze({ fogNear: clamp(sample.fogNear, 8, 240, 24), fogFar: clamp(sample.fogFar, 120, 2400, 980), exposure: clamp(sample.exposure, 0.7, 1.35, 1), blackSkyRisk: Boolean(sample.blackSkyRisk) });

  const antiTilingPhase = Object.freeze({ x: Math.sin(finite(sample.worldX) * 0.013 + finite(sample.seed)) * 0.5 + 0.5, y: Math.cos(finite(sample.worldZ) * 0.017 + finite(sample.seed) * 0.37) * 0.5 + 0.5, scale: lerp(0.72, 1.34, bands.normalizedElevation) });
  const risks = Object.freeze({ visibleSeam: Boolean(sample.visibleSeam), visibleRectangularWater: water.rectangularCoverageRisk, obviousWaterMoire: water.moireRisk, floatingOrInterpenetrating: Boolean(sample.floatingOrInterpenetrating), flatTerrain: bands.normalizedSlope < 0.08 && bands.normalizedElevation > 0.58, blackSky: atmosphere.blackSkyRisk });
  const digest = JSON.stringify({ surface, water, vegetation, atmosphere, antiTilingPhase, parity, risks });

  return Object.freeze({ version: 'v44', bands, surface, water, vegetation, atmosphere, antiTilingPhase, parity, risks, acceptanceCameras: ACCEPTANCE_CAMERA_PROFILES, digest });
};

export const applyEnvironmentVisualAdoption = (target = {}, sample = {}) => {
  const plan = buildEnvironmentVisualAdoption(sample);
  if (target && typeof target === 'object') Object.assign(target, plan);
  return plan;
};
