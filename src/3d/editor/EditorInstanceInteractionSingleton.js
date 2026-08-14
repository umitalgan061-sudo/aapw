import { installEditorInstanceInteraction } from './EditorInstanceInteractionInstaller.js';

const activeByCanvas = new WeakMap();

function assertCanvas(canvas) {
  if (!canvas || (typeof canvas !== 'object' && typeof canvas !== 'function')) {
    throw new TypeError('canvas object is required');
  }
}

export function installEditorInstanceInteractionOnce(options = {}) {
  const canvas = options.canvas;
  assertCanvas(canvas);

  const current = activeByCanvas.get(canvas);
  if (current && current.disposed === false) return current.surface;

  const pipeline = installEditorInstanceInteraction(options);
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    pipeline.dispose();
    const active = activeByCanvas.get(canvas);
    if (active?.surface === surface) activeByCanvas.delete(canvas);
  }

  function getSnapshot() {
    return Object.freeze({
      disposed,
      pipeline: pipeline.getSnapshot()
    });
  }

  const surface = Object.freeze({
    begin: pipeline.begin,
    commit: pipeline.commit,
    end: pipeline.end,
    getSnapshot,
    dispose
  });

  activeByCanvas.set(canvas, { surface, disposed: false });

  const originalDispose = dispose;
  Object.defineProperty(activeByCanvas.get(canvas), 'disposed', {
    get: () => disposed
  });

  return surface;
}
