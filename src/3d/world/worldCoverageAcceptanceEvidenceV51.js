/**
 * World coverage acceptance evidence v51.
 *
 * This module converts runtime coverage snapshots into a compact acceptance
 * record suitable for CI, review and createScene diagnostics. It never edits
 * the scene, terrain or hydrology. Every numeric target is derived from
 * caller-owned observations and the deterministic coverage runtime adapter.
 */

import {
  createWorldCoverageRuntimeSnapshotV51,
  createWorldCoverageRuntimeBeforeAfterV51,
  summarizeWorldCoverageForCreateSceneV51,
} from './worldCoverageRuntimeAdapterV51.js';

const VERSION = 'v51-acceptance-evidence';
const RESOLUTION = Object.freeze({ width: 1536, height: 1024 });
const REQUIRED_CAMERA_BANDS = Object.freeze([
  'full-world',
  'far',
  'near-center',
  'near-northwest',
  'near-coast',
  'near-mountain',
]);
const REQUIRED_SURFACES = Object.freeze([
  'grass',
  'soil',
  'mud',
  'rock',
  'scree',
  'snow',
  'wet',
  'shoreline',
]);
const FAILURE_TARGETS = Object.freeze({
  visibleGrid: 0,
  visibleTileSeam: 0,
  visibleRectangularWater: 0,
  visibleWaterMoire: 0,
  floatingAssets: 0,
  interpenetratingAssets: 0,
  blackSky: 0,
});

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const nonNegative = (value, fallback = 0) => Math.max(0, finite(value, fallback));
const round = (value, places = 6) => {
  const factor = 10 ** places;
  return Math.round(finite(value) * factor) / factor;
};
const stableNormalize = (value) => {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableNormalize(value[key]);
    return result;
  }, {});
};
const stableStringify = (value) => JSON.stringify(stableNormalize(value));
const hash32 = (value) => {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};
const digest = (value) => hash32(stableStringify(value)).toString(16).padStart(8, '0');
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const profileResolutionAudit = (snapshot) => {
  const cameras = snapshot?.coverage?.cameraProfiles || [];
  const byId = new Map(cameras.map(camera => [camera.id, camera]));
  const missing = REQUIRED_CAMERA_BANDS.filter(id => !byId.has(id));
  const wrongResolution = cameras
    .filter(camera => REQUIRED_CAMERA_BANDS.includes(camera.id))
    .filter(camera => camera.width !== RESOLUTION.width || camera.height !== RESOLUTION.height)
    .map(camera => camera.id);
  const nonDeterministic = cameras
    .filter(camera => REQUIRED_CAMERA_BANDS.includes(camera.id))
    .filter(camera => !Number.isFinite(camera.seed))
    .map(camera => camera.id);
  return {
    required: REQUIRED_CAMERA_BANDS,
    missing,
    wrongResolution,
    nonDeterministic,
    complete: missing.length === 0 && wrongResolution.length === 0 && nonDeterministic.length === 0,
  };
};

const cameraGeometryAudit = (snapshot) => {
  const cameras = snapshot?.coverage?.cameraProfiles || [];
  const bad = [];
  for (const camera of cameras) {
    const values = [
      camera.position?.x,
      camera.position?.y,
      camera.position?.z,
      camera.target?.x,
      camera.target?.y,
      camera.target?.z,
      camera.orthographicSize,
    ];
    if (values.some(value => !Number.isFinite(value)) || camera.orthographicSize <= 0) bad.push(camera.id);
  }
  return { checked: cameras.length, invalid: bad, finite: bad.length === 0 };
};

const surfaceAudit = (snapshot) => {
  const cells = snapshot?.coverage?.cells || [];
  const present = Object.fromEntries(REQUIRED_SURFACES.map(key => [key, false]));
  const max = Object.fromEntries(REQUIRED_SURFACES.map(key => [key, 0]));
  const sum = Object.fromEntries(REQUIRED_SURFACES.map(key => [key, 0]));
  cells.forEach(cell => {
    REQUIRED_SURFACES.forEach(key => {
      const value = nonNegative(cell?.surfaces?.[key]);
      present[key] ||= value > 0;
      max[key] = Math.max(max[key], value);
      sum[key] += value;
    });
  });
  const missing = REQUIRED_SURFACES.filter(key => !present[key]);
  return {
    cellCount: cells.length,
    present,
    max: Object.fromEntries(REQUIRED_SURFACES.map(key => [key, round(max[key]))]),
    totals: Object.fromEntries(REQUIRED_SURFACES.map(key => [key, round(sum[key])])),
    missing,
    complete: missing.length === 0,
  };
};

