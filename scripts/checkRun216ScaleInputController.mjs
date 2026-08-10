const inputs = new Map();
const pagehideListeners = [];

function makeInput(id) {
  const listeners = [];
  const input = {
    id,
    value: '1',
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

globalThis.window = {
  addEventListener(type, handler) {
    if (type === 'pagehide') pagehideListeners.push(handler);
  }
};

const { installEditorScaleInputController, EDITOR_SCALE_INPUT_POLICY } = await import('../src/3d/editor/EditorScaleInputController.js');

let selected = { isInstancedMesh: false, scale: { x: 1, y: 1, z: 1 } };
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

scaleY.value = '0';
scaleY.dispatchChange();
if (selected.scale.y !== 0.001) throw new Error(`zero scale was not clamped safely: ${selected.scale.y}`);

scaleZ.value = 'not-a-number';
const previousZ = selected.scale.z;
scaleZ.dispatchChange();
if (selected.scale.z !== previousZ) throw new Error('invalid scale mutated object state');

const ordinary = selected;
selected = { isInstancedMesh: true, scale: { x: 1, y: 1, z: 1 } };
scaleX.value = '0.25';
if (scaleX.dispatchChange()) throw new Error('instance group scale event should remain available to its own editing layer');
if (selected.scale.x !== 1) throw new Error('instance group scale was mutated by ordinary-object controller');
selected = ordinary;

if (inspectorWrites < 3) throw new Error('Inspector was not synchronized after scale changes');
if (hierarchyRefreshes !== 2) throw new Error(`unexpected hierarchy refresh count: ${hierarchyRefreshes}`);

surface.dispose();
if (scaleX.listenerCount() || scaleY.listenerCount() || scaleZ.listenerCount()) throw new Error('dispose leaked scale listeners');
surface.dispose();

console.log('PASS Run216 precise Inspector scale input: sub-0.01 values persist, zero stays non-singular, invalid input is non-destructive, cleanup is idempotent.');
