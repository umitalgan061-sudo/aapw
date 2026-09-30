import * as THREE from 'three';
import { EditorAssetManager } from './EditorAssetManager.js';
import { findEditorAsset } from './editorAssetLibrary.js';
import { EDITOR_TERRAIN_CELL_POLICY, snapEditorTerrainCell } from './EditorTerrainCellModel.js';

const MODE_TO_ASSET = Object.freeze({
  'land-add': 'editor-land-cell',
  'land-remove': 'editor-land-cell',
  'water-add': 'editor-water-cell',
  'water-remove': 'editor-water-cell'
});

function nextTerrainCellId(api, kind) {
  const used = new Set(api.editableObjects.map((object) => object.userData?.editorId).filter(Boolean));
  let index = 1;
  let candidate = '';
  do {
    candidate = `terrain-${kind}-${String(index).padStart(4, '0')}`;
    index += 1;
  } while (used.has(candidate));
  return candidate;
}

function createUi() {
  const toolbar = document.querySelector('.we-toolbar-actions');
  const link = toolbar?.querySelector('.we-link');
  if (!toolbar || !link) throw new Error('World Editor terrain toolbar hedefi bulunamadı.');

  const group = document.createElement('div');
  group.id = 'we-terrain-tools';
  group.className = 'we-terrain-tools';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Kara ve deniz düzenleme araçları');

  const modes = [
    ['land-add', 'Kara +'],
    ['land-remove', 'Kara −'],
    ['water-add', 'Deniz +'],
    ['water-remove', 'Deniz −']
  ];
  const buttons = new Map();
  for (const [mode, label] of modes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.terrainMode = mode;
    button.textContent = label;
    button.setAttribute('aria-pressed', 'false');
    button.title = `${label} fırçası`;
    buttons.set(mode, button);
    group.append(button);
  }

  const sizeLabel = document.createElement('label');
  sizeLabel.className = 'we-terrain-size-label';
  sizeLabel.textContent = 'Hücre ';
  const sizeInput = document.createElement('input');
  sizeInput.id = 'we-terrain-cell-size';
  sizeInput.className = 'we-number we-terrain-size';
  sizeInput.type = 'number';
  sizeInput.min = '1';
  sizeInput.max = '100';
  sizeInput.step = '1';
  sizeInput.value = String(EDITOR_TERRAIN_CELL_POLICY.defaultCellSizeMeters);
  sizeInput.setAttribute('aria-label', 'Kara deniz hücre boyutu metre');
  sizeLabel.append(sizeInput, document.createTextNode(' m'));
  group.append(sizeLabel);
  toolbar.insertBefore(group, link);

  const style = document.createElement('style');
  style.id = 'we-terrain-style';
  style.textContent = '.we-terrain-tools{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}.we-terrain-tools button[aria-pressed="true"]{border-color:var(--we-gold);color:var(--we-gold-2);box-shadow:inset 0 -2px 0 var(--we-gold)}.we-terrain-size-label{display:inline-flex;align-items:center;gap:4px;color:var(--we-muted);font-size:11px}.we-terrain-size{width:58px}@media(max-width:900px){.we-toolbar-actions .we-terrain-tools button{display:inline-block}.we-terrain-size-label{display:inline-flex}}';
  document.head.append(style);

  return { group, buttons, sizeInput, style };
}

