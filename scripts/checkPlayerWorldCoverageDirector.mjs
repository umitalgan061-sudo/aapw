import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  PLAYER_WORLD_COVERAGE_CONFIG,
  PLAYER_WORLD_COVERAGE_VERSION,
  applyPlayerWorldCoveragePresentation,
  buildCoverageLattice,
  buildCoverageViewportSchedule,
  buildWorldCoverageDebugCard,
  buildWorldCoverageInputParity,
  buildWorldCoveragePerformanceBudget,
  buildWorldCoverageAcceptanceManifest,
  cellToCenter,
  comparePlayerWorldCoverageSnapshots,
  createPlayerWorldCoverageDirector,
  derivePlayerWorldContext,
  enumerateCoverageCells,
  getWorldCoverageContractSummary,
  normalizeWorldSample,
  validatePlayerWorldContext,
  worldToCell,
} from '../src/3d/gameplay/playerWorldCoverageDirector.js';
import {
  buildModelPlacementProof,
  getPlayerWorldCoverageAssetContract,
  normalizeAssetEvidence,
  validatePlayerAssetEvidence,
} from '../src/3d/gameplay/playerWorldCoverageAssetEvidence.js';
import {
  buildReplayAcceptanceManifest,
  buildReplayFixture,
  compareReplayRuns,
  createReplayRecording,
  replayRecording,
  validateReplayRecording,
} from '../src/3d/gameplay/playerWorldCoverageReplayContract.js';
import {
  PLAYER_WORLD_COVERAGE_EVENT,
  PLAYER_WORLD_COVERAGE_FOCUS_EVENT,
  createPlayerWorldCoverageRuntimeAdapter,
  validatePlayerWorldCoverageRuntimeAdapter,
} from '../src/3d/gameplay/playerWorldCoverageRuntimeAdapter.js';

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (left, right, message) => { assert.deepEqual(left, right, message); checks += 1; };
const rejects = async (fn, message) => { await assert.rejects(fn, message); checks += 1; };

const directorSource = fs.readFileSync(new URL('../src/3d/gameplay/playerWorldCoverageDirector.js', import.meta.url), 'utf8');
const runtimeSource = fs.readFileSync(new URL('../src/3d/gameplay/playerWorldCoverageRuntimeAdapter.js', import.meta.url), 'utf8');
const replaySource = fs.readFileSync(new URL('../src/3d/gameplay/playerWorldCoverageReplayContract.js', import.meta.url), 'utf8');
const assetSource = fs.readFileSync(new URL('../src/3d/gameplay/playerWorldCoverageAssetEvidence.js', import.meta.url), 'utf8');

ok(!directorSource.includes('EditorMaterialStudio'), 'director must not import editor material UI');
ok(!runtimeSource.includes('EditorMaterialStudio'), 'runtime adapter must not import editor material UI');
ok(!replaySource.includes('EditorMaterialStudio'), 'replay must not import editor material UI');
ok(!assetSource.includes('new THREE.'), 'asset evidence must remain DOM/Three free');
ok(!runtimeSource.includes("from 'three'"), 'runtime adapter must not construct Three objects');
ok(!runtimeSource.includes('FBXLoader'), 'runtime adapter must not own asset loading');

const contract = getWorldCoverageContractSummary();
eq(contract.version, PLAYER_WORLD_COVERAGE_VERSION, 'contract version');
eq(contract.expectedCells, 1008, 'full-world lattice expected cells');
eq(contract.lattice, [36, 28], 'lattice dimensions');
eq(contract.cellSizeMeters, 250, 'cell size');
eq(contract.authorities.material, 'src/3d/materials/MaterialAssignmentCore.js', 'material authority');
eq(contract.authorities.placement, 'src/3d/world/WorldAssetPlacementPipeline.js', 'placement authority');
ok(contract.binaryAssetsAdded === false, 'no binary assets');

const cells = enumerateCoverageCells();
eq(cells.length, 1008, 'enumerates every world cell');
eq(cells[0].id, 'c00-00', 'first cell id');
eq(cells.at(-1).id, 'c27-35', 'last cell id');
const ids = new Set(cells.map((cell) => cell.id));
eq(ids.size, 1008, 'cell ids unique');
eq(cellToCenter(0, 0), { x: -4375, y: 0, z: -3375 }, 'first cell center');
eq(worldToCell({ x: -4500, z: -3500 }), { column: 0, row: 0, id: 'c00-00' }, 'world minimum cell');
eq(worldToCell({ x: 4499.9, z: 3499.9 }), { column: 35, row: 27, id: 'c27-35' }, 'world maximum cell');
eq(worldToCell({ x: 0, z: 0 }), { column: 18, row: 14, id: 'c14-18' }, 'world center cell');

