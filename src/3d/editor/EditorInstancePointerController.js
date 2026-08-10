function assertCanvas(canvas) {
  if (!canvas || typeof canvas.addEventListener !== 'function' || typeof canvas.removeEventListener !== 'function') {
    throw new TypeError('canvas event target is required');
  }
}

function assertFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} function is required`);
}

export function createEditorInstancePointerController(options = {}) {
  const canvas = options.canvas;
  const getHits = options.getHits;
  const begin = options.begin;
  const isBlocked = options.isBlocked || (() => false);
  assertCanvas(canvas);
  assertFunction(getHits, 'getHits');
  assertFunction(begin, 'begin');
  assertFunction(isBlocked, 'isBlocked');

  let disposed = false;

  function onPointerDown(event) {
    if (disposed || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isBlocked(event)) return;
    const hits = getHits(event);
    if (!Array.isArray(hits) || hits.length === 0) return;
    begin(hits, event);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('pointerdown', onPointerDown);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  return Object.freeze({ dispose, isDisposed: () => disposed });
}
