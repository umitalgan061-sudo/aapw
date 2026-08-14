import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceFile = process.argv[2];
assert(sourceFile, 'source file is required');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-interaction-installer-'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}\n');
fs.copyFileSync(sourceFile, path.join(tmp, 'EditorInstanceInteractionInstaller.js'));
fs.writeFileSync(path.join(tmp, 'EditorInstanceCoordinatorLifecycle.js'), `
export function createEditorInstanceCoordinatorLifecycle(options) {
  globalThis.__lifecycleOptions = options;
  return {
    beginEdit: (...args) => ['begin', ...args],
    commitEdit: (...args) => ['commit', ...args],
    endEdit: (...args) => ['end', ...args]
  };
}
`);
fs.writeFileSync(path.join(tmp, 'EditorInstanceInteractionPipeline.js'), `
export function createEditorInstanceInteractionPipeline(options) {
  globalThis.__pipelineOptions = options;
  return Object.freeze({ id: 'pipeline', options });
}
`);
const { installEditorInstanceInteraction } = await import(pathToFileURL(path.join(tmp, 'EditorInstanceInteractionInstaller.js')).href);
const THREE = { id: 'three' };
const scene = { id: 'scene' };
const canvas = { id: 'canvas' };
const camera = { id: 'camera' };
const raycaster = { id: 'raycaster' };
const transformSurface = { id: 'transform' };
const isBlocked = () => false;
const objectA = { id: 'mesh-a' };
const objectB = { id: 'mesh-b' };
const instanceManager = { groups: [{ object: objectA }, { object: null }] };
const installed = installEditorInstanceInteraction({ THREE, scene, canvas, camera, raycaster, transformSurface, isBlocked, instanceManager });
assert.equal(installed.id, 'pipeline');
assert.equal(globalThis.__lifecycleOptions.THREE, THREE);
assert.equal(globalThis.__lifecycleOptions.scene, scene);
assert.equal(globalThis.__lifecycleOptions.getGroups(), instanceManager.groups, 'lifecycle should read live groups array');
assert.equal(globalThis.__pipelineOptions.canvas, canvas);
assert.equal(globalThis.__pipelineOptions.camera, camera);
assert.equal(globalThis.__pipelineOptions.raycaster, raycaster);
assert.equal(globalThis.__pipelineOptions.transformSurface, transformSurface);
assert.equal(globalThis.__pipelineOptions.isBlocked, isBlocked);
assert.deepEqual(globalThis.__pipelineOptions.getObjects(), [objectA], 'installer should expose only present group objects');
instanceManager.groups = [{ object: objectB }];
assert.equal(globalThis.__lifecycleOptions.getGroups(), instanceManager.groups, 'lifecycle should follow replacement groups arrays');
assert.deepEqual(globalThis.__pipelineOptions.getObjects(), [objectB], 'raycast objects should follow replacement groups arrays');
assert.deepEqual(globalThis.__pipelineOptions.beginEdit('x'), ['begin', 'x']);
assert.deepEqual(globalThis.__pipelineOptions.commitEdit('y'), ['commit', 'y']);
assert.deepEqual(globalThis.__pipelineOptions.endEdit('z'), ['end', 'z']);
assert.throws(() => installEditorInstanceInteraction({ instanceManager: {} }), /instanceManager with groups array is required/);
console.log('[checkRun216InstanceInteractionInstaller] PASS');
