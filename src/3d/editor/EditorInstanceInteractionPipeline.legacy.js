import { createEditorInstanceInteractionRuntime } from './EditorInstanceInteractionRuntime.js';
import { createEditorInstanceRaycastSource } from './EditorInstanceRaycastSource.js';

export function createEditorInstanceInteractionPipeline(options = {}) {
  const raycast = createEditorInstanceRaycastSource({
    canvas: options.canvas,
    camera: options.camera,
    raycaster: options.raycaster,
    getObjects: options.getObjects
  });

  const runtime = createEditorInstanceInteractionRuntime({
    canvas: options.canvas,
    transformSurface: options.transformSurface,
    getHits: raycast.getHits,
    isBlocked: options.isBlocked,
    beginEdit: options.beginEdit,
    commitEdit: options.commitEdit,
    endEdit: options.endEdit
  });

  function getSnapshot() {
    return Object.freeze({
      pointer: raycast.getPointerSnapshot(),
      runtime: runtime.getSnapshot()
    });
  }

  return Object.freeze({
    begin: runtime.begin,
    commit: runtime.commit,
    end: runtime.end,
    getSnapshot,
    dispose: runtime.dispose
  });
}
