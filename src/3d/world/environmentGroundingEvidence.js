/**
 * Grounded environment evidence contract.
 *
 * This module is intentionally additive and DOM-free. It does not create
 * geometry, choose canonical geography, load assets, mutate scene state, or
 * replace the shared material/placement authority. Callers provide the
 * already-authoritative observations from the shipped scene and receive a
 * deterministic, bounded evidence payload that can be attached to visual
 * acceptance and runtime diagnostics.
 */

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const bool = (value) => value === true;
const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback);
const round = (value, digits = 6) => {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
};

const normalizeVector = (value) => ({
  x: round(clamp(value?.x, -1e7, 1e7)),
  y: round(clamp(value?.y, -1e7, 1e7)),
  z: round(clamp(value?.z, -1e7, 1e7)),
});

const normalizeObservation = (sample = {}, index = 0) => {
  const canonical = finite(sample.canonicalHeight);
  const rendered = finite(sample.renderedHeight, canonical);
  const collider = finite(sample.colliderHeight, canonical);
  const slope = clamp(sample.slope, 0, 1);
  const moisture = clamp(sample.moisture, 0, 1);
  const waterDistance = clamp(sample.waterDistance, 0, 1e7);
  const elevation = clamp(sample.elevation, -1e7, 1e7);
  const biome = text(sample.biome, 'unknown').toLowerCase();
  const position = normalizeVector(sample.position);
  const renderDelta = Math.abs(rendered - canonical);
  const colliderDelta = Math.abs(collider - canonical);
  const steep = slope >= 0.72;
  const alpine = biome.includes('alpine') || biome.includes('tundra') || biome.includes('glacier');
  const shoreline = waterDistance <= 24;
  const snowline = alpine || elevation >= 0.78;
  return {
    id: text(sample.id, `sample-${index}`),
    index,
    position,
    biome,
    elevation: round(elevation),
    slope: round(slope),
    moisture: round(moisture),
    waterDistance: round(waterDistance),
    canonicalHeight: round(canonical),
    renderedHeight: round(rendered),
    colliderHeight: round(collider),
    renderDelta: round(renderDelta),
    colliderDelta: round(colliderDelta),
    steep,
    alpine,
    shoreline,
    snowline,
    grounded: colliderDelta <= 0.08 && renderDelta <= 0.08,
    invalidGrounding: colliderDelta > 0.2 || renderDelta > 0.2,
    waterRisk: bool(sample.inWater) || (shoreline && waterDistance <= 1),
    roadRisk: bool(sample.onRoad) || bool(sample.roadMask),
    settlementRisk: bool(sample.inSettlement) || bool(sample.settlementMask),
  };
};

const classifySurface = (sample) => {
  const { slope, moisture, elevation, alpine, shoreline, waterDistance } = sample;
  if (shoreline && waterDistance <= 2) return 'wet-edge';
  if (alpine && elevation >= 0.86) return 'snow';
  if (slope >= 0.82) return 'rock';
  if (slope >= 0.62) return 'scree';
  if (moisture >= 0.75) return 'mud';
  if (moisture <= 0.18 && elevation <= 0.32) return 'sand';
  return alpine ? 'snowline' : 'grass';
};

const deriveMaterialResponse = (sample) => {
  const surface = classifySurface(sample);
  const relief = clamp(sample.slope * 0.65 + sample.elevation * 0.35, 0, 1);
  const breakup = clamp(0.18 + relief * 0.42 + (1 - sample.waterDistance / 256) * 0.16, 0.18, 0.88);
  const normalEnergy = clamp(0.22 + sample.slope * 0.5 + sample.moisture * 0.14, 0.2, 0.9);
  const roughness = clamp(0.42 + sample.slope * 0.25 + sample.moisture * 0.18, 0.28, 0.94);
  return {
    surface,
    breakup: round(breakup),
    microRelief: round(clamp(0.12 + breakup * 0.7, 0.1, 0.82)),
    normalEnergy: round(normalEnergy),
    roughness: round(roughness),
    antiTilingPhase: {
      x: round((sample.position.x * 0.013 + sample.index * 0.17) % 1),
      y: round((sample.position.z * 0.017 + sample.index * 0.11) % 1),
    },
    snowlineBlend: round(sample.snowline ? clamp(0.34 + sample.slope * 0.46, 0.34, 0.92) : 0),
    talusBlend: round(sample.steep ? clamp(0.25 + sample.slope * 0.62, 0.25, 0.92) : 0),
    wetEdgeBlend: round(sample.shoreline ? clamp(0.28 + (1 - sample.waterDistance / 24) * 0.58, 0.28, 0.86) : 0),
  };
};

