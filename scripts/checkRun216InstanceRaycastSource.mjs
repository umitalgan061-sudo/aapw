import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceFile = process.argv[2];
assert(sourceFile, 'source file is required');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-raycast-source-'));
const moduleFile = path.join(tmp, 'EditorInstanceRaycastSource.mjs');
fs.copyFileSync(sourceFile, moduleFile);
const { createEditorInstanceRaycastSource } = await import(pathToFileURL(moduleFile).href);

const calls = [];
const camera = { id: 'camera' };
const instancedA = { isInstancedMesh: true, id: 'a' };
const instancedB = { isInstancedMesh: true, id: 'b' };
const nonInstance = { isInstancedMesh: false, id: 'plain' };
const hits = [{ object: instancedB, instanceId: 4, distance: 3 }];
const raycaster = {
  setFromCamera(pointer, receivedCamera) { calls.push(['set', { ...pointer }, receivedCamera]); },
  intersectObjects(objects, recursive) { calls.push(['intersect', objects, recursive]); return hits; }
};
const canvas = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 200 }) };
const source = createEditorInstanceRaycastSource({
  canvas,
  camera,
  raycaster,
  getObjects: () => [instancedA, nonInstance, null, instancedB]
});
const result = source.getHits({ clientX: 300, clientY: 100 });
assert.equal(result, hits, 'raycast result identity should be preserved');
assert.deepEqual(calls[0], ['set', { x: 0, y: 0.5 }, camera], 'canvas coordinates should normalize to NDC');
assert.deepEqual(calls[1], ['intersect', [instancedA, instancedB], false], 'only InstancedMesh candidates should raycast non-recursively');
assert.deepEqual(source.getPointerSnapshot(), { x: 0, y: 0.5 });

let zeroCalls = 0;
const zero = createEditorInstanceRaycastSource({
  canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 100 }) },
  camera,
  raycaster: {
    setFromCamera() { zeroCalls += 1; },
    intersectObjects() { zeroCalls += 1; return []; }
  },
  getObjects: () => [instancedA]
});
assert.deepEqual(zero.getHits({ clientX: 0, clientY: 0 }), [], 'zero-size canvas should not raycast');
assert.equal(zeroCalls, 0, 'zero-size canvas should not touch raycaster');

let emptyCalls = 0;
const empty = createEditorInstanceRaycastSource({
  canvas,
  camera,
  raycaster: {
    setFromCamera() { emptyCalls += 1; },
    intersectObjects() { emptyCalls += 1; return []; }
  },
  getObjects: () => [nonInstance]
});
assert.deepEqual(empty.getHits({ clientX: 100, clientY: 50 }), [], 'non-instance object list should be ignored');
assert.equal(emptyCalls, 0, 'no instance candidates should not touch raycaster');
assert.throws(() => createEditorInstanceRaycastSource({}), /canvas bounds API is required/);
console.log('[checkRun216InstanceRaycastSource] PASS');
