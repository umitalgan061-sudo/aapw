import { EditorAssetManager } from './EditorAssetManager.js';
import { findEditorAsset } from './editorAssetLibrary.js';

const GENERATED_ID_KIND = Object.freeze({ paste: 'paste', duplicate: 'duplicate' });

function typingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
}

function snapshotObject(object) {
  if (!object || object.isInstancedMesh) return null;
  const assetId = object.userData?.editorAssetId;
  if (!assetId || !findEditorAsset(assetId)) return null;
  return Object.freeze({
    assetId,
    name: object.name || assetId,
    position: Object.freeze(object.position.toArray()),
    rotation: Object.freeze([object.rotation.x, object.rotation.y, object.rotation.z]),
    scale: Object.freeze(object.scale.toArray())
  });
}

function nextGeneratedId(api, assetId, kind) {
  const used = new Set(api.editableObjects.map((object) => object.userData?.editorId).filter(Boolean));
  let index = 1;
  let candidate = '';
  do {
    candidate = `${assetId}-${kind}-${String(index).padStart(4, '0')}`;
    index += 1;
  } while (used.has(candidate));
  return candidate;
}

function createUi() {
  const toolbar = document.querySelector('.we-toolbar-actions');
  const duplicateButton = document.getElementById('we-duplicate');
  if (!toolbar || !duplicateButton) throw new Error('World Editor clipboard toolbar hedefi bulunamadı.');

  duplicateButton.textContent = 'Çoğalt';
  duplicateButton.title = 'Seçili objeyi çoğalt (Ctrl+D)';

  const group = document.createElement('div');
  group.id = 'we-clipboard-tools';
  group.className = 'we-clipboard-tools';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Kopyala ve yapıştır araçları');

  const copyButton = document.createElement('button');
  copyButton.id = 'we-copy';
  copyButton.type = 'button';
  copyButton.textContent = 'Kopyala';
  copyButton.title = 'Seçili objeyi editör panosuna kopyala (Ctrl+C)';

  const pasteButton = document.createElement('button');
  pasteButton.id = 'we-paste';
  pasteButton.type = 'button';
  pasteButton.textContent = 'Yapıştır';
  pasteButton.title = 'Editör panosundaki objeyi yapıştır (Ctrl+V)';
  pasteButton.disabled = true;

  group.append(copyButton, pasteButton);
  toolbar.insertBefore(group, duplicateButton);

  const style = document.createElement('style');
  style.id = 'we-clipboard-style';
  style.textContent = '.we-clipboard-tools{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}.we-clipboard-tools button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:900px){.we-toolbar-actions .we-clipboard-tools button{display:inline-block}}';
  document.head.append(style);

  return { group, copyButton, pasteButton, duplicateButton, style };
}