export function installEditorTerrainPaintController(api) {
  if (!api?.scene || !api?.camera || !api?.canvas) throw new Error('World Editor terrain API eksik.');
  if (window.__WESTEROS_EDITOR_TERRAIN__) return window.__WESTEROS_EDITOR_TERRAIN__;

  const landAsset = findEditorAsset('editor-land-cell');
  const waterAsset = findEditorAsset('editor-water-cell');
  if (!landAsset || !waterAsset) throw new Error('Editor land/water cell assets bulunamadı.');
  const ground = api.scene.getObjectByName('Editor Ground');
  if (!ground) throw new Error('Editor Ground bulunamadı.');

  const ui = createUi();
  const assetManager = new EditorAssetManager();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const removers = [];
  let mode = null;
  let busy = false;
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

  function cellSize() {
    const value = Number(ui.sizeInput.value);
    return Number.isFinite(value) && value > 0 ? value : EDITOR_TERRAIN_CELL_POLICY.defaultCellSizeMeters;
  }

  function syncUi() {
    for (const [buttonMode, button] of ui.buttons) {
      button.setAttribute('aria-pressed', String(mode === buttonMode));
      button.disabled = busy;
    }
    ui.sizeInput.disabled = busy;
  }

  function setMode(nextMode) {
    if (busy) return;
    const enabling = Boolean(nextMode && mode !== nextMode);
    if (enabling) {
      const roads = window.__WESTEROS_EDITOR_ROADS__;
      if (roads?.isBusy?.()) {
        toast('Önce yol segmentinin tamamlanmasını bekle.');
        return;
      }
      if (roads?.isDrawing?.()) roads.finishDrawing();
    }
    mode = mode === nextMode ? null : nextMode;
    syncUi();
    if (mode) toast(`${ui.buttons.get(mode)?.textContent || 'Arazi'} modu aktif.`);
  }

  function pointerRay(event) {
    const rect = api.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, api.camera);
    return raycaster;
  }

  function rootFromHitObject(object) {
    return object?.userData?.editorRoot || object || null;
  }

  function terrainObjects(assetId) {
    return api.editableObjects.filter((object) => object.userData?.editorAssetId === assetId);
  }

  function terrainObjectUnderPointer(assetId) {
    const candidates = terrainObjects(assetId);
    if (!candidates.length) return null;
    const hit = raycaster.intersectObjects(candidates, true)[0];
    if (!hit) return null;
    const root = rootFromHitObject(hit.object);
    return candidates.includes(root) ? root : null;
  }

  function removeObject(object) {
    if (!object) return false;
    const index = api.editableObjects.indexOf(object);
    if (index >= 0) api.editableObjects.splice(index, 1);
    api.scene.remove(object);
    api.refreshHierarchy();
    return true;
  }

  function existingCell(assetId, cell) {
    return terrainObjects(assetId).find((object) => (
      Math.abs(object.position.x - cell.x) < 0.001 &&
      Math.abs(object.position.z - cell.z) < 0.001 &&
      Math.abs(object.scale.x - cell.size) < 0.001 &&
      Math.abs(object.scale.z - cell.size) < 0.001
    )) || null;
  }

  async function addCell(kind, groundPoint) {
    const asset = kind === 'land' ? landAsset : waterAsset;
    const oppositeAsset = kind === 'land' ? waterAsset : landAsset;
    const cell = snapEditorTerrainCell(groundPoint, cellSize());
    const duplicate = existingCell(asset.id, cell);
    if (duplicate) return duplicate;
    const opposite = existingCell(oppositeAsset.id, cell);
    if (opposite) removeObject(opposite);

    const object = await assetManager.createObject(asset);
    if (disposed) return null;
    object.position.set(cell.x, cell.y, cell.z);
    object.scale.set(cell.size, 1, cell.size);
    object.userData.editorId = nextTerrainCellId(api, kind);
    object.userData.editorTerrainKind = kind;
    object.name = `${kind === 'land' ? 'Kara' : 'Deniz'} Hücresi ${object.userData.editorId.slice(-4)}`;
    api.editableObjects.push(object);
    api.scene.add(object);
    api.refreshHierarchy();
    return object;
  }

  async function onCanvasPointerDown(event) {
    if (!mode || busy || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    const activeRay = pointerRay(event);
    if (!activeRay) return;
    const groundHit = activeRay.intersectObject(ground, true)[0];
    if (!groundHit) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    busy = true;
    syncUi();
    try {
      const assetId = MODE_TO_ASSET[mode];
      if (mode.endsWith('-remove')) {
        const object = terrainObjectUnderPointer(assetId);
        if (removeObject(object)) toast(mode.startsWith('land') ? 'Kara hücresi silindi.' : 'Deniz hücresi silindi.');
        else toast('Bu noktada silinecek hücre yok.');
      } else {
        const kind = mode.startsWith('land') ? 'land' : 'water';
        const object = await addCell(kind, groundHit.point);
        if (object) toast(kind === 'land' ? 'Kara hücresi eklendi.' : 'Deniz hücresi eklendi.');
      }
    } catch (error) {
      console.error('[EditorTerrainPaintController] paint failed', error);
      toast('Kara/deniz düzenleme başarısız.');
    } finally {
      busy = false;
      syncUi();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    mode = null;
    busy = false;
    removers.splice(0).reverse().forEach((remove) => remove());
    window.clearTimeout(toastTimer);
    ui.group.remove();
    ui.style.remove();
    if (window.__WESTEROS_EDITOR_TERRAIN__ === surface) delete window.__WESTEROS_EDITOR_TERRAIN__;
  }

  for (const [buttonMode, button] of ui.buttons) listen(button, 'click', () => setMode(buttonMode));
  listen(api.canvas, 'pointerdown', onCanvasPointerDown, true);
  listen(window, 'pagehide', dispose, { once: true });

  const surface = Object.freeze({
    setMode,
    getMode: () => mode,
    getCellSize: cellSize,
    isBusy: () => busy,
    dispose
  });
  window.__WESTEROS_EDITOR_TERRAIN__ = surface;
  syncUi();
  return surface;
}

const api = window.__WESTEROS_WORLD_EDITOR__;
if (api) {
  try {
    installEditorTerrainPaintController(api);
  } catch (error) {
    console.error('[EditorTerrainPaintController] boot failed', error);
  }
}
