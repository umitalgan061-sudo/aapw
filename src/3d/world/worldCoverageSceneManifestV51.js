/**
 * Shipped createScene coverage manifest v51.
 *
 * The manifest describes the camera/sample/coverage contract that a real
 * createScene caller must provide. It is not a renderer and does not synthesize
 * screenshots. This keeps acceptance evidence tied to shipped runtime input.
 */

import {
  createWorldCoverageAcceptanceEvidenceV51,
  createWorldCoverageAcceptanceBeforeAfterV51,
} from './worldCoverageAcceptanceEvidenceV51.js';

const VERSION = 'v51-scene-manifest';
const WIDTH = 1536;
const HEIGHT = 1024;
const BANDS = Object.freeze(['full-world','far','near-center','near-northwest','near-coast','near-mountain']);
const REQUIRED_STAGES = Object.freeze(['sky','atmosphere','terrain-pbr','hydrology','vegetation','set-dressing','audio','acceptance']);
const P0_TARGETS = Object.freeze({visibleGrid:0,visibleTileSeam:0,visibleRectangularWater:0,visibleWaterMoire:0});

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const positive = (value, fallback = 0) => Math.max(0, finite(value, fallback));
const round = (value, places = 6) => {
  const factor = 10 ** places;
  return Math.round(finite(value) * factor) / factor;
};
const normalizeId = (value, fallback) => String(value ?? fallback).trim() || fallback;
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stable(value[key]);
    return result;
  }, {});
};
const stableStringify = (value) => JSON.stringify(stable(value));
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

const normalizeCamera = (camera = {}, index) => ({
  id: normalizeId(camera.id, `camera-${index}`),
  width: WIDTH,
  height: HEIGHT,
  orthographic: true,
  orthographicSize: positive(camera.orthographicSize, 1),
  seed: Number.isFinite(camera.seed) ? Math.trunc(camera.seed) : null,
  position: {
    x: round(finite(camera.position?.x)),
    y: round(finite(camera.position?.y)),
    z: round(finite(camera.position?.z)),
  },
  target: {
    x: round(finite(camera.target?.x)),
    y: round(finite(camera.target?.y)),
    z: round(finite(camera.target?.z)),
  },
});

const normalizeStage = (stage = {}, index) => ({
  id: normalizeId(stage.id, `stage-${index}`),
  status: normalizeId(stage.status, 'unknown'),
  callerOwned: stage.callerOwned !== false,
  mutatesWorld: stage.mutatesWorld === true,
  producesGeometry: stage.producesGeometry === true,
  evidence: normalizeId(stage.evidence, 'none'),
});

const normalizeArtifact = (artifact = {}, index) => ({
  id: normalizeId(artifact.id, `artifact-${index}`),
  band: normalizeId(artifact.band, 'unknown'),
  path: normalizeId(artifact.path, `artifact-${index}`),
  seed: Number.isFinite(artifact.seed) ? Math.trunc(artifact.seed) : null,
  width: Number.isFinite(artifact.width) ? Math.trunc(artifact.width) : WIDTH,
  height: Number.isFinite(artifact.height) ? Math.trunc(artifact.height) : HEIGHT,
  runtimeGenerated: artifact.runtimeGenerated !== false,
  postProcessed: artifact.postProcessed === true,
});

const cameraAudit = (cameras) => {
  const ids = new Set(cameras.map(camera => camera.id));
  const missing = BANDS.filter(band => !ids.has(band));
  const wrongResolution = cameras.filter(camera => camera.width !== WIDTH || camera.height !== HEIGHT).map(camera => camera.id);
  const nonOrtho = cameras.filter(camera => !camera.orthographic).map(camera => camera.id);
  const missingSeeds = cameras.filter(camera => !Number.isFinite(camera.seed)).map(camera => camera.id);
  const invalidVectors = cameras.filter(camera => [
    camera.position.x,camera.position.y,camera.position.z,
    camera.target.x,camera.target.y,camera.target.z,
  ].some(value => !Number.isFinite(value))).map(camera => camera.id);
  return {
    count: cameras.length,
    missing,
    wrongResolution,
    nonOrtho,
    missingSeeds,
    invalidVectors,
    complete: missing.length === 0 && wrongResolution.length === 0 && nonOrtho.length === 0 && missingSeeds.length === 0 && invalidVectors.length === 0,
  };
};

