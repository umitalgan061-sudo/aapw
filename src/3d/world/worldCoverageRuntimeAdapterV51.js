/**
 * Runtime-facing world coverage adapter v51.
 *
 * This adapter is intentionally side-effect free. It bridges caller-owned
 * terrain/scene observations into the deterministic coverage director and
 * exposes query/acceptance functions suitable for createScene callers.
 *
 * Ownership boundary:
 * - terrain/elevation/hydrology/collider state stays caller-owned
 * - renderer/scene attachment stays caller-owned
 * - assets and MaterialAssignmentCore/WorldAssetPlacementPipeline stay
 *   caller-owned
 * - this module never creates geometry or mutates world state
 */

import {
  createWorldCoverageDirectorV51,
  createWorldCoverageBeforeAfterV51,
  applyWorldCoverageDirectorV51,
} from './worldCoverageDirectorV51.js';

const VERSION = 'v51-runtime-adapter';
const MAX_OBSERVATIONS = 512;
const ORTHO_WIDTH = 1536;
const ORTHO_HEIGHT = 1024;
const REQUIRED_BANDS = Object.freeze([
  'full-world',
  'far',
  'near-center',
  'near-northwest',
  'near-coast',
  'near-mountain',
]);
const SURFACE_KEYS = Object.freeze([
  'grass',
  'soil',
  'mud',
  'rock',
  'scree',
  'snow',
  'wet',
  'shoreline',
]);

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const nonNegative = (value, fallback = 0) => Math.max(0, finite(value, fallback));
const round = (value, places = 6) => {
  const factor = 10 ** places;
  return Math.round(finite(value) * factor) / factor;
};
const normalizeId = (value, fallback) => String(value ?? fallback).trim() || fallback;
const sortStable = (values) => [...values].sort((a, b) => String(a).localeCompare(String(b)));
const stableKeys = (object) => Object.keys(object || {}).sort();
const stableJson = (value) => {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (!entry || typeof entry !== 'object') return entry;
    return stableKeys(entry).reduce((result, key) => {
      result[key] = normalize(entry[key]);
      return result;
    }, {});
  };
  return JSON.stringify(normalize(value));
};
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const vec3 = (value = {}) => ({
  x: round(finite(value.x)),
  y: round(finite(value.y)),
  z: round(finite(value.z)),
});

const normalizeObservation = (source = {}, index) => {
  const weather = source.weather || {};
  return {
    id: normalizeId(source.id, `observation-${index}`),
    position: vec3(source.position),
    elevation: round(finite(source.elevation, source.position?.y ?? 0), 3),
    slope: round(clamp(source.slope, 0, 1)),
    moisture: round(clamp(source.moisture, 0, 1)),
    snow: round(clamp(source.snow, 0, 1)),
    waterDistance: round(nonNegative(source.waterDistance, Infinity), 3),
    roadDistance: round(nonNegative(source.roadDistance, Infinity), 3),
    settlementDistance: round(nonNegative(source.settlementDistance, Infinity), 3),
    distance: round(nonNegative(source.distance, 0), 3),
    horizonOcclusion: round(clamp(source.horizonOcclusion, 0, 1)),
    biome: normalizeId(source.biome, 'unknown').toLowerCase(),
    weather: {
      cloud: round(clamp(weather.cloud, 0, 1)),
      precipitation: round(clamp(weather.precipitation, 0, 1)),
      wind: round(clamp(weather.wind, 0, 1)),
      temperatureC: round(clamp(weather.temperatureC, -40, 60), 3),
    },
    cameraBand: normalizeId(source.cameraBand, 'unspecified').toLowerCase(),
  };
};

const normalizeInput = (input = {}) => {
  const raw = Array.isArray(input.observations)
    ? input.observations
    : Array.isArray(input.samples)
      ? input.samples
      : [];
  return {
    seed: Number.isFinite(input.seed) ? Math.trunc(input.seed) : 5101,
    framePressure: clamp(input.framePressure, 0, 1),
    observations: raw.slice(0, MAX_OBSERVATIONS).map(normalizeObservation),
    truncated: raw.length > MAX_OBSERVATIONS,
    sourceMode: Array.isArray(input.observations) ? 'observations' : 'samples',
  };
};

const bandLookup = (coverage) => {
  const entries = new Map((coverage.cameraProfiles || []).map(profile => [profile.id, profile]));
  return REQUIRED_BANDS.reduce((result, band) => {
    result[band] = entries.get(band) || null;
    return result;
  }, {});
};

