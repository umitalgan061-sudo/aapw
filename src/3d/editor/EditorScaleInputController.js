const MIN_EDITOR_SCALE = 0.001;

const SCALE_AXIS_BY_INPUT_ID = Object.freeze({
  'we-scale-x': 'x',
  'we-scale-y': 'y',
  'we-scale-z': 'z'
});

function normalizedScale(value) {
  if (String(value).trim() === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(MIN_EDITOR_SCALE, numeric);
}

/**
 * Owns Inspector scale changes before the legacy bubble listener so precise values below 0.01
 * remain usable without permitting a singular zero scale. Existing position/rotation/name inputs
 * stay on the legacy World Editor path.
 *
 * @param {object} api World Editor bridge.
 * @returns {{dispose: Function, minimumScale: number}}
 */
export function installEditorScaleInputController(api) {
  if (!api) throw new Error('World Editor API bulunamadı.');
  if (window.__WESTEROS_EDITOR_SCALE_INPUT__) return window.__WESTEROS_EDITOR_SCALE_INPUT__;

  const removers = [];
  let disposed = false;

  function onScaleChange(event) {
    const axis = SCALE_AXIS_BY_INPUT_ID[event.currentTarget?.id];
    if (!axis) return;
    const object = api.getSelectedObject();
    if (!object || object.isInstancedMesh) return;

    event.stopImmediatePropagation();
    const next = normalizedScale(event.currentTarget.value);
    if (next === null) {
      api.writeInspector(object);
      return;
    }

    object.scale[axis] = next;
    api.writeInspector(object);
    api.refreshHierarchy();
  }

  Object.keys(SCALE_AXIS_BY_INPUT_ID).forEach((id) => {
    const input = document.getElementById(id);
    if (!input) throw new Error(`Scale Inspector input bulunamadı: ${id}`);
    input.min = String(MIN_EDITOR_SCALE);
    input.step = String(MIN_EDITOR_SCALE);
    input.setAttribute('inputmode', 'decimal');
    input.addEventListener('change', onScaleChange, true);
    removers.push(() => input.removeEventListener('change', onScaleChange, true));
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    removers.splice(0).reverse().forEach((remove) => remove());
    if (window.__WESTEROS_EDITOR_SCALE_INPUT__ === surface) delete window.__WESTEROS_EDITOR_SCALE_INPUT__;
  }

  const surface = Object.freeze({ dispose, minimumScale: MIN_EDITOR_SCALE });
  window.__WESTEROS_EDITOR_SCALE_INPUT__ = surface;
  window.addEventListener('pagehide', dispose, { once: true });
  removers.push(() => window.removeEventListener('pagehide', dispose));
  return surface;
}

export const EDITOR_SCALE_INPUT_POLICY = Object.freeze({ minimumScale: MIN_EDITOR_SCALE });

// Run259 owner precision follow-up. Keep the historical Run216 contract above intact while the
// final capture-phase layer extends ordinary-object authoring down to a non-singular 1e-6 scale.
const MICRO_EDITOR_SCALE = 0.000001;
const MICRO_EDITOR_SCALE_DECIMALS = 6;
const MICRO_EDITOR_QUICK_SHRINK_FACTOR = 0.1;

function microScaleText(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(MICRO_EDITOR_SCALE_DECIMALS) : '';
}

function microScaleValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(MICRO_EDITOR_SCALE, numeric);
}

export function installEditorMicroScaleController(api) {
  if (!api) throw new Error('World Editor API bulunamadı.');
  if (window.__WESTEROS_EDITOR_MICRO_SCALE__) {
    window.__WESTEROS_EDITOR_MICRO_SCALE__.syncBounds?.();
    window.__WESTEROS_EDITOR_MICRO_SCALE__.syncPrecision?.();
    return window.__WESTEROS_EDITOR_MICRO_SCALE__;
  }

  const removers = [];
  let disposed = false;
  let transformObjectChange = null;
  let transformAttachTimer = 0;
  let boundSyncQueued = false;

  const scaleInputs = Object.entries(SCALE_AXIS_BY_INPUT_ID)
    .map(([id, axis]) => ({ id, axis, input: document.getElementById(id) }));
  if (scaleInputs.some(({ input }) => !input)) throw new Error('Scale Inspector inputları bulunamadı.');

  function selectedOrdinaryObject() {
    const object = api.getSelectedObject?.();
    return object && !object.isInstancedMesh ? object : null;
  }

  function syncBounds() {
    boundSyncQueued = false;
    for (const { input } of scaleInputs) {
      input.min = String(MICRO_EDITOR_SCALE);
      input.step = String(MICRO_EDITOR_SCALE);
      input.setAttribute('inputmode', 'decimal');
    }
  }

  function scheduleBoundSync() {
    if (disposed || boundSyncQueued) return;
    boundSyncQueued = true;
    queueMicrotask(syncBounds);
  }

  function syncPrecision(object = selectedOrdinaryObject()) {
    if (!object) return;
    for (const { axis, input } of scaleInputs) input.value = microScaleText(object.scale?.[axis]);
  }

  function commitInspector(object) {
    api.writeInspector?.(object);
    syncBounds();
    syncPrecision(object);
    api.refreshHierarchy?.();
    window.__WESTEROS_EDITOR_HISTORY__?.scheduleCapture?.();
  }

  function scaleAxis(event) {
    return SCALE_AXIS_BY_INPUT_ID[event.target?.id || event.currentTarget?.id] || null;
  }

  function onScaleInputCapture(event) {
    const axis = scaleAxis(event);
    if (!axis) return;
    const object = selectedOrdinaryObject();
    if (!object) return;
    event.stopImmediatePropagation?.();
    const next = microScaleValue(event.target?.value);
    if (next !== null) object.scale[axis] = next;
  }

  function onScaleChangeCapture(event) {
    const axis = scaleAxis(event);
    if (!axis) return;
    const object = selectedOrdinaryObject();
    if (!object) return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    const next = microScaleValue(event.target?.value);
    if (next === null) {
      api.writeInspector?.(object);
      syncBounds();
      syncPrecision(object);
      return;
    }
    object.scale[axis] = next;
    commitInspector(object);
  }

  function onQuickShrinkCapture(event) {
    if (!event.target?.closest?.('#we-quick-shrink')) return;
    const object = selectedOrdinaryObject();
    if (!object) return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    object.scale.set(
      Math.max(MICRO_EDITOR_SCALE, object.scale.x * MICRO_EDITOR_QUICK_SHRINK_FACTOR),
      Math.max(MICRO_EDITOR_SCALE, object.scale.y * MICRO_EDITOR_QUICK_SHRINK_FACTOR),
      Math.max(MICRO_EDITOR_SCALE, object.scale.z * MICRO_EDITOR_QUICK_SHRINK_FACTOR)
    );
    commitInspector(object);
    window.__WESTEROS_EDITOR_TRANSFORM__?.syncSelection?.();
  }

  const boundsObserver = typeof MutationObserver === 'function'
    ? new MutationObserver((mutations) => {
        if (mutations.some((mutation) => mutation.type === 'attributes')) scheduleBoundSync();
      })
    : null;
  if (boundsObserver) {
    for (const { input } of scaleInputs) {
      boundsObserver.observe(input, { attributes: true, attributeFilter: ['min', 'step', 'inputmode'] });
    }
  }

  const selectionStatus = document.getElementById('we-selection-status');
  const selectionObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(() => queueMicrotask(() => syncPrecision()))
    : null;
  if (selectionStatus && selectionObserver) {
    selectionObserver.observe(selectionStatus, { childList: true, characterData: true, subtree: true });
  }

  window.addEventListener('input', onScaleInputCapture, true);
  removers.push(() => window.removeEventListener('input', onScaleInputCapture, true));
  window.addEventListener('change', onScaleChangeCapture, true);
  removers.push(() => window.removeEventListener('change', onScaleChangeCapture, true));
  window.addEventListener('click', onQuickShrinkCapture, true);
  removers.push(() => window.removeEventListener('click', onQuickShrinkCapture, true));

  syncBounds();
  syncPrecision();
  transformAttachTimer = window.setTimeout(() => {
    transformAttachTimer = 0;
    const transform = window.__WESTEROS_EDITOR_TRANSFORM__?.transform;
    if (!transform?.addEventListener) return;
    transformObjectChange = () => syncPrecision(transform.object || selectedOrdinaryObject());
    transform.addEventListener('objectChange', transformObjectChange);
  }, 0);

  function dispose() {
    if (disposed) return;
    disposed = true;
    boundsObserver?.disconnect();
    selectionObserver?.disconnect();
    if (transformAttachTimer) window.clearTimeout(transformAttachTimer);
    const transform = window.__WESTEROS_EDITOR_TRANSFORM__?.transform;
    if (transformObjectChange && transform?.removeEventListener) transform.removeEventListener('objectChange', transformObjectChange);
    removers.splice(0).reverse().forEach((remove) => remove());
    if (window.__WESTEROS_EDITOR_MICRO_SCALE__ === surface) delete window.__WESTEROS_EDITOR_MICRO_SCALE__;
  }

  const surface = Object.freeze({
    version: 2,
    minimumScale: MICRO_EDITOR_SCALE,
    decimals: MICRO_EDITOR_SCALE_DECIMALS,
    quickShrinkFactor: MICRO_EDITOR_QUICK_SHRINK_FACTOR,
    syncBounds,
    syncPrecision,
    dispose
  });
  window.__WESTEROS_EDITOR_MICRO_SCALE__ = surface;
  window.addEventListener('pagehide', dispose, { once: true });
  removers.push(() => window.removeEventListener('pagehide', dispose));
  return surface;
}

export const EDITOR_MICRO_SCALE_POLICY = Object.freeze({
  minimumScale: MICRO_EDITOR_SCALE,
  decimals: MICRO_EDITOR_SCALE_DECIMALS,
  quickShrinkFactor: MICRO_EDITOR_QUICK_SHRINK_FACTOR
});

// Install after the dynamic-import continuation has installed the historical Run216 controller.
// Capture-phase ownership and the narrow bounds observer then keep the final 1e-6 contract stable.
window.setTimeout(() => {
  const api = window.__WESTEROS_WORLD_EDITOR__;
  if (!api) return;
  try { installEditorMicroScaleController(api); }
  catch (error) { console.error('[EditorScaleInputController] micro-scale boot failed', error); }
}, 0);
