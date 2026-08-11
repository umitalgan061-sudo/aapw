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

// Run264 keeps the historical Run216 0.001 controller intact while giving ordinary editable
// objects six-decimal scale precision. Window-capture ownership runs before legacy input handlers.
const RUN264_MIN_EDITOR_SCALE = 0.000001;
const RUN264_SCALE_DECIMALS = 6;
const RUN264_QUICK_SHRINK_FACTOR = 0.1;

function run264ScaleText(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(RUN264_SCALE_DECIMALS) : '';
}

/**
 * Installs the additive micro-scale owner for Inspector and quick-shrink interactions.
 *
 * @param {object} api World Editor bridge.
 * @returns {{dispose: Function, minimumScale: number, decimals: number, syncBounds: Function, syncPrecision: Function}}
 */
export function installEditorMicroScaleOverrideRun264(api) {
  if (!api) throw new Error('World Editor API bulunamadı.');
  if (window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__) {
    const existing = window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__;
    existing.syncBounds?.();
    existing.syncPrecision?.();
    return existing;
  }

  const removers = [];
  let disposed = false;
  let transformObjectChange = null;
  let transformAttachTimer = 0;

  function syncBounds() {
    Object.keys(SCALE_AXIS_BY_INPUT_ID).forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.min = String(RUN264_MIN_EDITOR_SCALE);
      input.step = String(RUN264_MIN_EDITOR_SCALE);
      input.setAttribute('inputmode', 'decimal');
    });
  }

  function syncPrecision(object = api.getSelectedObject?.()) {
    if (!object || object.isInstancedMesh) return;
    Object.entries(SCALE_AXIS_BY_INPUT_ID).forEach(([id, axis]) => {
      const input = document.getElementById(id);
      if (input) input.value = run264ScaleText(object.scale?.[axis]);
    });
  }

  function finishScaleMutation(object) {
    api.writeInspector?.(object);
    syncBounds();
    syncPrecision(object);
    api.refreshHierarchy?.();
    window.__WESTEROS_EDITOR_HISTORY__?.scheduleCapture?.();
  }

  function onScaleInputCapture(event) {
    const id = event.target?.id || event.currentTarget?.id;
    const axis = SCALE_AXIS_BY_INPUT_ID[id];
    if (!axis) return;
    const object = api.getSelectedObject?.();
    if (!object || object.isInstancedMesh) return;

    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    const raw = String(event.target?.value ?? '').trim();
    const numeric = Number(raw);
    if (!raw || !Number.isFinite(numeric)) {
      if (event.type === 'change') {
        api.writeInspector?.(object);
        syncPrecision(object);
      }
      return;
    }

    object.scale[axis] = Math.max(RUN264_MIN_EDITOR_SCALE, numeric);
    finishScaleMutation(object);
  }

  function onQuickShrinkCapture(event) {
    const button = event.target?.closest?.('#we-quick-shrink');
    if (!button) return;
    const object = api.getSelectedObject?.();
    if (!object || object.isInstancedMesh) return;

    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    object.scale.set(
      Math.max(RUN264_MIN_EDITOR_SCALE, object.scale.x * RUN264_QUICK_SHRINK_FACTOR),
      Math.max(RUN264_MIN_EDITOR_SCALE, object.scale.y * RUN264_QUICK_SHRINK_FACTOR),
      Math.max(RUN264_MIN_EDITOR_SCALE, object.scale.z * RUN264_QUICK_SHRINK_FACTOR)
    );
    finishScaleMutation(object);
    window.__WESTEROS_EDITOR_TRANSFORM__?.syncSelection?.();
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
  window.addEventListener('change', onScaleInputCapture, true);
  removers.push(() => window.removeEventListener('change', onScaleInputCapture, true));
  window.addEventListener('click', onQuickShrinkCapture, true);
  removers.push(() => window.removeEventListener('click', onQuickShrinkCapture, true));

  syncBounds();
  syncPrecision();
  transformAttachTimer = window.setTimeout(() => {
    transformAttachTimer = 0;
    const transform = window.__WESTEROS_EDITOR_TRANSFORM__?.transform;
    if (!transform?.addEventListener) return;
    transformObjectChange = () => syncPrecision(transform.object || api.getSelectedObject?.());
    transform.addEventListener('objectChange', transformObjectChange);
  }, 0);

  function dispose() {
    if (disposed) return;
    disposed = true;
    selectionObserver?.disconnect();
    if (transformAttachTimer) window.clearTimeout(transformAttachTimer);
    const transform = window.__WESTEROS_EDITOR_TRANSFORM__?.transform;
    if (transformObjectChange && transform?.removeEventListener) {
      transform.removeEventListener('objectChange', transformObjectChange);
    }
    removers.splice(0).reverse().forEach((remove) => remove());
    if (window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__ === surface) {
      delete window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__;
    }
  }

  const surface = Object.freeze({
    dispose,
    minimumScale: RUN264_MIN_EDITOR_SCALE,
    decimals: RUN264_SCALE_DECIMALS,
    syncBounds,
    syncPrecision
  });
  window.__WESTEROS_EDITOR_MICRO_SCALE_RUN264__ = surface;
  window.addEventListener('pagehide', dispose, { once: true });
  removers.push(() => window.removeEventListener('pagehide', dispose));
  return surface;
}