const assertCameraCoverage = (coverage) => {
  const bands = bandLookup(coverage);
  const missingBands = REQUIRED_BANDS.filter(band => !bands[band]);
  const badResolution = REQUIRED_BANDS.filter(band => {
    const profile = bands[band];
    return profile && (profile.width !== ORTHO_WIDTH || profile.height !== ORTHO_HEIGHT);
  });
  const badDeterminism = REQUIRED_BANDS.filter(band => {
    const profile = bands[band];
    return profile && !Number.isFinite(profile.seed);
  });
  return {
    requiredBands: REQUIRED_BANDS,
    missingBands,
    badResolution,
    badDeterminism,
    complete: missingBands.length === 0 && badResolution.length === 0 && badDeterminism.length === 0,
  };
};

const surfaceTotals = (cells = []) => {
  const totals = Object.fromEntries(SURFACE_KEYS.map(key => [key, 0]));
  cells.forEach(cell => {
    SURFACE_KEYS.forEach(key => { totals[key] += nonNegative(cell?.surfaces?.[key]); });
  });
  return Object.fromEntries(SURFACE_KEYS.map(key => [key, round(totals[key], 6)]));
};

const surfacePresence = (cells = []) => Object.fromEntries(
  SURFACE_KEYS.map(key => [key, cells.some(cell => nonNegative(cell?.surfaces?.[key]) > 0)]),
);

const classifyCoverageBand = (observation) => {
  if (observation.distance < 1200) return 'near';
  if (observation.distance < 12000) return 'mid';
  if (observation.distance < 60000) return 'far';
  return 'remote';
};

const classifyPlacement = (observation) => {
  if (observation.waterDistance < 2) return 'blocked-water';
  if (observation.slope > 0.78) return 'blocked-cliff';
  if (observation.snow > 0.94) return 'blocked-permanent-snow';
  if (observation.roadDistance < 8) return 'blocked-road';
  if (observation.settlementDistance < 8) return 'blocked-settlement';
  if (observation.horizonOcclusion > 0.88) return 'blocked-occluded';
  return 'eligible';
};

const placementSummary = (observations = []) => {
  const counts = {
    eligible: 0,
    'blocked-water': 0,
    'blocked-cliff': 0,
    'blocked-permanent-snow': 0,
    'blocked-road': 0,
    'blocked-settlement': 0,
    'blocked-occluded': 0,
  };
  observations.forEach(observation => {
    const status = classifyPlacement(observation);
    counts[status] += 1;
  });
  return counts;
};

const buildSurfaceAudit = (coverage) => ({
  cells: coverage.cells?.length || 0,
  totals: surfaceTotals(coverage.cells),
  presence: surfacePresence(coverage.cells),
  requiredSurfaceSetPresent: SURFACE_KEYS.every(key => surfacePresence(coverage.cells)[key]),
});

const buildP0Audit = (coverage) => {
  const ledger = coverage.manifest?.ledger || coverage.manifest?.riskLedger || {};
  const p0 = ledger.p0 || coverage.p0 || {};
  return {
    visibleGrid: nonNegative(p0.visibleGrid),
    visibleTileSeam: nonNegative(p0.visibleTileSeam),
    visibleRectangularWater: nonNegative(p0.visibleRectangularWater),
    visibleWaterMoire: nonNegative(p0.visibleWaterMoire ?? p0.visibleMoiréRisk),
    targetGridZero: nonNegative(p0.visibleGrid) === 0,
    targetRectangularWaterZero: nonNegative(p0.visibleRectangularWater) === 0,
  };
};

const buildP5Audit = (coverage) => {
  const ledger = coverage.manifest?.ledger || coverage.manifest?.riskLedger || {};
  const p5 = ledger.p5 || coverage.p5 || {};
  const blackSky = Boolean(coverage.p5?.blackSkyGuard ?? p5.blackSkyGuard);
  const weatherClasses = sortStable((coverage.weatherCells || []).map(cell => cell.class));
  return {
    blackSkyGuard: blackSky,
    weatherClasses: [...new Set(weatherClasses)],
    weatherClassCount: new Set(weatherClasses).size,
    blackSkyFailure: blackSky ? 0 : 1,
  };
};