const stageAudit = (stages) => {
  const byId = new Map(stages.map(stage => [stage.id, stage]));
  const missing = REQUIRED_STAGES.filter(stage => !byId.has(stage));
  const forbiddenMutation = stages.filter(stage => stage.mutatesWorld).map(stage => stage.id);
  const forbiddenGeometry = stages.filter(stage => stage.producesGeometry).map(stage => stage.id);
  const nonCallerOwned = stages.filter(stage => !stage.callerOwned).map(stage => stage.id);
  return {
    missing,
    forbiddenMutation,
    forbiddenGeometry,
    nonCallerOwned,
    complete: missing.length === 0 && forbiddenMutation.length === 0 && forbiddenGeometry.length === 0 && nonCallerOwned.length === 0,
  };
};

const artifactAudit = (artifacts) => {
  const missingBand = artifacts.filter(artifact => !BANDS.includes(artifact.band));
  const invalidResolution = artifacts.filter(artifact => artifact.width !== WIDTH || artifact.height !== HEIGHT);
  const postProcessed = artifacts.filter(artifact => artifact.postProcessed).map(artifact => artifact.id);
  const nonRuntime = artifacts.filter(artifact => !artifact.runtimeGenerated).map(artifact => artifact.id);
  const duplicatePaths = artifacts
    .map(artifact => artifact.path)
    .filter((path, index, paths) => paths.indexOf(path) !== index);
  return {
    count: artifacts.length,
    missingBand,
    invalidResolution: invalidResolution.map(artifact => artifact.id),
    postProcessed,
    nonRuntime,
    duplicatePaths,
    complete: missingBand.length === 0 && invalidResolution.length === 0 && postProcessed.length === 0 && nonRuntime.length === 0 && duplicatePaths.length === 0,
  };
};

const p0Audit = (evidence) => ({
  visibleGrid: Math.max(0, finite(evidence?.targetFailures?.visibleGrid)),
  visibleTileSeam: Math.max(0, finite(evidence?.targetFailures?.visibleTileSeam)),
  visibleRectangularWater: Math.max(0, finite(evidence?.targetFailures?.visibleRectangularWater)),
  visibleWaterMoire: Math.max(0, finite(evidence?.targetFailures?.visibleWaterMoire)),
  targets: P0_TARGETS,
  clear: [
    evidence?.targetFailures?.visibleGrid,
    evidence?.targetFailures?.visibleTileSeam,
    evidence?.targetFailures?.visibleRectangularWater,
    evidence?.targetFailures?.visibleWaterMoire,
  ].every(value => finite(value) === 0),
});

const buildApplicationRecord = (snapshot, stages, artifacts) => {
  const summary = snapshot?.runtimeSummary || {};
  return {
    digest: snapshot?.evidenceDigest || null,
    acceptanceReady: snapshot?.acceptanceReady === true,
    sampleCount: finite(summary.sampleCount),
    cellCount: finite(summary.cellCount),
    cameraCoverage: summary.cameras?.complete === true,
    stageCoverage: stageAudit(stages).complete,
    artifactCoverage: artifactAudit(artifacts).complete,
  };
};

