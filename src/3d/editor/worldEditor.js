import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EDITOR_ASSETS, findEditorAsset } from './editorAssetLibrary.js';
import { EditorAssetManager } from './EditorAssetManager.js';
import { EditorInstanceManager } from './EditorInstanceManager.js';
import { serializeEditorScene, validateEditorScene } from './EditorSceneSerializer.js';

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
  selectedObject.name = $('we-name').value.trim() || selectedObject.name;
  selectedObject.position.set(snapValue(Number($('we-pos-x').value) || 0), snapValue(Number($('we-pos-y').value) || 0), snapValue(Number($('we-pos-z').value) || 0));
  selectedObject.rotation.set(THREE.MathUtils.degToRad(Number($('we-rot-x').value) || 0), THREE.MathUtils.degToRad(Number($('we-rot-y').value) || 0), THREE.MathUtils.degToRad(Number($('we-rot-z').value) || 0));
  selectedObject.scale.set(Math.max(0.01, Number($('we-scale-x').value) || 1), Math.max(0.01, Number($('we-scale-y').value) || 1), Math.max(0.01, Number($('we-scale-z').value) || 1));
  refreshHierarchy();
}

function duplicateSelected() {
  if (!selectedObject || selectedObject.isInstancedMesh) return;
  const clone = selectedObject.clone(true);
  clone.userData = { ...selectedObject.userData, editorId: nextEditorId(selectedObject.userData.editorAssetId || 'object') };
  clone.name = `${selectedObject.name} Kopya`;
  clone.position.x = snapValue(clone.position.x + editorState().snapSize);
  editableObjects.push(clone);
  scene.add(clone);
  selectObject(clone);
}

function deleteSelected() {
  if (!selectedObject) return;
  if (selectedObject.isInstancedMesh && instanceManager.removeGroupObject(selectedObject)) {
    selectObject(null);
    return;
  }
  const index = editableObjects.indexOf(selectedObject);
  if (index >= 0) {
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
  for (const object of [...editableObjects]) {
    scene.remove(object);
    editableObjects.splice(editableObjects.indexOf(object), 1);
  }
  for (const record of data.objects) {
    const asset = findEditorAsset(record.asset);
    if (!asset) continue;
    const object = await addAsset(asset, new THREE.Vector3(...record.transform.position));
    if (!object) continue;
    object.userData.editorId = record.id;
    object.name = record.name;
    object.rotation.set(...record.transform.rotation);
    object.scale.set(...record.transform.scale);
  }
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

// Run215 additive transform-authoring layer. It deliberately reuses the existing editor scene,
// selection, Inspector and OrbitControls owners instead of introducing parallel scene state.
const transformGizmo = new THREE.Group();
transformGizmo.name = 'Editor Transform Gizmo';
transformGizmo.visible = false;
transformGizmo.userData.editorLocked = true;
scene.add(transformGizmo);

const transformRaycaster = new THREE.Raycaster();
const transformPointer = new THREE.Vector2();
const transformPlane = new THREE.Plane();
const transformPlaneHit = new THREE.Vector3();
const transformStartHit = new THREE.Vector3();
const transformStartPosition = new THREE.Vector3();
const transformStartScale = new THREE.Vector3();
const transformStartQuaternion = new THREE.Quaternion();
const transformAxisWorld = new THREE.Vector3();
const transformUnitAxes = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) };
let transformMode = 'translate';
let transformSpace = 'world';
let transformDragging = false;
let transformAxis = null;
let transformPointerStartX = 0;
let transformPointerStartY = 0;

function makeTransformHandle(axis, geometry, color, position, rotation) {
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.92, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.transformAxis = axis;
  mesh.renderOrder = 1000;
  if (position) mesh.position.copy(position);
  if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  transformGizmo.add(mesh);
  return mesh;
}

