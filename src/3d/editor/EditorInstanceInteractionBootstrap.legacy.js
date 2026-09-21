import { createEditorInstanceRaycastSource } from './EditorInstanceRaycastSource.js';
import { installEditorInstanceInteractionOnce } from './EditorInstanceInteractionSingleton.js';
import { createEditorInstancePointerOwnership } from './EditorInstancePointerOwnership.js';

function assertApi(api) {
  if (!api?.canvas || !api?.camera || !api?.scene || !api?.instanceManager) {
    throw new TypeError('World Editor api with canvas/camera/scene/instanceManager is required');
  }
}

function assertThree(THREE) {
  if (typeof THREE?.Raycaster !== 'function') throw new TypeError('THREE.Raycaster constructor is required');
}

function assertTransformSurface(surface) {
  if (!surface?.transform) throw new TypeError('transform surface is required');
}

export function installEditorInstanceInteractionBootstrap(options = {}) {
  const api = options.api;
  const THREE = options.THREE;
  const transformSurface = options.transformSurface;
  const globalTarget = options.globalTarget || globalThis;
  assertApi(api);
  assertThree(THREE);
  assertTransformSurface(transformSurface);

  const existing = globalTarget.__WESTEROS_EDITOR_INSTANCE_INTERACTION__;
  if (existing && existing.getSnapshot?.().disposed === false) return existing;

  const raycaster = options.raycaster || new THREE.Raycaster();
  const raycast = createEditorInstanceRaycastSource({
    canvas: api.canvas,
    camera: api.camera,
    raycaster,
    getObjects: () => api.instanceManager.groups.map((record) => record?.object).filter(Boolean)
  });

  let interaction = null;
  const ownership = createEditorInstancePointerOwnership({
    getHits: raycast.getHits,
    isActive: () => Boolean(interaction?.getSnapshot?.().pipeline?.runtime?.transform?.active)
  });

  interaction = installEditorInstanceInteractionOnce({
    THREE,
    scene: api.scene,
    canvas: api.canvas,
    camera: api.camera,
    raycaster,
    instanceManager: api.instanceManager,
    transformSurface,
    isBlocked: options.isBlocked || (() => Boolean(transformSurface.transform.dragging))
  });

  let disposed = false;
  function getSnapshot() {
    return Object.freeze({
      disposed,
      interaction: interaction.getSnapshot(),
      pointer: raycast.getPointerSnapshot()
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    interaction.dispose();
    if (globalTarget.__WESTEROS_EDITOR_INSTANCE_POINTER__ === ownershipSurface) delete globalTarget.__WESTEROS_EDITOR_INSTANCE_POINTER__;
    if (globalTarget.__WESTEROS_EDITOR_INSTANCE_INTERACTION__ === surface) delete globalTarget.__WESTEROS_EDITOR_INSTANCE_INTERACTION__;
  }

  const ownershipSurface = Object.freeze({ ownsPointer: ownership.ownsPointer });
  const surface = Object.freeze({
    begin: interaction.begin,
    commit: interaction.commit,
    end: interaction.end,
    ownsPointer: ownership.ownsPointer,
    getSnapshot,
    dispose
  });
  globalTarget.__WESTEROS_EDITOR_INSTANCE_POINTER__ = ownershipSurface;
  globalTarget.__WESTEROS_EDITOR_INSTANCE_INTERACTION__ = surface;
  return surface;
}
