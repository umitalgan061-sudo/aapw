const inputs = new Map();
const windowListeners = new Map();
const transformListeners = new Map();
const observers = [];
let historyCaptures = 0;
let hierarchyRefreshes = 0;
let transformSyncs = 0;

function makeInput(id) {
  const attributes = new Map();
  const domListeners = [];
  const input = {
    id,
    value: '1.000',
    min: '',
    step: '',
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) {
      if (name === 'min' || name === 'step') return this[name];
      return attributes.get(name) ?? null;
    },
    addEventListener(type, handler, capture) { domListeners.push({ type, handler, capture }); },
    removeEventListener(type, handler, capture) {
      const index = domListeners.findIndex((entry) => entry.type === type && entry.handler === handler && entry.capture === capture);
      if (index >= 0) domListeners.splice(index, 1);
    },
    listenerCount(type) { return domListeners.filter((entry) => entry.type === type).length; }
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

function addListener(type, handler, capture) {
  const list = windowListeners.get(type) || [];
  list.push({ handler, capture });
  windowListeners.set(type, list);
}
function removeListener(type, handler, capture) {
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
  name: 'Run264 Probe',
  userData: { editorId: 'run264-probe', editorAssetId: 'marker-tree' },
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
  refreshHierarchy() { hierarchyRefreshes += 1; }
};

globalThis.window = {
  __WESTEROS_WORLD_EDITOR__: api,
  __WESTEROS_EDITOR_HISTORY__: { scheduleCapture() { historyCaptures += 1; } },
  __WESTEROS_EDITOR_TRANSFORM__: { transform, syncSelection() { transformSyncs += 1; } },
  addEventListener: addListener,
  removeEventListener: removeListener,
  setTimeout,
  clearTimeout
};

const module = await import('../src/3d/editor/EditorScaleInputController.js');
const legacy = module.installEditorScaleInputController(api);
const micro = window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__ || module.installEditorMicroScaleOverrideRun264(api);
await new Promise((resolve) => setTimeout(resolve, 10));
micro.syncBounds();
micro.syncPrecision(selected);

if (legacy.minimumScale !== 0.001) throw new Error('Run216 legacy minimum changed');
if ([scaleX, scaleY, scaleZ].some((input) => input.listenerCount('change') !== 1)) throw new Error('Legacy Run216 change listener contract was not installed');
if (micro.minimumScale !== 0.000001 || micro.decimals !== 6) throw new Error('Run264 policy mismatch');
if (module.EDITOR_MICRO_SCALE_POLICY_RUN264.quickShrinkFactor !== 0.1) throw new Error('Quick-shrink policy mismatch');
for (const input of [scaleX, scaleY, scaleZ]) {
  if (input.min !== '0.000001' || input.step !== '0.000001') throw new Error(`${input.id} micro bounds mismatch`);
  if (input.getAttribute('inputmode') !== 'decimal') throw new Error(`${input.id} decimal inputmode missing`);
}

function dispatch(type, input, value) {
  input.value = value;
  let stopped = false;
  const event = {
    type,
    target: input,
    preventDefault() {},
    stopImmediatePropagation() { stopped = true; }
  };
  for (const entry of [...(windowListeners.get(type) || [])]) entry.handler(event);
  return stopped;
}

if (!dispatch('input', scaleX, '0.000001')) throw new Error('Input capture did not own X scale');
if (selected.scale.x !== 0.000001 || scaleX.value !== '0.000001') throw new Error('1e-6 X scale lost precision');
if (!dispatch('change', scaleY, '0')) throw new Error('Change capture did not own Y scale');
if (selected.scale.y !== 0.000001 || scaleY.value !== '0.000001') throw new Error('Zero Y scale did not clamp to 1e-6');
const zBefore = selected.scale.z;
dispatch('input', scaleZ, '');
if (selected.scale.z !== zBefore) throw new Error('Empty input mutated Z');
dispatch('change', scaleZ, 'invalid');
if (selected.scale.z !== zBefore || scaleZ.value !== zBefore.toFixed(6)) throw new Error('Invalid Z input was destructive');

selected.scale.set(0.00001, 0.0001, 1);
let clickStopped = false;
const click = {
  target: { closest: (selector) => selector === '#we-quick-shrink' ? { id: 'we-quick-shrink' } : null },
  preventDefault() {},
  stopImmediatePropagation() { clickStopped = true; }
};
for (const entry of [...(windowListeners.get('click') || [])]) entry.handler(click);
if (!clickStopped) throw new Error('Quick shrink was not captured');
if (Math.abs(selected.scale.x - 0.000001) > 1e-12 || Math.abs(selected.scale.y - 0.00001) > 1e-12 || Math.abs(selected.scale.z - 0.1) > 1e-12) throw new Error('Quick shrink math mismatch');
if (scaleX.value !== '0.000001' || scaleY.value !== '0.000010' || scaleZ.value !== '0.100000') throw new Error('Quick shrink display rounded');
if (transformSyncs !== 1) throw new Error('Transform sync missing after quick shrink');

selected.scale.z = 0.000001;
api.writeInspector(selected);
for (const handler of [...(transformListeners.get('objectChange') || [])]) handler({});
if (scaleZ.value !== '0.000001') throw new Error('TransformControls display rounded micro scale');

const { serializeEditorScene } = await import('../src/3d/editor/EditorSceneSerializer.js');
const serialized = serializeEditorScene([selected], [], { gridVisible: true, snapEnabled: true, snapSize: 1 });
if (!JSON.stringify(serialized).includes('0.000001')) throw new Error('Scene JSON lost 0.000001 precision');
if (historyCaptures < 3 || hierarchyRefreshes < 3) throw new Error('History/hierarchy integration missing');

micro.dispose();
legacy.dispose();
if ([scaleX, scaleY, scaleZ].some((input) => input.listenerCount('change') !== 0)) throw new Error('Legacy Run216 input listener leaked');
if ((windowListeners.get('input') || []).length || (windowListeners.get('change') || []).length || (windowListeners.get('click') || []).length) throw new Error('Run264 window listener leak');
if ((transformListeners.get('objectChange') || []).length) throw new Error('Transform listener leak');
if (observers.some((observer) => observer.active)) throw new Error('MutationObserver leak');
if (window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__) throw new Error('Run264 global leaked');

console.log('PASS Run264 V6 micro-scale: legacy listener lifecycle + 0.000001 input, quick shrink, TransformControls, serializer, history and teardown verified.');
