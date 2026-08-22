import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EDITOR_ASSETS, findEditorAsset } from './editorAssetLibrary.js';
import { EditorAssetManager } from './EditorAssetManager.js';
import { EditorInstanceManager } from './EditorInstanceManager.js';
import { serializeEditorScene, validateEditorScene } from './EditorSceneSerializer.js';
import { rehydrateInstanceGroups } from './EditorFormationRehydrator.js';
import { autoTextureObject, autoTextureMany, restoreOriginalMaterials, describeResult } from './EditorAutoTexture.js';
import { isEditorStructureAsset } from './EditorTerrainFoundationGrounder.js';
import { disposePaletteCaches } from '../materials/textureFactory.js';

const $ = (id) => document.getElementById(id);
const canvas = $('we-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111927);
scene.fog = new THREE.Fog(0x111927, 180, 520);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
camera.position.set(48, 42, 58);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.maxDistance = 700;
controls.minDistance = 2;

scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x3d3427, 2.2));
const sun = new THREE.DirectionalLight(0xffe5b5, 3.2);
sun.position.set(80, 120, 40);
sun.castShadow = true;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x27382a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.name = 'Editor Ground';
ground.userData.editorLocked = true;
scene.add(ground);

const grid = new THREE.GridHelper(600, 600, 0x8d7846, 0x334053);
grid.position.y = 0.02;
scene.add(grid);

const assetManager = new EditorAssetManager();
const instanceManager = new EditorInstanceManager(scene, assetManager);
const editableObjects = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedObject = null;
let selectedAssetId = 'marker-soldier';
let activeCategory = 'Tümü';
let idCounter = 1;
let toastTimer = 0;

function toast(message) {
  const element = $('we-toast');
  element.textContent = message;
  element.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove('is-visible'), 1800);
}

function nextEditorId(assetId) {
  const id = `${assetId}-${String(idCounter).padStart(4, '0')}`;
  idCounter += 1;
  return id;
}

function editorState() {
  return {
    gridVisible: $('we-grid-toggle').checked,
    snapEnabled: $('we-snap-toggle').checked,
    snapSize: Number($('we-snap-size').value) || 1
  };
}

function snapValue(value) {
  const state = editorState();
  if (!state.snapEnabled) return value;
  return Math.round(value / state.snapSize) * state.snapSize;
}

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelWidth = Math.max(1, Math.floor(width * renderer.getPixelRatio()));
  const pixelHeight = Math.max(1, Math.floor(height * renderer.getPixelRatio()));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}

function refreshHierarchy() {
  const query = $('we-hierarchy-search').value.trim().toLocaleLowerCase('tr-TR');
  const container = $('we-hierarchy');
  container.replaceChildren();
  const items = [...editableObjects, ...instanceManager.groups.map((record) => record.object)];
  items.filter((object) => !query || object.name.toLocaleLowerCase('tr-TR').includes(query)).forEach((object) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `we-hierarchy-item${object === selectedObject ? ' is-selected' : ''}`;
    button.textContent = object.name || object.userData.editorId || 'Adsız obje';
    button.setAttribute('role', 'treeitem');
    button.addEventListener('click', () => selectObject(object));
    container.append(button);
  });
  $('we-render-status').textContent = `${items.length} obje/grup`;
}

function writeInspector(object) {
  const visible = Boolean(object && !object.isInstancedMesh);
  $('we-inspector').hidden = !visible;
  $('we-inspector-empty').hidden = visible;
  if (!visible) return;
  $('we-name').value = object.name;
  $('we-pos-x').value = object.position.x.toFixed(3);
  $('we-pos-y').value = object.position.y.toFixed(3);
  $('we-pos-z').value = object.position.z.toFixed(3);
  $('we-rot-x').value = THREE.MathUtils.radToDeg(object.rotation.x).toFixed(1);
  $('we-rot-y').value = THREE.MathUtils.radToDeg(object.rotation.y).toFixed(1);
  $('we-rot-z').value = THREE.MathUtils.radToDeg(object.rotation.z).toFixed(1);
  $('we-scale-x').value = object.scale.x.toFixed(3);
  $('we-scale-y').value = object.scale.y.toFixed(3);
  $('we-scale-z').value = object.scale.z.toFixed(3);
}

