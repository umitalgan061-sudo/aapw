import { createScene } from '../sceneManager.js';

function findEditorGround(scene) {
  return scene.children.find((child) => child?.name === 'Editor Ground') || null;
}

function setEditorLightsVisible(children, visible) {
  for (const child of children) {
    if (child?.isLight) child.visible = visible;
  }
}

export function installEditorLiveWorldBridge(api) {
  if (!api?.scene || !api?.camera || !api?.renderer || !api?.canvas) {
    throw new Error('World Editor live-world bridge için scene/camera/renderer/canvas gerekli.');
  }
  if (window.__WESTEROS_EDITOR_LIVE_WORLD__) return window.__WESTEROS_EDITOR_LIVE_WORLD__;

  const editorScene = api.scene;
  const editorChildrenBeforeWorld = [...editorScene.children];
  const editorGround = findEditorGround(editorScene);
  const previousBackground = editorScene.background;
  const previousFog = editorScene.fog;
  const previousCamera = {
    position: api.camera.position.clone(),
    fov: api.camera.fov,
    near: api.camera.near,
    far: api.camera.far
  };

  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = Math.max(1, api.canvas.clientWidth || 1);
  offscreenCanvas.height = Math.max(1, api.canvas.clientHeight || 1);
  const liveState = createScene(offscreenCanvas);
  const liveChildren = [...liveState.scene.children];

  // The editor keeps ownership of its renderer/camera/controls. Only the exact world objects
  // produced by the gameplay scene factory are transferred into the editor scene.
  for (const child of liveChildren) editorScene.add(child);

  if (editorGround) editorGround.visible = false;
  setEditorLightsVisible(editorChildrenBeforeWorld, false);
  editorScene.background = liveState.scene.background;
  // Edit mode intentionally stays fog-free even though the live gameplay scene owns dynamic fog.
  editorScene.fog = null;

  api.camera.fov = liveState.camera.fov;
  api.camera.near = liveState.camera.near;
  api.camera.far = liveState.camera.far;
  api.camera.position.copy(liveState.camera.position);
  api.camera.updateProjectionMatrix();
  api.orbitControls?.target?.set(0, 0, 0);
  api.orbitControls?.update?.();

  // createScene needs a renderer/controls to build the canonical world, but the editor already
  // owns both. Dispose only those temporary input/render owners after the world graph is moved.
  liveState.controls?.dispose?.();
  liveState.freeCamera?.dispose?.();
  liveState.renderer?.dispose?.();

  let disposed = false;
  function getSnapshot() {
    return Object.freeze({
      liveWorldVisible: liveChildren.some((child) => child.parent === editorScene && child.visible !== false),
      transferredObjectCount: liveChildren.filter((child) => child.parent === editorScene).length,
      syntheticGroundHidden: Boolean(editorGround && editorGround.visible === false),
      fogDisabled: editorScene.fog === null,
      terrainChunkCount: Number(liveState.chunkManager?.loadedCount || 0),
      roadSegmentCount: Number(liveState.roadEdges?.length || 0),
      settlementCount: Number(liveState.settlementSeats?.length || 0)
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pagehide', dispose);
    for (const child of liveChildren) {
      if (child.parent === editorScene) editorScene.remove(child);
    }
    if (editorGround) editorGround.visible = true;
    setEditorLightsVisible(editorChildrenBeforeWorld, true);
    editorScene.background = previousBackground;
    editorScene.fog = previousFog;
    api.camera.position.copy(previousCamera.position);
    api.camera.fov = previousCamera.fov;
    api.camera.near = previousCamera.near;
    api.camera.far = previousCamera.far;
    api.camera.updateProjectionMatrix();
    if (window.__WESTEROS_EDITOR_LIVE_WORLD__ === surface) delete window.__WESTEROS_EDITOR_LIVE_WORLD__;
  }

  const surface = Object.freeze({ liveState, getSnapshot, dispose });
  window.__WESTEROS_EDITOR_LIVE_WORLD__ = surface;
  window.addEventListener('pagehide', dispose, { once: true });
  return surface;
}

const api = window.__WESTEROS_WORLD_EDITOR__;
if (api) {
  try {
    installEditorLiveWorldBridge(api);
  } catch (error) {
    console.error('[EditorLiveWorldBridge] boot failed', error);
  }
}
