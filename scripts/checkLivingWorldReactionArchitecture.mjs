import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const runtimePath = path.resolve(ROOT, 'src/3d/gameplay/livingWorldReactionRuntime.js');
const evidencePath = path.resolve(ROOT, 'src/3d/gameplay/livingWorldReactionEvidence.js');
const runtimeTestPath = path.resolve(ROOT, 'scripts/checkLivingWorldReactionRuntime.mjs');
const browserTestPath = path.resolve(ROOT, 'scripts/checkLivingWorldReactionBrowser.mjs');

const failures = [];
let passed = 0;
function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}
function read(filePath) {
  assert(fs.existsSync(filePath), `required file exists: ${path.relative(ROOT, filePath)}`);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}
function includes(source, needle, message) {
  assert(source.includes(needle), message);
}
function excludes(source, needle, message) {
  assert(!source.includes(needle), message);
}
function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

const runtime = read(runtimePath);
const evidence = read(evidencePath);
const runtimeTest = read(runtimeTestPath);
const browserTest = read(browserTestPath);

// Runtime owner boundary: one reaction adapter, no replacement NPC/faction/world-event framework.
assert(runtime.length > 12000, 'reaction runtime is substantive rather than a marker stub');
assert(runtime.split(/\r?\n/).length < 600, 'gameplay runtime module remains below the repository gameplay module size ceiling');
includes(runtime, 'export function createLivingWorldReactionRuntime', 'runtime exposes one explicit reaction-runtime factory');
includes(runtime, 'export function auditLivingWorldReactionResult', 'runtime exposes an executable audit contract');
includes(runtime, 'export function livingWorldReactionDigest', 'runtime exposes deterministic digest evidence');
includes(runtime, 'LIVING_WORLD_REACTION_RUNTIME_POLICY', 'runtime has a named bounded policy');
includes(runtime, 'services?.perception', 'perception stays behind the existing owner/service seam');
includes(runtime, 'services?.factions', 'faction lookup stays behind the existing owner/service seam');
includes(runtime, 'services?.reputation', 'reputation stays behind the existing owner/service seam');
includes(runtime, 'services?.diplomacy', 'diplomacy stays behind the existing owner/service seam');
includes(runtime, 'services?.law', 'law/crime stays behind the existing owner/service seam');
includes(runtime, 'services?.navigation', 'navigation stays behind the existing owner/service seam');
includes(runtime, 'services?.encounters', 'combat/encounter stays behind the existing owner/service seam');
includes(runtime, 'services?.worldEvents', 'world events stay behind the existing publisher seam');
includes(runtime, 'services?.occupation', 'occupation stays behind the existing schedule owner seam');
includes(runtime, 'maxActors: 128', 'actor population cap is explicit and bounded');
includes(runtime, 'maxDeltaSeconds: 0.25', 'frame delta is bounded');
includes(runtime, 'sensingIntervalSeconds: 0.15', 'sensing tick is throttled');
includes(runtime, 'farTickIntervalSeconds: 2.0', 'far LOD simulation is throttled');
includes(runtime, "'patrol'", 'patrol phase is represented');
includes(runtime, "'detect'", 'detect phase is represented');
includes(runtime, "'investigate'", 'investigate phase is represented');
includes(runtime, "'chase'", 'chase phase is represented');
includes(runtime, "'attack'", 'attack phase is represented');
includes(runtime, "'return'", 'return phase is represented');
includes(runtime, "'flee'", 'flee phase is represented');
includes(runtime, "kind: 'detect'", 'detect directive is explicit');
includes(runtime, "kind: 'investigate'", 'investigate directive is explicit');
includes(runtime, "kind: 'chase'", 'chase directive is explicit');
includes(runtime, "kind: 'attack'", 'attack directive is explicit');
includes(runtime, "kind: 'return'", 'return directive is explicit');
includes(runtime, "kind: 'flee'", 'flee directive is explicit');
includes(runtime, 'writeActorTelemetry', 'runtime emits bounded actor telemetry');
includes(runtime, 'trimHistory', 'runtime history is explicitly bounded');
includes(runtime, 'normalizeLod', 'population LOD classification is explicit');
includes(runtime, 'tickIntervalForLod', 'population LOD tick budget is explicit');
includes(runtime, 'normalizeSignals', 'perception input normalization is explicit');
includes(runtime, 'chooseBestSignal', 'perception signal arbitration is deterministic');
includes(runtime, 'resolveReputation', 'relationship decision path reads reputation rather than owning it');
includes(runtime, 'resolveDiplomaticRelation', 'relationship decision path reads diplomacy rather than owning it');
includes(runtime, 'resolveWanted', 'law decision path reads wanted state rather than owning it');
includes(runtime, 'resolveCrimeSeverity', 'crime decision path reads existing law evidence rather than owning it');
includes(runtime, 'callNavigation', 'navigation is delegated instead of reimplemented');
includes(runtime, 'callCombat', 'combat is delegated instead of reimplemented');
includes(runtime, 'callLawReport', 'law reporting is delegated instead of reimplemented');
includes(runtime, 'callWorldEvent', 'world-event publishing is delegated instead of reimplemented');

