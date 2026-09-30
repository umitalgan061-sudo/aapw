import { createEditorInstanceCoordinatorLifecycle } from './EditorInstanceCoordinatorLifecycle.js';
import { createEditorInstanceInteractionPipeline } from './EditorInstanceInteractionPipeline.js';

function assertInstanceManager(instanceManager) {
  if (!instanceManager || !Array.isArray(instanceManager.groups)) throw new TypeError('instanceManager with groups array is required');
}

export function installEditorInstanceInteraction(options = {}) {
  const instanceManager = options.instanceManager;
  assertInstanceManager(instanceManager);

  const lifecycle = createEditorInstanceCoordinatorLifecycle({
    THREE: options.THREE,
    scene: options.scene,
    getGroups: () => instanceManager.groups
  });

  return createEditorInstanceInteractionPipeline({
    canvas: options.canvas,
    camera: options.camera,
    raycaster: options.raycaster,
    getObjects: () => instanceManager.groups.map((record) => record?.object).filter(Boolean),
    transformSurface: options.transformSurface,
    isBlocked: options.isBlocked,
    beginEdit: lifecycle.beginEdit,
    commitEdit: lifecycle.commitEdit,
    endEdit: lifecycle.endEdit
  });
}