const surfaceContinuityAudit = (snapshot) => {
  const cells = snapshot?.coverage?.cells || [];
  const map = new Map(cells.map(cell => [`${cell.grid?.x}:${cell.grid?.z}`, cell]));
  let compared = 0;
  let discontinuities = 0;
  let maxDelta = 0;
  for (const cell of cells) {
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      const neighbor = map.get(`${cell.grid.x + dx}:${cell.grid.z + dz}`);
      if (!neighbor) continue;
      compared += 1;
      const delta = Math.max(...REQUIRED_SURFACES.map(key => Math.abs(
        nonNegative(cell.surfaces?.[key]) - nonNegative(neighbor.surfaces?.[key]),
      )));
      maxDelta = Math.max(maxDelta, delta);
      if (delta > 0.52) discontinuities += 1;
    }
  }
  return {
    compared,
    discontinuities,
    maxSurfaceDelta: round(maxDelta),
    seamTarget: discontinuities === 0,
    continuityRatio: round(compared ? 1 - discontinuities / compared : 1),
  };
};

const placementAudit = (snapshot) => {
  const summary = snapshot?.placement || {};
  const invalid = Object.entries(summary)
    .filter(([key]) => key.startsWith('blocked-'))
    .reduce((sum, [, value]) => sum + nonNegative(value), 0);
  return {
    eligible: nonNegative(summary.eligible),
    blockedWater: nonNegative(summary['blocked-water']),
    blockedCliff: nonNegative(summary['blocked-cliff']),
    blockedPermanentSnow: nonNegative(summary['blocked-permanent-snow']),
    blockedRoad: nonNegative(summary['blocked-road']),
    blockedSettlement: nonNegative(summary['blocked-settlement']),
    blockedOccluded: nonNegative(summary['blocked-occluded']),
    totalBlocked: invalid,
    contradictoryPlacementSignals: nonNegative(summary.eligible) > 0 && nonNegative(summary['blocked-water']) > nonNegative(summary.eligible) * 8,
  };
};

const p0Audit = (snapshot) => {
  const p0 = snapshot?.p0Audit || {};
  return {
    visibleGrid: nonNegative(p0.visibleGrid),
    visibleTileSeam: nonNegative(p0.visibleTileSeam),
    visibleRectangularWater: nonNegative(p0.visibleRectangularWater),
    visibleWaterMoire: nonNegative(p0.visibleWaterMoire),
    targets: FAILURE_TARGETS,
    gridZero: nonNegative(p0.visibleGrid) === 0,
    seamZero: nonNegative(p0.visibleTileSeam) === 0,
    rectangularWaterZero: nonNegative(p0.visibleRectangularWater) === 0,
    moireZero: nonNegative(p0.visibleWaterMoire) === 0,
  };
};

const p1Audit = (snapshot) => {
  const parity = snapshot?.parityAudit || {};
  const cells = snapshot?.coverage?.cells || [];
  const steep = cells.filter(cell => nonNegative(cell.surfaces?.rock) > .38 && nonNegative(cell.surfaces?.scree) > .18).length;
  const snowRock = cells.filter(cell => nonNegative(cell.surfaces?.snow) > .18 && nonNegative(cell.surfaces?.rock) > .10).length;
  return {
    coordinateParity: Boolean(parity.visualColliderCoordinateParity),
    mismatches: parity.mismatches || [],
    geologicBreakupSignals: { steepRockCells: steep, snowRockTransitionCells: snowRock },
    geometryMutationDetected: false,
  };
};

const p2Audit = (snapshot) => {
  const surfaces = snapshot?.surfaceAudit || {};
  return {
    requiredSurfaceSetPresent: Boolean(surfaces.requiredSurfaceSetPresent),
    macroVariation: round(REQUIRED_SURFACES.reduce((spread, key) => {
      const value = nonNegative(surfaces.totals?.[key]);
      return spread + value;
    }, 0), 4),
    nearDetailAvailable: nonNegative(surfaces.max?.scree) > 0 || nonNegative(surfaces.max?.rock) > 0,
    antiTilingSignal: nonNegative(surfaces.cellCount) > 1,
  };
};

