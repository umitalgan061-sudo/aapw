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
  const attributes = new Map();
  const input = {
    id,
    value: '1.000',
    min: '',
    step: '',
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    addEventListener() {},
    removeEventListener() {}
  };
  inputs.set(id, input);
  return input;
}
const scaleX = makeInput('we-scale-x');
const scaleY = makeInput('we-scale-y');
const scaleZ = makeInput('we-scale-z');
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
  userData: { editorId: 'micro-final-0001', editorAssetId: 'marker-castle' },
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
  refreshHierarchy() { hierarchyRefreshes += 1; }
};

globalThis.window = {
  __WESTEROS_WORLD_EDITOR__: api,
  __WESTEROS_EDITOR_HISTORY__: { scheduleCapture() { historyCaptures += 1; } },
  __WESTEROS_EDITOR_TRANSFORM__: { transform, syncSelection() { transformSyncs += 1; } },
  addEventListener: addWindowListener,
  removeEventListener: removeWindowListener,
  setTimeout,
  clearTimeout
};

const module = await import('../src/3d/editor/EditorScaleInputController.js');
const legacy = module.installEditorScaleInputController(api);
await new Promise((resolve) => setTimeout(resolve, 15));
const micro = window.__WESTEROS_EDITOR_MICRO_SCALE__;

if (legacy.minimumScale !== 0.001) throw new Error('historical Run216 minimum changed');
if (!micro || micro.version !== 2) throw new Error('final micro-scale surface did not boot');
if (!near(micro.minimumScale, 0.000001)) throw new Error(`minimum mismatch: ${micro.minimumScale}`);
if (micro.decimals !== 6 || module.EDITOR_MICRO_SCALE_POLICY.decimals !== 6) throw new Error('six-decimal policy missing');
for (const input of [scaleX, scaleY, scaleZ]) {
  if (input.min !== '0.000001' || input.step !== '0.000001') throw new Error(`${input.id} bounds mismatch`);
  if (input.getAttribute('inputmode') !== 'decimal') throw new Error(`${input.id} decimal input mode missing`);
}

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

for (const [input, axis] of [[scaleX, 'x'], [scaleY, 'y'], [scaleZ, 'z']]) {
  const writesBefore = historyCaptures;
  if (!dispatch('input', input, '0.000001')) throw new Error(`${axis} input not captured`);
  if (!near(selected.scale[axis], 0.000001)) throw new Error(`${axis} live input lost 1e-6`);
  if (input.value !== '0.000001') throw new Error(`${axis} active field rewritten during typing`);
  if (historyCaptures !== writesBefore) throw new Error(`${axis} live input captured history before commit`);
  if (!dispatch('change', input, '0.000001')) throw new Error(`${axis} change not captured`);
  if (!near(selected.scale[axis], 0.000001)) throw new Error(`${axis} commit lost 1e-6`);
}
if (![scaleX.value, scaleY.value, scaleZ.value].every((value) => value === '0.000001')) {
  throw new Error(`six-decimal display mismatch: ${scaleX.value},${scaleY.value},${scaleZ.value}`);
}

dispatch('input', scaleY, '0');
dispatch('change', scaleY, '0');
if (!near(selected.scale.y, 0.000001) || scaleY.value !== '0.000001') throw new Error('zero did not clamp to 1e-6');

selected.scale.set(0.00001, 0.0001, 1);
let clickStopped = false;
const clickEvent = {
  target: { closest: (selector) => selector === '#we-quick-shrink' ? { id: 'we-quick-shrink' } : null },
  preventDefault() {},
  stopImmediatePropagation() { clickStopped = true; }
};
for (const entry of [...(windowListeners.get('click') || [])]) {
  entry.handler(clickEvent);
  if (clickStopped) break;
}
if (!clickStopped) throw new Error('quick shrink not captured');
if (!near(selected.scale.x, 0.000001) || !near(selected.scale.y, 0.00001) || !near(selected.scale.z, 0.1)) {
  throw new Error(`quick shrink mismatch: ${selected.scale.x},${selected.scale.y},${selected.scale.z}`);
}
if (scaleX.value !== '0.000001' || scaleY.value !== '0.000010' || scaleZ.value !== '0.100000') {
  throw new Error(`quick-shrink precision mismatch: ${scaleX.value},${scaleY.value},${scaleZ.value}`);
}
if (transformSyncs !== 1) throw new Error(`transform sync mismatch: ${transformSyncs}`);

selected.scale.set(0.000001, 0.000001, 0.000001);
for (const handler of [...(transformListeners.get('objectChange') || [])]) handler({});
if (![scaleX.value, scaleY.value, scaleZ.value].every((value) => value === '0.000001')) throw new Error('TransformControls display lost 1e-6');

const { serializeEditorScene } = await import('../src/3d/editor/EditorSceneSerializer.js');
const serialized = serializeEditorScene([selected], [], { gridVisible: true, snapEnabled: true, snapSize: 1 });
if (!serialized.objects[0].transform.scale.every((value) => near(value, 0.000001))) throw new Error(`serializer lost micro scale: ${JSON.stringify(serialized.objects[0].transform.scale)}`);
if (!JSON.stringify(serialized).includes('0.000001')) throw new Error('JSON does not preserve 0.000001');
if (historyCaptures < 5 || hierarchyRefreshes < 5) throw new Error(`commit side effects missing: history=${historyCaptures} hierarchy=${hierarchyRefreshes}`);

micro.dispose();
legacy.dispose();
console.log('PASS Run259 final micro-scale controller: 1e-6 input/change, zero clamp, quick shrink, TransformControls precision and scene JSON.');