function selectObject(object) {
  selectedObject = object || null;
  $('we-selection-status').textContent = selectedObject ? `Seçim: ${selectedObject.name}` : 'Seçim: yok';
  if (selectedObject?.isInstancedMesh) $('we-inspector-empty').textContent = 'Instance grubu seçildi. Bireysel instance Inspector düzenleme bir sonraki katmanda.';
  else $('we-inspector-empty').textContent = 'Bir obje seç.';
  writeInspector(selectedObject);
  refreshHierarchy();
}

function livePlacement() {
  return window.__WESTEROS_EDITOR_PLACEMENT__ || null;
}

function retireObjectFoundation(object) {
  if (!object?.userData?.editorFoundationKey && !object?.userData?.terrainFoundationKey) return { ok: true, skipped: true };
  const placement = livePlacement();
  if (!placement?.removeObjectFoundation) return { ok: false, error: 'live-placement-unavailable' };
  return placement.removeObjectFoundation(object);
}

function retireObjectFoundations(objects) {
  const candidates = (Array.isArray(objects) ? objects : [objects])
    .filter((object) => object?.userData?.editorFoundationKey || object?.userData?.terrainFoundationKey);
  if (!candidates.length) return { ok: true, removedCount: 0, missingKeys: [], rebuiltChunkCount: 0 };
  const placement = livePlacement();
  if (!placement?.removeObjectFoundations) return { ok: false, error: 'live-placement-unavailable' };
  return placement.removeObjectFoundations(candidates);
}

function regroundObjectFoundation(object, asset = null) {
  const placement = livePlacement();
  if (!placement?.groundObject || !object || object.isInstancedMesh) return { ok: false, error: 'live-placement-unavailable' };
  return placement.groundObject(object, asset ? { asset } : undefined);
}

async function addAsset(asset, position = new THREE.Vector3()) {
  try {
    toast(`${asset.name} yükleniyor…`);
    const object = await assetManager.createObject(asset);
    object.position.set(snapValue(position.x), snapValue(position.y), snapValue(position.z));
    object.userData.editorId = nextEditorId(asset.id);
    editableObjects.push(object);
    scene.add(object);
    selectObject(object);
    toast(`${asset.name} sahneye eklendi.`);
    return object;
  } catch (error) {
    console.error('[worldEditor] asset load failed', asset.id, error);
    toast(`${asset.name} yüklenemedi.`);
    return null;
  }
}

function renderAssets() {
  const query = $('we-asset-search').value.trim().toLocaleLowerCase('tr-TR');
  const container = $('we-assets');
  container.replaceChildren();
  EDITOR_ASSETS.filter((asset) => (activeCategory === 'Tümü' || asset.category === activeCategory) && (!query || `${asset.name} ${asset.category}`.toLocaleLowerCase('tr-TR').includes(query))).forEach((asset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `we-asset${selectedAssetId === asset.id ? ' is-selected' : ''}`;
    button.innerHTML = `<strong>${asset.name}</strong><span>${asset.category} · ${asset.format.toUpperCase()}</span>`;
    button.addEventListener('click', () => {
      selectedAssetId = asset.id;
      renderAssets();
    });
    button.addEventListener('dblclick', () => addAsset(asset, controls.target.clone()));
    container.append(button);
  });
}

function renderCategories() {
  const categories = ['Tümü', ...new Set(EDITOR_ASSETS.map((asset) => asset.category))];
  const container = $('we-asset-categories');
  container.replaceChildren();
  categories.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `we-category${activeCategory === category ? ' is-active' : ''}`;
    button.textContent = category;
    button.addEventListener('click', () => {
      activeCategory = category;
      renderCategories();
      renderAssets();
    });
    container.append(button);
  });
}

function applyInspector() {
  if (!selectedObject || selectedObject.isInstancedMesh) return;
  const hadFoundation = Boolean(selectedObject.userData?.editorFoundationKey || selectedObject.userData?.terrainFoundationKey);
  selectedObject.name = $('we-name').value.trim() || selectedObject.name;
  selectedObject.position.set(snapValue(Number($('we-pos-x').value) || 0), snapValue(Number($('we-pos-y').value) || 0), snapValue(Number($('we-pos-z').value) || 0));
  selectedObject.rotation.set(THREE.MathUtils.degToRad(Number($('we-rot-x').value) || 0), THREE.MathUtils.degToRad(Number($('we-rot-y').value) || 0), THREE.MathUtils.degToRad(Number($('we-rot-z').value) || 0));
  selectedObject.scale.set(Math.max(0.01, Number($('we-scale-x').value) || 1), Math.max(0.01, Number($('we-scale-y').value) || 1), Math.max(0.01, Number($('we-scale-z').value) || 1));
  if (hadFoundation) {
    const grounding = regroundObjectFoundation(selectedObject);
    if (!grounding.ok) console.warn('[worldEditor] live foundation update failed', grounding.error);
  }
  writeInspector(selectedObject);
  refreshHierarchy();
}