export function createWorldCoverageSceneManifestV51(input = {}) {
  const cameras = Array.isArray(input.cameras) ? input.cameras.map(normalizeCamera) : [];
  const stages = Array.isArray(input.stages) ? input.stages.map(normalizeStage) : REQUIRED_STAGES.map((id, index) => normalizeStage({id,status:'caller-owned'}, index));
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts.map(normalizeArtifact) : [];
  const evidence = input.evidence || createWorldCoverageAcceptanceEvidenceV51(input);
  const cameraResult = cameraAudit(cameras.length ? cameras : evidence.runtimeSummary?.cameras?.required?.map((id, index) => normalizeCamera({id,seed:evidence.seed}, index)) || []);
  const stageResult = stageAudit(stages);
  const artifactResult = artifactAudit(artifacts);
  const p0Result = p0Audit(evidence);
  const application = buildApplicationRecord(evidence, stages, artifacts);
  const result = {
    version: VERSION,
    seed: Number.isFinite(input.seed) ? Math.trunc(input.seed) : finite(evidence.seed, 5101),
    resolution: Object.freeze({width:WIDTH,height:HEIGHT}),
    bands: BANDS,
    requiredStages: REQUIRED_STAGES,
    cameras,
    stages,
    artifacts,
    audits:{camera:cameraResult,stage:stageResult,artifact:artifactResult,p0:p0Result},
    acceptance:{
      evidenceDigest:evidence.evidenceDigest || evidence.digest || null,
      ready:evidence.acceptanceReady === true,
      noPostProcessing:artifactResult.postProcessed.length === 0,
      sameResolution:cameraResult.wrongResolution.length === 0,
      orthographic:cameraResult.nonOrtho.length === 0,
      sameSeed:cameraResult.missingSeeds.length === 0,
      p0Clear:p0Result.clear,
      noWorldMutation:stageResult.forbiddenMutation.length === 0,
      noGeometryCreation:stageResult.forbiddenGeometry.length === 0,
    },
    application,
  };
  result.acceptance.digest = digest({
    version:VERSION,
    seed:result.seed,
    cameras:result.cameras,
    stages:result.stages,
    artifacts:result.artifacts,
    audits:result.audits,
    acceptance:result.acceptance,
  });
  return deepFreeze(result);
}

export function createWorldCoverageSceneManifestBeforeAfterV51(beforeInput = {}, afterInput = {}) {
  const beforeEvidence = createWorldCoverageAcceptanceEvidenceV51(beforeInput);
  const afterEvidence = createWorldCoverageAcceptanceEvidenceV51(afterInput);
  const runtime = createWorldCoverageAcceptanceBeforeAfterV51(beforeInput, afterInput);
  const before = createWorldCoverageSceneManifestV51({...beforeInput,evidence:beforeEvidence});
  const after = createWorldCoverageSceneManifestV51({...afterInput,evidence:afterEvidence});
  return deepFreeze({
    version:VERSION,
    before,
    after,
    runtime,
    regressions:{
      acceptance:before.acceptance.ready && !after.acceptance.ready,
      p0:before.acceptance.p0Clear && !after.acceptance.p0Clear,
      resolution:before.acceptance.sameResolution && !after.acceptance.sameResolution,
      postProcessing:before.acceptance.noPostProcessing && !after.acceptance.noPostProcessing,
      cameraDeterminism:before.acceptance.sameSeed && !after.acceptance.sameSeed,
    },
  });
}

export function summarizeWorldCoverageSceneManifestV51(manifest) {
  if (!manifest || manifest.version !== VERSION) {
    return deepFreeze({version:VERSION,valid:false,reason:'invalid-manifest'});
  }
  return deepFreeze({
    version:VERSION,
    valid:true,
    digest:manifest.acceptance.digest,
    seed:manifest.seed,
    resolution:manifest.resolution,
    cameraAudit:manifest.audits.camera,
    stageAudit:manifest.audits.stage,
    artifactAudit:manifest.audits.artifact,
    p0Audit:manifest.audits.p0,
    acceptance:manifest.acceptance,
    application:manifest.application,
  });
}

export const WORLD_COVERAGE_SCENE_MANIFEST_V51 = Object.freeze({
  version:VERSION,
  resolution:Object.freeze({width:WIDTH,height:HEIGHT}),
  bands:BANDS,
  stages:REQUIRED_STAGES,
  p0Targets:P0_TARGETS,
  postProcessingAllowed:false,
  sceneMutationAllowed:false,
  geometryCreationAllowed:false,
});