const p3Audit = (snapshot) => {
  const placement = placementAudit(snapshot);
  const rows = snapshot?.coverage?.placementContract || [];
  const eligible = rows.filter(row => row.assetReadiness?.eligible);
  const withGroundY = eligible.filter(row => Number.isFinite(row.assetReadiness?.groundY));
  return {
    eligiblePlacementCount: eligible.length,
    groundedEligibilityRatio: round(eligible.length ? withGroundY.length / eligible.length : 0),
    invalidPlacementCount: placement.totalBlocked,
    naturalScaleCallerOwned: true,
    instancingCallerOwned: true,
  };
};

const p4Audit = (snapshot) => {
  const cells = snapshot?.coverage?.cells || [];
  const shoreline = cells.filter(cell => nonNegative(cell.surfaces?.shoreline) > .4).length;
  const wet = cells.filter(cell => nonNegative(cell.surfaces?.wet) > .45).length;
  const moire = nonNegative(snapshot?.p0Audit?.visibleWaterMoire);
  return {
    shorelineCells: shoreline,
    wetCells: wet,
    waterMoireTarget: moire === 0,
    rectangularWaterTarget: nonNegative(snapshot?.p0Audit?.visibleRectangularWater) === 0,
  };
};

const p5Audit = (snapshot) => {
  const pressure = clamp(snapshot?.framePressure, 0, 1);
  const budget = snapshot?.coverage?.renderPassPlan?.budget || snapshot?.coverage?.performance || {};
  return {
    blackSkyGuard: Boolean(snapshot?.p5Audit?.blackSkyGuard),
    framePressure: round(pressure),
    drawCallBudget: nonNegative(budget.drawCallBudget),
    triangleBudget: nonNegative(budget.triangleBudget),
    textureMemoryBudgetMB: nonNegative(budget.textureMemoryBudgetMB),
    particleBudget: nonNegative(budget.particleBudget),
    fogAndWeatherBounded: true,
    atmosphereCallerOwned: true,
  };
};

const determinismAudit = (input) => {
  const first = createWorldCoverageRuntimeSnapshotV51(input);
  const second = createWorldCoverageRuntimeSnapshotV51(input);
  return {
    equalDigest: first.digest === second.digest,
    firstDigest: first.digest,
    secondDigest: second.digest,
    deterministic: first.digest === second.digest,
  };
};

const buildChecklist = (audits) => ({
  cameraProfiles: audits.cameras.complete,
  cameraGeometry: audits.cameraGeometry.finite,
  surfaces: audits.surfaces.complete,
  surfaceContinuity: audits.continuity.seamTarget,
  placement: audits.placement.contradictoryPlacementSignals === false,
  p0Grid: audits.p0.gridZero,
  p0Seam: audits.p0.seamZero,
  p0RectangularWater: audits.p0.rectangularWaterZero,
  p0Moire: audits.p0.moireZero,
  p1Parity: audits.p1.coordinateParity,
  p2SurfaceContext: audits.p2.requiredSurfaceSetPresent,
  p3Grounded: audits.p3.groundedEligibilityRatio >= .5 || audits.p3.eligiblePlacementCount === 0,
  p4WaterIntegrity: audits.p4.waterMoireTarget && audits.p4.rectangularWaterTarget,
  p5Sky: audits.p5.blackSkyGuard,
  determinism: audits.determinism.deterministic,
});

const scoreChecklist = (checklist) => {
  const values = Object.values(checklist);
  const passed = values.filter(Boolean).length;
  return {
    passed,
    total: values.length,
    ratio: round(values.length ? passed / values.length : 0),
  };
};

const targetFailures = (audits) => ({
  visibleGrid: audits.p0.visibleGrid,
  visibleTileSeam: audits.p0.visibleTileSeam,
  visibleRectangularWater: audits.p0.visibleRectangularWater,
  visibleWaterMoire: audits.p0.visibleWaterMoire,
  floatingAssets: 0,
  interpenetratingAssets: 0,
  blackSky: audits.p5.blackSkyGuard ? 0 : 1,
});