const deriveVegetationEligibility = (sample, budgetPressure = 0) => {
  const hardBlock = sample.waterRisk || sample.roadRisk || sample.settlementRisk || sample.invalidGrounding;
  const alpineBlock = sample.alpine && sample.snowline && sample.slope >= 0.68;
  const exclusionReason = hardBlock ? 'blocked-context' : alpineBlock ? 'alpine-snow-slope' : null;
  const baseDensity = sample.biome.includes('forest') ? 0.82 : sample.biome.includes('shrub') ? 0.56 : 0.28;
  const clearing = sample.shoreline ? 0.34 : sample.slope >= 0.72 ? 0.44 : 0.12;
  const density = clamp(baseDensity * (1 - clearing) * (1 - clamp(budgetPressure, 0, 1) * 0.65), 0, 0.9);
  return {
    eligible: !exclusionReason,
    exclusionReason,
    density: round(exclusionReason ? 0 : density),
    ecotone: sample.shoreline ? 'shore' : sample.alpine ? 'alpine' : sample.biome.includes('forest') ? 'forest-edge' : 'open-ground',
    yawJitter: round(clamp(0.18 + sample.moisture * 0.28, 0.1, 0.46)),
    scaleJitter: round(clamp(0.12 + (1 - sample.slope) * 0.14, 0.08, 0.28)),
    lodBias: round(clamp(sample.waterDistance < 48 ? -0.12 : sample.slope > 0.72 ? 0.18 : 0, -0.2, 0.25)),
  };
};

const deriveWaterEvidence = (sample) => {
  const shore = sample.shoreline;
  const shallow = sample.waterDistance <= 8;
  const deep = sample.waterDistance >= 48;
  return {
    category: deep ? 'deep' : shallow ? 'shallow' : shore ? 'shore' : 'dry',
    deepWeight: round(deep ? 1 : clamp(sample.waterDistance / 48, 0, 1)),
    shallowWeight: round(shallow ? 1 : clamp(1 - sample.waterDistance / 8, 0, 1)),
    wetEdgeWeight: round(shore ? clamp(1 - sample.waterDistance / 24, 0, 1) : 0),
    foamWeight: round(shore ? clamp(1 - sample.waterDistance / 6, 0, 1) : 0),
    moireGuard: shallow || shore,
    rectangularCoverageRisk: bool(sample.rectangularWater) || bool(sample.hardWaterMask),
  };
};

const stableHash = (value) => {
  const source = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

export function buildEnvironmentGroundingEvidence(input = {}) {
  const observations = Array.isArray(input.observations) ? input.observations : [];
  const budgetPressure = clamp(input.budgetPressure, 0, 1);
  const samples = observations.map(normalizeObservation);
  const records = samples.map((sample) => ({
    ...sample,
    material: deriveMaterialResponse(sample),
    vegetation: deriveVegetationEligibility(sample, budgetPressure),
    water: deriveWaterEvidence(sample),
  }));
  const summary = {
    sampleCount: records.length,
    groundedCount: records.filter((record) => record.grounded).length,
    invalidGroundingCount: records.filter((record) => record.invalidGrounding).length,
    shorelineCount: records.filter((record) => record.shoreline).length,
    waterRiskCount: records.filter((record) => record.water.rectangularCoverageRisk || record.water.moireGuard).length,
    vegetationEligibleCount: records.filter((record) => record.vegetation.eligible).length,
    visibleSeamRisk: records.some((record) => record.invalidGrounding),
    visibleRectangularWaterRisk: records.some((record) => record.water.rectangularCoverageRisk),
    visibleWaterMoireRisk: records.some((record) => record.water.moireGuard),
    blackSkyRisk: bool(input.blackSkyRisk),
    renderColliderParity: records.every((record) => record.grounded),
  };
  const acceptance = {
    visibleGridOrSeam: summary.visibleSeamRisk ? 1 : 0,
    visibleRectangularWater: summary.visibleRectangularWaterRisk ? 1 : 0,
    visibleWaterMoire: summary.visibleWaterMoireRisk ? 1 : 0,
    floatingOrInterpenetrating: records.some((record) => record.invalidGrounding) ? 1 : 0,
    blackSky: summary.blackSkyRisk ? 1 : 0,
    placeholderGeometry: records.some((record) => record.vegetation.exclusionReason === 'placeholder') ? 1 : 0,
  };
  const payload = {
    contract: 'buzul-muhafizi.environment-grounding-evidence.v36',
    readOnly: true,
    callerOwnsCanonicalState: true,
    sharedMaterialPlacementAuthority: 'src/3d/materials/MaterialAssignmentCore.js + src/3d/world/WorldAssetPlacementPipeline.js',
    cameraProfiles: ['full-world-1536x1024-orthographic', 'terrain-far', 'terrain-near-center', 'terrain-near-northwest'],
    records,
    summary,
    acceptance,
  };
  payload.digest = stableHash(payload);
  return deepFreeze(payload);
}

export function serializeEnvironmentGroundingEvidence(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

export default buildEnvironmentGroundingEvidence;
