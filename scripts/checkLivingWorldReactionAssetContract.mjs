import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const failures = [];
let passed = 0;
function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}
function exists(relativePath) {
  const absolutePath = path.resolve(ROOT, relativePath);
  return fs.existsSync(absolutePath);
}
function read(relativePath) {
  const absolutePath = path.resolve(ROOT, relativePath);
  return exists(relativePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
}
function gitNames() {
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: ROOT, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

// Asset-first inventory: all canonical model families must remain discoverable, even when Git LFS
// exposes pointer text. This check never interprets a pointer as a missing asset and never writes to source assets.
const modelFamilies = [
  'assets/models/characters',
  'assets/models/animals',
  'assets/models/creatures',
  'assets/models/dragons',
  'assets/models/fbx',
  'assets/animations',
  'assets/textures',
  'assets/audio',
  'assets/particles',
];
for (const family of modelFamilies) {
  assert(exists(family), `asset family exists: ${family}`);
}

const sharedMaterial = 'src/3d/materials/MaterialAssignmentCore.js';
const sharedPlacement = 'src/3d/world/WorldAssetPlacementPipeline.js';
const sharedContract = 'scripts/checkSharedMaterialPlacementContract.js';
assert(exists(sharedMaterial), 'shared MaterialAssignmentCore exists on current main');
assert(exists(sharedPlacement), 'shared WorldAssetPlacementPipeline exists on current main');
assert(exists(sharedContract), 'shared placement/material regression exists on current main');

const runtime = read('src/3d/gameplay/livingWorldReactionRuntime.js');
const evidence = read('src/3d/gameplay/livingWorldReactionEvidence.js');
const integration = read('src/3d/gameplay/livingWorldReactionIntegrationAdapter.js');

// Runtime modules must never pull authoring/editor UI or directly instantiate imported assets.
for (const [name, source] of [['runtime', runtime], ['evidence', evidence], ['integration', integration]]) {
  for (const forbidden of [
    'EditorMaterialStudio',
    'EditorMaterialStudio.js',
    'document.',
    'window.',
    'FBXLoader',
    'GLTFLoader',
    'loadAsync(',
    'new THREE.',
    'TextureLoader',
    'FileLoader',
  ]) {
    assert(!source.includes(forbidden), `${name} stays clear of authoring/importer concern: ${forbidden}`);
  }
}

// The new runtime has no new model byte payload. If any asset file is added accidentally,
// stop the qualification so a real model can go through the shared placement/material pipeline first.
const changed = gitNames();
const changedAssetFiles = changed.filter((name) => /^(assets\/models\/|assets\/animations\/|assets\/textures\/|assets\/audio\/|assets\/particles\/)/.test(name));
assert(changedAssetFiles.length === 0, `reaction runtime introduces no unqualified asset payloads (${changedAssetFiles.join(', ') || 'none'})`);

// New gameplay code must keep the #590 shared authority explicit rather than growing another material system.
assert(evidence.includes("src/3d/materials/MaterialAssignmentCore.js"), 'evidence records the shared material authority');
assert(evidence.includes("src/3d/world/WorldAssetPlacementPipeline.js"), 'evidence records the shared placement authority');
assert(runtime.includes('no model'), 'runtime ownership documentation says models are not owned here');
assert(runtime.includes('spawn'), 'runtime documents spawn as an owner concern rather than implementing it');
assert(integration.includes('existing Living World directors'), 'composition adapter identifies existing directors as owners');
assert(integration.includes('does not'), 'composition adapter documents non-ownership constraints');

// Source provenance and LFS policy are read-only concerns for this turn.
const gitattributes = read('.gitattributes');
assert(gitattributes.length > 0, '.gitattributes remains available for LFS provenance');
assert(/filter=lfs|lfs/.test(gitattributes), 'repository LFS policy remains declared');

// Existing source assets remain untouched by this branch. Runtime work consumes actor/controller state,
// so missing model pointers cannot be misclassified as runtime material failures.
assert(changed.every((name) => !name.endsWith('.blend') && !name.endsWith('.fbx') && !name.endsWith('.glb') && !name.endsWith('.gltf')), 'no source model files are overwritten');

if (failures.length) {
  console.error(`[living-world-reaction-assets] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`[living-world-reaction-assets] PASS: ${passed} asset-first/shared-contract assertions.`);