auto constSamples = [
  {
    id: 'forest-ground',
    position: { x: 0, y: 12, z: 0 },
    groundY: 12,
    colliderY: 12.04,
    canonicalY: 12,
    surface: 'grass',
    biome: 'forest',
    slopeDegrees: 6,
    elevationMeters: 180,
    moisture: 0.34,
    snow: 0,
    waterDepthMeters: 0,
    waterCoverage: 0,
    roadDistanceMeters: 40,
    settlementDistanceMeters: 70,
    assetReady: true,
    visible: true,
    verified: true,
  },
  {
    id: 'alpine-scree',
    position: { x: 250, y: 74, z: 0 },
    groundY: 74,
    colliderY: 74,
    canonicalY: 74,
    surface: 'scree',
    biome: 'alpine',
    slopeDegrees: 42,
    elevationMeters: 1180,
    moisture: 0.18,
    snow: 0.72,
    waterDepthMeters: 0,
    waterCoverage: 0,
    roadDistanceMeters: null,
    settlementDistanceMeters: null,
    assetReady: true,
    visible: true,
    observed: true,
  },
  {
    id: 'coast-wet',
    position: { x: -250, y: 3, z: 0 },
    groundY: 3,
    colliderY: 3,
    canonicalY: 3.02,
    surface: 'wet-edge',
    biome: 'coast',
    slopeDegrees: 3,
    elevationMeters: 8,
    moisture: 0.82,
    snow: 0,
    waterDepthMeters: 0.08,
    waterCoverage: 0.4,
    roadDistanceMeters: 11,
    settlementDistanceMeters: 16,
    assetReady: true,
    visible: true,
    confidence: 0.9,
  },
];

constSamples[0].tags = ['forest', 'ground'];
constSamples[1].tags = ['alpine', 'snow'];
constSamples[2].tags = ['coast', 'shore'];

const normalized = normalizeWorldSample({ position: { x: NaN, z: Infinity }, slopeDegrees: 999, moisture: -4, waterCoverage: 9 });
eq(normalized.position, { x: 0, y: 0, z: 0 }, 'finite position fallback');
eq(normalized.slopeDegrees, 89.9, 'slope clamp');
eq(normalized.moisture, 0, 'moisture clamp');
eq(normalized.waterCoverage, 1, 'water coverage clamp');
eq(normalized.quality, 'partial', 'numeric observation quality');

const lattice = buildCoverageLattice(constSamples);
eq(lattice.expectedCellCount, 1008, 'lattice expected count');
eq(lattice.observedCellCount, 3, 'three observed cells');
eq(lattice.gapCellCount, 1005, 'gaps are explicit not invented');
ok(lattice.coverageRatio > 0 && lattice.coverageRatio < 1, 'partial coverage ratio');
eq(lattice.cells.length, 1008, 'lattice cell records');
ok(lattice.cells.some((cell) => cell.surface === 'grass'), 'grass coverage represented');
ok(lattice.cells.some((cell) => cell.biome === 'alpine'), 'alpine coverage represented');
ok(lattice.cells.some((cell) => cell.biome === 'coast'), 'coast coverage represented');

const forestSnapshot = derivePlayerWorldContext({
  player: {
    position: { x: 0, y: 12, z: 0 },
    isGrounded: true,
    speedMps: 3,
    locomotion: 'run',
    lockOn: true,
    rangedReady: false,
    stance: 'neutral',
  },
  samples: constSamples,
  movement: { speedMps: 3, locomotion: 'run', inAttack: true, attackWeight: 0.7, inGuard: false },
  combat: { isGrounded: true, lockOn: true, rangedReady: false, stance: 'attack' },
  equipment: {
    weaponReachMeters: 1.8,
    encumbranceRatio: 0.2,
    metalWeightRatio: 0.6,
    leatherWeightRatio: 0.1,
    socketReady: true,
    assetReady: true,
    surfaceRoles: ['skin', 'hair', 'cloth', 'metal', 'boot', 'weapon'],
  },
  interaction: {},
  nowSeconds: 2,
});

