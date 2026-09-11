import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  PLAYER_WORLD_COVERAGE_VERSION,
  applyPlayerWorldCoveragePresentation,
  buildCoverageLattice,
  buildCoverageViewportSchedule,
  buildWorldCoverageDebugCard,
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
import {
  evaluateAllPlayerWorldCoverageScenarios,
  evaluatePlayerWorldCoverageScenario,
  listPlayerWorldCoverageScenarios,
} from '../src/3d/gameplay/playerWorldCoverageScenarioMatrix.js';
import {
  buildWorldAwareCombatContext,
  chooseWorldAwareLockOnTarget,
  validateWorldAwareThreatContext,
} from '../src/3d/gameplay/playerWorldCoverageThreatAdapter.js';

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (left, right, message) => { assert.deepEqual(left, right, message); checks += 1; };

const modulePaths = [
  '../src/3d/gameplay/playerWorldCoverageDirector.js',
  '../src/3d/gameplay/playerWorldCoverageRuntimeAdapter.js',
  '../src/3d/gameplay/playerWorldCoverageReplayContract.js',
  '../src/3d/gameplay/playerWorldCoverageAssetEvidence.js',
  '../src/3d/gameplay/playerWorldCoverageScenarioMatrix.js',
  '../src/3d/gameplay/playerWorldCoverageThreatAdapter.js',
];
const sources = Object.fromEntries(modulePaths.map((path) => [path, fs.readFileSync(new URL(path, import.meta.url), 'utf8')]));
for (const [path, source] of Object.entries(sources)) {
  ok(!source.includes('EditorMaterialStudio'), `${path} has no editor import`);
  ok(!source.includes("from 'three'"), `${path} has no Three import`);
  ok(!/assets\/models\/.*\.(?:fbx|blend|glb|gltf)/i.test(source), `${path} has no embedded binary asset path`);
}

const contract = getWorldCoverageContractSummary();
eq(contract.version, PLAYER_WORLD_COVERAGE_VERSION, 'contract version');
eq(contract.expectedCells, 1008, 'full-world cell count');
eq(contract.worldExtentMeters, [9000, 7000], 'world extent');
eq(contract.lattice, [36, 28], 'grid shape');
eq(contract.cellSizeMeters, 250, 'cell size');
eq(contract.authorities.player, 'src/3d/gameplay/player.js', 'player authority');
eq(contract.authorities.material, 'src/3d/materials/MaterialAssignmentCore.js', 'material authority');
eq(contract.authorities.placement, 'src/3d/world/WorldAssetPlacementPipeline.js', 'placement authority');

eq(enumerateCoverageCells().length, 1008, 'enumerate all cells');
eq(new Set(enumerateCoverageCells().map((cell) => cell.id)).size, 1008, 'cell ids unique');
eq(cellToCenter(0, 0), { x: -4375, y: 0, z: -3375 }, 'minimum cell center');
eq(worldToCell({ x: 4499.9, z: 3499.9 }), { column: 35, row: 27, id: 'c27-35' }, 'maximum cell');
eq(worldToCell({ x: 0, z: 0 }), { column: 18, row: 14, id: 'c14-18' }, 'center cell');

const samples = [
  { id: 'forest', position: { x: 0, y: 12, z: 0 }, groundY: 12, colliderY: 12.04, canonicalY: 12, surface: 'grass', biome: 'forest', slopeDegrees: 6, elevationMeters: 180, moisture: 0.3, snow: 0, waterCoverage: 0, waterDepthMeters: 0, roadDistanceMeters: 40, settlementDistanceMeters: 70, assetReady: true, visible: true, confidence: 1, verified: true },
  { id: 'alpine', position: { x: 250, y: 74, z: 0 }, groundY: 74, colliderY: 74, canonicalY: 74, surface: 'scree', biome: 'alpine', slopeDegrees: 42, elevationMeters: 1180, moisture: 0.18, snow: 0.72, waterCoverage: 0, waterDepthMeters: 0, roadDistanceMeters: null, settlementDistanceMeters: null, assetReady: true, visible: true, confidence: 1, observed: true },
  { id: 'coast', position: { x: -250, y: 3, z: 0 }, groundY: 3, colliderY: 3, canonicalY: 3.02, surface: 'wet-edge', biome: 'coast', slopeDegrees: 3, elevationMeters: 8, moisture: 0.82, snow: 0, waterCoverage: 0.4, waterDepthMeters: 0.08, roadDistanceMeters: 11, settlementDistanceMeters: 16, assetReady: true, visible: true, confidence: 0.9 },
];

const normalized = normalizeWorldSample({ position: { x: NaN, z: Infinity }, slopeDegrees: 999, moisture: -1, waterCoverage: 3 });
eq(normalized.position, { x: 0, y: 0, z: 0 }, 'finite fallback');
eq(normalized.slopeDegrees, 89.9, 'slope clamp');
eq(normalized.moisture, 0, 'moisture clamp');
eq(normalized.waterCoverage, 1, 'water clamp');

