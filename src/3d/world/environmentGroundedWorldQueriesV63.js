/**
 * V63 shared world-query projections for non-environment agents.
 *
 * Terrain/collider/water/biome/navigation ownership stays external. These helpers
 * turn the Buzul Muhafızı runtime observations into small, stable query surfaces.
 */
import {
  V63_CONTRACT,
  createGroundedVisualRuntimeV63,
  createNaturalTransformV63,
  createHabitatDensityV63,
  createStreamingPlanV63,
  createParityDiagnosticsV63,
  createShorelineBandProfileV63,
  createWaterOpticalResponseV63,
} from './environmentGroundedVisualRuntimeV63.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function hash(value) {
  let h = 2166136261;
  const source = String(value);
  for (let index = 0; index < source.length; index += 1) {
    h ^= source.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function normalizePoint(point = {}) {
  return freeze({ x: finite(point.x), y: finite(point.y), z: finite(point.z) });
}

function normalizeDistance(value, max = 50000) {
  return clamp(value, 0, max);
}

export function getGroundQueryV63(observation = {}) {
  const plan = createGroundedVisualRuntimeV63(observation);
  return freeze({
    contract: V63_CONTRACT.id,
    sampleId: plan.sampleId,
    point: normalizePoint({
      x: plan.input.terrain.x,
      y: plan.input.terrain.canonicalHeight,
      z: plan.input.terrain.z,
    }),
    heightMeters: plan.input.terrain.canonicalHeight,
    slopeDegrees: plan.input.terrain.slope,
    normal: plan.input.terrain.normal,
    biome: plan.input.terrain.biome,
    surface: plan.input.terrain.surface,
    moisture: plan.input.terrain.moisture,
    elevation01: plan.input.terrain.elevation01,
    snowWeight: plan.input.terrain.snowWeight,
    parity: Object.freeze({
      pass: plan.geometry.parityPass,
      renderDelta: plan.geometry.renderDelta,
      colliderDelta: plan.geometry.colliderDelta,
    }),
    fingerprint: plan.fingerprint,
  });
}

export function getWaterQueryV63(observation = {}) {
  const plan = createGroundedVisualRuntimeV63(observation);
  return freeze({
    sampleId: plan.sampleId,
    class: plan.water.class,
    recognized: plan.water.recognized,
    distance: plan.input.water.distance,
    depth: plan.input.water.depth,
    deepWeight: plan.water.deep,
    shallowWeight: plan.water.shallow,
    shoreWeight: plan.water.shore,
    wetEdge: plan.water.wetEdge,
    foam: plan.water.foam,
    cyanSuppression: plan.water.cyanSuppression,
    moireSuppression: plan.water.moireSuppression,
    shorelineIntegrity: plan.water.shorelineIntegrity,
  });
}

export function getPlacementQueryV63(observation = {}) {
  const plan = createGroundedVisualRuntimeV63(observation);
  return freeze({
    total: plan.vegetation.total,
    eligible: plan.vegetation.eligible,
    invalid: plan.vegetation.invalid,
    results: freeze(plan.vegetation.results.map((item) => freeze({
      assetId: item.assetId,
      eligible: item.eligible,
      reason: item.reason,
      ecotone: item.ecotone,
      scale: item.scale,
      lod: item.lod,
      batch: item.batch,
    }))),
  });
}

export function getSurfaceQueryV63(observation = {}) {
  const plan = createGroundedVisualRuntimeV63(observation);
  return freeze({
    weights: plan.material.weights,
    roughness: plan.material.roughness,
    normalScale: plan.material.normalScale,
    ao: plan.material.ao,
    macroContrast: plan.material.macroContrast,
    microDetail: plan.material.microDetail,
    antiTilingPhase: plan.material.antiTilingPhase,
    worldSpaceScale: plan.material.worldSpaceScale,
    triplanarEquivalent: plan.material.triplanarEquivalent,
    snowlineBreakup: plan.material.snowlineBreakup,
  });
}

export function getAcceptanceQueryV63(observation = {}) {
  const plan = createGroundedVisualRuntimeV63(observation);
  return freeze({
    mergeEligible: plan.acceptance.mergeEligible,
    blockers: plan.acceptance.releaseBlockers,
    profile: plan.acceptanceProfile,
    p0: plan.p0,
    p1: plan.geometry,
    p4: plan.water,
    p5: plan.atmosphere,
    riskScore: plan.riskScore,
    fingerprint: plan.fingerprint,
  });
}

export function queryPointEligibilityV63({ terrain = {}, water = {}, slopeLimit = 58, minGroundConfidence = 0.72 } = {}) {
  const slope = clamp(terrain.slope, 0, 89.9);
  const confidence = clamp01(terrain.groundConfidence ?? 1);
  const waterClass = text(water.waterClass, 'unknown').toLowerCase();
  const distance = normalizeDistance(water.waterDistance);
  const canonical = waterClass === 'land' && distance >= 2;
  return freeze({
    eligible: canonical && slope < slopeLimit && confidence >= minGroundConfidence,
    slope,
    confidence,
    waterClass,
    distance,
    reasons: freeze([
      ...(canonical ? [] : ['water-exclusion']),
      ...(slope < slopeLimit ? [] : ['slope-exclusion']),
      ...(confidence >= minGroundConfidence ? [] : ['ground-confidence']),
    ]),
  });
}

export function queryVegetationHabitatsV63(options = {}) {
  return createHabitatDensityV63({
    biome: text(options.biome, 'temperate'),
    slope: clamp(options.slope, 0, 89.9),
    moisture: clamp01(options.moisture),
    elevation01: clamp01(options.elevation01),
    waterDistance: normalizeDistance(options.waterDistance),
    roadDistance: normalizeDistance(options.roadDistance),
    settlementDistance: normalizeDistance(options.settlementDistance),
  });
}

export function queryStreamingBudgetV63(options = {}) {
  return createStreamingPlanV63({
    cameraDistance: normalizeDistance(options.cameraDistance, 20000),
    visibleChunks: clamp(options.visibleChunks, 1, 512),
    residentChunks: clamp(options.residentChunks, 1, 1024),
    vegetationInstances: clamp(options.vegetationInstances, 0, 1000000),
    textureMemoryMb: clamp(options.textureMemoryMb, 0, 65536),
    mobile: options.mobile === true,
  });
}

export function queryNaturalPlacementTransformV63(options = {}) {
  return createNaturalTransformV63({
    assetId: text(options.assetId, 'asset'),
    x: finite(options.x),
    z: finite(options.z),
    seed: text(options.seed, 'v63'),
    minScale: clamp(options.minScale ?? 0.82, 0.1, 8),
    maxScale: clamp(options.maxScale ?? 1.18, 0.1, 8),
  });
}

export function queryParityV63(options = {}) {
  return createParityDiagnosticsV63({
    canonicalHeight: finite(options.canonicalHeight),
    renderedHeight: finite(options.renderedHeight),
    colliderHeight: finite(options.colliderHeight),
    canonicalX: finite(options.canonicalX),
    canonicalZ: finite(options.canonicalZ),
    renderedX: finite(options.renderedX),
    renderedZ: finite(options.renderedZ),
    colliderX: finite(options.colliderX),
    colliderZ: finite(options.colliderZ),
    toleranceMeters: clamp(options.toleranceMeters ?? 0.25, 0.01, 5),
  });
}

export function queryShorelineBandsV63(options = {}) {
  return createShorelineBandProfileV63({
    waterClass: text(options.waterClass, 'sea'),
    distance: normalizeDistance(options.distance, 500),
    depth: clamp(options.depth, 0, 2000),
    wetEdge: clamp01(options.wetEdge),
    foam: clamp01(options.foam),
  });
}

export function queryWaterOpticsV63(options = {}) {
  return createWaterOpticalResponseV63({
    waterClass: text(options.waterClass, 'sea'),
    depth: clamp(options.depth, 0, 2000),
    distance: normalizeDistance(options.distance, 500),
    wetEdge: clamp01(options.wetEdge),
    foam: clamp01(options.foam),
    cyanRisk: clamp01(options.cyanRisk),
    moireRisk: clamp01(options.moireRisk),
  });
}

export function createCapabilityManifestV63() {
  return freeze({
    contract: V63_CONTRACT.id,
    canonicalExtent: V63_CONTRACT.canonicalExtent,
    capabilities: freeze({
      ground: getGroundQueryV63,
      water: getWaterQueryV63,
      placement: getPlacementQueryV63,
      surface: getSurfaceQueryV63,
      acceptance: getAcceptanceQueryV63,
      habitat: queryVegetationHabitatsV63,
      streaming: queryStreamingBudgetV63,
      transform: queryNaturalPlacementTransformV63,
      parity: queryParityV63,
      shoreline: queryShorelineBandsV63,
      waterOptics: queryWaterOpticsV63,
    }),
    ownership: freeze({
      terrain: 'caller-owned',
      collider: 'caller-owned',
      hydrology: 'caller-owned',
      roads: 'caller-owned',
      settlements: 'caller-owned',
      placement: 'merged-#590',
    }),
    readOnly: true,
    createsGeometry: false,
    hydratesAssets: false,
    importsEditorUi: false,
    fingerprint: hash(V63_CONTRACT.id),
  });
}

export function compareWorldQueriesV63(first, second) {
  const a = getGroundQueryV63(first);
  const b = getGroundQueryV63(second);
  return freeze({
    samePoint: JSON.stringify(a.point) === JSON.stringify(b.point),
    sameHeight: a.heightMeters === b.heightMeters,
    sameSurface: a.surface === b.surface,
    sameBiome: a.biome === b.biome,
    sameParity: JSON.stringify(a.parity) === JSON.stringify(b.parity),
    sameFingerprint: a.fingerprint === b.fingerprint,
  });
}

export function createNeighborhoodQueryV63(center, neighbors = []) {
  const origin = getGroundQueryV63(center);
  const rows = (Array.isArray(neighbors) ? neighbors : []).slice(0, 128).map(getGroundQueryV63);
  const deltas = rows.map((row) => freeze({
    sampleId: row.sampleId,
    dx: row.point.x - origin.point.x,
    dz: row.point.z - origin.point.z,
    dy: row.heightMeters - origin.heightMeters,
    distance: Math.hypot(row.point.x - origin.point.x, row.point.z - origin.point.z),
  }));
  return freeze({
    origin,
    count: rows.length,
    neighbors: freeze(rows),
    deltas: freeze(deltas),
    maxHeightDelta: Math.max(0, ...deltas.map((row) => Math.abs(row.dy))),
  });
}

export function createTerrainTraversalQueryV63(samples = []) {
  const rows = (Array.isArray(samples) ? samples : []).slice(0, 256).map(getGroundQueryV63);
  const walkable = rows.filter((row) => row.slopeDegrees < 28 && row.parity.pass);
  const blocked = rows.filter((row) => !walkable.includes(row));
  return freeze({
    count: rows.length,
    walkable: walkable.length,
    blocked: blocked.length,
    rows: freeze(rows),
    routeReady: rows.length > 0 && blocked.length === 0,
    digest: hash(rows.map((row) => `${row.sampleId}:${row.fingerprint}`).sort().join('|')),
  });
}

export function createVisualGroundingContractV63() {
  return freeze({
    id: V63_CONTRACT.id,
    queryApi: createCapabilityManifestV63(),
    acceptance: V63_CONTRACT.acceptanceCamera,
    thresholds: V63_CONTRACT.thresholds,
    sharedPlacement: V63_CONTRACT.sharedPlacement,
  });
}
