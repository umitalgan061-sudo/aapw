import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceFile = process.argv[2];
assert(sourceFile, 'source file is required');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-coordinator-lifecycle-'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}\n');
fs.copyFileSync(sourceFile, path.join(tmp, 'EditorInstanceCoordinatorLifecycle.js'));
fs.writeFileSync(path.join(tmp, 'EditorInstanceEditCoordinator.js'), `
export function beginEditorInstanceEditFromHits(THREE, scene, groups, hits) {
  globalThis.__calls.push(['begin', THREE, scene, groups, hits]);
  return { active: true, session: { proxy: { id: 'proxy' } } };
}
export function commitEditorInstanceEdit(THREE, groups, coordinator) {
  globalThis.__calls.push(['commit', THREE, groups, coordinator]);
  return 'committed';
}
export function endEditorInstanceEdit(scene, coordinator) {
  globalThis.__calls.push(['end', scene, coordinator]);
  return 'ended';
}
`);
globalThis.__calls = [];
const { createEditorInstanceCoordinatorLifecycle } = await import(pathToFileURL(path.join(tmp, 'EditorInstanceCoordinatorLifecycle.js')).href);
const THREE = { id: 'three' };
const scene = { id: 'scene' };
const groupsA = [{ id: 'a' }];
const groupsB = [{ id: 'b' }];
let groups = groupsA;
const lifecycle = createEditorInstanceCoordinatorLifecycle({ THREE, scene, getGroups: () => groups });
const hits = [{ instanceId: 2 }];
const coordinator = lifecycle.beginEdit(hits);
assert.equal(globalThis.__calls[0][0], 'begin');
assert.equal(globalThis.__calls[0][1], THREE);
assert.equal(globalThis.__calls[0][2], scene);
assert.equal(globalThis.__calls[0][3], groupsA);
assert.equal(globalThis.__calls[0][4], hits);
groups = groupsB;
assert.equal(lifecycle.commitEdit(coordinator), 'committed');
assert.equal(globalThis.__calls[1][2], groupsB, 'commit should resolve current groups lazily');
assert.equal(lifecycle.endEdit(coordinator), 'ended');
assert.equal(globalThis.__calls[2][1], scene);
assert.throws(() => createEditorInstanceCoordinatorLifecycle({ THREE, scene, getGroups: () => null }).beginEdit([]), /getGroups must return an array/);
assert.throws(() => createEditorInstanceCoordinatorLifecycle({ scene, getGroups: () => [] }), /THREE namespace is required/);
console.log('[checkRun216InstanceCoordinatorLifecycle] PASS');
