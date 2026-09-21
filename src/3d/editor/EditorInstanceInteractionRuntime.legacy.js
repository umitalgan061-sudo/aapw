import { createEditorInstancePointerController } from './EditorInstancePointerController.js';
import { createEditorInstanceTransformBridge } from './EditorInstanceTransformBridge.js';

function assertFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} function is required`);
}

export function createEditorInstanceInteractionRuntime(options = {}) {
  const beginEdit = options.beginEdit;
  const commitEdit = options.commitEdit;
  const endEdit = options.endEdit;
  assertFunction(beginEdit, 'beginEdit');
  assertFunction(commitEdit, 'commitEdit');
  assertFunction(endEdit, 'endEdit');

  const bridge = createEditorInstanceTransformBridge({
    transformSurface: options.transformSurface,
    beginEdit,
    commitEdit,
    endEdit
  });

  let pointer = null;
  let disposed = false;

  try {
    pointer = createEditorInstancePointerController({
      canvas: options.canvas,
      getHits: options.getHits,
      isBlocked: options.isBlocked,
      begin: (hits) => bridge.begin(hits)
    });
  } catch (error) {
    bridge.dispose();
    throw error;
  }

  function getSnapshot() {
    return Object.freeze({
      disposed,
      pointerDisposed: pointer.isDisposed(),
      transform: bridge.getSnapshot()
    });
  }

  function dispose() {
    if (disposed) return null;
    pointer.dispose();
    const ended = bridge.dispose();
    disposed = true;
    return ended;
  }

  return Object.freeze({
    begin: bridge.begin,
    commit: bridge.commit,
    end: bridge.end,
    getSnapshot,
    dispose
  });
}