const transformTranslateHandles = [
  makeTransformHandle('X', new THREE.BoxGeometry(2.4, 0.16, 0.16), 0xff5555, new THREE.Vector3(1.2, 0, 0)),
  makeTransformHandle('Y', new THREE.BoxGeometry(0.16, 2.4, 0.16), 0x55ff77, new THREE.Vector3(0, 1.2, 0)),
  makeTransformHandle('Z', new THREE.BoxGeometry(0.16, 0.16, 2.4), 0x5599ff, new THREE.Vector3(0, 0, 1.2))
];
const transformRotateHandles = [
  makeTransformHandle('X', new THREE.TorusGeometry(1.7, 0.08, 8, 48), 0xff5555, null, new THREE.Euler(0, Math.PI / 2, 0)),
  makeTransformHandle('Y', new THREE.TorusGeometry(1.7, 0.08, 8, 48), 0x55ff77, null, new THREE.Euler(Math.PI / 2, 0, 0)),
  makeTransformHandle('Z', new THREE.TorusGeometry(1.7, 0.08, 8, 48), 0x5599ff)
];
const transformScaleHandles = [
  makeTransformHandle('X', new THREE.BoxGeometry(0.32, 0.32, 0.32), 0xff5555, new THREE.Vector3(1.8, 0, 0)),
  makeTransformHandle('Y', new THREE.BoxGeometry(0.32, 0.32, 0.32), 0x55ff77, new THREE.Vector3(0, 1.8, 0)),
  makeTransformHandle('Z', new THREE.BoxGeometry(0.32, 0.32, 0.32), 0x5599ff, new THREE.Vector3(0, 0, 1.8))
];

function transformHandlesForMode() {
  if (transformMode === 'rotate') return transformRotateHandles;
  if (transformMode === 'scale') return transformScaleHandles;
  return transformTranslateHandles;
}

function syncTransformGizmo() {
  const object = selectedObject && !selectedObject.isInstancedMesh ? selectedObject : null;
  transformGizmo.visible = Boolean(object);
  if (!object) return;
  transformGizmo.position.copy(object.position);
  transformGizmo.quaternion.copy(transformSpace === 'local' ? object.quaternion : new THREE.Quaternion());
  for (const handle of [...transformTranslateHandles, ...transformRotateHandles, ...transformScaleHandles]) handle.visible = transformHandlesForMode().includes(handle);
}

function setTransformMode(mode) {
  transformMode = mode;
  syncTransformGizmo();
  const modeLabel = mode === 'translate' ? 'Taşı' : mode === 'rotate' ? 'Döndür' : 'Ölçekle';
  $('we-transform-mode').textContent = `Araç: ${modeLabel}`;
}

function setTransformSpace(space) {
  transformSpace = space;
  $('we-transform-space').textContent = space === 'world' ? 'World' : 'Local';
  syncTransformGizmo();
}

function transformAxisForObject(axis, object) {
  transformAxisWorld.copy(transformUnitAxes[axis]);
  if (transformSpace === 'local') transformAxisWorld.applyQuaternion(object.quaternion);
  return transformAxisWorld.normalize();
}

function updateTransformPointer(event) {
  const rect = canvas.getBoundingClientRect();
  transformPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  transformPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  transformRaycaster.setFromCamera(transformPointer, camera);
}

function intersectTransformPlane(event) {
  updateTransformPointer(event);
  return transformRaycaster.ray.intersectPlane(transformPlane, transformPlaneHit);
}

function applyTransformDrag(event) {
  const object = selectedObject;
  if (!transformDragging || !object || object.isInstancedMesh || !transformAxis) return;
  const axis = transformAxisForObject(transformAxis, object);
  if (transformMode === 'rotate') {
    const deltaPixels = (event.clientX - transformPointerStartX) + (transformPointerStartY - event.clientY);
    let angle = deltaPixels * 0.01;
    if (editorState().snapEnabled) angle = Math.round(angle / THREE.MathUtils.degToRad(15)) * THREE.MathUtils.degToRad(15);
    object.quaternion.copy(transformStartQuaternion).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  } else if (intersectTransformPlane(event)) {
    let amount = transformPlaneHit.clone().sub(transformStartHit).dot(axis);
    if (editorState().snapEnabled) {
      const size = editorState().snapSize;
      amount = Math.round(amount / size) * size;
    }
    if (transformMode === 'translate') {
      object.position.copy(transformStartPosition).addScaledVector(axis, amount);
    } else {
      const component = transformAxis === 'X' ? 'x' : transformAxis === 'Y' ? 'y' : 'z';
      const factor = Math.max(0.01, 1 + amount / 3);
      object.scale.copy(transformStartScale);
      object.scale[component] = Math.max(0.01, transformStartScale[component] * factor);
    }
  }
  writeInspector(object);
  refreshHierarchy();
  syncTransformGizmo();
}