const buildParityAudit = (observations, coverage) => {
  const sourceById = new Map(observations.map(observation => [observation.id, observation]));
  const mismatches = [];
  (coverage.samples || []).forEach(sample => {
    const source = sourceById.get(sample.id);
    if (!source) return;
    const dy = Math.abs(finite(sample.elevation) - finite(source.elevation));
    const dx = Math.abs(finite(sample.position?.x) - finite(source.position?.x));
    const dz = Math.abs(finite(sample.position?.z) - finite(source.position?.z));
    if (dy > 1e-3 || dx > 1e-3 || dz > 1e-3) {
      mismatches.push({ id: sample.id, dx: round(dx, 4), dy: round(dy, 4), dz: round(dz, 4) });
    }
  });
  return {
    compared: coverage.samples?.length || 0,
    mismatches,
    visualColliderCoordinateParity: mismatches.length === 0,
  };
};

const buildBandAudit = (observations) => {
  const counts = { near: 0, mid: 0, far: 0, remote: 0 };
  observations.forEach(observation => { counts[classifyCoverageBand(observation)] += 1; });
  return {
    counts,
    total: observations.length,
    complete: Object.values(counts).reduce((sum, value) => sum + value, 0) === observations.length,
  };
};

const buildAcceptanceTargets = (cameraAudit, surfaceAudit, p0Audit, p5Audit, parityAudit) => ({
  cameraCoverage: cameraAudit.complete,
  allRequiredSurfaces: surfaceAudit.requiredSurfaceSetPresent,
  visibleGridZero: p0Audit.targetGridZero,
  visibleRectangularWaterZero: p0Audit.targetRectangularWaterZero,
  blackSkyGuard: p5Audit.blackSkyGuard,
  visualColliderParity: parityAudit.visualColliderCoordinateParity,
  deterministicEvidence: cameraAudit.badDeterminism.length === 0,
  acceptanceReady: cameraAudit.complete && surfaceAudit.requiredSurfaceSetPresent &&
    p0Audit.targetGridZero && p0Audit.targetRectangularWaterZero && p5Audit.blackSkyGuard &&
    parityAudit.visualColliderCoordinateParity,
});

