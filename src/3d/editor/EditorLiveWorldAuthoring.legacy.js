import * as THREE from 'three';
import { EditorAssetManager } from './EditorAssetManager.js';
import { EDITOR_ASSETS } from './editorAssetLibrary.js';

const DEMO_MARKERS = Object.freeze([
  Object.freeze({ assetId: 'marker-castle', x: 0, z: 0 }),
  Object.freeze({ assetId: 'marker-tree', x: 8, z: 6 })
]);
const DEMO_POSITION_EPSILON = 0.001;
const DESKTOP_EDITOR_STREAM_RADIUS_CHUNKS = 2;
const MIN_EDITOR_MAX_DISTANCE_METERS = 4000;

function selectedAssetFromDom() {
  const button = document.querySelector('#we-assets .we-asset.is-selected');
  const name = button?.querySelector('strong')?.textContent?.trim();
  return EDITOR_ASSETS.find((asset) => asset.name === name) || null;
}

function nextEditorObjectId(api, assetId) {
  const used = new Set(api.editableObjects.map((object) => object.userData?.editorId).filter(Boolean));
  let index = 1;
  let candidate = '';
  do {
    candidate = `${assetId}-live-${String(index).padStart(4, '0')}`;
    index += 1;
  } while (used.has(candidate));
  return candidate;
}

function hierarchySelect(api, object) {
  api.refreshHierarchy();
  const matches = [...document.querySelectorAll('#we-hierarchy .we-hierarchy-item')]
    .filter((button) => button.textContent === object.name);
  matches.at(-1)?.click();
}

function createToast() {
  let timer = 0;
  return Object.freeze({
    show(message) {
      const element = document.getElementById('we-toast');
      if (!element) return;
      element.textContent = message;
      element.classList.add('is-visible');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => element.classList.remove('is-visible'), 1800);
    },
    dispose() {
      window.clearTimeout(timer);
    }
  });
}

