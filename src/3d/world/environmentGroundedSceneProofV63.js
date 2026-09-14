/**
 * V63 shipped-scene proof descriptors.
 *
 * This file defines the deterministic camera/sample contract that an existing
 * createScene/browser harness can consume. It never edits the scene itself.
 */
import { V63_CONTRACT, createGroundedVisualRuntimeV63 } from './environmentGroundedVisualRuntimeV63.js';
import { createVisualEvidenceV63, createAcceptanceCameraManifestV63 } from './environmentGroundedVisualEvidenceV63.js';

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};

const hash = (value) => {
  let h = 2166136261;
  const source = String(value);
  for (let i = 0; i < source.length; i += 1) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;

const CAMERA_PROFILES = Object.freeze({
  fullWorld: Object.freeze({ distance: 7000, targetX: 4500, targetY: 120, targetZ: 3500 }),
  far: Object.freeze({ distance: 3600, targetX: 4500, targetY: 120, targetZ: 3500 }),
  'terrain-near': Object.freeze({ distance: 420, targetX: 4500, targetY: 120, targetZ: 3500 }),
  'coast-near': Object.freeze({ distance: 520, targetX: 2600, targetY: 70, targetZ: 3600 }),
  'mountain-near': Object.freeze({ distance: 480, targetX: 6700, targetY: 500, targetZ: 2800 }),
  'forest-near': Object.freeze({ distance: 260, targetX: 3600, targetY: 130, targetZ: 3000 }),
  'settlement-near': Object.freeze({ distance: 220, targetX: 5100, targetY: 95, targetZ: 4100 }),
  'northwest-near': Object.freeze({ distance: 540, targetX: 2200, targetY: 390, targetZ: 1650 }),
});

export function createSceneCameraV63(profile = 'terrain-near', seed = 'v63-camera') {
  const spec = CAMERA_PROFILES[profile] || CAMERA_PROFILES['terrain-near'];
  return freeze({
    profile: text(profile, 'terrain-near'),
    width: 1536,
    height: 1024,
    orthographicDegrees: 90,
    distance: spec.distance,
    targetX: spec.targetX,
    targetY: spec.targetY,
    targetZ: spec.targetZ,
    seed: hash(`${seed}:${profile}`),
  });
}

export function createDeterministicSceneProofPlan({ seed = 'v63-proof', profiles = Object.keys(CAMERA_PROFILES) } = {}) {
  const safeProfiles = (Array.isArray(profiles) ? profiles : Object.keys(CAMERA_PROFILES))
    .filter((profile) => CAMERA_PROFILES[profile])
    .filter((profile, index, items) => items.indexOf(profile) === index);
  const cameras = safeProfiles.map((profile) => createSceneCameraV63(profile, seed));
  return freeze({
    contract: V63_CONTRACT.id,
    seed,
    cameras: freeze(cameras),
    output: freeze({ width: 1536, height: 1024, orthographicDegrees: 90, format: 'png' }),
    deterministic: true,
    sameCoordinateBeforeAfter: true,
    postProcess: false,
    expectedVisibleFailureTargets: freeze({ seam: 0, rectangularWater: 0, moire: 0, cyan: 0, floating: 0, interpenetration: 0, blackSky: 0 }),
    acceptanceManifest: createAcceptanceCameraManifestV63(seed),
  });
}

export function createSceneSampleGridV63({ centerX = 4500, centerZ = 3500, extentX = 720, extentZ = 540, columns = 7, rows = 5, seed = 'v63-grid' } = {}) {
  const cols = Math.round(clamp(columns, 2, 16));
  const rowCount = Math.round(clamp(rows, 2, 16));
  const samples = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const x = centerX - extentX / 2 + (cols === 1 ? 0 : (extentX * column) / (cols - 1));
      const z = centerZ - extentZ / 2 + (rowCount === 1 ? 0 : (extentZ * row) / (rowCount - 1));
      samples.push(freeze({ sampleId: `grid-${row}-${column}`, x, z, seed: hash(`${seed}:${row}:${column}`) }));
    }
  }
  return freeze({ centerX, centerZ, extentX, extentZ, columns: cols, rows: rowCount, samples: freeze(samples) });
}

export function classifySceneSampleV63(observation) {
  const plan = createGroundedVisualRuntimeV63(observation);
  return freeze({
    sampleId: plan.sampleId,
    profile: plan.acceptanceProfile.profile,
    p0VisibleFailures: Object.values(plan.p0).reduce((sum, value) => sum + value, 0),
    p1GeometryFailures: [plan.geometry.cliffWall, plan.geometry.flatRelief, plan.geometry.snowSheet, Number(!plan.geometry.parityPass)].reduce((sum, value) => sum + value, 0),
    p2MaterialFailures: Object.values(plan.risks.P2).reduce((sum, value) => sum + value, 0),
    p3PlacementFailures: plan.vegetation.invalid,
    p4WaterFailures: [plan.water.rectangularRisk, Number(!plan.water.shorelineIntegrity && plan.water.recognized), Number(plan.water.moireSuppression > 0.5), Number(plan.water.cyanSuppression > 0.5)].reduce((sum, value) => sum + value, 0),
    p5AtmosphereFailures: Object.values(plan.risks.P5).reduce((sum, value) => sum + value, 0),
    fingerprint: plan.fingerprint,
  });
}

