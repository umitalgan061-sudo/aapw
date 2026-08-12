const MIN_EDITOR_SCALE = 0.001;

const SCALE_AXIS_BY_INPUT_ID = Object.freeze({
  'we-scale-x': 'x',
  'we-scale-y': 'y',
  'we-scale-z': 'z'
});

function normalizedScale(value) {
  if (String(value).trim() === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(MIN_EDITOR_SCALE, numeric);
}

/**
 * Owns Inspector scale changes before the legacy bubble listener so precise values below 0.01
 * remain usable without permitting a singular zero scale. Existing position/rotation/name inputs
 * stay on the legacy World Editor path.
 *
 * @param {object} api World Editor bridge.
 * @returns {{dispose: Function, minimumScale: number}}
 */
export function installEditorScaleInputController(api) {
  if (!api) throw new Error('World Editor API bulunamadı.');
  if (window.__WESTEROS_EDITOR_SCALE_INPUT__) return window.__WESTEROS_EDITOR_SCALE_INPUT__;

  const removers = [];
  let disposed = false;

  function onScaleChange(event) {
    const axis = SCALE_AXIS_BY_INPUT_ID[event.currentTarget?.id];
    if (!axis) return;
    const object = api.getSelectedObject();
    if (!object || object.isInstancedMesh) return;

    event.stopImmediatePropagation();
    const next = normalizedScale(event.currentTarget.value);
    if (next === null) {
      api.writeInspector(object);
      return;
    }

    object.scale[axis] = next;
    api.writeInspector(object);
    api.refreshHierarchy();
  }

  Object.keys(SCALE_AXIS_BY_INPUT_ID).forEach((id) => {
    const input = document.getElementById(id);
    if (!input) throw new Error(`Scale Inspector input bulunamadı: ${id}`);
    input.min = String(MIN_EDITOR_SCALE);
    input.step = String(MIN_EDITOR_SCALE);
    input.setAttribute('inputmode', 'decimal');
    input.addEventListener('change', onScaleChange, true);
    removers.push(() => input.removeEventListener('change', onScaleChange, true));
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    removers.splice(0).reverse().forEach((remove) => remove());
    if (window.__WESTEROS_EDITOR_SCALE_INPUT__ === surface) delete window.__WESTEROS_EDITOR_SCALE_INPUT__;
  }

  const surface = Object.freeze({ dispose, minimumScale: MIN_EDITOR_SCALE });
  window.__WESTEROS_EDITOR_SCALE_INPUT__ = surface;
  window.addEventListener('pagehide', dispose, { once: true });
  removers.push(() => window.removeEventListener('pagehide', dispose));
  return surface;
}

export const EDITOR_SCALE_INPUT_POLICY = Object.freeze({ minimumScale: MIN_EDITOR_SCALE });

// RUN305_FBX_PACK_NODE_COMPATIBLE_V1 — independent static FBX pack selection and transforms.
let RUN305_THREE = null;
const RUN305_PACK_SCALE_FLOOR = 0.000001;

function run305IsFbxRoot(root) {
  return root?.userData?.editorFormat === 'fbx' && !root.isInstancedMesh;
}

function run305HasBoneAncestor(node, stop) {
  for (let cursor = node?.parent; cursor && cursor !== stop; cursor = cursor.parent) {
    if (cursor.isBone) return true;
  }
  return false;
}

function run305ContainsStaticMesh(node) {
  let found = false;
  node?.traverse?.((child) => {
    if (child.isMesh && !child.isSkinnedMesh && !run305HasBoneAncestor(child, node)) found = true;
  });
  return found;
}

function run305PackNodes(root) {
  if (!run305IsFbxRoot(root)) return [];
  let frontier = (root.children || []).filter((child) => !child.isBone && run305ContainsStaticMesh(child));
  let depth = 0;
  while (frontier.length === 1 && depth < 12) {
    const nested = frontier[0].children.filter((child) => !child.isBone && run305ContainsStaticMesh(child));
    if (nested.length < 2) break;
    frontier = nested;
    depth += 1;
  }
  if (frontier.length > 1 || frontier[0]?.isMesh) return frontier;
  if (frontier.length === 1) {
    const meshes = [];
    frontier[0].traverse((node) => {
      if (node.isMesh && !node.isSkinnedMesh && !run305HasBoneAncestor(node, root)) meshes.push(node);
    });
    if (meshes.length > 1) return meshes;
  }
  return frontier;
}

function run305PathForNode(root, node) {
  const parts = [];
  for (let cursor = node; cursor && cursor !== root; cursor = cursor.parent) {
    if (!cursor.parent) return null;
    const index = cursor.parent.children.indexOf(cursor);
    if (index < 0) return null;
    parts.push(index);
  }
  return parts.reverse().join('/');
}

function run305NodeFromPath(root, path) {
  if (!root || typeof path !== 'string' || path === '') return null;
  let node = root;
  for (const token of path.split('/')) {
    const index = Number(token);
    if (!Number.isInteger(index) || index < 0 || index >= node.children.length) return null;
    node = node.children[index];
  }
  return node;
}

function run305Round6(value) {
  return Number(Number(value).toFixed(6));
}

function run305TransformRecord(node) {
  return {
    name: node.name || '',
    transform: {
      position: node.position.toArray().map(run305Round6),
      rotation: [node.rotation.x, node.rotation.y, node.rotation.z].map(run305Round6),
      scale: node.scale.toArray().map(run305Round6)
    }
  };
}

export function installRun305FbxPackController(api, transformSurface, THREE = RUN305_THREE) {
  if (!THREE || !api?.scene || !api?.camera || !api?.canvas || !transformSurface?.transform) {
    throw new Error('FBX pack controller API eksik.');
  }
  if (window.__WESTEROS_EDITOR_FBX_PACKS__) return window.__WESTEROS_EDITOR_FBX_PACKS__;

  const transform = transformSurface.transform;
  const hierarchy = document.getElementById('we-hierarchy');
  const toast = document.getElementById('we-toast');
  const selectionStatus = document.getElementById('we-selection-status');
  if (!hierarchy || !selectionStatus) throw new Error('FBX pack editor arayüzü bulunamadı.');

  const removers = [];
  let activeRoot = null;
  let activeNode = null;
  let activePath = null;
  let helper = null;
  let pendingLoad = null;
  let toastTimer = 0;
  let disposed = false;

  const panel = document.createElement('section');
  panel.id = 'we-fbx-pack-panel';
  panel.hidden = true;
  panel.innerHTML = '<div class="we-fbx-pack-title"><strong>FBX Pack Parçaları</strong><button id="we-fbx-pack-root" type="button">Tüm FBX</button></div><div id="we-fbx-pack-list"></div>';
  hierarchy.insertAdjacentElement('afterend', panel);
  const list = panel.querySelector('#we-fbx-pack-list');
  const rootButton = panel.querySelector('#we-fbx-pack-root');

  const status = document.createElement('span');
  status.id = 'we-fbx-pack-status';
  status.textContent = 'FBX Pack: —';
  document.querySelector('.we-statusbar')?.append(status);

  const style = document.createElement('style');
  style.id = 'we-fbx-pack-style';
  style.textContent = '#we-fbx-pack-panel{margin-top:8px;padding:8px;border:1px solid rgba(205,170,90,.35);border-radius:6px;background:rgba(10,15,24,.55)}.we-fbx-pack-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.we-fbx-pack-title strong{font-size:11px;color:var(--we-gold-2)}#we-fbx-pack-list{display:grid;gap:4px;max-height:180px;overflow:auto}#we-fbx-pack-list button{text-align:left;font-size:11px}#we-fbx-pack-list button.is-selected,#we-fbx-pack-root.is-selected{border-color:var(--we-gold);color:var(--we-gold-2)}#we-fbx-pack-list .we-fbx-pack-empty{font-size:11px;color:var(--we-muted);line-height:1.35}';
  document.head.append(style);

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

  function listPacks(root = api.getSelectedObject?.()) {
    return run305PackNodes(root).map((node) => ({
      path: run305PathForNode(root, node),
      name: node.name || node.type || 'Adsız Pack',
      type: node.type
    }));
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

  function serializeOverrides(root) {
    const source = root?.userData?.editorFbxPackOverrides;
    if (!source || typeof source !== 'object') return [];
    return Object.keys(source).sort().map((path) => ({ path, ...source[path] }));
  }

  function captureOverride(root, node) {
    const path = run305PathForNode(root, node);
    if (!path) return;
    if (!root.userData.editorFbxPackOverrides || typeof root.userData.editorFbxPackOverrides !== 'object') {
      root.userData.editorFbxPackOverrides = {};
    }
    root.userData.editorFbxPackOverrides[path] = run305TransformRecord(node);
  }

  function renderPanel() {
    const root = api.getSelectedObject?.();
    panel.hidden = !run305IsFbxRoot(root);
    list.replaceChildren();
    if (!run305IsFbxRoot(root)) {
      status.textContent = 'FBX Pack: —';
      return;
    }
    const packs = listPacks(root);
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
    if (!packs.length) {
      const empty = document.createElement('div');
      empty.className = 'we-fbx-pack-empty';
      empty.textContent = 'Bağımsız statik pack bulunamadı; rig/bone parçaları güvenlik için ayrılmaz.';
      list.append(empty);
    }
    rootButton.classList.toggle('is-selected', !activeNode);
    status.textContent = activeNode && root === activeRoot
      ? `FBX Pack: ${activeNode.name || activePath}`
      : `FBX Pack: tüm model · ${packs.length} parça`;
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
    if (root !== api.getSelectedObject?.() || !run305IsFbxRoot(root)) return false;
    const node = run305NodeFromPath(root, path);
    if (!node || !run305PackNodes(root).includes(node)) return false;
    activeRoot = root;
    activeNode = node;
    activePath = path;
    transform.attach(node);
    api.writeInspector?.(node);
    updateHelper();
    renderPanel();
    return true;
  }

  function onInspectorChange(event) {
    if (!activeNode || activeRoot !== api.getSelectedObject?.()) return;
    const id = event.target?.id;
    if (!['we-name','we-pos-x','we-pos-y','we-pos-z','we-rot-x','we-rot-y','we-rot-z','we-scale-x','we-scale-y','we-scale-z'].includes(id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (id === 'we-name') {
      activeNode.name = event.target.value.trim() || activeNode.name;
    } else {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) return;
      const axis = id.endsWith('x') ? 'x' : id.endsWith('y') ? 'y' : 'z';
      if (id.startsWith('we-pos-')) {
        const state = api.getEditorState?.();
        const size = Math.max(RUN305_PACK_SCALE_FLOOR, Number(state?.snapSize) || 1);
        activeNode.position[axis] = state?.snapEnabled ? Math.round(value / size) * size : value;
      } else if (id.startsWith('we-rot-')) {
        activeNode.rotation[axis] = THREE.MathUtils.degToRad(value);
      } else {
        const sign = value < 0 ? -1 : 1;
        activeNode.scale[axis] = Math.abs(value) < RUN305_PACK_SCALE_FLOOR ? sign * RUN305_PACK_SCALE_FLOOR : value;
      }
    }

    captureOverride(activeRoot, activeNode);
    activeNode.updateMatrixWorld(true);
    updateHelper();
    api.writeInspector?.(activeNode);
    renderPanel();
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
    notify('FBX pack seçiliyken kök silme/kopyalama kapalı. Tüm FBX seçimine dön veya packı transform et.');
  }

  async function onSave(event) {
    if (!api.editableObjects.some((root) => serializeOverrides(root).length)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const { serializeEditorScene } = await import('./EditorSceneSerializer.js');
    const data = serializeEditorScene(api.editableObjects, api.instanceManager.serialize(), api.getEditorState());
    for (const root of api.editableObjects) {
      const packs = serializeOverrides(root);
      if (!packs.length) continue;
      const record = data.objects.find((candidate) => candidate.id === root.userData?.editorId);
      if (record) record.fbxPacks = packs;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'westeros-world.scene.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function applyScenePackOverrides(data) {
    let applied = 0;
    let missing = 0;
    for (const record of data?.objects || []) {
      if (!Array.isArray(record.fbxPacks)) continue;
      const root = api.editableObjects.find((object) => object.userData?.editorId === record.id);
      if (!root) {
        missing += record.fbxPacks.length;
        continue;
      }
      root.userData.editorFbxPackOverrides = {};
      for (const pack of record.fbxPacks) {
        const node = run305NodeFromPath(root, pack.path);
        const t = pack?.transform;
        if (!node || !Array.isArray(t?.position) || !Array.isArray(t?.rotation) || !Array.isArray(t?.scale)) {
          missing += 1;
          continue;
        }
        node.name = pack.name || node.name;
        node.position.fromArray(t.position);
        node.rotation.set(...t.rotation);
        node.scale.fromArray(t.scale);
        root.userData.editorFbxPackOverrides[pack.path] = run305TransformRecord(node);
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
    const text = toast?.textContent?.trim();
    if (text === 'Scene JSON yüklenemedi.') {
      pendingLoad = null;
      return;
    }
    if (text !== 'Scene JSON yüklendi.' || !pendingLoad) return;
    const promise = pendingLoad;
    pendingLoad = null;
    Promise.resolve(promise).then((data) => {
      if (data) applyScenePackOverrides(data);
      clearSelection(false);
    });
  }

  function onCanvasPointerDown(event) {
    if (event.button !== 0 || transform.axis || window.__WESTEROS_EDITOR_TERRAIN__?.getMode?.()) return;
    const root = api.getSelectedObject?.();
    if (!run305IsFbxRoot(root)) return;
    const candidates = run305PackNodes(root);
    if (!candidates.length) return;
    const rect = api.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, api.camera);
    let node = raycaster.intersectObject(root, true)[0]?.object || null;
    const candidateSet = new Set(candidates);
    while (node && node !== root && !candidateSet.has(node)) node = node.parent;
    if (node && candidateSet.has(node)) selectPack(root, run305PathForNode(root, node));
  }

  function syncRootSelection() {
    const root = api.getSelectedObject?.();
    if (activeRoot && root !== activeRoot) clearSelection(false);
    else if (activeNode && root === activeRoot) transform.attach(activeNode);
    renderPanel();
  }

  function onKeyDown(event) {
    if (!activeNode) return;
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable;
    if (typing) return;
    if (event.key === 'Delete' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd')) guardRootAction(event);
  }

  function getSnapshot() {
    const root = api.getSelectedObject?.();
    return Object.freeze({
      rootEditorId: root?.userData?.editorId || null,
      candidateCount: listPacks(root).length,
      activePackPath: activePath,
      activePackName: activeNode?.name || null,
      transformAttachedToPack: Boolean(activeNode && transform.object === activeNode),
      overrideCount: run305IsFbxRoot(root) ? serializeOverrides(root).length : 0
    });
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
  listen(document.getElementById('we-delete'), 'click', guardRootAction, true);
  listen(document.getElementById('we-duplicate'), 'click', guardRootAction, true);
  listen(document.getElementById('we-save'), 'click', onSave, true);
  listen(document.getElementById('we-load-file'), 'change', onLoadCapture, true);
  listen(window, 'keydown', onKeyDown, true);
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

async function bootRun305FbxPackController(attempt = 0) {
  if (typeof window === 'undefined') return;
  const api = window.__WESTEROS_WORLD_EDITOR__;
  const transformSurface = window.__WESTEROS_EDITOR_TRANSFORM__;
  if (api && transformSurface) {
    try {
      RUN305_THREE ||= await import('../vendor/three/three.module.js');
      installRun305FbxPackController(api, transformSurface, RUN305_THREE);
    } catch (error) {
      console.error('[Run305FbxPackController] boot failed', error);
    }
    return;
  }
  if (attempt < 180) requestAnimationFrame(() => bootRun305FbxPackController(attempt + 1));
}

if (typeof window !== 'undefined') queueMicrotask(() => bootRun305FbxPackController());

// RUN306_NODE_BOOT_GUARD_V1 — prevent browser-only queued boot from running inside Node DOM stubs.
if (typeof document === 'undefined' || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
  bootRun305FbxPackController = async () => {};
}