eq(forestSnapshot.version, PLAYER_WORLD_COVERAGE_VERSION, 'snapshot version');
eq(forestSnapshot.selectedSample.id, 'forest-ground', 'nearest sample selected');
eq(forestSnapshot.surfaceContext.dominantSurface, 'grass', 'surface context');
eq(forestSnapshot.selectedSample.biome, 'forest', 'biome context');
eq(forestSnapshot.grounding.grounded, true, 'grounding parity');
eq(forestSnapshot.grounding.colliderDelta, 0.04, 'collider delta');
ok(forestSnapshot.grounding.snapRecommended, true, 'small collider correction recommended');
ok(forestSnapshot.combat.eligible, true, 'combat eligible on grounded terrain');
ok(forestSnapshot.combat.attackReachMeters > 1.7, 'weapon reach carried into combat context');
ok(forestSnapshot.combat.lockOnRangeMeters > 0, 'lock-on context bounded');
ok(forestSnapshot.animation.attackLayerWeight > 0, 'attack animation layer projected');
ok(forestSnapshot.animation.footPlantWeight > 0.5, 'foot plant preserved');
ok(forestSnapshot.movement.locomotionSpeedScale > 0.4, 'movement remains usable');
ok(forestSnapshot.camera.fullWorldAcceptance.orthographic, 'acceptance camera contract');
ok(forestSnapshot.interaction.interactionCandidates.includes('world'), 'world interaction candidate');
ok(forestSnapshot.coverage.gapCellCount > 0, 'coverage reports missing world samples');
ok(typeof forestSnapshot.fingerprint === 'string' && forestSnapshot.fingerprint.length === 8, 'stable fingerprint');

const replayA = buildReplayFixture({ frames: 24, sampleFactory: (index) => ({
  id: `frame-${index}`,
  position: { x: index * 4, y: 10 + index * 0.1, z: index * -2 },
  groundY: 10 + index * 0.1,
  colliderY: 10 + index * 0.1,
  canonicalY: 10 + index * 0.1,
  surface: index % 2 ? 'rock' : 'grass',
  biome: index % 2 ? 'mountain' : 'forest',
  slopeDegrees: index % 8,
  elevationMeters: 500 + index,
  assetReady: true,
  visible: true,
  confidence: 1,
} ) });
const replayValidation = validateReplayRecording(replayA);
ok(replayValidation.ok, 'fixture replay validates');
eq(replayValidation.frameCount, 24, 'replay frame count');
const replayRun1 = replayRecording(replayA);
const replayRun2 = replayRecording(replayA);
const replayComparison = compareReplayRuns(replayRun1, replayRun2);
eq(replayComparison.equal, true, 'replay deterministic');
const replayManifest = buildReplayAcceptanceManifest(replayA, replayRun1);
ok(replayManifest.accepted, 'replay acceptance');
ok(replayManifest.deterministic, 'replay reports deterministic');

const recording = createReplayRecording({ maxFrames: 3 });
eq(recording.push({ samples: constSamples, player: { position: { x: 0, z: 0 } } }), 1, 'record first frame');
eq(recording.push({ samples: constSamples, player: { position: { x: 1, z: 0 } } }), 2, 'record second frame');
eq(recording.push({ samples: constSamples, player: { position: { x: 2, z: 0 } } }), 3, 'record third frame');
await rejects(async () => recording.push({}), /replay-frame-limit/, 'recording frame cap');
const sealed = recording.seal();
ok(sealed.frameCount === 3, 'sealed recording frame count');
ok(sealed.digest.length === 8, 'sealed recording digest');
await rejects(async () => recording.push({}), /replay-recording-sealed/, 'sealed recording rejects writes');

const asset = normalizeAssetEvidence({
  assetId: 'peasant-girl',
  sourcePath: 'assets/models/characters/peasant_girl.fbx',
  extension: '.fbx',
  assetState: 'pointer',
  loaderVerified: false,
  meshes: [{ id: 'body' }],
  materialSlots: [
    { name: 'Body', role: 'skin', hasUv: true, hasNormal: true, generated: true, textureSizes: [256], paletteId: 'skin' },
    { name: 'Hair', role: 'hair', hasUv: true, hasNormal: true, generated: true, textureSizes: [256], paletteId: 'hair' },
  ],
  namedPartCount: 2,
  layeredFallback: false,
  groundDeltaMeters: 0.04,
  placementOrder: ['source-asset', 'material-core', 'validate', 'placement-pipeline', 'ground-snap', 'scene-attach'],
});
const assetCheck = validatePlayerAssetEvidence(asset, { requireNamedSurfaces: true });
ok(assetCheck.ok, 'pointer evidence is not treated as missing');
ok(assetCheck.warnings.includes('lfs-pointer-not-hydrated'), 'pointer warning remains explicit');
eq(assetCheck.evidence.sharedMaterialAuthority, 'src/3d/materials/MaterialAssignmentCore.js', 'asset shared material authority');
eq(assetCheck.evidence.sharedPlacementAuthority, 'src/3d/world/WorldAssetPlacementPipeline.js', 'asset shared placement authority');
const assetContract = getPlayerWorldCoverageAssetContract();
ok(assetContract.pointerIsNotMissing, 'pointer policy contract');
ok(assetContract.sourceOverwriteForbidden, 'source overwrite policy');
ok(assetContract.editorMaterialUiForbidden === undefined || assetContract.editorMaterialUiForbidden !== false, 'editor UI boundary is preserved');

