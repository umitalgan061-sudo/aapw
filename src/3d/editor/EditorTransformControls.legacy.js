import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { installEditorScaleInputController } from './EditorScaleInputController.js';

const ROTATE_SNAP = THREE.MathUtils.degToRad(15);
const SCALE_SNAP = 0.1;
const MODE_LABEL = Object.freeze({ translate: 'Taşı', rotate: 'Döndür', scale: 'Ölçekle' });

function typingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
}

function hasTerrainFoundation(object) {
  return Boolean(object?.userData?.editorFoundationKey || object?.userData?.terrainFoundationKey);
}

function refreshTerrainFoundation(object) {
  if (!object || !hasTerrainFoundation(object)) return { ok: true, skipped: true };
  const placement = window.__WESTEROS_EDITOR_PLACEMENT__;
  if (!placement?.groundObject) return { ok: false, error: 'live-placement-unavailable' };
  return placement.groundObject(object);
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
    const object = api.getSelectedObject();
    if (object && !object.isInstancedMesh) transform.attach(object);
    else transform.detach();
    updateUi();
  }

  function setMode(mode) {
    transform.setMode(mode);
    updateUi();
  }

  function toggleSpace() {
    transform.setSpace(transform.space === 'world' ? 'local' : 'world');
    updateUi();
  }

  function onObjectChange() {
    if (!transform.object) return;
    // Keep the inspector responsive while dragging, but do not rebuild terrain chunks every pointer
    // frame. Foundation recomputation is intentionally deferred to the drag-end event below.
    api.writeInspector(transform.object);
    api.refreshHierarchy();
  }

  function onDraggingChanged(event) {
    api.orbitControls.enabled = !event.value;
    if (event.value || !transform.object) return;
    const grounding = refreshTerrainFoundation(transform.object);
    if (!grounding.ok) console.warn('[EditorTransformControls] foundation refresh failed', grounding.error);
    api.writeInspector(transform.object);
    api.refreshHierarchy();
  }

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
    return {
      isTransformControls: transform.isTransformControls === true,
      mode: transform.getMode(),
      space: transform.space,
      translationSnap: transform.translationSnap,
      rotationSnap: transform.rotationSnap,
      scaleSnap: transform.scaleSnap,
      attachedEditorId: object?.userData?.editorId || null,
      objectPosition: object ? object.position.toArray() : null,
      objectRotation: object ? [object.rotation.x, object.rotation.y, object.rotation.z] : null,
      objectScale: object ? object.scale.toArray() : null,
      orbitEnabled: api.orbitControls.enabled,
      dragging: transform.dragging,
      visible: transform.visible
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
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
    object.scale.set(
      Math.max(OWNER_QUICK_SHRINK_MIN_SCALE, object.scale.x * OWNER_QUICK_SHRINK_FACTOR),
      Math.max(OWNER_QUICK_SHRINK_MIN_SCALE, object.scale.y * OWNER_QUICK_SHRINK_FACTOR),
      Math.max(OWNER_QUICK_SHRINK_MIN_SCALE, object.scale.z * OWNER_QUICK_SHRINK_FACTOR)
    );
    const grounding = refreshTerrainFoundation(object);
    if (!grounding.ok) console.warn('[EditorTransformControls] quick-shrink foundation refresh failed', grounding.error);
    api.writeInspector?.(object);
    api.refreshHierarchy?.();
    window.__WESTEROS_EDITOR_TRANSFORM__?.syncSelection?.();
  });
  toolbar.insertBefore(button, toolbar.querySelector('.we-link'));
  window.addEventListener('pagehide', () => button.remove(), { once: true });
});
