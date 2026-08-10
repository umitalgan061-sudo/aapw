import * as THREE from 'three';
import { EditorAssetManager } from './EditorAssetManager.js';
import { findEditorAsset } from './editorAssetLibrary.js';

const ROAD_ASSET_ID = 'editor-road-segment';
const MIN_SEGMENT_LENGTH_METERS = 0.1;

function nextRoadSegmentId(api) {
  const used = new Set(api.editableObjects.map((object) => object.userData?.editorId).filter(Boolean));
  let index = 1;
  let candidate = '';
  do {
    candidate = `road-segment-${String(index).padStart(4, '0')}`;
    index += 1;
  } while (used.has(candidate));
  return candidate;
}

function snappedGroundPoint(point, editorState) {
  if (!editorState.snapEnabled) return point.clone();
  const snap = Math.max(0.1, Number(editorState.snapSize) || 1);
  return new THREE.Vector3(
    Math.round(point.x / snap) * snap,
    point.y,
    Math.round(point.z / snap) * snap
  );
}

function createUi() {
  const toolbar = document.querySelector('.we-toolbar-actions');
  const link = toolbar?.querySelector('.we-link');
  if (!toolbar || !link) throw new Error('World Editor road toolbar hedefi bulunamadı.');

  const group = document.createElement('div');
  group.id = 'we-road-tools';
  group.className = 'we-road-tools';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Yol çizim araçları');

  const drawButton = document.createElement('button');
  drawButton.id = 'we-road-draw';
  drawButton.type = 'button';
  drawButton.textContent = 'Yol Çiz';
  drawButton.setAttribute('aria-pressed', 'false');
  drawButton.title = 'Yol çizimini başlat / bitir';

  const undoButton = document.createElement('button');
  undoButton.id = 'we-road-undo';
  undoButton.type = 'button';
  undoButton.textContent = 'Yol Geri';
  undoButton.disabled = true;
  undoButton.title = 'Bu çizim oturumundaki son yol segmentini geri al';

  group.append(drawButton, undoButton);
  toolbar.insertBefore(group, link);

  const style = document.createElement('style');
  style.id = 'we-road-style';
  style.textContent = '.we-road-tools{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}.we-road-tools button[aria-pressed="true"]{border-color:var(--we-gold);color:var(--we-gold-2);box-shadow:inset 0 -2px 0 var(--we-gold)}.we-road-tools button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:900px){.we-toolbar-actions .we-road-tools button{display:inline-block}}';
  document.head.append(style);

  return { group, drawButton, undoButton, style };
}

