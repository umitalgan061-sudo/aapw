import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { installEditorScaleInputController } from './EditorScaleInputController.js';
const ROTATE_SNAP = THREE.MathUtils.degToRad(15);
const SCALE_SNAP = 0.1;
const MODE_LABEL = Object.freeze({ translate: 'Taşı', rotate: 'Döndür', scale: 'Ölçekle' });
const FBX_PACK_MIN_SCALE = 0.001;
const FBX_PACK_INSPECTOR_IDS = new Set(['we-name','we-pos-x','we-pos-y','we-pos-z','we-rot-x','we-rot-y','we-rot-z','we-scale-x','we-scale-y','we-scale-z']);
function typingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
}
function isFbxRoot(root) {
  return root?.userData?.editorFormat === 'fbx' && !root.isInstancedMesh;
}
function hasBoneAncestor(node, stop) {
  for (let cursor = node?.parent; cursor && cursor !== stop; cursor = cursor.parent) if (cursor.isBone) return true;
  return false;
}
function containsIndependentStaticMesh(node, root) {
  let found = false;
  node?.traverse?.((child) => {
    if (child.isMesh && !child.isSkinnedMesh && !hasBoneAncestor(child, root)) found = true;
  });
  return found;
}
export function discoverEditorFbxPacks(root) {
  if (!isFbxRoot(root)) return [];
  let frontier = (root.children || []).filter((child) => !child.isBone && containsIndependentStaticMesh(child, root));
  let depth = 0;
  while (frontier.length === 1 && depth < 12) {
    const nested = (frontier[0].children || []).filter((child) => !child.isBone && containsIndependentStaticMesh(child, root));
    if (nested.length < 2) break;
    frontier = nested;
    depth += 1;
  }
  if (frontier.length > 1 || frontier[0]?.isMesh) return frontier;
  if (frontier.length === 1) {
    const meshes = [];
    frontier[0].traverse((node) => {
      if (node.isMesh && !node.isSkinnedMesh && !hasBoneAncestor(node, root)) meshes.push(node);
    });
    if (meshes.length > 1) return meshes;
  }
  return frontier;
}
function pathForNode(root, node) {
  const parts = [];
  for (let cursor = node; cursor && cursor !== root; cursor = cursor.parent) {
    if (!cursor.parent) return null;
    const index = cursor.parent.children.indexOf(cursor);
    if (index < 0) return null;
    parts.push(index);
  }
  return parts.length ? parts.reverse().join('/') : null;
}
function nodeFromPath(root, path) {
  if (!root || typeof path !== 'string' || !path) return null;
  let node = root;
  for (const token of path.split('/')) {
    const index = Number(token);
    if (!Number.isInteger(index) || index < 0 || index >= node.children.length) return null;
    node = node.children[index];
  }
  return node;
}
function round6(value) { return Number(Number(value).toFixed(6)); }
function transformRecord(node) {
  return {
    name: node.name || '',
    transform: {
      position: node.position.toArray().map(round6),
      rotation: [node.rotation.x, node.rotation.y, node.rotation.z].map(round6),
      scale: node.scale.toArray().map(round6)
    }
  };
}
function validTuple(values) {
  return Array.isArray(values) && values.length === 3 && values.every((value) => Number.isFinite(Number(value)));
}
export function applyEditorFbxPackOverrides(root, records) {
  if (!isFbxRoot(root) || !Array.isArray(records)) return { applied: 0, missing: Array.isArray(records) ? records.length : 0 };
  const candidates = new Set(discoverEditorFbxPacks(root).map((node) => pathForNode(root, node)).filter(Boolean));
  const overrides = {};
  let applied = 0;
  let missing = 0;
  for (const record of records) {
    const path = typeof record?.path === 'string' ? record.path : '';
    const transform = record?.transform;
    const node = candidates.has(path) ? nodeFromPath(root, path) : null;
    if (!node || !validTuple(transform?.position) || !validTuple(transform?.rotation) || !validTuple(transform?.scale)) {
      missing += 1;
      continue;
    }
    node.name = String(record?.name || node.name || '');
    node.position.fromArray(transform.position.map(Number));
    node.rotation.set(...transform.rotation.map(Number));
    node.scale.set(...transform.scale.map((value) => Math.max(FBX_PACK_MIN_SCALE, Number(value))));
    overrides[path] = transformRecord(node);
    applied += 1;
  }
  root.userData.editorFbxPackOverrides = overrides;
  root.updateMatrixWorld(true);
  return { applied, missing };
}
function createUi() {
  const toolbar = document.querySelector('.we-toolbar-actions');
  const statusbar = document.querySelector('.we-statusbar');
  if (!toolbar || !statusbar) throw new Error('World Editor toolbar/statusbar bulunamadı.');
  const tools = document.createElement('div');
  tools.id = 'we-transform-tools';
  tools.className = 'we-transform-tools';
  tools.setAttribute('role', 'group');
  tools.setAttribute('aria-label', 'Transform araçları');
  tools.innerHTML = '<button id="we-tool-translate" type="button" aria-pressed="true" title="Taşı (W)">W Taşı</button><button id="we-tool-rotate" type="button" aria-pressed="false" title="Döndür (E)">E Döndür</button><button id="we-tool-scale" type="button" aria-pressed="false" title="Ölçekle (R)">R Ölçekle</button><button id="we-space-toggle" type="button" aria-pressed="false" title="World / Local uzayı">World</button>';
  toolbar.insertBefore(tools, toolbar.querySelector('.we-link'));
  const status = document.createElement('span');
  status.id = 'we-transform-status';
  status.textContent = 'Transform: Taşı · World';
  statusbar.insertBefore(status, document.getElementById('we-selection-status'));
  const style = document.createElement('style');
  style.id = 'we-transform-style';
  style.textContent = '.we-transform-tools{display:inline-flex;align-items:center;gap:4px}.we-transform-tools button[aria-pressed="true"]{border-color:var(--we-gold);color:var(--we-gold-2);box-shadow:inset 0 -2px 0 var(--we-gold)}#we-space-toggle{min-width:58px}@media(max-width:640px){.we-transform-tools{flex:0 0 auto}}';
  document.head.append(style);
  return { tools, status, style };
}
export function installEditorFbxPackController(api, transformSurface) {
  if (!api?.scene || !api?.camera || !api?.canvas || !transformSurface?.transform) throw new Error('FBX pack controller API eksik.');
  if (window.__WESTEROS_EDITOR_FBX_PACKS__) return window.__WESTEROS_EDITOR_FBX_PACKS__;
  const transform = transformSurface.transform;
  const hierarchy = document.getElementById('we-hierarchy');
  const selectionStatus = document.getElementById('we-selection-status');
  const toast = document.getElementById('we-toast');
  const loadInput = document.getElementById('we-load-file');
  const deleteButton = document.getElementById('we-delete');
  const duplicateButton = document.getElementById('we-duplicate');
  const quickShrinkButton = document.getElementById('we-quick-shrink');
  if (!hierarchy || !selectionStatus || !loadInput) throw new Error('FBX pack UI hedefleri bulunamadı.');
  const panel = document.createElement('section');
  panel.id = 'we-fbx-pack-panel';
  panel.hidden = true;
  panel.innerHTML = '<div class="we-fbx-pack-title"><strong>FBX PACK PARÇALARI</strong><button id="we-fbx-pack-root" type="button">Tüm FBX</button></div><div id="we-fbx-pack-list"></div>';
  hierarchy.insertAdjacentElement('afterend', panel);
  const list = panel.querySelector('#we-fbx-pack-list');
  const rootButton = panel.querySelector('#we-fbx-pack-root');
  const status = document.createElement('span');
  status.id = 'we-fbx-pack-status';
  status.textContent = 'FBX Pack: —';
  document.querySelector('.we-statusbar')?.append(status);
  const style = document.createElement('style');
  style.id = 'we-fbx-pack-style';
  style.textContent = '#we-fbx-pack-panel{margin-top:8px;padding:8px;border:1px solid rgba(205,170,90,.35);border-radius:6px;background:rgba(10,15,24,.55)}.we-fbx-pack-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.we-fbx-pack-title strong{font-size:11px;color:var(--we-gold-2)}#we-fbx-pack-list{display:grid;gap:4px;max-height:180px;overflow:auto}#we-fbx-pack-list button{text-align:left;font-size:11px}#we-fbx-pack-list button.is-selected,#we-fbx-pack-root.is-selected{border-color:var(--we-gold);color:var(--we-gold-2)}';
  document.head.append(style);
  const removers = [];
  let activeRoot = null;
  let activeNode = null;
  let activePath = null;
  let helper = null;
  let pendingLoad = null;
  let toastTimer = 0;
  let disposed = false;
  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  }
  function notify(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1800);
  }
  function disposeHelper() {
    if (!helper) return;
    api.scene.remove(helper);
    helper.geometry?.dispose?.();
    helper.material?.dispose?.();
    helper = null;
  }
  function updateHelper() {
    disposeHelper();
    if (!activeNode) return;
    helper = new THREE.BoxHelper(activeNode, 0xe0bd67);
    helper.name = 'World Editor FBX Pack Selection';
    helper.userData.editorLocked = true;
    api.scene.add(helper);
  }
  function packsForRoot(root = api.getSelectedObject?.()) {
    return discoverEditorFbxPacks(root).map((node) => ({ node, path: pathForNode(root, node), name: node.name || node.type || 'Adsız Pack', type: node.type })).filter((entry) => entry.path);
  }
  function serializeOverrides(root = api.getSelectedObject?.()) {
    const source = root?.userData?.editorFbxPackOverrides;
    if (!source || typeof source !== 'object') return [];
    return Object.keys(source).sort().map((path) => ({ path, ...source[path] }));
  }
  function captureOverride(root, node) {
    const path = pathForNode(root, node);
    if (!path) return;
    const source = root.userData.editorFbxPackOverrides;
    root.userData.editorFbxPackOverrides = { ...(source && typeof source === 'object' ? source : {}), [path]: transformRecord(node) };
  }
  function renderPanel() {
    const root = api.getSelectedObject?.();
    const isRoot = isFbxRoot(root);
    panel.hidden = !isRoot;
    list.replaceChildren();
    if (!isRoot) { status.textContent = 'FBX Pack: —'; return; }
    const packs = packsForRoot(root);
    for (const pack of packs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.packPath = pack.path;
      button.textContent = pack.name;
      button.title = `${pack.type} · ${pack.path}`;
      button.className = root === activeRoot && pack.path === activePath ? 'is-selected' : '';
      button.addEventListener('click', () => selectPack(root, pack.path));
      list.append(button);
    }
    if (!packs.length) list.textContent = 'Bağımsız statik pack bulunamadı; rig/bone parçaları kök FBX altında kalır.';
    rootButton.classList.toggle('is-selected', !activeNode || root !== activeRoot);
    status.textContent = activeNode && root === activeRoot ? `FBX Pack: ${activeNode.name || activePath}` : `FBX Pack: tüm model · ${packs.length} parça`;
  }
  function clearSelection(attachRoot = true) {
    disposeHelper();
    activeRoot = null;
    activeNode = null;
    activePath = null;
    const root = api.getSelectedObject?.();
    if (attachRoot && root && !root.isInstancedMesh) { transform.attach(root); api.writeInspector?.(root); }
    renderPanel();
  }
  function selectPack(root, path) {
    if (root !== api.getSelectedObject?.() || !isFbxRoot(root)) return false;
    const pack = packsForRoot(root).find((entry) => entry.path === path);
    if (!pack) return false;
    activeRoot = root;
    activeNode = pack.node;
    activePath = path;
    transform.attach(activeNode);
    api.writeInspector?.(activeNode);
    updateHelper();
    renderPanel();
    return true;
  }
  function scheduleHistory() { window.__WESTEROS_EDITOR_HISTORY__?.scheduleCapture?.(); }
  function onInspectorChange(event) {
    if (!activeNode || activeRoot !== api.getSelectedObject?.() || !FBX_PACK_INSPECTOR_IDS.has(event.target?.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const id = event.target.id;
    if (id === 'we-name') activeNode.name = event.target.value.trim() || activeNode.name;
    else {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) { api.writeInspector?.(activeNode); return; }
      const axis = id.endsWith('x') ? 'x' : id.endsWith('y') ? 'y' : 'z';
      if (id.startsWith('we-pos-')) {
        const state = api.getEditorState?.();
        const size = Math.max(0.1, Number(state?.snapSize) || 1);
        activeNode.position[axis] = state?.snapEnabled ? Math.round(value / size) * size : value;
      } else if (id.startsWith('we-rot-')) activeNode.rotation[axis] = THREE.MathUtils.degToRad(value);
      else activeNode.scale[axis] = Math.max(FBX_PACK_MIN_SCALE, value);
    }
    captureOverride(activeRoot, activeNode);
    activeNode.updateMatrixWorld(true);
    updateHelper();
    api.writeInspector?.(activeNode);
    renderPanel();
    scheduleHistory();
  }
  function onTransformChange() {
    if (!activeNode || transform.object !== activeNode || activeRoot !== api.getSelectedObject?.()) return;
    captureOverride(activeRoot, activeNode);
    updateHelper();
    renderPanel();
  }
  function guardRootAction(event) {
    if (!activeNode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    notify('FBX pack seçiliyken kök kopyalama/silme/küçültme kapalı. Önce “Tüm FBX” seçimine dön.');
  }
  function applySceneOverrides(data) {
    let applied = 0;
    let missing = 0;
    for (const record of data?.objects || []) {
      if (!Array.isArray(record?.fbxPacks)) continue;
      const root = api.editableObjects.find((object) => object.userData?.editorId === record.id);
      if (!root) { missing += record.fbxPacks.length; continue; }
      const result = applyEditorFbxPackOverrides(root, record.fbxPacks);
      applied += result.applied;
      missing += result.missing;
    }
    if (activeNode) updateHelper();
    renderPanel();
    return { applied, missing };
  }
  function onLoadCapture(event) {
    const file = event.target?.files?.[0];
    pendingLoad = file ? file.text().then((text) => JSON.parse(text)).catch(() => null) : null;
  }
  function onToastMutation() {
    if (toast?.textContent?.trim() !== 'Scene JSON yüklendi.' || !pendingLoad) return;
    const promise = pendingLoad;
    pendingLoad = null;
    Promise.resolve(promise).then((data) => { if (data) applySceneOverrides(data); clearSelection(false); });
  }
  function onCanvasPointerDown(event) {
    if (event.button !== 0 || event.defaultPrevented || transform.axis || transform.dragging || window.__WESTEROS_EDITOR_TERRAIN__?.getMode?.()) return;
    const root = api.getSelectedObject?.();
    if (!isFbxRoot(root)) return;
    const packs = packsForRoot(root);
    if (!packs.length) return;
    const rect = api.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, api.camera);
    let node = raycaster.intersectObject(root, true)[0]?.object || null;
    const packByNode = new Map(packs.map((pack) => [pack.node, pack]));
    while (node && node !== root && !packByNode.has(node)) node = node.parent;
    const pack = packByNode.get(node);
    if (pack) selectPack(root, pack.path);
  }
  function syncRootSelection() {
    const root = api.getSelectedObject?.();
    if (activeRoot && root !== activeRoot) clearSelection(false);
    else if (activeNode && root === activeRoot) transform.attach(activeNode);
    renderPanel();
  }
  function onKeyDown(event) {
    if (!activeNode || typingTarget(event.target)) return;
    const duplicate = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd';
    if (event.key === 'Delete' || duplicate) guardRootAction(event);
  }
  function getSnapshot() {
    const root = api.getSelectedObject?.();
    return Object.freeze({ rootEditorId: root?.userData?.editorId || null, candidateCount: packsForRoot(root).length, activePackPath: activePath, activePackName: activeNode?.name || null, transformAttachedToPack: Boolean(activeNode && transform.object === activeNode), overrideCount: isFbxRoot(root) ? serializeOverrides(root).length : 0 });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    selectionObserver.disconnect();
    toastObserver.disconnect();
    removers.splice(0).reverse().forEach((remove) => remove());
    transform.removeEventListener('objectChange', onTransformChange);
    clearTimeout(toastTimer);
    disposeHelper();
    panel.remove();
    status.remove();
    style.remove();
    if (window.__WESTEROS_EDITOR_FBX_PACKS__ === surface) delete window.__WESTEROS_EDITOR_FBX_PACKS__;
  }
  const selectionObserver = new MutationObserver(syncRootSelection);
  const toastObserver = new MutationObserver(onToastMutation);
  selectionObserver.observe(selectionStatus, { childList: true, characterData: true, subtree: true });
  if (toast) toastObserver.observe(toast, { childList: true, characterData: true, subtree: true });
  transform.addEventListener('objectChange', onTransformChange);
  listen(hierarchy, 'click', () => queueMicrotask(() => clearSelection(true)), true);
  listen(rootButton, 'click', () => clearSelection(true));
  listen(document, 'change', onInspectorChange, true);
  listen(api.canvas, 'pointerdown', onCanvasPointerDown);
  listen(deleteButton, 'click', guardRootAction, true);
  listen(duplicateButton, 'click', guardRootAction, true);
  listen(quickShrinkButton, 'click', guardRootAction, true);
  listen(loadInput, 'change', onLoadCapture, true);
  listen(window, 'keydown', onKeyDown, true);
  listen(window, 'pagehide', dispose, { once: true });
  const surface = Object.freeze({
    listPacks: () => packsForRoot().map(({ path, name, type }) => ({ path, name, type })),
    selectPack: (path) => selectPack(api.getSelectedObject?.(), path),
    clearSelection,
    serializeOverrides,
    applySceneOverrides,
    getActiveNode: () => activeNode,
    getSnapshot,
    dispose
  });
  window.__WESTEROS_EDITOR_FBX_PACKS__ = surface;
  syncRootSelection();
  return surface;
}
export function installEditorTransformControls(api) {
  if (!api) throw new Error('World Editor API bulunamadı.');
  installEditorScaleInputController(api);
  if (window.__WESTEROS_EDITOR_TRANSFORM__) return window.__WESTEROS_EDITOR_TRANSFORM__;
  const ui = createUi();
  const transform = new TransformControls(api.camera, api.canvas);
  transform.name = 'World Editor TransformControls';
  transform.setMode('translate');
  transform.setSpace('world');
  transform.setSize(0.9);
  api.scene.add(transform);
  // Run216 live-world safety: canonical world transfer can remove a formerly selected object.
  // Three.js treats an attached object with no parent as invalid, so detach it before matrix updates.
  const run216TransformUpdateMatrixWorld = transform.updateMatrixWorld.bind(transform);
  transform.updateMatrixWorld = function run216SafeTransformUpdateMatrixWorld() {
    if (transform.object && transform.object.parent === null) transform.detach();
    return run216TransformUpdateMatrixWorld();
  };
  const translateButton = document.getElementById('we-tool-translate');
  const rotateButton = document.getElementById('we-tool-rotate');
  const scaleButton = document.getElementById('we-tool-scale');
  const spaceButton = document.getElementById('we-space-toggle');
  const snapToggle = document.getElementById('we-snap-toggle');
  const snapSize = document.getElementById('we-snap-size');
  const selectionStatus = document.getElementById('we-selection-status');
  const removers = [];
  let packController = null;
  let disposed = false;
  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  }
  function updateUi() {
    const mode = transform.getMode();
    translateButton.setAttribute('aria-pressed', String(mode === 'translate'));
    rotateButton.setAttribute('aria-pressed', String(mode === 'rotate'));
    scaleButton.setAttribute('aria-pressed', String(mode === 'scale'));
    spaceButton.textContent = transform.space === 'local' ? 'Local' : 'World';
    spaceButton.setAttribute('aria-pressed', String(transform.space === 'local'));
    const attachment = transform.object ? '' : ' · Seçim bekleniyor';
    ui.status.textContent = `Transform: ${MODE_LABEL[mode]} · ${transform.space === 'local' ? 'Local' : 'World'}${attachment}`;
  }
  function syncSnap() {
    const state = api.getEditorState();
    const enabled = state.snapEnabled;
    transform.setTranslationSnap(enabled ? Math.max(0.1, state.snapSize) : null);
    transform.setRotationSnap(enabled ? ROTATE_SNAP : null);
    transform.setScaleSnap(enabled ? SCALE_SNAP : null);
    transform.setScaleSnap(null);
  }
  function syncSelection() {
    const packTarget = window.__WESTEROS_EDITOR_FBX_PACKS__?.getActiveNode?.();
    const object = packTarget || api.getSelectedObject();
    if (object && !object.isInstancedMesh) transform.attach(object);
    else transform.detach();
    updateUi();
  }
  function setMode(mode) { transform.setMode(mode); updateUi(); }
  function toggleSpace() { transform.setSpace(transform.space === 'world' ? 'local' : 'world'); updateUi(); }
  function onObjectChange() {
    if (!transform.object) return;
    api.writeInspector(transform.object);
    api.refreshHierarchy();
  }
  function onDraggingChanged(event) { api.orbitControls.enabled = !event.value; }
  function onKeyDown(event) {
    if (typingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'w') setMode('translate');
    else if (key === 'e') setMode('rotate');
    else if (key === 'r') setMode('scale');
    else return;
    event.preventDefault();
  }
  function getSnapshot() {
    const object = transform.object;
    return { isTransformControls: transform.isTransformControls === true, mode: transform.getMode(), space: transform.space, translationSnap: transform.translationSnap, rotationSnap: transform.rotationSnap, scaleSnap: transform.scaleSnap, attachedEditorId: object?.userData?.editorId || null, objectPosition: object ? object.position.toArray() : null, objectRotation: object ? [object.rotation.x, object.rotation.y, object.rotation.z] : null, objectScale: object ? object.scale.toArray() : null, orbitEnabled: api.orbitControls.enabled, dragging: transform.dragging, visible: transform.visible };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    packController?.dispose?.();
    packController = null;
    selectionObserver.disconnect();
    removers.splice(0).reverse().forEach((remove) => remove());
    transform.removeEventListener('objectChange', onObjectChange);
    transform.removeEventListener('dragging-changed', onDraggingChanged);
    api.orbitControls.enabled = true;
    transform.detach();
    api.scene.remove(transform);
    transform.dispose();
    ui.tools.remove();
    ui.status.remove();
    ui.style.remove();
    if (window.__WESTEROS_EDITOR_TRANSFORM__ === surface) delete window.__WESTEROS_EDITOR_TRANSFORM__;
  }
  const selectionObserver = new MutationObserver(syncSelection);
  selectionObserver.observe(selectionStatus, { childList: true, characterData: true, subtree: true });
  transform.addEventListener('objectChange', onObjectChange);
  transform.addEventListener('dragging-changed', onDraggingChanged);
  listen(window, 'keydown', onKeyDown);
  listen(translateButton, 'click', () => setMode('translate'));
  listen(rotateButton, 'click', () => setMode('rotate'));
  listen(scaleButton, 'click', () => setMode('scale'));
  listen(spaceButton, 'click', toggleSpace);
  listen(snapToggle, 'change', syncSnap);
  listen(snapSize, 'input', syncSnap);
  listen(snapSize, 'change', syncSnap);
  listen(window, 'pagehide', dispose, { once: true });
  const surface = Object.freeze({ transform, setMode, toggleSpace, syncSnap, syncSelection, getSnapshot, dispose });
  window.__WESTEROS_EDITOR_TRANSFORM__ = surface;
  syncSnap();
  syncSelection();
  packController = installEditorFbxPackController(api, surface);
  return surface;
}
const OWNER_QUICK_SHRINK_FACTOR = 0.1;
const OWNER_QUICK_SHRINK_MIN_SCALE = 0.001;
queueMicrotask(() => {
  const api = window.__WESTEROS_WORLD_EDITOR__;
  const toolbar = document.querySelector('.we-toolbar-actions');
  if (!api || !toolbar || document.getElementById('we-quick-shrink')) return;
  const button = document.createElement('button');
  button.id = 'we-quick-shrink';
  button.type = 'button';
  button.textContent = '×0.1 Küçült';
  button.title = 'Seçili objeyi her eksende 10 kat küçült';
  button.addEventListener('click', () => {
    const object = api.getSelectedObject?.();
    if (!object || object.isInstancedMesh) return;
    object.scale.set(Math.max(OWNER_QUICK_SHRINK_MIN_SCALE, object.scale.x * OWNER_QUICK_SHRINK_FACTOR), Math.max(OWNER_QUICK_SHRINK_MIN_SCALE, object.scale.y * OWNER_QUICK_SHRINK_FACTOR), Math.max(OWNER_QUICK_SHRINK_MIN_SCALE, object.scale.z * OWNER_QUICK_SHRINK_FACTOR));
    api.writeInspector?.(object);
    api.refreshHierarchy?.();
    window.__WESTEROS_EDITOR_TRANSFORM__?.syncSelection?.();
  });
  toolbar.insertBefore(button, toolbar.querySelector('.we-link'));
  window.addEventListener('pagehide', () => button.remove(), { once: true });
});