const lattice = buildCoverageLattice(samples);
eq(lattice.expectedCellCount, 1008, 'lattice expected');
eq(lattice.observedCellCount, 3, 'lattice observed');
eq(lattice.gapCellCount, 1005, 'lattice gaps');
ok(lattice.coverageRatio > 0 && lattice.coverageRatio < 1, 'partial coverage is explicit');

const snapshotInput = {
  player: { position: { x: 0, y: 12, z: 0 }, isGrounded: true, speedMps: 3, locomotion: 'run', lockOn: true, rangedReady: false, stance: 'attack', attackWeight: 0.75 },
  movement: { speedMps: 3, locomotion: 'run', inAttack: true, attackWeight: 0.75 },
  combat: { stance: 'attack', isGrounded: true, lockOn: true, rangedReady: false },
  equipment: { weaponReachMeters: 1.8, encumbranceRatio: 0.2, metalWeightRatio: 0.6, leatherWeightRatio: 0.1, socketReady: true, assetReady: true, surfaceRoles: ['skin', 'hair', 'cloth', 'metal', 'boot', 'weapon'] },
  interaction: {},
  samples,
  nowSeconds: 2,
};
const snapshot = derivePlayerWorldContext(snapshotInput);
eq(snapshot.selectedSample.id, 'forest', 'nearest sample selection');
eq(snapshot.surfaceContext.dominantSurface, 'grass', 'forest surface context');
eq(snapshot.selectedSample.biome, 'forest', 'forest biome context');
ok(snapshot.grounding.grounded, 'grounding accepted');
eq(snapshot.grounding.colliderDelta, 0.04, 'collider delta');
ok(snapshot.grounding.snapRecommended, 'snap recommendation');
ok(snapshot.combat.eligible, 'grounded combat is eligible');
ok(snapshot.animation.attackLayerWeight > 0, 'attack layer is present');
ok(snapshot.animation.footPlantWeight > 0.5, 'foot plant remains usable');
ok(snapshot.movement.locomotionSpeedScale > 0.4, 'movement stays usable');
ok(snapshot.coverage.gapCellCount > 0, 'world gaps are reported');
ok(snapshot.fingerprint.length === 8, 'fingerprint shape');

const validation = validatePlayerWorldContext(snapshot, { requireGrounded: true, maxMissingAssets: 0 });
ok(validation.ok, 'snapshot validation');
ok(validation.fingerprintOkay, 'snapshot fingerprint format');
const same = derivePlayerWorldContext(snapshotInput);
ok(comparePlayerWorldCoverageSnapshots(snapshot, same).equal, 'snapshot determinism');
const acceptance = buildWorldCoverageAcceptanceManifest(snapshot, { requireGrounded: true, maxMissingAssets: 0 });
ok(acceptance.accepted, 'acceptance manifest');
eq(acceptance.material.authority, 'src/3d/materials/MaterialAssignmentCore.js', 'acceptance material contract');
eq(acceptance.placement.authority, 'src/3d/world/WorldAssetPlacementPipeline.js', 'acceptance placement contract');

const viewport = buildCoverageViewportSchedule({ playerPosition: snapshot.player.position, camera: { radiusMeters: 250 } });
ok(viewport.cells.length > 0, 'viewport schedule');
ok(viewport.cells.every((row) => ['near', 'mid', 'far'].includes(row.band)), 'viewport bands');
const desktopBudget = buildWorldCoveragePerformanceBudget({ visibleCellCount: 40, samplesPerCell: 2, combat: true });
const mobileBudget = buildWorldCoveragePerformanceBudget({ visibleCellCount: 40, samplesPerCell: 2, combat: true, mobile: true });
ok(mobileBudget.coverageQueriesPerFrame <= desktopBudget.coverageQueriesPerFrame, 'mobile budget bounded');

const debug = buildWorldCoverageDebugCard(snapshot);
eq(debug.playerCell, snapshot.coverage.playerCell.id, 'debug card cell');
ok(debug.coveragePercent > 0, 'debug card coverage');
const target = { userData: {} };
ok(applyPlayerWorldCoveragePresentation(target, snapshot).ok, 'presentation application');
eq(target.userData.playerWorldCoverage.playerCellId, snapshot.coverage.playerCell.id, 'presentation cell');

const fixture = buildReplayFixture({ frames: 18 });
ok(validateReplayRecording(fixture).ok, 'replay fixture validates');
const replay1 = replayRecording(fixture);
const replay2 = replayRecording(fixture);
ok(compareReplayRuns(replay1, replay2).equal, 'replay is deterministic');
ok(buildReplayAcceptanceManifest(fixture, replay1).accepted, 'replay accepted');
const recording = createReplayRecording({ maxFrames: 2 });
recording.push({ samples, player: { position: { x: 0, z: 0 } } });
recording.push({ samples, player: { position: { x: 1, z: 0 } } });
assert.throws(() => recording.push({}), /replay-frame-limit/); checks += 1;
const sealed = recording.seal();
eq(sealed.frameCount, 2, 'sealed replay count');