export function installEditorRoadController(api) {
  if (!api?.scene || !api?.camera || !api?.canvas) throw new Error('World Editor road API eksik.');
  if (window.__WESTEROS_EDITOR_ROADS__) return window.__WESTEROS_EDITOR_ROADS__;

  const roadAsset = findEditorAsset(ROAD_ASSET_ID);
  if (!roadAsset) throw new Error('Editor road segment asset bulunamadı.');
  const ground = api.scene.getObjectByName('Editor Ground');
  if (!ground) throw new Error('Editor Ground bulunamadı.');

  const ui = createUi();
  const assetManager = new EditorAssetManager();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const localXAxis = new THREE.Vector3(1, 0, 0);
  const removers = [];
  const sessionSegments = [];
  let lastPoint = null;
  let drawing = false;
  let busy = false;
  let creationQueue = Promise.resolve();
  let toastTimer = 0;
  let disposed = false;

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  }

  function toast(message) {
    const element = document.getElementById('we-toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove('is-visible'), 1800);
  }

  function syncUi() {
    ui.drawButton.setAttribute('aria-pressed', String(drawing));
    ui.drawButton.textContent = drawing ? 'Yolu Bitir' : 'Yol Çiz';
    ui.drawButton.disabled = busy;
    ui.undoButton.disabled = busy || (!lastPoint && sessionSegments.length === 0);
  }

  function selectObjectThroughHierarchy(object) {
    api.refreshHierarchy();
    const button = [...document.querySelectorAll('#we-hierarchy .we-hierarchy-item')]
      .find((candidate) => candidate.textContent === object.name);
    button?.click();
  }

  async function createSegment(fromPoint, toPoint) {
    const direction = toPoint.clone().sub(fromPoint);
    const length = direction.length();
    if (length < MIN_SEGMENT_LENGTH_METERS || disposed) return null;

    const object = await assetManager.createObject(roadAsset);
    if (disposed) return null;
    object.position.copy(fromPoint).add(toPoint).multiplyScalar(0.5);
    object.quaternion.setFromUnitVectors(localXAxis, direction.normalize());
    object.scale.set(length, 1, 1);
    object.userData.editorId = nextRoadSegmentId(api);
    object.userData.editorRoadSegment = true;
    object.userData.editorRoadFrom = fromPoint.toArray();
    object.userData.editorRoadTo = toPoint.toArray();
    object.name = `Yol Segmenti ${object.userData.editorId.slice(-4)}`;
    api.editableObjects.push(object);
    api.scene.add(object);
    api.refreshHierarchy();
    return object;
  }

  function groundPointFromPointerEvent(event) {
    const rect = api.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, api.camera);
    const hit = raycaster.intersectObject(ground, true)[0];
    return hit ? snappedGroundPoint(hit.point, api.getEditorState()) : null;
  }

  function onCanvasPointerDown(event) {
    if (!drawing || busy || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    const point = groundPointFromPointerEvent(event);
    if (!point) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (!lastPoint) {
      lastPoint = point;
      syncUi();
      toast('Yol başlangıç noktası seçildi. Sonraki noktaya tıkla.');
      return;
    }

    const fromPoint = lastPoint.clone();
    const toPoint = point.clone();
    lastPoint = point;
    busy = true;
    syncUi();
    creationQueue = creationQueue
      .then(() => createSegment(fromPoint, toPoint))
      .then((segment) => {
        if (segment) sessionSegments.push(segment);
      })
      .catch((error) => {
        console.error('[EditorRoadController] segment creation failed', error);
        toast('Yol segmenti oluşturulamadı.');
      })
      .finally(() => {
        busy = false;
        syncUi();
      });
  }

  function finishDrawing() {
    if (!drawing || busy) return;
    drawing = false;
    lastPoint = null;
    const lastSegment = sessionSegments.at(-1) || null;
    sessionSegments.length = 0;
    syncUi();
    if (lastSegment) {
      selectObjectThroughHierarchy(lastSegment);
      toast('Yol çizimi tamamlandı.');
    } else {
      toast('Yol çizimi kapatıldı.');
    }
  }

  function startDrawing() {
    if (busy) return;
    drawing = true;
    lastPoint = null;
    sessionSegments.length = 0;
    syncUi();
    toast('Yol çizimi: zeminde başlangıç noktasına tıkla.');
  }

  function toggleDrawing() {
    if (busy) return;
    if (drawing) finishDrawing();
    else startDrawing();
  }

  function undoLastSegment() {
    if (!drawing || busy) return;
    const object = sessionSegments.pop();
    if (!object) {
      lastPoint = null;
      syncUi();
      toast('Yol başlangıç noktası temizlendi.');
      return;
    }
    const index = api.editableObjects.indexOf(object);
    if (index >= 0) api.editableObjects.splice(index, 1);
    api.scene.remove(object);
    lastPoint = new THREE.Vector3().fromArray(object.userData.editorRoadFrom || [0, 0, 0]);
    api.refreshHierarchy();
    syncUi();
    toast('Son yol segmenti geri alındı.');
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    drawing = false;
    busy = false;
    lastPoint = null;
    removers.splice(0).reverse().forEach((remove) => remove());
    window.clearTimeout(toastTimer);
    ui.group.remove();
    ui.style.remove();
    if (window.__WESTEROS_EDITOR_ROADS__ === surface) delete window.__WESTEROS_EDITOR_ROADS__;
  }

  listen(ui.drawButton, 'click', toggleDrawing);
  listen(ui.undoButton, 'click', undoLastSegment);
  listen(api.canvas, 'pointerdown', onCanvasPointerDown, true);
  listen(window, 'pagehide', dispose, { once: true });

  const surface = Object.freeze({
    startDrawing,
    finishDrawing,
    toggleDrawing,
    undoLastSegment,
    isDrawing: () => drawing,
    isBusy: () => busy,
    waitForPendingSegments: () => creationQueue,
    dispose
  });
  window.__WESTEROS_EDITOR_ROADS__ = surface;
  syncUi();
  return surface;
}

const api = window.__WESTEROS_WORLD_EDITOR__;
if (api) {
  try {
    installEditorRoadController(api);
  } catch (error) {
    console.error('[EditorRoadController] boot failed', error);
  }
}
