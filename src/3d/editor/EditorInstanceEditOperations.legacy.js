import { createEditorInstanceTransformProxy, snapshotEditorInstanceTransformProxy } from './EditorInstanceTransformProxy.js';
import { updateInstanceSelection } from './EditorInstanceSelectionModel.js';
import { applyUpdatedInstanceSelectionToMesh } from './EditorInstanceRenderAdapter.js';
import { applyBoundsSafeInstanceRender } from './EditorInstanceBoundsSafety.js';

export function createEditorInstanceEditOperations() {
  return Object.freeze({
    createProxy: createEditorInstanceTransformProxy,
    snapshotProxy: snapshotEditorInstanceTransformProxy,
    updateSelection: updateInstanceSelection,
    applyRender(THREE, updateResult) {
      return applyBoundsSafeInstanceRender(THREE, updateResult, applyUpdatedInstanceSelectionToMesh);
    }
  });
}