const asset = normalizeAssetEvidence({ assetId: 'player', sourcePath: 'assets/models/characters/peasant_girl.fbx', assetState: 'pointer', loaderVerified: false, meshes: [{ id: 'body' }], materialSlots: [{ role: 'skin', hasUv: true, generated: true, textureSizes: [256], paletteId: 'skin' }, { role: 'hair', hasUv: true, generated: true, textureSizes: [256], paletteId: 'hair' }], namedPartCount: 2, groundDeltaMeters: 0.04, placementOrder: ['source-asset', 'material-core', 'validate', 'placement-pipeline', 'ground-snap', 'scene-attach'] });
const assetValidation = validatePlayerAssetEvidence(asset, { requireNamedSurfaces: true });
ok(assetValidation.ok, 'LFS pointer is not missing');
ok(assetValidation.warnings.includes('lfs-pointer-not-hydrated'), 'pointer warning present');
const assetContract = getPlayerWorldCoverageAssetContract();
ok(assetContract.sourceOverwriteForbidden, 'source overwrite prohibited');
ok(assetContract.pointerIsNotMissing, 'pointer semantics');
const proof = buildModelPlacementProof({ asset, material: asset, placement: { ...asset, assetState: 'loaded', loaderVerified: true }, runtime: { spawnObserved: true, inputObserved: true, animationObserved: true, combatObserved: true, equipmentObserved: true, consoleErrorCount: 0, pageErrorCount: 0 } });
ok(proof.accepted, 'model placement proof accepted');

const scenarios = listPlayerWorldCoverageScenarios();
eq(scenarios.length, 10, 'scenario matrix size');
const scenarioResults = evaluateAllPlayerWorldCoverageScenarios();
ok(scenarioResults.length === scenarios.length, 'all scenarios evaluated');
ok(evaluatePlayerWorldCoverageScenario('deep-water').snapshot.combat.eligible === false, 'deep water blocks combat');
ok(evaluatePlayerWorldCoverageScenario('settlement-gate').snapshot.interaction.primary === 'settlement', 'settlement interaction priority');
ok(evaluatePlayerWorldCoverageScenario('mountain-climb').snapshot.combat.eligible === true, 'mountain combat eligibility');

const threatTargets = [
  { id: 'hostile-close', position: { x: 4, y: 12, z: 0 }, hostile: true, lineOfSight: true, threat: 0.9 },
  { id: 'friendly-close', position: { x: 2, y: 12, z: 0 }, factionRelation: 'friendly', lineOfSight: true, threat: 0.2 },
];
const lockOn = chooseWorldAwareLockOnTarget(threatTargets, { playerPosition: { x: 0, y: 12, z: 0 }, headingDegrees: 90, worldContext: snapshot, combat: { lockOn: true, rangedReady: false } });
eq(lockOn.id, 'hostile-close', 'hostile target wins lock-on');
const combatContext = buildWorldAwareCombatContext({ targets: threatTargets, playerPosition: { x: 0, y: 12, z: 0 }, headingDegrees: 90, worldContext: snapshot, combat: { lockOn: true, rangedReady: false } });
ok(validateWorldAwareThreatContext(combatContext).ok, 'threat context validation');

const eventTarget = new EventTarget();
eventTarget.CustomEvent = globalThis.CustomEvent;
const events = [];
eventTarget.addEventListener(PLAYER_WORLD_COVERAGE_EVENT, () => events.push('coverage'));
eventTarget.addEventListener(PLAYER_WORLD_COVERAGE_FOCUS_EVENT, () => events.push('focus'));
const runtime = createPlayerWorldCoverageRuntimeAdapter({ player: { object3D: { position: { x: 0, y: 12, z: 0 }, rotation: { y: 0 } }, getState: () => ({ isGrounded: true, speedMps: 0 }) }, world: { sample: () => samples }, eventTarget, now: () => 30 });
ok(validatePlayerWorldCoverageRuntimeAdapter(runtime).ok, 'runtime adapter contract');
ok(runtime.update({ forcePublish: true }).validation.ok, 'runtime adapter update');
runtime.focus(threatTargets);
ok(events.includes('coverage'), 'coverage event emitted');
ok(events.includes('focus'), 'focus event emitted');
runtime.dispose();
eq(runtime.isDisposed, true, 'runtime disposed');

const failure = validatePlayerAssetEvidence({ assetId: 'broken', assetState: 'missing', meshes: [], placeholder: true, sharedMaterialAuthority: 'local', sharedPlacementAuthority: 'local', editorMaterialStudioImported: true, placementOrder: ['scene-attach'], consoleErrorCount: 1, pageErrorCount: 1 });
ok(!failure.ok, 'broken asset fails closed');
ok(failure.errors.includes('missing-asset'), 'missing asset rejected');
ok(failure.errors.includes('editor-material-runtime-import'), 'editor UI rejected');
ok(failure.errors.includes('wrong-material-authority'), 'wrong material rejected');
ok(failure.errors.includes('wrong-placement-authority'), 'wrong placement rejected');
ok(failure.errors.includes('console-errors'), 'console error rejected');
ok(failure.errors.includes('page-errors'), 'page error rejected');

console.log(JSON.stringify({ contract: PLAYER_WORLD_COVERAGE_VERSION, cells: 1008, observed: lattice.observedCellCount, replayFrames: replay1.frameCount, scenarios: scenarios.length, checks }));