function duplicateSelected() {
  if (!selectedObject || selectedObject.isInstancedMesh) return;
  const sourceAsset = findEditorAsset(selectedObject.userData?.editorAssetId) || null;
  const sourceWasStructure = Boolean(
    selectedObject.userData?.editorFoundationKey
    || selectedObject.userData?.terrainFoundationKey
    || isEditorStructureAsset(sourceAsset),
  );
  const clone = selectedObject.clone(true);
  const {
    editorFoundationKey: _editorFoundationKey,
    terrainFoundationKey: _terrainFoundationKey,
    editorGroundingMode: _editorGroundingMode,
    ...cloneUserData
  } = selectedObject.userData || {};
  clone.userData = { ...cloneUserData, editorId: nextEditorId(selectedObject.userData.editorAssetId || 'object') };
  clone.name = `${selectedObject.name} Kopya`;
  clone.position.x = snapValue(clone.position.x + editorState().snapSize);
  editableObjects.push(clone);
  scene.add(clone);
  selectObject(clone);
  if (sourceWasStructure) {
    const grounding = regroundObjectFoundation(clone, sourceAsset);
    if (!grounding.ok) console.warn('[worldEditor] duplicated structure grounding failed', grounding.error);
    else writeInspector(clone);
  }
}

function deleteSelected() {
  if (!selectedObject) return;
  if (selectedObject.isInstancedMesh && instanceManager.removeGroupObject(selectedObject)) {
    selectObject(null);
    return;
  }
  const index = editableObjects.indexOf(selectedObject);
  if (index >= 0) {
    const retired = retireObjectFoundation(selectedObject);
    if (!retired.ok && retired.error !== 'foundation-not-registered') {
      console.warn('[worldEditor] foundation cleanup failed before delete', retired.error);
    }
    scene.remove(selectedObject);
    editableObjects.splice(index, 1);
    selectObject(null);
  }
}

function focusSelected() {
  if (!selectedObject) return;
  const box = new THREE.Box3().setFromObject(selectedObject);
  const center = box.getCenter(new THREE.Vector3());
  const size = Math.max(2, box.getSize(new THREE.Vector3()).length());
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(size * 0.8, size * 0.55, size * 0.8));
}

function saveScene() {
  const data = serializeEditorScene(editableObjects, instanceManager.serialize(), editorState());
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'westeros-world.scene.json';
  anchor.click();
  URL.revokeObjectURL(url);
  toast('Scene JSON hazırlandı.');
}

async function loadSceneFile(file) {
  const data = validateEditorScene(JSON.parse(await file.text()));
  instanceManager.clear();
  const previousObjects = [...editableObjects];
  const retired = retireObjectFoundations(previousObjects);
  if (!retired.ok) {
    console.warn('[worldEditor] batch foundation cleanup failed before scene load', retired.error);
  }
  for (const object of previousObjects) {
    scene.remove(object);
  }
  editableObjects.splice(0, editableObjects.length);
  for (const record of data.objects) {
    const asset = findEditorAsset(record.asset);
    if (!asset) continue;
    const object = await addAsset(asset, new THREE.Vector3(...record.transform.position));
    if (!object) continue;
    object.userData.editorId = record.id;
    object.name = record.name;
    object.rotation.set(...record.transform.rotation);
    object.scale.set(...record.transform.scale);
    if (isEditorStructureAsset(asset)) {
      const grounding = regroundObjectFoundation(object, asset);
      if (!grounding.ok) console.warn('[worldEditor] loaded structure grounding failed', record.id, grounding.error);
      else writeInspector(object);
    }
  }
  await rehydrateInstanceGroups(data.instanceGroups, instanceManager, findEditorAsset);
  $('we-grid-toggle').checked = data.editor?.gridVisible !== false;
  $('we-snap-toggle').checked = data.editor?.snapEnabled !== false;
  $('we-snap-size').value = Number(data.editor?.snapSize) || 1;
  grid.visible = $('we-grid-toggle').checked;
  selectObject(null);
  toast('Scene JSON yüklendi.');
}

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const candidates = [...editableObjects, ...instanceManager.groups.map((record) => record.object)];
  const hits = raycaster.intersectObjects(candidates, true);
  if (!hits.length) return;
  let object = hits[0].object;
  while (object.parent && !candidates.includes(object)) object = object.parent;
  if (candidates.includes(object)) selectObject(object);
});

