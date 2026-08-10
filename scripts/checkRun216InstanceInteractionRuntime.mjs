import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceRoot = process.argv[2];
assert(sourceRoot, 'source root is required');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-interaction-runtime-'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}\n');
for (const name of ['EditorInstancePointerController.js', 'EditorInstanceTransformBridge.js', 'EditorInstanceInteractionRuntime.js']) {
  fs.copyFileSync(path.join(sourceRoot, name), path.join(tmp, name));
}
const { createEditorInstanceInteractionRuntime } = await import(pathToFileURL(path.join(tmp, 'EditorInstanceInteractionRuntime.js')).href);

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    emit(type, event) { listeners.get(type)?.(event); },
    has(type) { return listeners.has(type); }
  };
}

const canvas = eventTarget();
const transformListeners = new Map();
const transform = {
  object: undefined,
  attach(object) { this.object = object; },
  detach() { this.object = undefined; },
  addEventListener(type, fn) { transformListeners.set(type, fn); },
  removeEventListener(type, fn) { if (transformListeners.get(type) === fn) transformListeners.delete(type); },
  emit(type) { transformListeners.get(type)?.(); }
};
const lifecycle = [];
let nextId = 0;
const runtime = createEditorInstanceInteractionRuntime({
  canvas,
  transformSurface: { transform },
  getHits: () => [{ object: { isInstancedMesh: true }, instanceId: 3 }],
  isBlocked: () => false,
  beginEdit(hits) {
    lifecycle.push(['begin', hits.length]);
    const proxy = { id: ++nextId };
    return { active: true, session: { proxy } };
  },
  commitEdit(coordinator) {
    lifecycle.push(['commit', coordinator.session.proxy.id]);
    return coordinator.session.proxy.id;
  },
  endEdit(coordinator) {
    lifecycle.push(['end', coordinator.session.proxy.id]);
    coordinator.active = false;
    return coordinator.session.proxy;
  }
});

assert.equal(canvas.has('pointerdown'), true, 'pointer listener should install');
assert.equal(transformListeners.has('objectChange'), true, 'transform listener should install');
canvas.emit('pointerdown', { button: 0, ctrlKey: false, metaKey: false, altKey: false });
assert.equal(transform.object.id, 1, 'primary pointer should attach first proxy');
assert.deepEqual(lifecycle[0], ['begin', 1]);
transform.emit('objectChange');
assert.deepEqual(lifecycle[1], ['commit', 1], 'objectChange should commit active proxy');
canvas.emit('pointerdown', { button: 0, ctrlKey: false, metaKey: false, altKey: false });
assert.deepEqual(lifecycle.slice(2, 4), [['end', 1], ['begin', 1]], 'new pick should end previous edit before begin');
assert.equal(transform.object.id, 2, 'second pointer should attach replacement proxy');
assert.equal(runtime.commit(), 2, 'explicit commit should delegate to bridge');
const ended = runtime.dispose();
assert.equal(ended.id, 2, 'dispose should end active edit');
assert.equal(canvas.has('pointerdown'), false, 'pointer listener should be removed');
assert.equal(transformListeners.has('objectChange'), false, 'transform listener should be removed');
assert.equal(transform.object, undefined, 'transform should detach on dispose');
assert.deepEqual(runtime.getSnapshot(), {
  disposed: true,
  pointerDisposed: true,
  transform: { active: false, attached: false, disposed: true }
});
assert.equal(runtime.dispose(), null, 'dispose should be idempotent');

let cleanupCount = 0;
const failingTransform = {
  object: undefined,
  attach() {}, detach() {},
  addEventListener() { cleanupCount += 1; },
  removeEventListener() { cleanupCount -= 1; }
};
assert.throws(() => createEditorInstanceInteractionRuntime({
  canvas: {},
  transformSurface: { transform: failingTransform },
  getHits: () => [],
  beginEdit: () => null,
  commitEdit: () => null,
  endEdit: () => null
}), /canvas event target is required/);
assert.equal(cleanupCount, 0, 'partial construction failure should dispose transform bridge listener');
console.log('[checkRun216InstanceInteractionRuntime] PASS');