function onTransformPointerDown(event) {
  if (event.button !== 0 || !selectedObject || selectedObject.isInstancedMesh) return;
  updateTransformPointer(event);
  const hit = transformRaycaster.intersectObjects(transformHandlesForMode(), false)[0];
  if (!hit) return;
  transformAxis = hit.object.userData.transformAxis;
  transformDragging = true;
  transformPointerStartX = event.clientX;
  transformPointerStartY = event.clientY;
  transformStartPosition.copy(selectedObject.position);
  transformStartScale.copy(selectedObject.scale);
  transformStartQuaternion.copy(selectedObject.quaternion);
  const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
  transformPlane.setFromNormalAndCoplanarPoint(cameraDirection, selectedObject.position);
  intersectTransformPlane(event);
  transformStartHit.copy(transformPlaneHit);
  controls.enabled = false;
  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onTransformPointerMove(event) {
  if (transformDragging) applyTransformDrag(event);
}

function onTransformPointerUp(event) {
  if (!transformDragging) return;
  transformDragging = false;
  transformAxis = null;
  controls.enabled = true;
  canvas.releasePointerCapture?.(event.pointerId);
  writeInspector(selectedObject);
  syncTransformGizmo();
}

const transformToolbar = document.createElement('div');
transformToolbar.className = 'we-transform-toolbar';
transformToolbar.innerHTML = '<button id="we-transform-translate" type="button">W · Taşı</button><button id="we-transform-rotate" type="button">E · Döndür</button><button id="we-transform-scale" type="button">R · Ölçekle</button><button id="we-transform-space" type="button">World</button><span id="we-transform-mode">Araç: Taşı</span>';
$('we-statusbar').prepend(transformToolbar);
$('we-transform-translate').addEventListener('click', () => setTransformMode('translate'));
$('we-transform-rotate').addEventListener('click', () => setTransformMode('rotate'));
$('we-transform-scale').addEventListener('click', () => setTransformMode('scale'));
$('we-transform-space').addEventListener('click', () => setTransformSpace(transformSpace === 'world' ? 'local' : 'world'));
canvas.addEventListener('pointerdown', onTransformPointerDown);
canvas.addEventListener('pointermove', onTransformPointerMove);
canvas.addEventListener('pointerup', onTransformPointerUp);
const transformSelectionObserver = new MutationObserver(syncTransformGizmo);
transformSelectionObserver.observe($('we-selection-status'), { childList: true, characterData: true, subtree: true });
window.addEventListener('keydown', (event) => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable;
  if (typing) return;
  const key = event.key.toLowerCase();
  if (key === 'w') setTransformMode('translate');
  if (key === 'e') setTransformMode('rotate');
  if (key === 'r') setTransformMode('scale');
  if (key === 'q') setTransformSpace(transformSpace === 'world' ? 'local' : 'world');
});
window.addEventListener('pagehide', () => {
  transformSelectionObserver.disconnect();
  canvas.removeEventListener('pointerdown', onTransformPointerDown);
  canvas.removeEventListener('pointermove', onTransformPointerMove);
  canvas.removeEventListener('pointerup', onTransformPointerUp);
  for (const handle of [...transformTranslateHandles, ...transformRotateHandles, ...transformScaleHandles]) {
    handle.geometry.dispose();
    handle.material.dispose();
  }
  scene.remove(transformGizmo);
});
syncTransformGizmo();
