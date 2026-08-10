import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const windowListeners = new Map();
const fakeWindow = {
  __WESTEROS_WORLD_EDITOR__: null,
  addEventListener(type, handler) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(handler);
  },
  removeEventListener(type, handler) {
    const list = windowListeners.get(type) || [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }
};

const context = vm.createContext({ console, window: fakeWindow });
const source = fs.readFileSync('src/3d/editor/EditorEditModeEnvironment.js', 'utf8');
const module = new vm.SourceTextModule(source, { context, identifier: 'EditorEditModeEnvironment.js' });
await module.link(() => { throw new Error('EditorEditModeEnvironment must stay dependency-free'); });
await module.evaluate();

const { installEditorEditModeEnvironment } = module.namespace;
const legacyFog = { type: 'Fog', near: 180, far: 520 };
const api = { scene: { fog: legacyFog } };
const surface = installEditorEditModeEnvironment(api);

assert.equal(api.scene.fog, null, 'Edit Mode must disable fog');
assert.deepEqual({ ...surface.getSnapshot() }, { fogDisabled: true, hadPreviousFog: true });
assert.equal(installEditorEditModeEnvironment(api), surface, 'duplicate install must reuse singleton');
assert.equal(windowListeners.get('pagehide')?.length, 1, 'pagehide cleanup listener must install once');

surface.dispose();
assert.equal(api.scene.fog, legacyFog, 'explicit dispose must restore previous editor fog state');
assert.equal(fakeWindow.__WESTEROS_EDITOR_ENVIRONMENT__, undefined, 'dispose must clear singleton');
assert.equal(windowListeners.get('pagehide')?.length || 0, 0, 'dispose leaked pagehide listener');
surface.dispose();

const foglessApi = { scene: { fog: null } };
const foglessSurface = installEditorEditModeEnvironment(foglessApi);
assert.deepEqual({ ...foglessSurface.getSnapshot() }, { fogDisabled: true, hadPreviousFog: false });
foglessSurface.dispose();
assert.equal(foglessApi.scene.fog, null, 'fogless scene must remain fogless after dispose');

console.log('PASS Run216 edit-mode fog: editor fog disabled deterministically, singleton idempotent, prior state restored on dispose, listener cleanup clean.');