export function createSceneProofManifestV63(observations = [], seed = 'v63-proof') {
  const source = Array.isArray(observations) ? observations : [];
  const reports = source.slice(0, V63_CONTRACT.thresholds.maxSamples).map((observation) => createVisualEvidenceV63({ ...observation, seed }));
  const visibleFailureTotal = reports.reduce((sum, report) => sum + Object.values(report.p0).filter((value) => typeof value === 'number').reduce((a, b) => a + b, 0), 0);
  return freeze({
    contract: V63_CONTRACT.id,
    seed,
    sampleCount: reports.length,
    reports: freeze(reports),
    visibleFailureTotal,
    pass: reports.length > 0 && reports.every((report) => report.qualityBand !== 'blocked' && report.mergeEligible),
    digest: hash(reports.map((report) => `${report.sampleId}:${report.fingerprint}`).sort().join('|')),
  });
}

export function createBeforeAfterSceneManifestV63(beforeSamples = [], afterSamples = [], seed = 'v63-before-after') {
  const before = Array.isArray(beforeSamples) ? beforeSamples : [];
  const after = Array.isArray(afterSamples) ? afterSamples : [];
  const count = Math.min(before.length, after.length, 256);
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const left = createGroundedVisualRuntimeV63({ ...before[index], seed });
    const right = createGroundedVisualRuntimeV63({ ...after[index], seed });
    rows.push(freeze({
      index,
      sampleIdBefore: left.sampleId,
      sampleIdAfter: right.sampleId,
      sameCamera: left.acceptanceProfile.width === right.acceptanceProfile.width && left.acceptanceProfile.height === right.acceptanceProfile.height,
      sameCoordinate: left.input.terrain.x === right.input.terrain.x && left.input.terrain.z === right.input.terrain.z,
      riskDelta: right.riskScore - left.riskScore,
      fingerprintBefore: left.fingerprint,
      fingerprintAfter: right.fingerprint,
    }));
  }
  return freeze({
    contract: V63_CONTRACT.id,
    seed,
    count,
    rows: freeze(rows),
    improved: rows.filter((row) => row.riskDelta < 0).length,
    regressed: rows.filter((row) => row.riskDelta > 0).length,
    comparable: rows.every((row) => row.sameCamera && row.sameCoordinate),
    digest: hash(rows.map((row) => `${row.index}:${row.fingerprintBefore}:${row.fingerprintAfter}`).join('|')),
  });
}

export function validateSceneProofManifestV63(manifest) {
  const failures = [];
  if (!manifest || manifest.contract !== V63_CONTRACT.id) failures.push('contract');
  if (!manifest || manifest.sampleCount <= 0) failures.push('samples');
  if (manifest && manifest.visibleFailureTotal !== 0) failures.push('visible-failure');
  if (manifest && manifest.pass !== true) failures.push('not-accepted');
  return freeze({ valid: failures.length === 0, failures: freeze(failures) });
}

export function createSceneAcceptanceSummaryV63(observations = [], seed = 'v63-summary') {
  const manifest = createSceneProofManifestV63(observations, seed);
  const priorityHistogram = {};
  for (const report of manifest.reports) {
    for (const code of report.failureCodes) priorityHistogram[code] = (priorityHistogram[code] || 0) + 1;
  }
  return freeze({
    pass: manifest.pass,
    sampleCount: manifest.sampleCount,
    visibleFailureTotal: manifest.visibleFailureTotal,
    priorityHistogram: freeze(priorityHistogram),
    digest: manifest.digest,
  });
}

export function createSceneEvidenceFixtureV63() {
  const terrain = { x: 4500, y: 116, z: 3500, height: 116, canonicalHeight: 116, colliderHeight: 116, slope: 10, moisture: 0.5, elevation01: 0.45, snowWeight: 0.04, roughness: 0.75, normal: { x: 0.1, y: 0.98, z: 0.1 }, biome: 'temperate', surface: 'grass', canonicalSource: 'canonical-owner-map', terrainBackend: 'Terrain3D', regionId: 'fixture' };
  const water = { waterClass: 'land', waterDistance: 120, depth: 0, shorelineWeight: 0, wetEdgeWeight: 0, foamWeight: 0, cyanRisk: 0, moireRisk: 0, seamRisk: 0, tileLike: false, rectangular: false, repeatedStripe: false };
  const material = { role: 'grass', multiSurface: true, placeholder: false, missing: false, roughness: 0.8, normalScale: 0.8, ao: 0.55, macroContrast: 0.7, microDetail: 0.7, textureRepeat: 1 };
  const camera = createSceneCameraV63('terrain-near', 'fixture');
  return freeze({ sampleId: 'scene-fixture', seed: 'fixture', terrain, water, material, vegetation: [], camera, renderedY: 116, colliderY: 116, postProcessed: false, editorRuntimeImported: false, primitiveGeometry: false });
}
