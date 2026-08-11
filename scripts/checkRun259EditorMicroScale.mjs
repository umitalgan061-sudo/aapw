const inputs = new Map();
const windowListeners = new Map();
const transformListeners = new Map();
let historyCaptures = 0;
let hierarchyRefreshes = 0;
let transformSyncs = 0;

function near(actual, expected, epsilon = 1e-12) {
  return Math.abs(Number(actual) - Number(expected)) <= epsilon;
}

function makeInput(id) {
  const listeners = [];
  const input = {
    id,
    value: '1.000',
    min: '',
    step: '',
    setAttribute(name, value) { this[name] = String(value); },
    addEventListener(type, handler, capture) {
      if (type === 'change') listeners.push({ handler, capture });
    },
    removeEventListener(type, handler, capture) {
      const index = listeners.findIndex((entry) => entry.handler === handler && entry.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatchTargetChange(event) {
      for (const entry of [...listeners]) entry.handler(event);
    }
  };
  inputs.set(id, input);
  return input;
}

const scaleX = makeInput('we-scale-x');
const scaleY = makeInput('we-scale-y');
const scaleZ = makeInput('we-scale-z');
const selectionStatus = { id: 'we-selection-status' };

class FakeMutationObserver {
  constructor(callback) { this.callback = callback; this.active = false; }
  observe() { this.active = true; }
  disconnect() { this.active = false; }
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
function addTransformListener(type, handler) {
  const list = transformListeners.get(type) || [];
  list.push(handler);
  transformListeners.set(type, list);
}
function removeTransformListener(type, handler) {
  const list = transformListeners.get(type) || [];
  const index = list.indexOf(handler);
  if (index >= 0) list.splice(index, 1);
}

const scale = {
  x: 1,
  y: 1,
  z: 1,
  set(x, y, z) { this.x = x; this.y = y; this.z = z; }
};
const selected = {
  isInstancedMesh: false,
  name: 'Micro Scale Probe',
  userData: { editorId: 'micro-0001', editorAssetId: 'marker-castle' },
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale
};

const transform = {
  object: selected,
  addEventListener: addTransformListener,
  removeEventListener: removeTransformListener
};

const api = {
  getSelectedObject: () => selected,
  writeInspector(object) {
    scaleX.value = object.scale.x.toFixed(3);
    scaleY.value = object.scale.y.toFixed(3);
    scaleZ.value = object.scale.z.toFixed(3);
  },
  refreshHierarchy: () => { hierarchyRefreshes += 1; }
};

globalThis.window = {
  __WESTEROS_WORLD_EDITOR__: api,
  __WESTEROS_EDITOR_HISTORY__: { scheduleCapture: () => { historyCaptures += 1; } },
  __WESTEROS_EDITOR_TRANSFORM__: { transform, syncSelection: () => { transformSyncs += 1; } },
  addEventListener: addWindowListener,
  removeEventListener: removeWindowListener,
  setTimeout,
  clearTimeout
};

const module = await import('../src/3d/editor/EditorScaleInputController.js');
const legacy = module.installEditorScaleInputController(api);
const micro = module.installEditorMicroScaleOverride(api);
await new Promise((resolve) => setTimeout(resolve, 10));

if (legacy.minimumScale !== 0.001) throw new Error('legacy additive contract unexpectedly changed');
if (!near(micro.minimumScale, 0.000001)) throw new Error(`micro minimum mismatch: ${micro.minimumScale}`);
if (!near(module.EDITOR_MICRO_SCALE_POLICY.minimumScale, 0.000001)) throw new Error('micro policy minimum mismatch');
if (module.EDITOR_MICRO_SCALE_POLICY.decimals !== 6) throw new Error('micro precision must remain six decimals');
for (const input of [scaleX, scaleY, scaleZ]) {
  if (input.min !== '0.000001') throw new Error(`${input.id} min is ${input.min}`);
  if (input.step !== '0.000001') throw new Error(`${input.id} step is ${input.step}`);
}

function dispatchChange(input, value) {
  input.value = value;
  let stopped = false;
  const event = {
    target: input,
    currentTarget: window,
    preventDefault() {},
    stopImmediatePropagation() { stopped = true; }
  };
  for (const entry of [...(windowListeners.get('change') || [])]) entry.handler(event);
  if (!stopped) input.dispatchTargetChange({ ...event, currentTarget: input });
  return stopped;
}

if (!dispatchChange(scaleX, '0.000001')) throw new Error('micro-scale change did not own capture path');
if (!near(selected.scale.x, 0.000001)) throw new Error(`1e-6 was not preserved: ${selected.scale.x}`);
if (scaleX.value !== '0.000001') throw new Error(`Inspector rounded micro scale: ${scaleX.value}`);

dispatchChange(scaleY, '0');
if (!near(selected.scale.y, 0.000001)) throw new Error(`zero was not clamped to 1e-6: ${selected.scale.y}`);
if (scaleY.value !== '0.000001') throw new Error(`clamped scale display lost precision: ${scaleY.value}`);

const previousZ = selected.scale.z;
dispatchChange(scaleZ, 'not-a-number');
if (selected.scale.z !== previousZ) throw new Error('invalid micro-scale input mutated object');

selected.scale.set(0.00001, 0.0001, 1);
let clickStopped = false;
const button = { id: 'we-quick-shrink' };
const clickEvent = {
  target: { closest: (selector) => selector === '#we-quick-shrink' ? button : null },
  preventDefault() {},
  stopImmediatePropagation() { clickStopped = true; }
};
for (const entry of [...(windowListeners.get('click') || [])]) entry.handler(clickEvent);
if (!clickStopped) throw new Error('quick shrink was not captured by micro-scale override');
if (!near(selected.scale.x, 0.000001)) throw new Error(`quick shrink x floor mismatch: ${selected.scale.x}`);
if (!near(selected.scale.y, 0.00001)) throw new Error(`quick shrink y mismatch: ${selected.scale.y}`);
if (!near(selected.scale.z, 0.1)) throw new Error(`quick shrink z mismatch: ${selected.scale.z}`);
if (scaleX.value !== '0.000001' || scaleY.value !== '0.000010' || scaleZ.value !== '0.100000') {
  throw new Error(`quick-shrink Inspector precision mismatch: ${scaleX.value}, ${scaleY.value}, ${scaleZ.value}`);
}
if (transformSyncs !== 1) throw new Error(`TransformControls selection sync mismatch: ${transformSyncs}`);

selected.scale.z = 0.000001;
api.writeInspector(selected);
for (const handler of [...(transformListeners.get('objectChange') || [])]) handler({});
if (scaleZ.value !== '0.000001') throw new Error(`TransformControls Inspector sync rounded 1e-6: ${scaleZ.value}`);

const { serializeEditorScene } = await import('../src/3d/editor/EditorSceneSerializer.js');
const serialized = serializeEditorScene([selected], [], { gridVisible: true, snapEnabled: true, snapSize: 1 });
const persistedScale = serialized.objects[0].transform.scale;
if (!near(persistedScale[0], 0.000001) || !near(persistedScale[2], 0.000001)) {
  throw new Error(`scene serializer lost micro scale: ${JSON.stringify(persistedScale)}`);
}
if (!JSON.stringify(serialized).includes('0.000001')) throw new Error('serialized JSON does not contain exact 1e-6 scale');

if (hierarchyRefreshes < 3) throw new Error(`expected hierarchy refresh after valid scale mutations: ${hierarchyRefreshes}`);
if (historyCaptures < 3) throw new Error(`expected history capture after valid scale mutations: ${historyCaptures}`);

micro.dispose();
legacy.dispose();
console.log('PASS Run259 editor micro-scale: Inspector + quick shrink + TransformControls display + scene JSON preserve 0.000001 exactly.');