const modelProof = buildModelPlacementProof({
  asset,
  material: asset,
  placement: { ...asset, assetState: 'loaded', loaderVerified: true },
  runtime: { spawnObserved: true, inputObserved: true, animationObserved: true, combatObserved: true, equipmentObserved: true, consoleErrorCount: 0, pageErrorCount: 0 },
});
ok(modelProof.accepted, 'model placement proof accepted');
ok(modelProof.runtimeOk, 'runtime chain evidence complete');

const manifest = buildWorldCoverageAcceptanceManifest(forestSnapshot, { requireGrounded: true, maxMissingAssets: 0 });
ok(manifest.accepted, 'world coverage acceptance manifest');
eq(manifest.material.authority, 'src/3d/materials/MaterialAssignmentCore.js', 'manifest material authority');
eq(manifest.placement.authority, 'src/3d/world/WorldAssetPlacementPipeline.js', 'manifest placement authority');

const validation = validatePlayerWorldContext(forestSnapshot, { requireGrounded: true, maxMissingAssets: 0 });
ok(validation.ok, 'context validation');
ok(validation.fingerprintOkay, 'fingerprint format');
const sameSnapshot = derivePlayerWorldContext({
  player: forestSnapshot.player,
  samples: constSamples,
  movement: { speedMps: 3, locomotion: 'run', inAttack: true, attackWeight: 0.7 },
  combat: { isGrounded: true, lockOn: true, stance: 'attack' },
  equipment: { weaponReachMeters: 1.8, encumbranceRatio: 0.2, socketReady: true, assetReady: true, surfaceRoles: ['skin', 'hair', 'cloth', 'metal', 'boot', 'weapon'] },
  nowSeconds: 2,
});
const snapshotCompare = comparePlayerWorldCoverageSnapshots(forestSnapshot, sameSnapshot);
eq(snapshotCompare.equal, true, 'same inputs serialize identically');

const viewport = buildCoverageViewportSchedule({ playerPosition: forestSnapshot.player.position, camera: { radiusMeters: 250 } });
ok(viewport.cells.length > 0, 'coverage viewport has cells');
ok(viewport.cells.every((row) => ['near', 'mid', 'far'].includes(row.band)), 'viewport bands normalized');
const performanceDesktop = buildWorldCoveragePerformanceBudget({ visibleCellCount: 40, samplesPerCell: 2, combat: true, mobile: false });
const performanceMobile = buildWorldCoveragePerformanceBudget({ visibleCellCount: 40, samplesPerCell: 2, combat: true, mobile: true });
ok(performanceMobile.coverageQueriesPerFrame <= performanceDesktop.coverageQueriesPerFrame, 'mobile budget is no heavier');
ok(performanceDesktop.combatPriority, 'combat budget priority');

const parity = buildWorldCoverageInputParity({
  keyboard: { moveX: 1, moveZ: 0 },
  gamepad: { moveX: 0.8, moveZ: 0 },
  touch: { moveX: 1, moveZ: 0 },
  mouse: { lookX: 0.2, lookY: -0.1 },
});
ok(parity.parityReady, 'input parity ready');
ok(Math.abs(parity.move.x) <= 1, 'parity move bounded');
eq(parity.activeSources.sort(), ['gamepad', 'keyboard', 'touch'].sort(), 'active input sources');

const debugCard = buildWorldCoverageDebugCard(forestSnapshot);
eq(debugCard.playerCell, forestSnapshot.coverage.playerCell.id, 'debug card player cell');
ok(debugCard.coveragePercent > 0, 'debug card coverage percent');

const applicationTarget = { userData: {} };
const applied = applyPlayerWorldCoveragePresentation(applicationTarget, forestSnapshot);
ok(applied.ok, 'presentation applies to caller-owned target');
eq(applicationTarget.userData.playerWorldCoverage.playerCellId, forestSnapshot.coverage.playerCell.id, 'presentation player cell');

