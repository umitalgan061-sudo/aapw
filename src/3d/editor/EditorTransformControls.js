import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const ROTATE_SNAP = THREE.MathUtils.degToRad(15);
const SCALE_SNAP = 0.1;
const MODE_LABEL = Object.freeze({ translate: 'Taşı', rotate: 'Döndür', scale: 'Ölçekle' });

function typingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
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
  if (window.__WESTEROS_EDITOR_TRANSFORM__) return window.__WESTEROS_EDITOR_TRANSFORM__;

  const ui = createUi();
  const transform = new TransformControls(api.camera, api.canvas);
  transform.name = 'World Editor TransformControls';
  transform.setMode('translate');
  transform.setSpace('world');
  transform.setSize(0.9);
  api.scene.add(transform);

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
    api.writeInspector(transform.object);
    api.refreshHierarchy();
  }

  function onDraggingChanged(event) {
    api.orbitControls.enabled = !event.value;
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
