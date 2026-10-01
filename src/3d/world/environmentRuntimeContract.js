/**
 * Canonical Environment Runtime Contract
 *
 * Runtime-facing, DOM-free and deterministic. Callers own canonical terrain,
 * hydrology, collider, roads, settlements, asset hydration and scene attach.
 * This module only converts already-owned observations into bounded render and
 * placement decisions so the shipped scene can consume one shared contract.
 */

const MAX_SAMPLES = 1024;
const MAX_ASSETS = 256;
const EPSILON = 1e-6;
const DEFAULTS = Object.freeze({
  maxSlopeForGroundedVegetation: 48,
  waterSafetyDistance: 2.5,
  snowlineHeight: 0.76,
  alpineHeight: 0.82,
  farNormalFadeStart: 180,
  farNormalFadeEnd: 1200,
  worldUnitSeed: 0x6d2b79f5,
});

const MATERIAL_FAMILIES = Object.freeze([
  'grass', 'soil', 'mud', 'sand', 'rock', 'scree', 'snow', 'wet', 'foam',
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const positive = (value, fallback = 0) => Math.max(0, finite(value, fallback));
const text = (value, fallback = '') => typeof value === 'string' ? value.slice(0, 160) : fallback;
const bool = (value) => value === true;
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

const hashUnit = (x, z, seed = DEFAULTS.worldUnitSeed) => {
  let h = (seed ^ Math.imul(Math.round(finite(x) * 1000), 374761393)) >>> 0;
  h = (h ^ Math.imul(Math.round(finite(z) * 1000), 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const stableCompare = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort(stableCompare).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const digest = (value) => {
  const source = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const normalizeSample = (sample, index) => {
  const x = finite(sample?.x, 0);
  const z = finite(sample?.z, 0);
  const height = clamp(finite(sample?.height, 0), -1, 2);
  const slope = clamp(Math.abs(finite(sample?.slope, 0)), 0, 90);
  const moisture = clamp(finite(sample?.moisture, 0), 0, 1);
  const temperature = clamp(finite(sample?.temperature, 0), -80, 80);
  const waterDistance = finite(sample?.waterDistance, 999999);
  const waterCoverage = clamp(finite(sample?.waterCoverage, 0), 0, 1);
  const shorelineGradient = clamp(finite(sample?.shorelineGradient, 0), 0, 1);
  const rockExposure = clamp(finite(sample?.rockExposure, 0), 0, 1);
  const snowCoverage = clamp(finite(sample?.snowCoverage, 0), 0, 1);
  const reliefVariance = clamp(finite(sample?.reliefVariance, 0), 0, 1);
  const forestDensity = clamp(finite(sample?.forestDensity, 0), 0, 1);
  const frameTimeMs = clamp(finite(sample?.frameTimeMs, 16.7), 0, 1000);
  const cameraDistance = Math.max(0, finite(sample?.cameraDistance, 0));
  const biome = text(sample?.biome, 'unknown');
  const bodyClass = text(sample?.waterBodyClass, waterCoverage > 0.5 ? 'water' : 'land');
  const canonicalHeight = finite(sample?.canonicalHeight, sample?.y);
  const renderedHeight = finite(sample?.renderedHeight, canonicalHeight);
  const colliderHeight = finite(sample?.colliderHeight, canonicalHeight);
  return {
    index,
    id: text(sample?.id, `sample-${index}`),
    x: round(x),
    z: round(z),
    height: round(height),
    slope: round(slope),
    moisture: round(moisture),
    temperature: round(temperature),
    waterDistance: round(waterDistance),
    waterCoverage: round(waterCoverage),
    shorelineGradient: round(shorelineGradient),
    rockExposure: round(rockExposure),
    snowCoverage: round(snowCoverage),
    reliefVariance: round(reliefVariance),
    forestDensity: round(forestDensity),
    frameTimeMs: round(frameTimeMs),
    cameraDistance: round(cameraDistance),
    biome,
    waterBodyClass: bodyClass,
    canonicalHeight: round(canonicalHeight),
    renderedHeight: round(renderedHeight),
    colliderHeight: round(colliderHeight),
    placeholder: bool(sample?.placeholder),
    missingAsset: bool(sample?.missingAsset),
    materialMismatch: bool(sample?.materialMismatch),
    floatingAsset: bool(sample?.floatingAsset),
    interpenetratingAsset: bool(sample?.interpenetratingAsset),
    seamRisk: clamp(finite(sample?.seamRisk, 0), 0, 1),
    rectangularWaterRisk: clamp(finite(sample?.rectangularWaterRisk, 0), 0, 1),
    waterStripeRisk: clamp(finite(sample?.waterStripeRisk, 0), 0, 1),
    blackSkyRisk: clamp(finite(sample?.blackSkyRisk, 0), 0, 1),
    textureRepeatRisk: clamp(finite(sample?.textureRepeatRisk, 0), 0, 1),
    skyLuminance: clamp(finite(sample?.skyLuminance, 0.2), 0, 1),
    reliefClass: text(sample?.reliefClass, slope >= 52 ? 'steep' : height >= 0.82 ? 'alpine' : 'rolling'),
  };
};

const sortSamples = (samples) => [...samples].sort((a, b) => {
  const idOrder = stableCompare(a.id, b.id);
  if (idOrder !== 0) return idOrder;
  if (a.x !== b.x) return a.x - b.x;
  return a.z - b.z;
});

const normalizeWeights = (raw) => {
  const weights = {};
  MATERIAL_FAMILIES.forEach((family) => { weights[family] = positive(raw[family]); });
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total <= EPSILON) {
    weights.soil = 1;
    return weights;
  }
  MATERIAL_FAMILIES.forEach((family) => { weights[family] = round(weights[family] / total); });
  return weights;
};

const deriveSurface = (sample) => {
  const alpine = clamp((sample.height - DEFAULTS.alpineHeight) / 0.28, 0, 1);
  const snowline = clamp((sample.height - DEFAULTS.snowlineHeight) / 0.2, 0, 1);
  const steep = clamp((sample.slope - 28) / 42, 0, 1);
  const shore = clamp(sample.shorelineGradient * (1 - Math.min(1, sample.waterDistance / 24)), 0, 1);
  const wet = clamp(sample.moisture * 0.55 + shore * 0.45, 0, 1);
  const raw = {
    grass: (1 - steep) * (1 - alpine) * (1 - sample.snowCoverage) * (1 - sample.waterCoverage),
    soil: (1 - sample.snowCoverage) * (0.34 + sample.reliefVariance * 0.3),
    mud: sample.moisture * (1 - sample.snowCoverage) * (1 - steep * 0.45),
    sand: shore * (1 - sample.rockExposure) * (sample.temperature > -4 ? 1 : 0.2),
    rock: Math.max(sample.rockExposure, steep * 0.72, alpine * 0.48),
    scree: steep * 0.52 + sample.rockExposure * 0.28 + alpine * 0.2,
    snow: Math.max(sample.snowCoverage, snowline * 0.72),
    wet: wet,
    foam: clamp(shore * (0.4 + sample.waterCoverage * 0.6), 0, 1),
  };
  const weights = normalizeWeights(raw);
  const dominant = Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
  return {
    dominant,
    weights,
    macroBreakup: round(clamp(sample.reliefVariance * 0.6 + sample.rockExposure * 0.4, 0, 1)),
    microRelief: round(clamp(0.16 + sample.reliefVariance * 0.72 + steep * 0.12, 0, 1)),
    antiTilingPhase: round(hashUnit(sample.x, sample.z) * Math.PI * 2),
    normalEnergy: round(clamp(1 - Math.max(0, sample.cameraDistance - DEFAULTS.farNormalFadeStart) / (DEFAULTS.farNormalFadeEnd - DEFAULTS.farNormalFadeStart), 0.08, 1)),
    snowlineBand: round(clamp(0.18 + Math.abs(sample.height - DEFAULTS.snowlineHeight) * 1.8, 0.18, 1)),
    shorelineBand: round(shore),
  };
};

const deriveWater = (sample) => {
  if (sample.waterCoverage <= EPSILON && sample.waterDistance > 8 && sample.shorelineGradient <= EPSILON) return null;
  const depth = clamp(sample.waterCoverage * 0.72 + Math.min(1, Math.max(0, sample.waterDistance) / 30) * 0.18, 0, 1);
  const shore = clamp(sample.shorelineGradient * (1 - Math.min(1, sample.waterDistance / 20)), 0, 1);
  const moire = clamp(sample.waterStripeRisk * 0.7 + sample.rectangularWaterRisk * 0.3, 0, 1);
  return {
    bodyClass: sample.waterBodyClass,
    depth: round(depth),
    shallow: round(1 - depth),
    shore: round(shore),
    wetEdge: round(clamp(shore * 0.82 + sample.moisture * 0.18, 0, 1)),
    foam: round(clamp(shore * (0.5 + sample.slope / 180), 0, 1)),
    deepToShallowBlend: round(clamp(0.22 + shore * 0.72, 0.22, 1)),
    normalEnergy: round(clamp(1 - Math.max(0, sample.cameraDistance - 120) / 1100, 0.05, 1)),
    antiMoire: round(moire),
    rotatedCarriers: moire > 0.1,
    rectangularCoverageSuppressed: sample.rectangularWaterRisk > 0.05,
    canonicalWaterOnly: sample.waterCoverage > 0.5 || sample.waterBodyClass !== 'land',
  };
};

const deriveVegetation = (sample, options) => {
  const reasons = [];
  const waterBlocked = sample.waterCoverage > 0.18 || sample.waterDistance < options.waterSafetyDistance;
  const slopeBlocked = sample.slope > options.maxSlopeForGroundedVegetation;
  const snowBlocked = sample.snowCoverage > 0.72 || sample.height >= 0.96;
  const invalidAsset = sample.placeholder || sample.missingAsset || sample.floatingAsset || sample.interpenetratingAsset;
  if (waterBlocked) reasons.push('canonical-water');
  if (slopeBlocked) reasons.push('steep-slope');
  if (snowBlocked) reasons.push('persistent-snow');
  if (invalidAsset) reasons.push('invalid-asset');
  const accepted = reasons.length === 0;
  const pressure = clamp((sample.frameTimeMs - 16.7) / 24, 0, 1);
  const baseDensity = clamp(sample.forestDensity * (1 - sample.slope / 90) * (1 - sample.snowCoverage), 0, 1);
  return {
    accepted,
    reasons,
    density: round(accepted ? baseDensity * (1 - pressure * 0.75) : 0),
    clusterStrength: round(accepted ? clamp(baseDensity * 1.25, 0, 1) : 0),
    ecotone: round(clamp(Math.abs(sample.moisture - 0.5) * 1.6 + sample.reliefVariance * 0.25, 0, 1)),
    yawPhase: round(hashUnit(sample.x + 11.7, sample.z - 7.3) * Math.PI * 2),
    scaleRange: [round(0.78 + hashUnit(sample.x, sample.z, options.worldUnitSeed + 13) * 0.16), round(1.08 + hashUnit(sample.x, sample.z, options.worldUnitSeed + 29) * 0.26)],
    lodBias: round(clamp(sample.cameraDistance / 900 + pressure * 0.5, 0, 1)),
    instancingRequired: baseDensity > 0.18,
    groundTransformRequired: accepted,
    manifestContract: 'MaterialAssignmentCore+WorldAssetPlacementPipeline',
  };
};

const deriveAtmosphere = (sample) => {
  const blackSky = sample.blackSkyRisk > 0.1 || sample.skyLuminance < 0.06;
  const fogNear = round(clamp(22 + sample.cameraDistance * 0.03, 12, 180));
  const fogFar = round(clamp(420 + sample.cameraDistance * 0.82, fogNear + 40, 3800));
  return {
    cameraRelativeSky: true,
    blackSkyGuard: blackSky,
    skyLuminance: round(Math.max(sample.skyLuminance, blackSky ? 0.12 : 0.04)),
    fogNear,
    fogFar,
    exposure: round(clamp(0.92 + (0.22 - sample.skyLuminance) * 0.9, 0.72, 1.18)),
    horizonReadability: round(clamp(0.7 + sample.skyLuminance * 0.8 - sample.blackSkyRisk * 0.5, 0.2, 1)),
  };
};

const deriveParity = (samples) => {
  const rendered = samples.map((sample) => Math.abs(sample.renderedHeight - sample.canonicalHeight));
  const collider = samples.map((sample) => Math.abs(sample.colliderHeight - sample.canonicalHeight));
  const renderCollider = samples.map((sample) => Math.abs(sample.renderedHeight - sample.colliderHeight));
  const max = (values) => round(values.reduce((value, current) => Math.max(value, current), 0));
  return {
    sameCoordinate: true,
    maxRenderedCanonical: max(rendered),
    maxColliderCanonical: max(collider),
    maxRenderedCollider: max(renderCollider),
    acceptable: max(rendered) <= 0.15 && max(collider) <= 0.2 && max(renderCollider) <= 0.2,
  };
};

const deriveAcceptance = (samples, reports, waterPlans, vegetationPlans, atmospherePlans, parity) => {
  const p0 = {
    visibleGridSeam: samples.filter((sample) => sample.seamRisk > 0.1).length,
    visibleRectangularWaterBlock: samples.filter((sample) => sample.rectangularWaterRisk > 0.1).length,
    visibleWaterMoire: samples.filter((sample) => sample.waterStripeRisk > 0.1).length,
    visibleBlackSky: samples.filter((sample) => sample.blackSkyRisk > 0.1 || sample.skyLuminance < 0.06).length,
  };
  const p1 = {
    flatCliff: reports.filter((report) => report.sample.reliefClass === 'steep' && report.surface.rock < 0.22).length,
    flatSnow: reports.filter((report) => report.sample.snowCoverage > 0.6 && report.surface.rock < 0.14 && report.sample.reliefVariance < 0.18).length,
    missingTalus: reports.filter((report) => report.sample.slope > 44 && report.surface.weights.scree < 0.12).length,
    parityMismatch: parity.acceptable ? 0 : 1,
  };
  const p2 = {
    flatGround: reports.filter((report) => report.surface.macroBreakup < 0.12).length,
    textureRepeat: samples.filter((sample) => sample.textureRepeatRisk > 0.2).length,
  };
  const p3 = {
    invalidVegetation: vegetationPlans.filter((plan) => !plan.accepted && plan.reasons.includes('invalid-asset')).length,
    vegetationVoid: vegetationPlans.filter((plan) => plan.accepted && plan.density <= 0.02).length,
  };
  const p4 = {
    weakWetEdge: waterPlans.filter((plan) => plan.shore > 0.1 && plan.wetEdge < 0.18).length,
    hardCoverage: waterPlans.filter((plan) => plan.rectangularCoverageSuppressed).length,
    moire: waterPlans.filter((plan) => plan.antiMoire > 0.2).length,
  };
  const p5 = {
    blackSky: atmospherePlans.filter((plan) => plan.blackSkyGuard).length,
    unreadableHorizon: atmospherePlans.filter((plan) => plan.horizonReadability < 0.35).length,
  };
  const failures = [p0, p1, p2, p3, p4, p5].flatMap((group) => Object.entries(group).filter(([, value]) => value > 0));
  return {
    pass: failures.length === 0,
    p0, p1, p2, p3, p4, p5,
    failureCount: failures.length,
    target: {
      visibleGridSeam: 0,
      visibleRectangularWaterBlock: 0,
      visibleWaterMoire: 0,
      visibleBlackSky: 0,
      missingAsset: 0,
      placeholder: 0,
      materialMismatch: 0,
      floatingAsset: 0,
      interpenetratingAsset: 0,
      renderColliderMismatch: 0,
    },
  };
};

const normalizeOptions = (options = {}) => ({
  ...DEFAULTS,
  maxSlopeForGroundedVegetation: clamp(finite(options.maxSlopeForGroundedVegetation, DEFAULTS.maxSlopeForGroundedVegetation), 1, 89),
  waterSafetyDistance: clamp(finite(options.waterSafetyDistance, DEFAULTS.waterSafetyDistance), 0, 1000),
  worldUnitSeed: Math.trunc(finite(options.worldUnitSeed, DEFAULTS.worldUnitSeed)),
});

export const ENVIRONMENT_RUNTIME_CAMERA_PROFILES = Object.freeze([
  Object.freeze({ id: 'full-world', width: 1536, height: 1024, projection: 'orthographic', degrees: 90, distance: 22000 }),
  Object.freeze({ id: 'terrain-far', width: 1536, height: 1024, projection: 'orthographic', degrees: 90, distance: 4200 }),
  Object.freeze({ id: 'terrain-near-center', width: 1536, height: 1024, projection: 'orthographic', degrees: 90, distance: 420 }),
  Object.freeze({ id: 'terrain-near-northwest', width: 1536, height: 1024, projection: 'orthographic', degrees: 90, distance: 420 }),
]);

export const ENVIRONMENT_RUNTIME_TARGETS = Object.freeze({
  visibleGridSeam: 0,
  visibleRectangularWaterBlock: 0,
  visibleWaterMoire: 0,
  visibleBlackSky: 0,
  placeholder: 0,
  missingAsset: 0,
  materialMismatch: 0,
  floatingAsset: 0,
  interpenetratingAsset: 0,
  renderColliderMismatch: 0,
});

export const buildEnvironmentRuntimePlan = ({ samples = [], options = {} } = {}) => {
  const normalizedOptions = normalizeOptions(options);
  const input = Array.isArray(samples) ? samples.slice(0, MAX_SAMPLES) : [];
  const normalized = sortSamples(input.map(normalizeSample));
  const reports = normalized.map((sample) => {
    const surface = deriveSurface(sample);
    return {
      id: sample.id,
      sample,
      surface,
      quality: {
        placeholder: sample.placeholder,
        missingAsset: sample.missingAsset,
        materialMismatch: sample.materialMismatch,
        floatingAsset: sample.floatingAsset,
        interpenetratingAsset: sample.interpenetratingAsset,
        textureRepeatRisk: sample.textureRepeatRisk,
      },
    };
  });
  const waterPlans = normalized.map(deriveWater).filter(Boolean);
  const vegetationPlans = normalized.map((sample) => deriveVegetation(sample, normalizedOptions));
  const atmospherePlans = normalized.map(deriveAtmosphere);
  const parity = deriveParity(normalized);
  const acceptance = deriveAcceptance(normalized, reports, waterPlans, vegetationPlans, atmospherePlans, parity);
  const manifest = {
    schema: 'aapw.environment-runtime-contract.v30',
    cameraProfiles: ENVIRONMENT_RUNTIME_CAMERA_PROFILES,
    sampleCount: normalized.length,
    reports: reports.map(({ id, surface, quality }) => ({ id, surface, quality })),
    waterPlans,
    vegetationPlans,
    atmospherePlans,
    parity,
    acceptance,
    runtimeOwnership: {
      canonicalTerrain: 'caller-owned',
      hydrology: 'caller-owned',
      coastline: 'caller-owned',
      collider: 'caller-owned',
      roads: 'caller-owned',
      settlements: 'caller-owned',
      sceneAttach: 'caller-owned',
      editorUiImported: false,
      geometryCreated: false,
      geographyInvented: false,
      sharedPlacementContract: 'MaterialAssignmentCore+WorldAssetPlacementPipeline',
    },
  };
  const result = {
    ...manifest,
    stableDigest: digest(manifest),
  };
  return deepFreeze(result);
};

export const evaluateEnvironmentRuntimeDelta = (beforeInput, afterInput) => {
  const before = buildEnvironmentRuntimePlan(beforeInput);
  const after = buildEnvironmentRuntimePlan(afterInput);
  const beforeScore = before.acceptance.failureCount + before.parity.maxRenderedCanonical + before.parity.maxColliderCanonical;
  const afterScore = after.acceptance.failureCount + after.parity.maxRenderedCanonical + after.parity.maxColliderCanonical;
  return deepFreeze({
    beforePass: before.acceptance.pass,
    afterPass: after.acceptance.pass,
    beforeScore: round(beforeScore),
    afterScore: round(afterScore),
    riskScoreDelta: round(afterScore - beforeScore),
    improved: afterScore < beforeScore,
    beforeDigest: before.stableDigest,
    afterDigest: after.stableDigest,
  });
};

export const applyEnvironmentMaterialHints = (material, surface) => {
  if (!material || typeof material !== 'object') return false;
  const profile = surface && typeof surface === 'object' ? surface : {};
  if (Number.isFinite(profile.roughness)) material.roughness = clamp(profile.roughness, 0, 1);
  if (Number.isFinite(profile.metalness)) material.metalness = clamp(profile.metalness, 0, 1);
  if (Number.isFinite(profile.normalScale)) material.normalScale = clamp(profile.normalScale, 0.05, 2);
  material.userData = {
    ...(material.userData && typeof material.userData === 'object' ? material.userData : {}),
    environmentRuntimeContract: 'aapw.environment-runtime-contract.v30',
    materialFamilies: MATERIAL_FAMILIES,
  };
  return true;
};

export const environmentRuntimeConstants = Object.freeze({
  MAX_SAMPLES,
  MAX_ASSETS,
  MATERIAL_FAMILIES,
  EPSILON,
});