export function installEditorLiveWorldAuthoring(api, liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__) {
  if (!api?.scene || !api?.camera || !api?.canvas || !api?.orbitControls || !api?.grid) {
    throw new Error('Live World authoring için editor scene/camera/canvas/controls/grid gerekli.');
  }
  if (!liveSurface?.liveState?.chunkManager || !liveSurface.liveState.groundCollider) {
    throw new Error('Live World authoring için canlı world state hazır olmalı.');
  }
  if (window.__WESTEROS_EDITOR_LIVE_AUTHORING__) return window.__WESTEROS_EDITOR_LIVE_AUTHORING__;

  const liveState = liveSurface.liveState;
  const chunkManager = liveState.chunkManager;
  const groundCollider = liveState.groundCollider;
  const editorGround = api.scene.getObjectByName('Editor Ground');
  const assetManager = new EditorAssetManager();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tempMatrix = new THREE.Matrix4();
  const removers = [];
  const toast = createToast();
  const badge = document.querySelector('.we-viewport-badge');
  const previousBadgeText = badge?.textContent || '';
  const previousGroundRaycast = editorGround?.raycast || null;
  const previousChunkScene = chunkManager.scene;
  const previousMaxDistance = api.orbitControls.maxDistance;
  const previousCameraFar = api.camera.far;
  let disposed = false;
  let cleanupFrame = 0;
  let cleanupAttempts = 0;
  let lastStreamKey = '';

  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  }

  function groundHeight(x, z) {
    const value = Number(groundCollider.getGroundHeight(x, z));
    return Number.isFinite(value) ? value : 0;
  }

  function loadedTerrainMeshes() {
    return [...chunkManager.loaded.values()].filter((mesh) => mesh?.parent === api.scene);
  }

  function liveRaycastSurfaceObjects() {
    const objects = loadedTerrainMeshes();
    if (liveState.water?.parent === api.scene) objects.push(liveState.water);
    return objects;
  }

  function patchEditorGroundRaycast() {
    if (!editorGround) return;
    editorGround.raycast = function liveWorldGroundRaycast(activeRaycaster, intersections) {
      const objects = liveRaycastSurfaceObjects();
      if (!objects.length) {
        previousGroundRaycast?.call(this, activeRaycaster, intersections);
        return;
      }
      const hit = activeRaycaster.intersectObjects(objects, false)[0];
      if (hit) intersections.push(hit);
    };
  }

  function surfacePointFromClient(clientX, clientY) {
    const rect = api.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, api.camera);
    return raycaster.intersectObjects(liveRaycastSurfaceObjects(), false)[0]?.point?.clone() || null;
  }

  function targetGroundPoint() {
    const target = api.orbitControls.target;
    return new THREE.Vector3(target.x, groundHeight(target.x, target.z), target.z);
  }

  function streamAroundTarget() {
    const target = api.orbitControls.target;
    const size = Number(chunkManager.chunkSizeMeters) || 1;
    const cx = Math.round(target.x / size);
    const cz = Math.round(target.z / size);
    const key = `${cx},${cz}`;
    if (key === lastStreamKey) return;
    lastStreamKey = key;
    chunkManager.streamTowards(cx, cz, DESKTOP_EDITOR_STREAM_RADIUS_CHUNKS);
  }

  function syncWorkingArea() {
    if (disposed) return;
    streamAroundTarget();
    const target = api.orbitControls.target;
    const y = groundHeight(target.x, target.z);
    target.y = y;
    api.grid.position.set(target.x, y + 0.08, target.z);
  }

  function configureEditorCameraRange() {
    const seatRadius = Math.max(0, ...(liveState.settlementSeats || []).map((seat) => Math.hypot(seat.x, seat.z)));
    const desiredMaxDistance = Math.max(MIN_EDITOR_MAX_DISTANCE_METERS, seatRadius * 1.35);
    api.orbitControls.maxDistance = Math.max(previousMaxDistance, desiredMaxDistance);
    api.camera.far = Math.max(previousCameraFar, desiredMaxDistance * 2.5);
    api.camera.updateProjectionMatrix();
  }

  function isBootDemoMarker(object, descriptor) {
    return object?.userData?.editorAssetId === descriptor.assetId &&
      Math.abs(object.position.x - descriptor.x) <= DEMO_POSITION_EPSILON &&
      Math.abs(object.position.z - descriptor.z) <= DEMO_POSITION_EPSILON;
  }

  function cleanupBootDemoMarkers() {
    if (disposed) return;
    cleanupAttempts += 1;
    let removed = 0;
    for (const descriptor of DEMO_MARKERS) {
      const object = api.editableObjects.find((candidate) => isBootDemoMarker(candidate, descriptor));
      if (!object) continue;
      const index = api.editableObjects.indexOf(object);
      if (index >= 0) api.editableObjects.splice(index, 1);
      api.scene.remove(object);
      removed += 1;
    }
    if (removed) api.refreshHierarchy();
    const stillPending = DEMO_MARKERS.some((descriptor) => api.editableObjects.some((object) => isBootDemoMarker(object, descriptor)));
    if ((stillPending || cleanupAttempts < 8) && cleanupAttempts < 40) {
      cleanupFrame = window.requestAnimationFrame(cleanupBootDemoMarkers);
    }
  }

  function settleObjectOnTerrain(object, x, z) {
    object.position.set(0, 0, 0);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const localBaseY = Number.isFinite(box.min.y) ? box.min.y : 0;
    object.position.set(x, groundHeight(x, z) - localBaseY, z);
    object.updateMatrixWorld(true);
  }

  async function placeAssetAtTarget(asset) {
    if (!asset || disposed) return null;
    toast.show(`${asset.name} gerçek araziye yerleştiriliyor…`);
    try {
      const object = await assetManager.createObject(asset);
      if (disposed) return null;
      const target = targetGroundPoint();
      settleObjectOnTerrain(object, target.x, target.z);
      object.userData.editorId = nextEditorObjectId(api, asset.id);
      api.editableObjects.push(object);
      api.scene.add(object);
      hierarchySelect(api, object);
      toast.show(`${asset.name} gerçek araziye eklendi.`);
      return object;
    } catch (error) {
      console.error('[EditorLiveWorldAuthoring] live asset placement failed', asset.id, error);
      toast.show(`${asset.name} yerleştirilemedi.`);
      return null;
    }
  }

  function onAssetDoubleClick(event) {
    const button = event.target?.closest?.('#we-assets .we-asset');
    if (!button) return;
    const name = button.querySelector('strong')?.textContent?.trim();
    const asset = EDITOR_ASSETS.find((candidate) => candidate.name === name);
    if (!asset) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void placeAssetAtTarget(asset);
  }

  async function createTerrainFormation(asset, rows, columns, spacing) {
    const origin = targetGroundPoint();
    const record = await api.instanceManager.createFormation(asset, rows, columns, spacing, origin);
    const mesh = record.object;
    mesh.geometry.computeBoundingBox();
    const geometryBaseY = Number.isFinite(mesh.geometry.boundingBox?.min?.y) ? mesh.geometry.boundingBox.min.y : 0;
    for (let index = 0; index < record.instances.length; index += 1) {
      const instance = record.instances[index];
      const x = Number(instance.position[0]);
      const z = Number(instance.position[2]);
      const y = groundHeight(x, z) - geometryBaseY;
      instance.position[1] = y;
      tempMatrix.makeTranslation(x, y, z);
      mesh.setMatrixAt(index, tempMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere?.();
    hierarchySelect(api, mesh);
    return record;
  }

  function onFormationClick(event) {
    if (event.target?.id !== 'we-create-formation') return;
    const asset = selectedAssetFromDom();
    if (!asset) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rows = Math.max(1, Math.min(100, Number(document.getElementById('we-rows')?.value) || 1));
    const columns = Math.max(1, Math.min(100, Number(document.getElementById('we-columns')?.value) || 1));
    const spacing = Math.max(0.25, Number(document.getElementById('we-spacing')?.value) || 1.5);
    void createTerrainFormation(asset, rows, columns, spacing)
      .then((record) => toast.show(`${record.instances.length} instance gerçek araziye oturtuldu.`))
      .catch((error) => {
        console.error('[EditorLiveWorldAuthoring] terrain formation failed', error);
        toast.show(error.message || 'Formasyon oluşturulamadı.');
      });
  }

  function getSnapshot() {
    return Object.freeze({
      liveSurfaceMeshCount: loadedTerrainMeshes().length,
      syntheticGroundHidden: Boolean(editorGround && editorGround.visible === false),
      groundRaycastPatched: Boolean(editorGround && editorGround.raycast !== previousGroundRaycast),
      editorMaxDistance: api.orbitControls.maxDistance,
      cameraFar: api.camera.far,
      gridCenter: Object.freeze(api.grid.position.toArray()),
      streamKey: lastStreamKey
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (cleanupFrame) window.cancelAnimationFrame(cleanupFrame);
    removers.splice(0).reverse().forEach((remove) => remove());
    toast.dispose();
    if (editorGround && previousGroundRaycast) editorGround.raycast = previousGroundRaycast;
    chunkManager.scene = previousChunkScene;
    api.orbitControls.maxDistance = previousMaxDistance;
    api.camera.far = previousCameraFar;
    api.camera.updateProjectionMatrix();
    if (badge) badge.textContent = previousBadgeText;
    if (window.__WESTEROS_EDITOR_LIVE_AUTHORING__ === surface) delete window.__WESTEROS_EDITOR_LIVE_AUTHORING__;
  }

  chunkManager.scene = api.scene;
  configureEditorCameraRange();
  patchEditorGroundRaycast();
  if (badge) badge.textContent = 'EDIT MODE · LIVE WORLD';
  syncWorkingArea();
  cleanupFrame = window.requestAnimationFrame(cleanupBootDemoMarkers);

  listen(api.orbitControls, 'end', syncWorkingArea);
  listen(document.getElementById('we-assets'), 'dblclick', onAssetDoubleClick, true);
  listen(document.getElementById('we-create-formation'), 'click', onFormationClick, true);
  function onPageHide() {
    dispose();
    chunkManager.scene = api.scene;
    chunkManager.disposeAll?.();
    chunkManager.scene = previousChunkScene;
  }

  listen(window, 'pagehide', onPageHide, { once: true });

  const surface = Object.freeze({
    groundHeight,
    surfacePointFromClient,
    targetGroundPoint,
    streamAroundTarget,
    syncWorkingArea,
    placeAssetAtTarget,
    createTerrainFormation,
    getSnapshot,
    dispose
  });
  window.__WESTEROS_EDITOR_LIVE_AUTHORING__ = surface;
  return surface;
}

const api = window.__WESTEROS_WORLD_EDITOR__;
const liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__;
if (api && liveSurface) {
  try {
    installEditorLiveWorldAuthoring(api, liveSurface);
  } catch (error) {
    console.error('[EditorLiveWorldAuthoring] boot failed', error);
  }
}
