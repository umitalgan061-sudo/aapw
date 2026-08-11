const inputs = new Map();
const windowListeners = new Map();
const transformListeners = new Map();
const observers = [];
let historyCaptures = 0;
let hierarchyRefreshes = 0;
let transformSyncs = 0;

function makeInput(id) {
  const listeners = [];
  const attributes = new Map();
  const input = {
    id,
    value: '1.000',
    min: '',
    step: '',
    setAttribute(name, value) {
      attributes.set(name, String(value));
      this[name] = String(value);
    },
    getAttribute(name) {
      if (name === 'min' || name === 'step') return this[name];
      return attributes.get(name) ?? null;
    },
    addEventListener(type, handler, capture) { listeners.push({ type, handler, capture }); },
    removeEventListener(type, handler, capture) {
      const index = listeners.findIndex((entry) => entry.type === type && entry.handler === handler && entry.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatchTarget(type, event) {
      for (const entry of [...listeners]) if (entry.type === type) entry.handler(event);
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
  constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
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

const scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
const selected = {
  isInstancedMesh: false,
  name: 'Run264 Micro Scale Probe',
  userData: { editorId: 'run264-micro-0001', editorAssetId: 'marker-castle' },
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale
};
const transform = { object: selected, addEventListener: addTransformListener, removeEventListener: removeTransformListener };
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
const micro = module.installEditorMicroScaleOverrideRun264(api);
await new Promise((resolve) => setTimeout(resolve, 10));
const boundsGuard = window.__WESTEROS_EDITOR_MICRO_SCALE_BOUNDS_GUARD_RUN264__;
boundsGuard?.sync?.();

if (legacy.minimumScale !== 0.001) throw new Error('Run216 legacy minimum changed');
if (micro.minimumScale !== 0.000001) throw new Error(`Run264 minimum mismatch: ${micro.minimumScale}`);
if (module.EDITOR_MICRO_SCALE_POLICY_RUN264.minimumScale !== 0.000001) throw new Error('Run264 policy minimum mismatch');
if (module.EDITOR_MICRO_SCALE_POLICY_RUN264.decimals !== 6) throw new Error('Run264 precision must be six decimals');
if (module.EDITOR_MICRO_SCALE_POLICY_RUN264.quickShrinkFactor !== 0.1) throw new Error('Run264 quick-shrink factor mismatch');
for (const input of [scaleX, scaleY, scaleZ]) {
  if (input.min !== '0.000001' || input.step !== '0.000001') throw new Error(`${input.id} bounds mismatch`);
  if (input.getAttribute('inputmode') !== 'decimal') throw new Error(`${input.id} inputmode is not decimal`);
}

function dispatchWindow(type, input, value) {
  input.value = value;
  let stopped = false;
  const event = {
    type,
    target: input,
    currentTarget: window,
    preventDefault() {},
    stopImmediatePropagation() { stopped = true; }
  };
  for (const entry of [...(windowListeners.get(type) || [])]) entry.handler(event);
  if (!stopped) input.dispatchTarget(type, { ...event, currentTarget: input });
  return stopped;
}

if (!dispatchWindow('input', scaleX, '0.000001')) throw new Error('Run264 input capture did not own scale event');
if (Math.abs(selected.scale.x - 0.000001) > 1e-12 || scaleX.value !== '0.000001') throw new Error('1e-6 input was not preserved');
if (!dispatchWindow('change', scaleY, '0')) throw new Error('Run264 change capture did not own scale event');
if (Math.abs(selected.scale.y - 0.000001) > 1e-12 || scaleY.value !== '0.000001') throw new Error('zero was not clamped to 1e-6');

const previousZ = selected.scale.z;
dispatchWindow('input', scaleZ, '');
if (selected.scale.z !== previousZ) throw new Error('empty in-progress input mutated object');
dispatchWindow('change', scaleZ, 'not-a-number');
if (selected.scale.z !== previousZ || scaleZ.value !== previousZ.toFixed(6)) throw new Error('invalid change was destructive');

selected.scale.set(0.00001, 0.0001, 1);
let clickStopped = false;
const clickEvent = {
  target: { closest: (selector) => selector === '#we-quick-shrink' ? { id: 'we-quick-shrink' } : null },
  preventDefault() {},
  stopImmediatePropagation() { clickStopped = true; }
};
for (const entry of [...(windowListeners.get('click') || [])]) entry.handler(clickEvent);
if (!clickStopped) throw new Error('Run264 quick shrink was not captured');
if (Math.abs(selected.scale.x - 0.000001) > 1e-12 || Math.abs(selected.scale.y - 0.00001) > 1e-12 || Math.abs(selected.scale.z - 0.1) > 1e-12) throw new Error('quick shrink math mismatch');
if (scaleX.value !== '0.000001' || scaleY.value !== '0.000010' || scaleZ.value !== '0.100000') throw new Error('quick shrink precision mismatch');
if (transformSyncs !== 1) throw new Error(`TransformControls sync mismatch: ${transformSyncs}`);

selected.scale.z = 0.000001;
api.writeInspector(selected);
for (const handler of [...(transformListeners.get('objectChange') || [])]) handler({});
if (scaleZ.value !== '0.000001') throw new Error('TransformControls display rounded 1e-6');

const { serializeEditorScene } = await import('../src/3d/editor/EditorSceneSerializer.js');
const serialized = serializeEditorScene([selected], [], { gridVisible: true, snapEnabled: true, snapSize: 1 });
const persistedScale = serialized.objects[0].transform.scale;
if (Math.abs(persistedScale[0] - 0.000001) > 1e-12 || Math.abs(persistedScale[2] - 0.000001) > 1e-12) throw new Error('scene serializer lost micro scale');
if (!JSON.stringify(serialized).includes('0.000001')) throw new Error('serialized JSON does not contain 0.000001');
if (hierarchyRefreshes < 3 || historyCaptures < 3) throw new Error('scale mutations did not integrate with hierarchy/history');

micro.dispose();
boundsGuard?.dispose?.();
legacy.dispose();
if ((windowListeners.get('input') || []).length || (windowListeners.get('change') || []).length || (windowListeners.get('click') || []).length) throw new Error('window listener leaked after dispose');
if ((transformListeners.get('objectChange') || []).length) throw new Error('TransformControls listener leaked after dispose');
if (observers.some((observer) => observer.active)) throw new Error('MutationObserver leaked after dispose');

console.log('PASS Run264 editor micro-scale: 0.000001 Inspector/input/quick-shrink/TransformControls/scene JSON precision + teardown verified.');
