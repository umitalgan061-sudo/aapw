import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import { EditorAssetManager } from './EditorAssetManager.js';
import { EditorInstanceManager } from './EditorInstanceManager.js';
import { validateEditorScene } from './EditorSceneSerializer.js';
import { findEditorAsset } from './editorAssetLibrary.js';
import { rehydrateInstanceGroups } from './EditorFormationRehydrator.js';

const STORAGE_KEY = 'westeros-world-editor.scene.v1';
const PREVIEW_PARAM = 'editorPatch';
const PREVIEW_VALUE = '1';

function previewRequested() {
  return new URLSearchParams(window.location.search).get(PREVIEW_PARAM) === PREVIEW_VALUE;
}

function createBadge(message) {
  const badge = document.createElement('div');
  badge.id = 'game3d-editor-preview-badge';
  badge.setAttribute('role', 'status');
  badge.style.cssText = 'position:fixed;left:50%;top:max(10px,env(safe-area-inset-top));transform:translateX(-50%);z-index:90;padding:8px 12px;border:1px solid rgba(229,194,102,.55);border-radius:8px;background:rgba(10,14,22,.88);color:#f4d46b;font:700 12px/1.2 system-ui,sans-serif;letter-spacing:.04em;pointer-events:none;box-shadow:0 4px 18px rgba(0,0,0,.35)';
  badge.textContent = message;
  document.body.append(badge);
  return badge;
}

function readSavedScene() {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    return validateEditorScene(JSON.parse(text));
  } catch (error) {
    console.error('[EditorGamePatchPreview] saved scene read failed', error);
    return null;
  }
}

function applyTransform(object, record) {
  object.position.set(...record.transform.position);
  object.rotation.set(...record.transform.rotation);
  object.scale.set(...record.transform.scale);
  object.name = record.name;
  object.userData.editorId = record.id;
  object.userData.editorAssetId = record.asset;
  object.userData.editorGamePreview = true;
  object.updateMatrixWorld(true);
}

async function installPreviewIntoScene(scene, data, badge) {
  const assetManager = new EditorAssetManager();
  const instanceManager = new EditorInstanceManager(scene, assetManager);
  const previewRoot = new THREE.Group();
  previewRoot.name = 'Editor World Patch Preview';
  previewRoot.userData.editorGamePreview = true;
  scene.add(previewRoot);

  let objectCount = 0;
  for (const record of data.objects) {
    const asset = findEditorAsset(record.asset);
    if (!asset) continue;
    const object = await assetManager.createObject(asset);
    applyTransform(object, record);
    previewRoot.add(object);
    objectCount += 1;
  }

  await rehydrateInstanceGroups(data.instanceGroups, instanceManager, findEditorAsset);
  for (const group of instanceManager.groups) group.object.userData.editorGamePreview = true;

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pagehide', dispose);
    instanceManager.clear();
    for (const child of [...previewRoot.children]) {
      previewRoot.remove(child);
      AssetLoader.disposeObject3D(child);
    }
    if (previewRoot.parent) previewRoot.parent.remove(previewRoot);
    badge.remove();
    if (window.__WESTEROS_GAME_EDITOR_PREVIEW__ === surface) delete window.__WESTEROS_GAME_EDITOR_PREVIEW__;
  }

  const surface = Object.freeze({
    getSnapshot: () => Object.freeze({
      active: true,
      objectCount,
      instanceGroupCount: instanceManager.groups.length,
      collisionPolicy: 'visual-only',
      rootAttached: previewRoot.parent === scene
    }),
    dispose
  });
  window.__WESTEROS_GAME_EDITOR_PREVIEW__ = surface;
  badge.textContent = `EDITÖR ÖNİZLEME · ${objectCount} obje · ${instanceManager.groups.length} grup · fizik değişmez`;
  window.addEventListener('pagehide', dispose, { once: true });
  return surface;
}

function captureFirstGameScene(data, badge) {
  const prototype = THREE.WebGLRenderer.prototype;
  const originalRender = prototype.render;
  let restored = false;

  function restore() {
    if (restored) return;
    restored = true;
    if (prototype.render === captureRender) prototype.render = originalRender;
  }

  function captureRender(scene, camera) {
    const result = originalRender.call(this, scene, camera);
    if (this.domElement?.id !== 'game3d-canvas') return result;
    restore();
    queueMicrotask(() => {
      installPreviewIntoScene(scene, data, badge).catch((error) => {
        console.error('[EditorGamePatchPreview] preview install failed', error);
        badge.textContent = 'EDITÖR ÖNİZLEME yüklenemedi';
      });
    });
    return result;
  }

  prototype.render = captureRender;
  window.addEventListener('pagehide', restore, { once: true });
}

if (previewRequested()) {
  const badge = createBadge('EDITÖR ÖNİZLEME hazırlanıyor…');
  const data = readSavedScene();
  if (!data) {
    badge.textContent = 'EDITÖR ÖNİZLEME · Yerel scene kaydı bulunamadı';
  } else {
    captureFirstGameScene(data, badge);
  }
}