export function installEditorClipboardController(api) {
  if (!api) throw new Error('World Editor API bulunamadı.');
  if (window.__WESTEROS_EDITOR_CLIPBOARD__) return window.__WESTEROS_EDITOR_CLIPBOARD__;

  const ui = createUi();
  const assetManager = new EditorAssetManager();
  const selectionStatus = document.getElementById('we-selection-status');
  const removers = [];
  let clipboard = null;
  let pasteCount = 0;
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

  function syncButtons() {
    const selected = api.getSelectedObject();
    const selectedSnapshot = snapshotObject(selected);
    ui.copyButton.disabled = !selectedSnapshot;
    ui.duplicateButton.disabled = !selectedSnapshot;
    ui.pasteButton.disabled = !clipboard;
  }

  function copySelected() {
    const snapshot = snapshotObject(api.getSelectedObject());
    if (!snapshot) {
      toast('Bu seçim kopyalanamıyor.');
      syncButtons();
      return false;
    }
    clipboard = snapshot;
    pasteCount = 0;
    syncButtons();
    toast(`${snapshot.name} kopyalandı.`);
    return true;
  }

  async function createFromSnapshot(snapshot, kind, offsetMultiplier, nameSuffix) {
    const asset = findEditorAsset(snapshot.assetId);
    if (!asset) {
      toast('Kopyalanan asset artık bulunamıyor.');
      return null;
    }

    const object = await assetManager.createObject(asset);
    const state = api.getEditorState();
    const offset = state.snapEnabled ? Math.max(0.1, Number(state.snapSize) || 1) : 1;
    object.position.fromArray(snapshot.position);
    object.position.x += offset * offsetMultiplier;
    object.rotation.set(...snapshot.rotation);
    object.scale.fromArray(snapshot.scale);
    object.userData.editorId = nextGeneratedId(api, snapshot.assetId, kind);
    object.name = `${snapshot.name} ${nameSuffix}`;
    api.editableObjects.push(object);
    api.scene.add(object);
    api.refreshHierarchy();

    const hierarchyButton = [...document.querySelectorAll('#we-hierarchy .we-hierarchy-item')]
      .find((button) => button.textContent === object.name);
    hierarchyButton?.click();
    syncButtons();
    return object;
  }

  async function pasteClipboard() {
    if (!clipboard) {
      toast('Önce bir obje kopyala.');
      syncButtons();
      return null;
    }
    pasteCount += 1;
    const object = await createFromSnapshot(clipboard, GENERATED_ID_KIND.paste, pasteCount, `Kopya ${pasteCount}`);
    if (object) toast(`${object.name} yapıştırıldı.`);
    return object;
  }

  async function duplicateSelected() {
    const snapshot = snapshotObject(api.getSelectedObject());
    if (!snapshot) {
      toast('Bu seçim çoğaltılamıyor.');
      syncButtons();
      return null;
    }
    const object = await createFromSnapshot(snapshot, GENERATED_ID_KIND.duplicate, 1, 'Kopya');
    if (object) toast(`${object.name} çoğaltıldı.`);
    return object;
  }

  function reportAsyncFailure(label, error) {
    console.error(`[EditorClipboardController] ${label} failed`, error);
    toast(label === 'duplicate' ? 'Çoğaltma başarısız.' : 'Yapıştırma başarısız.');
  }

  function onDuplicateClick(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    duplicateSelected().catch((error) => reportAsyncFailure('duplicate', error));
  }

  function onKeyDown(event) {
    if (typingTarget(event.target) || event.altKey) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'c') {
      event.preventDefault();
      event.stopImmediatePropagation();
      copySelected();
    } else if (key === 'v') {
      event.preventDefault();
      event.stopImmediatePropagation();
      pasteClipboard().catch((error) => reportAsyncFailure('paste', error));
    } else if (key === 'd') {
      event.preventDefault();
      event.stopImmediatePropagation();
      duplicateSelected().catch((error) => reportAsyncFailure('duplicate', error));
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    selectionObserver.disconnect();
    removers.splice(0).reverse().forEach((remove) => remove());
    window.clearTimeout(toastTimer);
    ui.group.remove();
    ui.style.remove();
    ui.duplicateButton.disabled = false;
    ui.duplicateButton.textContent = 'Kopyala';
    ui.duplicateButton.removeAttribute('title');
    if (window.__WESTEROS_EDITOR_CLIPBOARD__ === surface) delete window.__WESTEROS_EDITOR_CLIPBOARD__;
  }

  const selectionObserver = new MutationObserver(syncButtons);
  if (selectionStatus) selectionObserver.observe(selectionStatus, { childList: true, characterData: true, subtree: true });
  listen(ui.copyButton, 'click', copySelected);
  listen(ui.pasteButton, 'click', () => pasteClipboard().catch((error) => reportAsyncFailure('paste', error)));
  listen(ui.duplicateButton, 'click', onDuplicateClick, true);
  listen(window, 'keydown', onKeyDown, true);
  listen(window, 'pagehide', dispose, { once: true });

  const surface = Object.freeze({ copySelected, pasteClipboard, duplicateSelected, syncButtons, getClipboard: () => clipboard, dispose });
  window.__WESTEROS_EDITOR_CLIPBOARD__ = surface;
  syncButtons();
  return surface;
}

const api = window.__WESTEROS_WORLD_EDITOR__;
if (api) {
  try {
    installEditorClipboardController(api);
  } catch (error) {
    console.error('[EditorClipboardController] boot failed', error);
  }
}
