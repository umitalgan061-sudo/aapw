const inputs = new Map();
const windowListeners = new Map();
let writeInspectorCalls = 0;
let hierarchyRefreshes = 0;
let historyCaptures = 0;

function makeInput(id) {
  const input = {
    id,
    value: '1.000000',
    min: '',
    step: '',
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; }
  };
  inputs.set(id, input);
  return input;
}

const x = makeInput('we-scale-x');
const y = makeInput('we-scale-y');
const z = makeInput('we-scale-z');
const selectionStatus = { id: 'we-selection-status' };

class FakeMutationObserver {
  constructor(callback) { this.callback = callback; }
  observe() {}
  disconnect() {}
}
globalThis.MutationObserver = FakeMutationObserver;

globalThis.document = {
  getElementById(id) {
    if (id === 'we-selection-status') return selectionStatus;
    return inputs.get(id) || null;
  }
};

function addWindowListener(type, handler, capture) {
  const list = windowListeners.get(type) || [];
  list.push({ handler, capture });
  windowListeners.set(type, list);
}
function removeWindowListener(type, handler, capture) {
  const list = windowListeners.get(type) || [];
  const index = list.findIndex((entry) => entry.handler === handler && entry.capture === capture);
  if (index >= 0) list.splice(index, 1);
}

const selected = {
  isInstancedMesh: false,
  scale: {
    x: 1,
    y: 1,
    z: 1,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; }
  }
};

const api = {
  getSelectedObject: () => selected,
  writeInspector(object) {
    writeInspectorCalls += 1;
    x.value = object.scale.x.toFixed(3);
    y.value = object.scale.y.toFixed(3);
    z.value = object.scale.z.toFixed(3);
  },
  refreshHierarchy() { hierarchyRefreshes += 1; }
};

globalThis.window = {
  __WESTEROS_WORLD_EDITOR__: api,
  __WESTEROS_EDITOR_HISTORY__: { scheduleCapture() { historyCaptures += 1; } },
  __WESTEROS_EDITOR_TRANSFORM__: { syncSelection() {} },
  addEventListener: addWindowListener,
  removeEventListener: removeWindowListener,
  setTimeout,
  clearTimeout
};

await import('../src/3d/editor/EditorScaleInputController.js');
await new Promise((resolve) => setTimeout(resolve, 10));

const surface = window.__WESTEROS_EDITOR_MICRO_SCALE__;
if (!surface || surface.version !== 2) throw new Error(`V2 micro-scale surface missing: ${JSON.stringify(surface)}`);
if (surface.minimumScale !== 0.000001) throw new Error(`V2 minimum mismatch: ${surface.minimumScale}`);

function dispatch(type, input, value) {
  input.value = value;
  let stopped = false;
  const event = {
    type,
    target: input,
    currentTarget: window,
    preventDefault() {},
    stopImmediatePropagation() { stopped = true; }
  };
  for (const entry of [...(windowListeners.get(type) || [])]) {
    entry.handler(event);
    if (stopped) break;
  }
  return stopped;
}

const baselineWrites = writeInspectorCalls;
if (!dispatch('input', y, '0.000001')) throw new Error('V2 did not own input capture');
if (selected.scale.y !== 0.000001) throw new Error(`live input did not update Y: ${selected.scale.y}`);
if (writeInspectorCalls !== baselineWrites) throw new Error('live input rewrote the Inspector before commit');
if (y.value !== '0.000001') throw new Error(`active Y field was rewritten during input: ${y.value}`);
if (x.value !== '1.000000' || z.value !== '1.000000') throw new Error('live Y input rewrote sibling Inspector fields');

if (!dispatch('change', y, '0.000001')) throw new Error('V2 did not own change capture');
if (selected.scale.y !== 0.000001) throw new Error(`committed Y scale mismatch: ${selected.scale.y}`);
if (writeInspectorCalls !== baselineWrites + 1) throw new Error('commit did not perform exactly one Inspector normalization');
if (y.value !== '0.000001') throw new Error(`committed Y scale lost six-decimal precision: ${y.value}`);
if (historyCaptures !== 1 || hierarchyRefreshes !== 1) throw new Error(`commit side effects mismatch: history=${historyCaptures} hierarchy=${hierarchyRefreshes}`);

for (const [input, axis] of [[x, 'x'], [z, 'z']]) {
  dispatch('input', input, '0.000001');
  if (selected.scale[axis] !== 0.000001) throw new Error(`live ${axis} input mismatch: ${selected.scale[axis]}`);
  if (input.value !== '0.000001') throw new Error(`active ${axis} field was rewritten before commit`);
  dispatch('change', input, '0.000001');
}
if (![selected.scale.x, selected.scale.y, selected.scale.z].every((value) => value === 0.000001)) {
  throw new Error(`three-axis micro scale mismatch: ${selected.scale.x},${selected.scale.y},${selected.scale.z}`);
}
if (![x.value, y.value, z.value].every((value) => value === '0.000001')) {
  throw new Error(`three-axis display mismatch: ${x.value},${y.value},${z.value}`);
}

surface.dispose();
console.log('PASS Run259 V2 micro-scale input/commit split: live typing preserves the active field; commit normalizes to six decimals and records history.');