const hashDigest = (payload) => {
  let h = 2166136261;
  const input = stableJson(payload);
  for (let index = 0; index < input.length; index += 1) {
    h ^= input.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/**
 * Build a single immutable runtime coverage snapshot.
 * Callers pass canonical observations harvested from the already-shipped
 * createScene path; no synthetic geometry is produced here.
 */
export function createWorldCoverageRuntimeSnapshotV51(input = {}) {
  const normalized = normalizeInput(input);
  const coverage = createWorldCoverageDirectorV51({
    seed: normalized.seed,
    samples: normalized.observations,
    framePressure: normalized.framePressure,
  });
  const cameraAudit = assertCameraCoverage(coverage);
  const surfaceAudit = buildSurfaceAudit(coverage);
  const p0Audit = buildP0Audit(coverage);
  const p5Audit = buildP5Audit(coverage);
  const parityAudit = buildParityAudit(normalized.observations, coverage);
  const bandAudit = buildBandAudit(normalized.observations);
  const placement = placementSummary(normalized.observations);
  const acceptance = buildAcceptanceTargets(cameraAudit, surfaceAudit, p0Audit, p5Audit, parityAudit);
  const result = {
    version: VERSION,
    seed: normalized.seed,
    framePressure: normalized.framePressure,
    sourceMode: normalized.sourceMode,
    sourceTruncated: normalized.truncated,
    coverage,
    cameraAudit,
    surfaceAudit,
    p0Audit,
    p5Audit,
    parityAudit,
    bandAudit,
    placement,
    acceptance,
    digest: hashDigest({
      version: VERSION,
      seed: normalized.seed,
      observations: normalized.observations,
      cameraAudit,
      surfaceAudit,
      p0Audit,
      p5Audit,
      parityAudit,
    }),
  };
  return deepFreeze(result);
}

export function createWorldCoverageRuntimeSnapshotFromSceneSamplesV51(sceneSamples = [], options = {}) {
  return createWorldCoverageRuntimeSnapshotV51({
    ...options,
    observations: sceneSamples,
    sourceMode: 'scene-samples',
  });
}

export function createWorldCoverageRuntimeBeforeAfterV51(beforeInput = {}, afterInput = {}) {
  const before = createWorldCoverageRuntimeSnapshotV51(beforeInput);
  const after = createWorldCoverageRuntimeSnapshotV51(afterInput);
  const delta = {
    digestChanged: before.digest !== after.digest,
    acceptanceRegressed: before.acceptance.acceptanceReady && !after.acceptance.acceptanceReady,
    cameraCompletenessDelta: after.cameraAudit.complete ? 0 : 1,
    parityRegressed: before.parityAudit.visualColliderCoordinateParity && !after.parityAudit.visualColliderCoordinateParity,
    p0GridRegressed: before.p0Audit.targetGridZero && !after.p0Audit.targetGridZero,
    p0WaterRegressed: before.p0Audit.targetRectangularWaterZero && !after.p0Audit.targetRectangularWaterZero,
    blackSkyRegressed: before.p5Audit.blackSkyGuard && !after.p5Audit.blackSkyGuard,
  };
  return deepFreeze({ version: VERSION, before, after, delta });
}

export function applyWorldCoverageRuntimeSnapshotV51(target, snapshot) {
  if (!target || typeof target !== 'object') return false;
  if (!snapshot || snapshot.version !== VERSION) return false;
  if (!snapshot.acceptance) return false;
  applyWorldCoverageDirectorV51(target, snapshot.coverage);
  target.worldCoverageRuntimeSnapshotV51 = snapshot;
  return true;
}

export function queryWorldCoverageSampleV51(snapshot, sampleId) {
  return snapshot?.coverage?.samples?.find(sample => sample.id === sampleId) || null;
}

export function queryWorldCoverageCellV51(snapshot, x, z) {
  const gridX = Math.trunc(finite(x));
  const gridZ = Math.trunc(finite(z));
  return snapshot?.coverage?.cells?.find(cell => cell.grid?.x === gridX && cell.grid?.z === gridZ) || null;
}

export function queryWorldCoverageRegionV51(snapshot, biome) {
  const normalizedBiome = normalizeId(biome, 'unknown').toLowerCase();
  return snapshot?.coverage?.regions?.find(region => region.biome === normalizedBiome) || null;
}

export function queryWorldCoverageWeatherV51(snapshot, cellId) {
  return snapshot?.coverage?.weatherCells?.find(cell => cell.cellId === cellId) || null;
}

export function summarizeWorldCoverageForCreateSceneV51(snapshot) {
  if (!snapshot || snapshot.version !== VERSION) {
    return deepFreeze({
      version: VERSION,
      valid: false,
      reason: 'invalid-snapshot',
      requiredBands: REQUIRED_BANDS,
    });
  }
  return deepFreeze({
    version: VERSION,
    valid: true,
    digest: snapshot.digest,
    acceptanceReady: snapshot.acceptance.acceptanceReady,
    sampleCount: snapshot.coverage.samples?.length || 0,
    cellCount: snapshot.coverage.cells?.length || 0,
    regions: snapshot.coverage.regions?.map(region => ({
      biome: region.biome,
      role: region.coverageRole,
      cellCount: region.cellCount,
    })) || [],
    cameras: snapshot.cameraAudit,
    surfaces: snapshot.surfaceAudit,
    p0: snapshot.p0Audit,
    p5: snapshot.p5Audit,
    parity: snapshot.parityAudit,
    placement: snapshot.placement,
    bands: snapshot.bandAudit,
  });
}

export const WORLD_COVERAGE_RUNTIME_ADAPTER_V51 = Object.freeze({
  version: VERSION,
  requiredBands: REQUIRED_BANDS,
  resolution: Object.freeze({ width: ORTHO_WIDTH, height: ORTHO_HEIGHT }),
  surfaceKeys: SURFACE_KEYS,
  maxObservations: MAX_OBSERVATIONS,
  mutationBoundary: 'caller-owned-scene-and-canonical-world',
});

export const WORLD_COVERAGE_RUNTIME_GATES_V51 = Object.freeze({
  actualCreateSceneSamplesOnly: true,
  noGeometryCreation: true,
  noGeographyMutation: true,
  noAssetHydration: true,
  noEditorImport: true,
  sharedMaterialPlacementAuthorityPreserved: true,
  requiredVisibleTargets: Object.freeze({
    grid: 0,
    rectangularWater: 0,
    waterMoire: 0,
    blackSky: 0,
    floatingAssets: 0,
    interpenetration: 0,
  }),
});
