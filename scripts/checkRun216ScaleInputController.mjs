const inputs = new Map();
const pagehideListeners = [];

function makeInput(id) {
  const listeners = [];
  const input = {
    id,
    value: '1',
    setAttribute(name, value) {
      this[name] = String(value);
    },
    addEventListener(type, handler, capture) {
      if (type === 'change') listeners.push({ handler, capture });
    },
    removeEventListener(type, handler, capture) {
      const index = listeners.findIndex((entry) => entry.handler === handler && entry.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatchChange() {
      let stopped = false;
      const event = {
        currentTarget: input,
        stopImmediatePropagation() { stopped = true; }
      };
      for (const entry of [...listeners]) entry.handler(event);
      return stopped;
    },
    listenerCount() { return listeners.length; }
  };
  inputs.set(id, input);
  return input;
}

const scaleX = makeInput('we-scale-x');
const scaleY = makeInput('we-scale-y');
const scaleZ = makeInput('we-scale-z');

globalThis.document = {
  getElementById(id) { return inputs.get(id) || null; }
};

let foundationRefreshes = 0;
let lastGroundedObject = null;
globalThis.window = {
  addEventListener(type, handler) {
    if (type === 'pagehide') pagehideListeners.push(handler);
  },
  __WESTEROS_EDITOR_PLACEMENT__: {
    groundObject(object) {
      foundationRefreshes += 1;
      lastGroundedObject = object;
      return { ok: true };
    }
  }
};
globalThis.window.removeEventListener = (type, handler) => {
  if (type !== 'pagehide') return;
  const index = pagehideListeners.indexOf(handler);
  if (index >= 0) pagehideListeners.splice(index, 1);
};

const { installEditorScaleInputController, EDITOR_SCALE_INPUT_POLICY } = await import('../src/3d/editor/EditorScaleInputController.js');

let selected = {
  isInstancedMesh: false,
  scale: { x: 1, y: 1, z: 1 },
  userData: { editorFoundationKey: 'asset:test-structure' }
};
let inspectorWrites = 0;
let hierarchyRefreshes = 0;
const api = {
  getSelectedObject: () => selected,
  writeInspector: () => { inspectorWrites += 1; },
  refreshHierarchy: () => { hierarchyRefreshes += 1; }
};

const surface = installEditorScaleInputController(api);
if (surface.minimumScale !== 0.001 || EDITOR_SCALE_INPUT_POLICY.minimumScale !== 0.001) throw new Error('minimum scale contract changed');
if (scaleX.listenerCount() !== 1 || scaleY.listenerCount() !== 1 || scaleZ.listenerCount() !== 1) throw new Error('scale listeners not installed exactly once');
if (installEditorScaleInputController(api) !== surface) throw new Error('duplicate install did not reuse singleton');

scaleX.value = '0.005';
if (!scaleX.dispatchChange()) throw new Error('precise scale input did not own the change event');
if (selected.scale.x !== 0.005) throw new Error(`0.005 scale was not preserved: ${selected.scale.x}`);
if (foundationRefreshes !== 1 || lastGroundedObject !== selected) throw new Error('structural numeric scale did not refresh its terrain foundation');

scaleY.value = '0';
scaleY.dispatchChange();
if (selected.scale.y !== 0.001) throw new Error(`zero scale was not clamped safely: ${selected.scale.y}`);
if (foundationRefreshes !== 2) throw new Error('clamped structural scale did not refresh terrain foundation');

scaleZ.value = 'not-a-number';
const previousZ = selected.scale.z;
scaleZ.dispatchChange();
if (selected.scale.z !== previousZ) throw new Error('invalid scale mutated object state');
scaleZ.value = '   ';
scaleZ.dispatchChange();
if (selected.scale.z !== previousZ) throw new Error('blank scale mutated object state');
if (foundationRefreshes !== 2) throw new Error('invalid/blank scale must not rebuild terrain foundation');

const structure = selected;
selected = { isInstancedMesh: false, scale: { x: 1, y: 1, z: 1 }, userData: {} };
scaleX.value = '0.5';
if (!scaleX.dispatchChange()) throw new Error('ordinary scale input did not own the change event');
if (selected.scale.x !== 0.5) throw new Error('ordinary scale was not applied');
if (foundationRefreshes !== 2) throw new Error('non-foundation object must not invoke terrain grounding');

const ordinary = selected;
selected = { isInstancedMesh: true, scale: { x: 1, y: 1, z: 1 }, userData: {} };
scaleX.value = '0.25';
if (scaleX.dispatchChange()) throw new Error('instance group scale event should remain available to its own editing layer');
if (selected.scale.x !== 1) throw new Error('instance group scale was mutated by ordinary-object controller');
selected = ordinary;

if (inspectorWrites < 5) throw new Error('Inspector was not synchronized after scale changes');
if (hierarchyRefreshes !== 3) throw new Error(`unexpected hierarchy refresh count: ${hierarchyRefreshes}`);
if (pagehideListeners.length !== 1) throw new Error('pagehide cleanup listener not installed exactly once');

selected = structure;
surface.dispose();
if (scaleX.listenerCount() || scaleY.listenerCount() || scaleZ.listenerCount()) throw new Error('dispose leaked scale listeners');
if (pagehideListeners.length !== 0) throw new Error('dispose leaked pagehide listener');
surface.dispose();

console.log('PASS Run216 precise Inspector scale input: sub-0.01 values persist, zero stays non-singular, structural numeric scaling refreshes the shared terrain foundation exactly once per valid committed change, invalid/blank input is non-destructive, and cleanup is idempotent.');
