import { EditorAssetManager } from './EditorAssetManager.js';
import { EDITOR_ASSETS } from './editorAssetLibrary.js';
import { createEditorTerrainFoundationGrounder } from './EditorTerrainFoundationGrounder.js';

function selectedAssetFromDom() {
  const button = document.querySelector('#we-assets .we-asset.is-selected');
  const name = button?.querySelector('strong')?.textContent?.trim();
  return EDITOR_ASSETS.find((asset) => asset.name === name) || null;
}

function nextPlacementId(api, assetId) {
  const used = new Set(api.editableObjects.map((object) => object.userData?.editorId).filter(Boolean));
  let index = 1;
  let candidate = '';
  do {
    candidate = `${assetId}-placed-${String(index).padStart(4, '0')}`;
    index += 1;
  } while (used.has(candidate));
  return candidate;
}

function createUi() {
  const toolbar = document.querySelector('.we-toolbar-actions');
  const link = toolbar?.querySelector('.we-link');
  if (!toolbar || !link) throw new Error('World Editor placement toolbar hedefi bulunamadı.');

  const group = document.createElement('div');
  group.id = 'we-placement-tools';
  group.className = 'we-placement-tools';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Obje yerleştirme araçları');

  const placeButton = document.createElement('button');
  placeButton.id = 'we-place-mode';
  placeButton.type = 'button';
  placeButton.textContent = 'Yerleştir';
  placeButton.title = 'Seçili asseti gerçek dünyaya tıklayarak yerleştir';
  placeButton.setAttribute('aria-pressed', 'false');

  const groundButton = document.createElement('button');
  groundButton.id = 'we-ground-selected';
  groundButton.type = 'button';
  groundButton.textContent = 'Zemine Oturt';
  groundButton.title = 'Seçili objenin bütün tabanını gerçek terrain yüksekliğine oturt';

  group.append(placeButton, groundButton);
  toolbar.insertBefore(group, link);

  const style = document.createElement('style');
  style.id = 'we-placement-style';
  style.textContent = '.we-placement-tools{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}.we-placement-tools button[aria-pressed="true"]{border-color:var(--we-gold);color:var(--we-gold-2);box-shadow:inset 0 -2px 0 var(--we-gold)}.we-placement-tools button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:900px){.we-toolbar-actions .we-placement-tools button{display:inline-block}}';
  document.head.append(style);
  return { group, placeButton, groundButton, style };
}

function selectThroughHierarchy(api, object) {
  api.refreshHierarchy();
  const candidates = [...document.querySelectorAll('#we-hierarchy .we-hierarchy-item')]
    .filter((button) => button.textContent === object.name);
  candidates.at(-1)?.click();
}

