import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceRoot = process.argv[2];
assert(sourceRoot, 'source root is required');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-interaction-pipeline-'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}\n');
for (const name of [
  'EditorInstancePointerController.js',
  'EditorInstanceTransformBridge.js',
  'EditorInstanceInteractionRuntime.js',
  'EditorInstanceRaycastSource.js',
  'EditorInstanceInteractionPipeline.js'
]) fs.copyFileSync(path.join(sourceRoot, name), path.join(tmp, name));
const { createEditorInstanceInteractionPipeline } = await import(pathToFileURL(path.join(tmp, 'EditorInstanceInteractionPipeline.js')).href);

const canvasListeners = new Map();
const canvas = {
  addEventListener(type, fn) { canvasListeners.set(type, fn); },
  removeEventListener(type, fn) { if (canvasListeners.get(type) === fn) canvasListeners.delete(type); },
  getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 100 }; },
  emit(type, event) { canvasListeners.get(type)?.(event); }
};
const transformListeners = new Map();
const transform = {
  object: undefined,
  attach(object) { this.object = object; },
  detach() { this.object = undefined; },
  addEventListener(type, fn) { transformListeners.set(type, fn); },
  removeEventListener(type, fn) { if (transformListeners.get(type) === fn) transformListeners.delete(type); },
  emit(type) { transformListeners.get(type)?.(); }
};
const camera = { id: 'camera' };
const mesh = { isInstancedMesh: true, id: 'formation' };
const rayCalls = [];
const hit = { object: mesh, instanceId: 7, distance: 4 };
const raycaster = {
  setFromCamera(pointer, receivedCamera) { rayCalls.push(['set', { ...pointer }, receivedCamera]); },
  intersectObjects(objects, recursive) { rayCalls.push(['intersect', objects, recursive]); return [hit]; }
};
const lifecycle = [];
const pipeline = createEditorInstanceInteractionPipeline({
  canvas,
  camera,
  raycaster,
  getObjects: () => [mesh],
  transformSurface: { transform },
  isBlocked: () => false,
  beginEdit(hits) {
    lifecycle.push(['begin', hits[0].instanceId]);
    return { active: true, session: { proxy: { id: `proxy-${hits[0].instanceId}` } } };
  },
  commitEdit(coordinator) { lifecycle.push(['commit', coordinator.session.proxy.id]); return coordinator.session.proxy.id; },
  endEdit(coordinator) { lifecycle.push(['end', coordinator.session.proxy.id]); coordinator.active = false; return coordinator.session.proxy; }
});
canvas.emit('pointerdown', { button: 0, ctrlKey: false, metaKey: false, altKey: false, clientX: 110, clientY: 45 });
assert.deepEqual(rayCalls[0], ['set', { x: 0, y: 0.5 }, camera], 'pipeline should normalize pointer before raycast');
assert.deepEqual(rayCalls[1], ['intersect', [mesh], false], 'pipeline should raycast only instance mesh candidates');
assert.deepEqual(lifecycle[0], ['begin', 7], 'raycast hit should begin matching instance edit');
assert.equal(transform.object.id, 'proxy-7', 'pipeline should attach selected instance proxy');
transform.emit('objectChange');
assert.deepEqual(lifecycle[1], ['commit', 'proxy-7'], 'transform change should commit through pipeline');
assert.deepEqual(pipeline.getSnapshot().pointer, { x: 0, y: 0.5 }, 'pipeline snapshot should expose normalized pointer');
assert.equal(pipeline.getSnapshot().runtime.transform.attached, true, 'pipeline snapshot should expose attached transform');
pipeline.dispose();
assert.equal(canvasListeners.has('pointerdown'), false, 'pipeline dispose should remove canvas listener');
assert.equal(transformListeners.has('objectChange'), false, 'pipeline dispose should remove transform listener');
assert.deepEqual(lifecycle.at(-1), ['end', 'proxy-7'], 'pipeline dispose should end active edit');
console.log('[checkRun216InstanceInteractionPipeline] PASS');
