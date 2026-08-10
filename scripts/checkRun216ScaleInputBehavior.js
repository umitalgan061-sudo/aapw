import { installEditorScaleInputController } from '../src/3d/editor/EditorScaleInputController.js';

class FakeInput {
  constructor(id) {
    this.id = id;
    this.value = '1';
    this.min = '0.01';
    this.step = '0.1';
    this.attributes = new Map();
    this.listeners = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, handler, options) {
    this.listeners.set(type, { handler, options });
  }

  removeEventListener(type, handler) {
    const current = this.listeners.get(type);
    if (current?.handler === handler) this.listeners.delete(type);
  }

  change(value) {
    this.value = value;
    let stopped = false;
    this.listeners.get('change')?.handler({
      currentTarget: this,
      stopImmediatePropagation() {
        stopped = true;
      }
    });
    return stopped;
  }
}

const inputs = Object.fromEntries(
  ['we-scale-x', 'we-scale-y', 'we-scale-z'].map((id) => [id, new FakeInput(id)])
);
const windowListeners = new Map();
globalThis.window = {
  addEventListener(type, handler, options) {
    windowListeners.set(type, { handler, options });
  },
  removeEventListener(type, handler) {
    const current = windowListeners.get(type);
    if (current?.handler === handler) windowListeners.delete(type);
  }
};
globalThis.document = {
  getElementById(id) {
    return inputs[id] || null;
  }
};

const selected = { isInstancedMesh: false, scale: { x: 1, y: 1, z: 1 } };
let inspectorWrites = 0;
let hierarchyRefreshes = 0;
const api = {
  getSelectedObject: () => selected,
  writeInspector: () => {
    inspectorWrites += 1;
  },
  refreshHierarchy: () => {
    hierarchyRefreshes += 1;
  }
};

const surface = installEditorScaleInputController(api);
if (surface.minimumScale !== 0.001) throw new Error(`minimum scale mismatch: ${surface.minimumScale}`);

for (const input of Object.values(inputs)) {
  if (input.min !== '0.001') throw new Error(`${input.id} min metadata mismatch: ${input.min}`);
  if (input.step !== '0.001') throw new Error(`${input.id} step metadata mismatch: ${input.step}`);
  if (input.attributes.get('inputmode') !== 'decimal') throw new Error(`${input.id} decimal inputmode missing`);
  if (input.listeners.get('change')?.options !== true) throw new Error(`${input.id} change listener must stay capture-phase`);
}

if (!inputs['we-scale-x'].change('0.0002')) throw new Error('scale change must stop legacy bubble listener');
if (selected.scale.x !== 0.001) throw new Error(`sub-minimum scale was not clamped to 0.001: ${selected.scale.x}`);

inputs['we-scale-y'].change('0.007');
if (selected.scale.y !== 0.007) throw new Error(`precise scale below legacy 0.01 floor was lost: ${selected.scale.y}`);

const refreshBeforeBlank = hierarchyRefreshes;
inputs['we-scale-z'].change('   ');
if (selected.scale.z !== 1) throw new Error('blank scale input must not mutate selected object');
if (hierarchyRefreshes !== refreshBeforeBlank) throw new Error('blank scale input must not refresh hierarchy');

selected.isInstancedMesh = true;
const xBeforeInstanced = selected.scale.x;
const stoppedForInstanced = inputs['we-scale-x'].change('0.2');
if (stoppedForInstanced) throw new Error('instanced mesh scale must stay on legacy/read-only path');
if (selected.scale.x !== xBeforeInstanced) throw new Error('instanced mesh scale mutated unexpectedly');
selected.isInstancedMesh = false;

if (inspectorWrites !== 3) throw new Error(`unexpected inspector write count: ${inspectorWrites}`);
if (hierarchyRefreshes !== 2) throw new Error(`unexpected hierarchy refresh count: ${hierarchyRefreshes}`);
if (!windowListeners.has('pagehide')) throw new Error('pagehide cleanup listener missing');

surface.dispose();
if (window.__WESTEROS_EDITOR_SCALE_INPUT__) throw new Error('global scale surface not cleared on dispose');
if (windowListeners.has('pagehide')) throw new Error('pagehide listener leaked after dispose');
for (const input of Object.values(inputs)) {
  if (input.listeners.has('change')) throw new Error(`${input.id} change listener leaked after dispose`);
}

console.log('PASS Run216 scale input behavior: 0.001 precision, legacy interception, instanced safety, and cleanup verified.');