export function installEditorPlacementController(api, authoring = window.__WESTEROS_EDITOR_LIVE_AUTHORING__) {
  if (!api?.scene || !api?.canvas || !api?.editableObjects || !api?.getSelectedObject) {
    throw new Error('World Editor placement API eksik.');
  }
  if (!authoring?.surfacePointFromClient || !authoring?.groundHeight) {
    throw new Error('World Editor placement için Live World authoring hazır olmalı.');
  }
  if (window.__WESTEROS_EDITOR_PLACEMENT__) return window.__WESTEROS_EDITOR_PLACEMENT__;

  const liveState = window.__WESTEROS_EDITOR_LIVE_WORLD__?.liveState;
  if (!liveState?.chunkManager || !liveState?.groundCollider) {
    throw new Error('World Editor terrain conform için canlı world state hazır olmalı.');
  }

  const ui = createUi();
  const assetManager = new EditorAssetManager();
  const terrainGrounder = createEditorTerrainFoundationGrounder({
    chunkManager: liveState.chunkManager,
    groundCollider: liveState.groundCollider,
  });
  const removers = [];
  let placementMode = false;
  let busy = false;
  let toastTimer = 0;
  let disposed = false;

  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
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
    ui.placeButton.setAttribute('aria-pressed', String(placementMode));
    ui.placeButton.textContent = placementMode ? 'Yerleştirmeyi Bitir' : 'Yerleştir';
    ui.placeButton.disabled = busy;
    ui.groundButton.disabled = busy || !api.getSelectedObject() || api.getSelectedObject()?.isInstancedMesh;
  }

  function setPlacementMode(enabled) {
    if (busy || disposed) return;
    placementMode = Boolean(enabled);
    if (placementMode) {
      const roads = window.__WESTEROS_EDITOR_ROADS__;
      if (roads?.isDrawing?.()) roads.finishDrawing();
      window.__WESTEROS_EDITOR_TERRAIN__?.setMode?.(null);
      toast('Yerleştir modu: soldan asset seç, gerçek dünya üzerinde tıkla.');
    }
    syncUi();
  }

  async function placeSelectedAtPoint(point) {
    const asset = selectedAssetFromDom();
    if (!asset) {
      toast('Önce soldan bir asset seç.');
      return null;
    }
    busy = true;
    syncUi();
    try {
      const object = await assetManager.createObject(asset);
      if (disposed) return null;
      object.userData.editorId = nextPlacementId(api, asset.id);
      const grounding = terrainGrounder.groundObject(object, asset, { x: point.x, z: point.z });
      if (!grounding.ok) throw new Error(grounding.error || 'terrain-grounding-failed');
      api.editableObjects.push(object);
      api.scene.add(object);
      selectThroughHierarchy(api, object);
      const suffix = grounding.mode === 'terrain-conform' ? ' · terrain tabana uyarlandı' : '';
      toast(`${asset.name} yerleştirildi${suffix}.`);
      return object;
    } catch (error) {
      console.error('[EditorPlacementController] placement failed', error);
      toast('Obje yerleştirilemedi.');
      return null;
    } finally {
      busy = false;
      syncUi();
    }
  }

  function groundSelected() {
    if (busy) return false;
    const object = api.getSelectedObject();
    if (!object || object.isInstancedMesh) {
      toast('Zemine oturtmak için normal bir obje seç.');
      return false;
    }
    const asset = EDITOR_ASSETS.find((candidate) => candidate.id === object.userData?.editorAssetId) || null;
    const grounding = terrainGrounder.groundObject(object, asset, { x: object.position.x, z: object.position.z });
    if (!grounding.ok) {
      console.error('[EditorPlacementController] grounding failed', grounding.error);
      toast('Seçili obje zemine oturtulamadı.');
      return false;
    }
    api.writeInspector?.(object);
    api.refreshHierarchy();
    toast(grounding.mode === 'terrain-conform'
      ? 'Seçili yapının bütün tabanı terrain ile birleştirildi.'
      : 'Seçili obje gerçek terrain üzerine oturtuldu.');
    return true;
  }

  function onCanvasPointerDown(event) {
    if (!placementMode || busy || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    const point = authoring.surfacePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void placeSelectedAtPoint(point);
  }

  function onOtherToolPointerDown(event) {
    if (!placementMode) return;
    if (event.target?.closest?.('#we-road-tools, #we-terrain-tools, #we-transform-tools')) setPlacementMode(false);
  }

  function onKeyDown(event) {
    if (!placementMode || event.key !== 'Escape') return;
    setPlacementMode(false);
    event.preventDefault();
  }

  function getSnapshot() {
    return Object.freeze({
      placementMode,
      busy,
      selectedAssetId: selectedAssetFromDom()?.id || null,
      selectedEditorId: api.getSelectedObject()?.userData?.editorId || null,
      dynamicFoundationCount: terrainGrounder.getDynamicPads().length,
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    placementMode = false;
    busy = false;
    removers.splice(0).reverse().forEach((remove) => remove());
    window.clearTimeout(toastTimer);
    ui.group.remove();
    ui.style.remove();
    if (window.__WESTEROS_EDITOR_PLACEMENT__ === surface) delete window.__WESTEROS_EDITOR_PLACEMENT__;
  }

  listen(ui.placeButton, 'click', () => setPlacementMode(!placementMode));
  listen(ui.groundButton, 'click', groundSelected);
  listen(api.canvas, 'pointerdown', onCanvasPointerDown, true);
  listen(document, 'pointerdown', onOtherToolPointerDown, true);
  listen(document.getElementById('we-selection-status'), 'DOMSubtreeModified', syncUi);
  listen(window, 'keydown', onKeyDown);
  listen(window, 'pagehide', dispose, { once: true });

  const surface = Object.freeze({
    setPlacementMode,
    isPlacementMode: () => placementMode,
    placeSelectedAtPoint,
    groundSelected,
    removeObjectFoundation: terrainGrounder.removeObjectFoundation,
    getSnapshot,
    dispose
  });
  window.__WESTEROS_EDITOR_PLACEMENT__ = surface;
  syncUi();
  return surface;
}

const api = window.__WESTEROS_WORLD_EDITOR__;
const authoring = window.__WESTEROS_EDITOR_LIVE_AUTHORING__;
if (api && authoring) {
  try {
    installEditorPlacementController(api, authoring);
  } catch (error) {
    console.error('[EditorPlacementController] boot failed', error);
  }
}