const director = createPlayerWorldCoverageDirector({ now: () => 10 });
const first = director.evaluate({ player: forestSnapshot.player, samples: constSamples, movement: { speedMps: 1, locomotion: 'walk' }, combat: { isGrounded: true } });
const second = director.evaluate({ player: forestSnapshot.player, samples: constSamples, movement: { speedMps: 1, locomotion: 'walk' }, combat: { isGrounded: true } });
eq(director.revision, 2, 'director revision increments');
ok(first.fingerprint === second.fingerprint, 'director repeated evaluation deterministic');
ok(director.currentHistory().length === 2, 'director history bounded and present');
const digestBeforeReset = director.digest();
ok(digestBeforeReset.length === 8, 'director digest');
director.reset();
eq(director.revision, 0, 'director reset');
director.dispose();
eq(director.isDisposed, true, 'director disposed');
await rejects(async () => director.evaluate({}), /player-world-coverage-disposed/, 'disposed director rejects evaluation');

const eventTarget = new EventTarget();
const eventNames = [];
eventTarget.CustomEvent = globalThis.CustomEvent;
eventTarget.addEventListener(PLAYER_WORLD_COVERAGE_EVENT, () => eventNames.push('coverage'));
eventTarget.addEventListener(PLAYER_WORLD_COVERAGE_FOCUS_EVENT, () => eventNames.push('focus'));
const player = { object3D: { position: { x: 0, y: 12, z: 0 }, rotation: { y: 0 } }, getState: () => ({ isGrounded: true, speedMps: 0 }) };
const runtime = createPlayerWorldCoverageRuntimeAdapter({
  player,
  world: { sample: () => constSamples },
  eventTarget,
  now: () => 30,
});
const runtimeContract = validatePlayerWorldCoverageRuntimeAdapter(runtime);
ok(runtimeContract.ok, 'runtime adapter shape');
const runtimeResult = runtime.update({ forcePublish: true });
ok(runtimeResult.validation.ok, 'runtime adapter validation');
eq(eventNames.includes('coverage'), true, 'coverage event published');
const focused = runtime.focus([{ id: 'enemy-a', position: { x: 4, y: 12, z: 0 }, hostile: true }, { id: 'friend', position: { x: 2, y: 12, z: 0 }, hostile: false }]);
eq(focused.targetId, 'enemy-a', 'hostile focus selected');
ok(eventNames.includes('focus'), 'focus event published');
runtime.dispose();
eq(runtime.isDisposed, true, 'runtime adapter dispose');

const malformed = derivePlayerWorldContext({ player: { position: { x: NaN, z: Infinity } }, samples: null, equipment: { weaponReachMeters: NaN }, combat: { isGrounded: true } });
ok(malformed.selectedSample !== undefined, 'malformed input still returns context');
const malformedValidation = validatePlayerWorldContext(malformed, { requireGrounded: true, maxMissingAssets: 0 });
ok(malformedValidation.errors.includes('grounding-unverified'), 'malformed grounding fails closed');

const expectedFailures = validatePlayerAssetEvidence({
  assetId: 'broken',
  assetState: 'missing',
  meshes: [],
  placeholder: true,
  sharedMaterialAuthority: 'local',
  sharedPlacementAuthority: 'local',
  editorMaterialStudioImported: true,
  placementOrder: ['scene-attach'],
  consoleErrorCount: 1,
  pageErrorCount: 1,
});
ok(!expectedFailures.ok, 'invalid asset evidence fails');
ok(expectedFailures.errors.includes('missing-asset'), 'missing asset is rejected');
ok(expectedFailures.errors.includes('editor-material-runtime-import'), 'editor material import rejected');
ok(expectedFailures.errors.includes('wrong-material-authority'), 'wrong material authority rejected');
ok(expectedFailures.errors.includes('wrong-placement-authority'), 'wrong placement authority rejected');
ok(expectedFailures.errors.includes('console-errors'), 'console error rejected');
ok(expectedFailures.errors.includes('page-errors'), 'page error rejected');

const diffGuard = [
  directorSource,
  runtimeSource,
  replaySource,
  assetSource,
].join('\n');
ok(!/from ['"](?:\.\.\/)*3d\/editor\/EditorMaterialStudio\.js['"]/.test(diffGuard), 'runtime never imports editor Studio');
ok(!/assets\/.*\.(?:fbx|blend|glb|gltf)/i.test(diffGuard), 'coverage contract does not embed binary assets');
ok(!/new THREE\./.test(diffGuard), 'coverage modules do not construct primitives');

const testSummary = {
  contractVersion: PLAYER_WORLD_COVERAGE_VERSION,
  fullWorldCells: cells.length,
  observedCells: lattice.observedCellCount,
  deterministicFingerprint: forestSnapshot.fingerprint,
  replayFrames: replayRun1.frameCount,
  runtimeEvents: eventNames,
  checks,
};
console.log(JSON.stringify(testSummary));