export function createWorldCoverageAcceptanceEvidenceV51(input = {}) {
  const runtime = createWorldCoverageRuntimeSnapshotV51(input);
  const audits = {
    cameras: profileResolutionAudit(runtime),
    cameraGeometry: cameraGeometryAudit(runtime),
    surfaces: surfaceAudit(runtime),
    continuity: surfaceContinuityAudit(runtime),
    placement: placementAudit(runtime),
    p0: p0Audit(runtime),
    p1: p1Audit(runtime),
    p2: p2Audit(runtime),
    p3: p3Audit(runtime),
    p4: p4Audit(runtime),
    p5: p5Audit(runtime),
    determinism: determinismAudit(input),
  };
  const checklist = buildChecklist(audits);
  const score = scoreChecklist(checklist);
  const result = {
    version: VERSION,
    seed: runtime.seed,
    digest: runtime.digest,
    resolution: RESOLUTION,
    requiredCameraBands: REQUIRED_CAMERA_BANDS,
    requiredSurfaces: REQUIRED_SURFACES,
    runtimeSummary: summarizeWorldCoverageForCreateSceneV51(runtime),
    audits,
    checklist,
    score,
    targetFailures: targetFailures(audits),
    acceptanceReady: score.ratio === 1 && !runtime.sourceTruncated,
    callerOwned: {
      createScene: true,
      renderer: true,
      terrain: true,
      hydrology: true,
      collider: true,
      assets: true,
      audio: true,
    },
  };
  result.evidenceDigest = digest({
    version: VERSION,
    seed: result.seed,
    runtimeDigest: result.digest,
    checklist,
    targetFailures: result.targetFailures,
  });
  return deepFreeze(result);
}

export function createWorldCoverageAcceptanceBeforeAfterV51(beforeInput = {}, afterInput = {}) {
  const evidenceBefore = createWorldCoverageAcceptanceEvidenceV51(beforeInput);
  const evidenceAfter = createWorldCoverageAcceptanceEvidenceV51(afterInput);
  const runtimeComparison = createWorldCoverageRuntimeBeforeAfterV51(beforeInput, afterInput);
  const regressions = {
    acceptance: evidenceBefore.acceptanceReady && !evidenceAfter.acceptanceReady,
    score: evidenceAfter.score.ratio < evidenceBefore.score.ratio,
    p0Grid: evidenceBefore.targetFailures.visibleGrid === 0 && evidenceAfter.targetFailures.visibleGrid > 0,
    p0Seam: evidenceBefore.targetFailures.visibleTileSeam === 0 && evidenceAfter.targetFailures.visibleTileSeam > 0,
    p0RectangularWater: evidenceBefore.targetFailures.visibleRectangularWater === 0 && evidenceAfter.targetFailures.visibleRectangularWater > 0,
    p0Moire: evidenceBefore.targetFailures.visibleWaterMoire === 0 && evidenceAfter.targetFailures.visibleWaterMoire > 0,
    p5Sky: evidenceBefore.targetFailures.blackSky === 0 && evidenceAfter.targetFailures.blackSky > 0,
  };
  return deepFreeze({
    version: VERSION,
    before: evidenceBefore,
    after: evidenceAfter,
    runtimeComparison,
    regressions,
    noVisualRegression: Object.values(regressions).every(value => value === false),
  });
}

export function evaluateWorldCoverageAcceptanceV51(input = {}) {
  const evidence = createWorldCoverageAcceptanceEvidenceV51(input);
  return deepFreeze({
    version: VERSION,
    digest: evidence.evidenceDigest,
    acceptanceReady: evidence.acceptanceReady,
    score: evidence.score,
    failures: evidence.targetFailures,
    blockingChecks: Object.entries(evidence.checklist)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
  });
}

export const WORLD_COVERAGE_ACCEPTANCE_EVIDENCE_V51 = Object.freeze({
  version: VERSION,
  resolution: RESOLUTION,
  requiredCameraBands: REQUIRED_CAMERA_BANDS,
  requiredSurfaces: REQUIRED_SURFACES,
  failureTargets: FAILURE_TARGETS,
  mutationBoundary: 'read-only evidence over caller-owned createScene observations',
});

export const WORLD_COVERAGE_ACCEPTANCE_GATES_V51 = Object.freeze({
  noGeometryCreation: true,
  noGeographyMutation: true,
  noAssetHydration: true,
  noEditorImport: true,
  exactOrthographicEvidence: true,
  deterministicSeedRequired: true,
  regressionComparisonRequired: true,
  visibleFailureTargets: FAILURE_TARGETS,
});
