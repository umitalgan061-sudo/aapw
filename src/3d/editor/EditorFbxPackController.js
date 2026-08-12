import * as THREE from 'three';

const PACK_SCALE_FLOOR = 0.000001;
const PACK_DISCOVERY_MAX_UNWRAP_DEPTH = 12;

function isFbxRoot(root) {
  return root?.userData?.editorFormat === 'fbx' && !root.isInstancedMesh;
}

function hasBoneAncestor(node, stop) {
  for (let cursor = node?.parent; cursor && cursor !== stop; cursor = cursor.parent) {
    if (cursor.isBone) return true;
  }
  return false;
}

function containsStaticMesh(node) {
  let found = false;
  node?.traverse?.((child) => {
    if (child.isMesh && !child.isSkinnedMesh && !hasBoneAncestor(child, node)) found = true;
  });
  return found;
}

function renderableChildren(node) {
  return (node?.children || []).filter((child) => !child.isBone && containsStaticMesh(child));
}

function packNodes(root) {
  if (!isFbxRoot(root)) return [];
  let frontier = renderableChildren(root);
  let depth = 0;
  while (frontier.length === 1 && depth < PACK_DISCOVERY_MAX_UNWRAP_DEPTH) {
    const nested = renderableChildren(frontier[0]);
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
  return parts.reverse().join('/');
}

function nodeFromPath(root, path) {
  if (!root || typeof path !== 'string' || path === '') return null;
  let node = root;
  for (const token of path.split('/')) {
    const index = Number(token);
    if (!Number.isInteger(index) || index < 0 || index >= node.children.length) return null;
    node = node.children[index];
  }
  return node;
}

function round6(value) {
  return Number(Number(value).toFixed(6));
}

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

function createUi() {
  const hierarchy = document.getElementById('we-hierarchy');
  if (!hierarchy) throw new Error('FBX pack paneli için hierarchy bulunamadı.');
  const panel = document.createElement('section');
  panel.id = 'we-fbx-pack-panel';
  panel.hidden = true;
  panel.innerHTML = '<div class="we-fbx-pack-title"><strong>FBX Pack Parçaları</strong><button id="we-fbx-pack-root" type="button">Tüm FBX</button></div><div id="we-fbx-pack-list"></div>';
  hierarchy.insertAdjacentElement('afterend', panel);

  const status = document.createElement('span');
  status.id = 'we-fbx-pack-status';
  status.textContent = 'FBX Pack: —';
  document.querySelector('.we-statusbar')?.append(status);

  const style = document.createElement('style');
  style.id = 'we-fbx-pack-style';
  style.textContent = '#we-fbx-pack-panel{margin-top:8px;padding:8px;border:1px solid rgba(205,170,90,.35);border-radius:6px;background:rgba(10,15,24,.55)}.we-fbx-pack-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.we-fbx-pack-title strong{font-size:11px;color:var(--we-gold-2)}#we-fbx-pack-list{display:grid;gap:4px;max-height:180px;overflow:auto}#we-fbx-pack-list button{text-align:left;font-size:11px}#we-fbx-pack-list button.is-selected,#we-fbx-pack-root.is-selected{border-color:var(--we-gold);color:var(--we-gold-2)}#we-fbx-pack-list .we-fbx-pack-empty{font-size:11px;color:var(--we-muted);line-height:1.35}';
  document.head.append(style);

  return {
    hierarchy,
    panel,
    list: panel.querySelector('#we-fbx-pack-list'),
    rootButton: panel.querySelector('#we-fbx-pack-root'),
    status,
    style
  };
}

export function installEditorFbxPackController(api, transformSurface) {
  if (!api?.scene || !api?.camera || !api?.canvas || !api?.editableObjects || !transformSurface?.transform) {
    throw new Error('FBX pack controller için World Editor/TransformControls API eksik.');
  }
  if (window.__WESTEROS_EDITOR_FBX_PACKS__) return window.__WESTEROS_EDITOR_FBX_PACKS__;

  const transform = transformSurface.transform;
  const ui = createUi();
  const selectionStatus = document.getElementById('we-selection-status');
  const saveButton = document.getElementById('we-save');
  const loadInput = document.getElementById('we-load-file');
  const toastNode = document.getElementById('we-toast');
  const removers = [];
  let activeRoot = null;
  let activeNode = null;
  let activePath = null;
  let helper = null;
  let toastTimer = 0;
  let pendingLoad = null;
  let disposed = false;

  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  }

  function showToast(message) {
    if (!toastNode) return;
    toastNode.textContent = message;
    toastNode.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastNode.classList.remove('is-visible'), 1800);
  }

  function captureOverride(root, node) {
    const path = pathForNode(root, node);
    if (!path) return null;
    if (!root.userData.editorFbxPackOverrides || typeof root.userData.editorFbxPackOverrides !== 'object') {
      root.userData.editorFbxPackOverrides = {};
    }
    root.userData.editorFbxPackOverrides[path] = transformRecord(node);
    return path;
  }

  function serializeOverrides(root) {
    const overrides = root?.userData?.editorFbxPackOverrides;
    if (!overrides || typeof overrides !== 'object') return [];
    return Object.keys(overrides).sort().map((path) => ({ path, ...overrides[path] }));
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

  function listPacks(root = api.getSelectedObject?.()) {
    return packNodes(root).map((node) => ({
      path: pathForNode(root, node),
      name: node.name || node.type || 'Adsız Pack',
      type: node.type
    }));
  }

  function renderPanel() {
    const root = api.getSelectedObject?.();
    const eligible = isFbxRoot(root);
    ui.panel.hidden = !eligible;
    if (!eligible) {
      ui.list.replaceChildren();
      ui.status.textContent = 'FBX Pack: —';
      return;
    }

    const descriptors = listPacks(root);
    ui.list.replaceChildren();
    for (const descriptor of descriptors) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.packPath = descriptor.path;
      button.className = descriptor.path === activePath && root === activeRoot ? 'is-selected' : '';
      button.textContent = descriptor.name;
      button.title = `${descriptor.type} · ${descriptor.path}`;
      button.addEventListener('click', () => selectPack(root, descriptor.path));
      ui.list.append(button);
    }
    if (!descriptors.length) {
      const empty = document.createElement('div');
      empty.className = 'we-fbx-pack-empty';
      empty.textContent = 'Bağımsız statik pack bulunamadı; rig/bone parçaları güvenlik için tek tek taşınmaz.';
      ui.list.append(empty);
    }
    ui.rootButton.classList.toggle('is-selected', !activeNode);
    ui.status.textContent = activeNode && root === activeRoot
      ? `FBX Pack: ${activeNode.name || activePath}`
      : `FBX Pack: tüm model · ${descriptors.length} parça`;
  }

  function clearSelection(attachRoot = true) {
    disposeHelper();
    activeRoot = null;
    activeNode = null;
    activePath = null;
    const root = api.getSelectedObject?.();
    if (attachRoot && root && !root.isInstancedMesh) {
      transform.attach(root);
      api.writeInspector?.(root);
    }
    renderPanel();
  }

  function selectPack(root, path) {
    if (root !== api.getSelectedObject?.() || !isFbxRoot(root)) return false;
    const node = nodeFromPath(root, path);
    if (!node || !packNodes(root).includes(node)) return false;
    activeRoot = root;
    activeNode = node;
    activePath = path;
    transform.attach(node);
    api.writeInspector?.(node);
    updateHelper();
    renderPanel();
    return true;
  }

  function focusActive() {
    if (!activeNode) return;
    const box = new THREE.Box3().setFromObject(activeNode);
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(2, box.getSize(new THREE.Vector3()).length());
    api.orbitControls.target.copy(center);
    api.camera.position.copy(center).add(new THREE.Vector3(size * 0.8, size * 0.55, size * 0.8));
  }

  function snapLocal(value) {
    const state = api.getEditorState?.();
    if (!state?.snapEnabled) return value;
    const size = Math.max(PACK_SCALE_FLOOR, Number(state.snapSize) || 1);
    return Math.round(value / size) * size;
  }

  function onInspectorChange(event) {
    if (!activeNode || activeRoot !== api.getSelectedObject?.()) return;
    const id = event.target?.id;
    const supported = ['we-name','we-pos-x','we-pos-y','we-pos-z','we-rot-x','we-rot-y','we-rot-z','we-scale-x','we-scale-y','we-scale-z'];
    if (!supported.includes(id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (id === 'we-name') {
      activeNode.name = event.target.value.trim() || activeNode.name;
    } else {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) return;
      const axis = id.endsWith('x') ? 'x' : id.endsWith('y') ? 'y' : 'z';
      if (id.startsWith('we-pos-')) activeNode.position[axis] = snapLocal(value);
      else if (id.startsWith('we-rot-')) activeNode.rotation[axis] = THREE.MathUtils.degToRad(value);
      else {
        const safe = Math.abs(value) < PACK_SCALE_FLOOR ? (value < 0 ? -PACK_SCALE_FLOOR : PACK_SCALE_FLOOR) : value;
        activeNode.scale[axis] = safe;
      }
    }

    captureOverride(activeRoot, activeNode);
    activeNode.updateMatrixWorld(true);
    updateHelper();
    api.writeInspector?.(activeNode);
    renderPanel();
  }

  function onTransformObjectChange() {
    if (!activeNode || transform.object !== activeNode || activeRoot !== api.getSelectedObject?.()) return;
    captureOverride(activeRoot, activeNode);
    updateHelper();
    renderPanel();
  }

  function guardRootAction(event, action) {
    if (!activeNode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (action === 'focus') focusActive();
    else showToast('FBX pack seçiliyken kök silme/kopyalama kapalı. Tüm FBX seçimine dön veya packı taşı/döndür/ölçekle.');
  }

  function onKeyDown(event) {
    if (!activeNode) return;
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable;
    if (typing) return;
    const key = event.key.toLowerCase();
    if (event.key === 'Delete' || ((event.ctrlKey || event.metaKey) && key === 'd')) guardRootAction(event, 'guard');
    else if (key === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) guardRootAction(event, 'focus');
  }

  async function buildSceneData() {
    const { serializeEditorScene } = await import('./EditorSceneSerializer.js');
    const data = serializeEditorScene(api.editableObjects, api.instanceManager.serialize(), api.getEditorState());
    for (const root of api.editableObjects) {
      if (!isFbxRoot(root)) continue;
      const packs = serializeOverrides(root);
      if (!packs.length) continue;
      const record = data.objects.find((candidate) => candidate.id === root.userData.editorId);
      if (record) record.fbxPacks = packs;
    }
    return data;
  }

  async function onSave(event) {
    if (!api.editableObjects.some((root) => serializeOverrides(root).length > 0)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const data = await buildSceneData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'westeros-world.scene.json';
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('Scene JSON, FBX pack transformlarıyla hazırlandı.');
  }

  function applyScenePackOverrides(data) {
    let applied = 0;
    let missing = 0;
    for (const record of data?.objects || []) {
      if (!Array.isArray(record.fbxPacks) || !record.fbxPacks.length) continue;
      const root = api.editableObjects.find((object) => object.userData?.editorId === record.id);
      if (!root) {
        missing += record.fbxPacks.length;
        continue;
      }
      root.userData.editorFbxPackOverrides = {};
      for (const pack of record.fbxPacks) {
        const node = nodeFromPath(root, pack.path);
        const t = pack?.transform;
        if (!node || !Array.isArray(t?.position) || !Array.isArray(t?.rotation) || !Array.isArray(t?.scale)) {
          missing += 1;
          continue;
        }
        node.name = typeof pack.name === 'string' && pack.name ? pack.name : node.name;
        node.position.fromArray(t.position);
        node.rotation.set(...t.rotation);
        node.scale.fromArray(t.scale);
        root.userData.editorFbxPackOverrides[pack.path] = transformRecord(node);
        applied += 1;
      }
      root.updateMatrixWorld(true);
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
    const text = toastNode?.textContent?.trim();
    if (text === 'Scene JSON yüklenemedi.') {
      pendingLoad = null;
      return;
    }
    if (text !== 'Scene JSON yüklendi.' || !pendingLoad) return;
    const current = pendingLoad;
    pendingLoad = null;
    Promise.resolve(current).then((data) => {
      if (data) applyScenePackOverrides(data);
      clearSelection(false);
    });
  }

  function onCanvasPointerDown(event) {
    if (event.button !== 0 || transform.axis || window.__WESTEROS_EDITOR_TERRAIN__?.getMode?.()) return;
    const root = api.getSelectedObject?.();
    if (!isFbxRoot(root)) return;
    const candidates = packNodes(root);
    if (!candidates.length) return;
    const rect = api.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, api.camera);
    const hit = raycaster.intersectObject(root, true)[0]?.object;
    if (!hit) return;
    const candidateSet = new Set(candidates);
    let node = hit;
    while (node && node !== root && !candidateSet.has(node)) node = node.parent;
    if (node && candidateSet.has(node)) selectPack(root, pathForNode(root, node));
  }

  function syncRootSelection() {
    const root = api.getSelectedObject?.();
    if (activeRoot && root !== activeRoot) clearSelection(false);
    else if (activeNode && root === activeRoot) transform.attach(activeNode);
    renderPanel();
  }

  function getSnapshot() {
    const root = api.getSelectedObject?.();
    return Object.freeze({
      rootEditorId: root?.userData?.editorId || null,
      candidateCount: listPacks(root).length,
      activePackPath: activePath,
      activePackName: activeNode?.name || null,
      transformAttachedToPack: Boolean(activeNode && transform.object === activeNode),
      overrideCount: isFbxRoot(root) ? serializeOverrides(root).length : 0
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    selectionObserver.disconnect();
    toastObserver.disconnect();
    removers.splice(0).reverse().forEach((remove) => remove());
    transform.removeEventListener('objectChange', onTransformObjectChange);
    window.clearTimeout(toastTimer);
    disposeHelper();
    ui.panel.remove();
    ui.status.remove();
    ui.style.remove();
    if (window.__WESTEROS_EDITOR_FBX_PACKS__ === surface) delete window.__WESTEROS_EDITOR_FBX_PACKS__;
  }

  const selectionObserver = new MutationObserver(syncRootSelection);
  const toastObserver = new MutationObserver(onToastMutation);
  if (selectionStatus) selectionObserver.observe(selectionStatus, { childList: true, characterData: true, subtree: true });
  if (toastNode) toastObserver.observe(toastNode, { childList: true, characterData: true, subtree: true });
  transform.addEventListener('objectChange', onTransformObjectChange);
  listen(ui.hierarchy, 'click', () => queueMicrotask(() => clearSelection(true)), true);
  listen(api.canvas, 'pointerdown', onCanvasPointerDown);
  listen(ui.rootButton, 'click', () => clearSelection(true));
  for (const id of ['we-name','we-pos-x','we-pos-y','we-pos-z','we-rot-x','we-rot-y','we-rot-z','we-scale-x','we-scale-y','we-scale-z']) {
    listen(document.getElementById(id), 'change', onInspectorChange, true);
  }
  listen(document.getElementById('we-delete'), 'click', (event) => guardRootAction(event, 'guard'), true);
  listen(document.getElementById('we-duplicate'), 'click', (event) => guardRootAction(event, 'guard'), true);
  listen(document.getElementById('we-focus'), 'click', (event) => guardRootAction(event, 'focus'), true);
  listen(document.getElementById('we-quick-shrink'), 'click', (event) => {
    if (!activeNode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const scaled = activeNode.scale.toArray().map((value) => Math.sign(value || 1) * Math.max(PACK_SCALE_FLOOR, Math.abs(value) * 0.1));
    activeNode.scale.fromArray(scaled);
    captureOverride(activeRoot, activeNode);
    api.writeInspector?.(activeNode);
    updateHelper();
    renderPanel();
  }, true);
  listen(window, 'keydown', onKeyDown, true);
  listen(saveButton, 'click', onSave, true);
  listen(loadInput, 'change', onLoadCapture, true);
  listen(window, 'pagehide', dispose, { once: true });

  const surface = Object.freeze({
    listPacks,
    selectPack,
    clearSelection,
    serializeOverrides,
    applyScenePackOverrides,
    getSnapshot,
    dispose
  });
  window.__WESTEROS_EDITOR_FBX_PACKS__ = surface;
  syncRootSelection();
  return surface;
}

function bootEditorFbxPackController(attempt = 0) {
  const api = window.__WESTEROS_WORLD_EDITOR__;
  const transformSurface = window.__WESTEROS_EDITOR_TRANSFORM__;
  if (api && transformSurface) {
    try {
      installEditorFbxPackController(api, transformSurface);
    } catch (error) {
      console.error('[EditorFbxPackController] boot failed', error);
    }
    return;
  }
  if (attempt < 180) requestAnimationFrame(() => bootEditorFbxPackController(attempt + 1));
}

queueMicrotask(() => bootEditorFbxPackController());