export const EDITOR_MICRO_SCALE_POLICY_RUN264 = Object.freeze({
  minimumScale: RUN264_MIN_EDITOR_SCALE,
  decimals: RUN264_SCALE_DECIMALS,
  quickShrinkFactor: RUN264_QUICK_SHRINK_FACTOR
});

// A later legacy initializer can restore historical HTML min/step metadata. This small observer
// owns only those three attributes and restores the Run264 precision without touching object state.
function installRun264MicroScaleBoundsGuard() {
  if (window.__WESTEROS_EDITOR_MICRO_SCALE_BOUNDS_GUARD_RUN264__) {
    window.__WESTEROS_EDITOR_MICRO_SCALE_BOUNDS_GUARD_RUN264__.sync?.();
    return window.__WESTEROS_EDITOR_MICRO_SCALE_BOUNDS_GUARD_RUN264__;
  }
  if (typeof MutationObserver !== 'function') return null;

  const inputs = Object.keys(SCALE_AXIS_BY_INPUT_ID)
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (inputs.length !== Object.keys(SCALE_AXIS_BY_INPUT_ID).length) return null;

  let disposed = false;
  let queued = false;
  const expected = String(RUN264_MIN_EDITOR_SCALE);

  function sync() {
    queued = false;
    if (disposed) return;
    for (const input of inputs) {
      if (input.min !== expected) input.min = expected;
      if (input.step !== expected) input.step = expected;
      if (input.getAttribute?.('inputmode') !== 'decimal') input.setAttribute('inputmode', 'decimal');
    }
  }

  function scheduleSync() {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(sync);
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === 'attributes')) scheduleSync();
  });
  for (const input of inputs) {
    observer.observe(input, { attributes: true, attributeFilter: ['min', 'step', 'inputmode'] });
  }

  const timer = window.setTimeout(sync, 0);
  sync();

  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    window.clearTimeout(timer);
    window.removeEventListener('pagehide', dispose);
    if (window.__WESTEROS_EDITOR_MICRO_SCALE_BOUNDS_GUARD_RUN264__ === surface) {
      delete window.__WESTEROS_EDITOR_MICRO_SCALE_BOUNDS_GUARD_RUN264__;
    }
  }

  const surface = Object.freeze({ sync, dispose, minimumScale: RUN264_MIN_EDITOR_SCALE });
  window.__WESTEROS_EDITOR_MICRO_SCALE_BOUNDS_GUARD_RUN264__ = surface;
  window.addEventListener('pagehide', dispose, { once: true });
  return surface;
}

queueMicrotask(() => {
  const api = window.__WESTEROS_WORLD_EDITOR__;
  if (!api) return;
  try { installEditorMicroScaleOverrideRun264(api); }
  catch (error) { console.error('[EditorScaleInputController] Run264 micro-scale boot failed', error); }
});

queueMicrotask(() => {
  try { installRun264MicroScaleBoundsGuard(); }
  catch (error) { console.error('[EditorScaleInputController] Run264 bounds guard boot failed', error); }
});