$('we-save').addEventListener('click', saveScene);
$('we-load').addEventListener('click', () => $('we-load-file').click());
$('we-load-file').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) loadSceneFile(file).catch((error) => {
    console.error('[worldEditor] scene load failed', error);
    toast('Scene JSON yüklenemedi.');
  });
  event.target.value = '';
});
$('we-duplicate').addEventListener('click', duplicateSelected);
$('we-delete').addEventListener('click', deleteSelected);
$('we-focus').addEventListener('click', focusSelected);
$('we-auto-texture').addEventListener('click', () => {
  if (!selectedObject) { toast('Önce bir obje seç.'); return; }
  const result = autoTextureObject(selectedObject, { lookupAsset: findEditorAsset });
  toast(describeResult(result));
});
$('we-auto-texture-all').addEventListener('click', () => {
  const targets = [...editableObjects, ...instanceManager.groups.map((record) => record.object)];
  if (targets.length === 0) { toast('Sahnede giydirilecek obje yok.'); return; }
  const summary = autoTextureMany(targets, { lookupAsset: findEditorAsset });
  const families = Object.keys(summary.byPalette).length;
  toast(`${summary.dressed} obje giydirildi · ${families} doku ailesi · ${summary.named} adlandırılmış parça, ${summary.banded} katmanlı gövde, ${summary.main + summary.plain} ana yüzey.`);
});
$('we-restore-texture').addEventListener('click', () => {
  if (!selectedObject) { toast('Önce bir obje seç.'); return; }
  const restored = restoreOriginalMaterials(selectedObject);
  toast(restored > 0 ? `${restored} mesh özgün materyaline döndü.` : 'Bu objede geri alınacak doku yok.');
});
$('we-grid-toggle').addEventListener('change', () => { grid.visible = $('we-grid-toggle').checked; });
$('we-asset-search').addEventListener('input', renderAssets);
$('we-hierarchy-search').addEventListener('input', refreshHierarchy);
['we-name', 'we-pos-x', 'we-pos-y', 'we-pos-z', 'we-rot-x', 'we-rot-y', 'we-rot-z', 'we-scale-x', 'we-scale-y', 'we-scale-z'].forEach((id) => $(id).addEventListener('change', applyInspector));
$('we-create-formation').addEventListener('click', async () => {
  const asset = findEditorAsset(selectedAssetId);
  if (!asset) return;
  try {
    const rows = Math.max(1, Math.min(100, Number($('we-rows').value) || 1));
    const columns = Math.max(1, Math.min(100, Number($('we-columns').value) || 1));
    const spacing = Math.max(0.25, Number($('we-spacing').value) || 1.5);
    const record = await instanceManager.createFormation(asset, rows, columns, spacing, controls.target.clone().setY(0));
    selectObject(record.object);
    toast(`${rows * columns} instance oluşturuldu.`);
  } catch (error) {
    console.error('[worldEditor] formation failed', error);
    toast(error.message);
  }
});
window.addEventListener('keydown', (event) => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable;
  if (typing) return;
  if (event.key === 'Delete') deleteSelected();
  if (event.key.toLowerCase() === 'f') focusSelected();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    duplicateSelected();
  }
});
window.addEventListener('resize', resizeRenderer);
window.addEventListener('pagehide', () => {
  window.clearTimeout(toastTimer);
  controls.dispose();
  renderer.dispose();
  disposePaletteCaches();
});

renderCategories();
renderAssets();
refreshHierarchy();
addAsset(findEditorAsset('marker-castle'), new THREE.Vector3(0, 0, 0));
addAsset(findEditorAsset('marker-tree'), new THREE.Vector3(8, 0, 6));

renderer.setAnimationLoop(() => {
  resizeRenderer();
  controls.update();
  renderer.render(scene, camera);
});

window.__WESTEROS_WORLD_EDITOR__ = Object.freeze({
  scene,
  camera,
  canvas,
  renderer,
  orbitControls: controls,
  grid,
  editableObjects,
  instanceManager,
  getSelectedObject: () => selectedObject,
  getEditorState: editorState,
  writeInspector,
  refreshHierarchy
});
import('./EditorTransformControls.js')
  .then(({ installEditorTransformControls }) => installEditorTransformControls(window.__WESTEROS_WORLD_EDITOR__))
  .catch((error) => console.error('[worldEditor] TransformControls boot failed', error));