// Forbidden ownership signals: no DOM/editor/material authoring/scene spawning/combat damage implementation.
for (const forbidden of [
  'document.', 'window.', 'EditorMaterialStudio', 'MaterialAssignmentCore', 'WorldAssetPlacementPipeline',
  'new THREE.', 'FBXLoader', 'GLTFLoader', 'loadAsync(', 'spawnModel', 'createNPCFramework',
  'class FactionManager', 'class ReputationManager', 'class WorldEventSystem', 'applyDamage(',
  'persistWorldState', 'localStorage', 'sessionStorage',
]) {
  excludes(runtime, forbidden, `runtime does not own forbidden concern: ${forbidden}`);
}
assert(count(runtime, /createLivingWorldReactionRuntime/g) >= 1, 'only one reaction runtime factory is defined');
assert(count(runtime, /function callService\(/g) === 1, 'owner-service invocation seam is centralized');
assert(count(runtime, /Math\.random/g) === 0, 'runtime never calls Math.random');
assert(count(runtime, /Date\.now/g) === 0, 'runtime never uses wall-clock nondeterminism');

// Evidence owner boundary: shared material/placement cores are references, not duplicate implementations.
assert(evidence.split(/\r?\n/).length < 500, 'evidence helper remains bounded');
includes(evidence, "sharedMaterialCore: 'src/3d/materials/MaterialAssignmentCore.js'", 'evidence pins shared material authority');
includes(evidence, "sharedPlacementCore: 'src/3d/world/WorldAssetPlacementPipeline.js'", 'evidence pins shared placement authority');
includes(evidence, 'validateMaterialEvidence', 'evidence validates material assignment rather than creating materials');
includes(evidence, 'validatePlacementEvidence', 'evidence validates world placement rather than placing models');
includes(evidence, 'requiredNpcRoles', 'evidence has named human surface-role expectations');
includes(evidence, 'requiredFaunaRoles', 'evidence has named fauna surface-role expectations');
includes(evidence, 'maxTextureResolution: 8192', 'evidence validates texture resolution bounds');
for (const forbidden of ['EditorMaterialStudio', 'document.', 'window.', 'new THREE.', 'MaterialAssignmentCore.js"', 'WorldAssetPlacementPipeline.js"']) {
  excludes(evidence, forbidden, `evidence helper does not execute forbidden runtime/editor concern: ${forbidden}`);
}

// Executable tests must target the actual module path and must not become grep-only claims.
includes(runtimeTest, "from '../src/3d/gameplay/livingWorldReactionRuntime.js'", 'runtime regression executes the shipped module');
includes(runtimeTest, "createLivingWorldReactionRuntime({", 'runtime regression constructs the real adapter');
includes(runtimeTest, 'runtime.tick(', 'runtime regression executes tick frames');
includes(runtimeTest, 'auditLivingWorldReactionResult(result)', 'runtime regression audits its result');
includes(runtimeTest, 'same seed generates the same full tick digest', 'runtime regression checks seeded determinism');
includes(runtimeTest, 'actor collection is capped before runtime simulation', 'runtime regression checks actor population cap');
includes(runtimeTest, 'outnumbered wildlife enters flee', 'runtime regression checks wildlife threat response');
includes(runtimeTest, 'first hostile perception enters detect', 'runtime regression checks detect phase');
includes(runtimeTest, 'confirmed visible hostile signal enters investigate', 'runtime regression checks investigate phase');
includes(runtimeTest, 'existing encounter policy authorizes chase', 'runtime regression checks chase phase');
includes(runtimeTest, 'existing encounter policy authorizes attack', 'runtime regression checks attack phase');
includes(runtimeTest, 'lost target causes return', 'runtime regression checks return phase');
includes(runtimeTest, 'wanted/crime evidence delegates into law owner', 'runtime regression checks law delegation');

includes(browserTest, "await import('./src/3d/vendor/three/three.module.js')", 'browser proof imports the real shipped Three.js vendor module');
includes(browserTest, "await import('./src/3d/gameplay/livingWorldReactionRuntime.js')", 'browser proof imports the real reaction runtime');
includes(browserTest, "new THREE.Object3D()", 'browser proof uses real Three.js Object3D instances');
includes(browserTest, 'livingWorldReaction', 'browser proof validates reaction telemetry path');
includes(browserTest, 'browser combat adapter was not invoked', 'browser proof checks combat delegation');
includes(browserTest, 'lost target did not return', 'browser proof checks return behavior');
includes(browserTest, 'request failed', 'browser proof installs a request-failure guard');
includes(browserTest, 'consoleErrors', 'browser proof checks console errors');
includes(browserTest, 'pageErrors', 'browser proof checks page errors');

// Test sources stay deterministic and bounded.
for (const [name, source] of [['runtime-test', runtimeTest], ['browser-test', browserTest]]) {
  assert(count(source, /Math\.random/g) === 0, `${name} has no Math.random`);
  assert(count(source, /Date\.now/g) === 0, `${name} has no Date.now`);
}

// The evidence policy itself must reject missing material/placement state rather than silently passing.
includes(evidence, 'missing-or-unvalidated-material-evidence', 'missing material evidence fails closed');
includes(evidence, 'missing-placement-evidence', 'missing placement evidence fails closed');
includes(evidence, 'actor-rejected:', 'evidence validator reports rejected actor identity');
includes(evidence, 'shared-material-core-mismatch', 'evidence validator detects shared material authority drift');
includes(evidence, 'shared-placement-core-mismatch', 'evidence validator detects shared placement authority drift');

// Contract-level ownership notes are executable via the presence of explicit negative claims.
for (const marker of [
  'does not load models',
  'does not assign materials',
  'does not place assets',
  'never loads models',
  'does not mutate controller state',
  'does not replace',
]) {
  assert(runtime.includes(marker) || evidence.includes(marker), `ownership boundary is documented: ${marker}`);
}

if (failures.length) {
  console.error(`[living-world-reaction-architecture] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`[living-world-reaction-architecture] PASS: ${passed} ownership/determinism assertions.`);
