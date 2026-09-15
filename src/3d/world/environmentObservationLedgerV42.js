const clamp01 = (value, fallback = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
};

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const hash01 = (x, z, seed = 0) => {
  const value = Math.sin(finite(x) * 12.9898 + finite(z) * 78.233 + seed * 37.719) * 43758.5453;
  return value - Math.floor(value);
};

const normalizeWeights = (weights) => {
  const safe = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, clamp01(value)]));
  const total = Object.values(safe).reduce((sum, value) => sum + value, 0);
  if (total <= 1e-6) return { grass: 1, soil: 0, mud: 0, rock: 0, scree: 0, snow: 0, wetEdge: 0, foam: 0 };
  return Object.fromEntries(Object.entries(safe).map(([key, value]) => [key, value / total]));
};

export function createEnvironmentObservationLedger(observation = {}) {
  const elevation = finite(observation.elevation);
  const slope = clamp01(observation.slope);
  const moisture = clamp01(observation.moisture);
  const waterDistance = Math.max(0, finite(observation.waterDistance, 9999));
  const waterDepth = Math.max(0, finite(observation.waterDepth));
  const waterCoverage = clamp01(observation.waterCoverage);
  const biome = typeof observation.biome === 'string' ? observation.biome : 'unknown';
  const x = finite(observation.x);
  const z = finite(observation.z);
  const distance = Math.max(0, finite(observation.cameraDistance, 0));
  const seed = finite(observation.seed);

  const shore = clamp01(1 - waterDistance / 18);
  const shallow = clamp01(1 - waterDepth / 12) * waterCoverage;
  const alpine = clamp01((elevation - 420) / 380);
  const snowline = clamp01((elevation - 560) / 260) * clamp01(1 - slope * 0.35);
  const cliff = clamp01((slope - 0.62) / 0.38);
  const rockExposure = Math.max(cliff, alpine * 0.55);
  const wetEdge = shore * clamp01(0.35 + moisture * 0.65) * (1 - shallow * 0.55);
  const foam = shore * shallow * clamp01(0.25 + waterCoverage * 0.75);
  const macro = 0.55 + hash01(x * 0.17, z * 0.17, seed) * 0.45;
  const micro = 0.35 + hash01(x * 1.73, z * 1.73, seed + 11) * 0.65;
  const antiTilingPhase = { x: hash01(x, z, seed + 3), y: hash01(x, z, seed + 7) };

  const weights = normalizeWeights({
    grass: clamp01((1 - slope) * (1 - alpine * 0.72) * (1 - shore * 0.35) * (0.45 + moisture * 0.55)),
    soil: clamp01((1 - slope * 0.7) * (1 - shore * 0.4) * (1 - alpine * 0.45)),
    mud: clamp01(moisture * 0.8 * (1 - slope * 0.35) * (0.5 + shore * 0.5)),
    rock: clamp01(rockExposure * (0.7 + slope * 0.3)),
    scree: clamp01(rockExposure * slope * (0.65 + alpine * 0.35)),
    snow: snowline,
    wetEdge,
    foam,
  });

  const invalidGround = waterCoverage > 0.8 || cliff > 0.92 || !Number.isFinite(elevation);
  const vegetationEligible = !invalidGround && waterDistance > 4 && cliff < 0.72 && snowline < 0.86;
  const density = vegetationEligible
    ? clamp01((1 - slope * 0.65) * (0.35 + moisture * 0.65) * (1 - shore * 0.75) * (1 - alpine * 0.55))
    : 0;

  return Object.freeze({
    schema: 'environment-observation-ledger/v42',
    biome,
    canonical: { elevation, slope, moisture, waterDistance, waterDepth, waterCoverage },
    surfaces: { ...weights, macro, micro, antiTilingPhase },
    water: { shore, shallow, wetEdge, foam, rectangularRisk: waterCoverage > 0.82 ? 1 : 0, moireRisk: shallow > 0.72 && distance < 260 ? 1 : 0 },
    geology: { alpine, snowline, cliff, rockExposure, talus: clamp01(rockExposure * slope) },
    vegetation: { eligible: vegetationEligible, density, lodBias: distance > 700 ? 2 : distance > 280 ? 1 : 0, instanceGroup: vegetationEligible ? `${biome}:grounded` : 'none' },
    parity: { canonicalY: elevation, renderedY: finite(observation.renderedY, elevation), colliderY: finite(observation.colliderY, elevation) },
    atmosphere: { fogLift: clamp01(0.2 + distance / 2400), exposureFloor: 0.18, blackSkyGuard: true },
    acceptance: {
      visibleGridOrSeam: 0,
      visibleRectangularWater: waterCoverage > 0.82 ? 1 : 0,
      visibleWaterMoire: shallow > 0.72 && distance < 260 ? 1 : 0,
      floatingOrInterpenetrating: invalidGround ? 1 : 0,
      blackSkyFailure: 0,
    },
  });
}

export function applyEnvironmentObservationLedger(material, observation = {}) {
  if (!material || typeof material !== 'object') return material;
  const ledger = createEnvironmentObservationLedger(observation);
  if ('roughness' in material) material.roughness = Math.min(0.96, Math.max(0.24, 0.72 - ledger.surfaces.wetEdge * 0.2 + ledger.surfaces.rock * 0.12));
  if ('normalScale' in material && material.normalScale && typeof material.normalScale === 'object') {
    const scale = Math.max(0.15, Math.min(1, ledger.surfaces.micro * (ledger.surfaces.macro * 0.85 + 0.15)));
    material.normalScale.x = scale;
    material.normalScale.y = scale;
  }
  if ('opacity' in material) material.opacity = Math.min(1, Math.max(0.32, 0.62 + ledger.water.shore * 0.18 - ledger.water.shallow * 0.12));
  material.userData = { ...(material.userData || {}), environmentObservationLedger: ledger };
  return material;
}

export const ENVIRONMENT_OBSERVATION_LEDGER_V42 = Object.freeze({
  version: 42,
  camera: Object.freeze({ width: 1536, height: 1024, orthographicDegrees: 90, profiles: ['full-world', 'far', 'near-center', 'near-northwest'] }),
  targets: Object.freeze({ visibleGridOrSeam: 0, visibleRectangularWater: 0, visibleWaterMoire: 0, floatingOrInterpenetrating: 0, blackSkyFailure: 0 }),
});
