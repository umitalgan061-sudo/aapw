import { serializeEditorScene, validateEditorScene } from './EditorSceneSerializer.js';

const STORAGE_KEY = 'westeros-world-editor.scene.v1';
const STORAGE_TIME_KEY = 'westeros-world-editor.scene.v1.savedAt';

function createUi() {
  const toolbar = document.querySelector('.we-toolbar-actions');
  const link = toolbar?.querySelector('.we-link');
  if (!toolbar || !link) throw new Error('Local session toolbar hedefi bulunamadı.');
  const group = document.createElement('div');
  group.id = 'we-local-session-tools';
  group.className = 'we-local-session-tools';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Yerel sahne kaydı');
  group.innerHTML = '<button id="we-local-save" type="button" title="Scene JSON verisini bu tarayıcıda sakla">Yerel Kaydet</button><button id="we-local-load" type="button" title="Bu tarayıcıdaki son scene kaydını yükle">Yerel Yükle</button>';
  toolbar.insertBefore(group, link);
  const style = document.createElement('style');
  style.id = 'we-local-session-style';
  style.textContent = '.we-local-session-tools{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}.we-local-session-tools button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:900px){.we-toolbar-actions .we-local-session-tools button{display:inline-block}}';
  document.head.append(style);
  return { group, saveButton: group.querySelector('#we-local-save'), loadButton: group.querySelector('#we-local-load'), style };
}

export function installEditorLocalSession(api) {
  if (!api?.editableObjects || !api?.instanceManager || !api?.getEditorState) {
    throw new Error('Local session için World Editor API eksik.');
  }
  if (window.__WESTEROS_EDITOR_LOCAL_SESSION__) return window.__WESTEROS_EDITOR_LOCAL_SESSION__;

  const ui = createUi();
  const loadInput = document.getElementById('we-load-file');
  const jsonSaveButton = document.getElementById('we-save');
  const removers = [];
  let disposed = false;
  let toastTimer = 0;

  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  }

  function toast(message) {
    const element = document.getElementById('we-toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove('is-visible'), 1800);
  }

  function storageAvailable() {
    try {
      return typeof window.localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  function hasLocalScene() {
    if (!storageAvailable()) return false;
    try { return Boolean(window.localStorage.getItem(STORAGE_KEY)); } catch { return false; }
  }

  function syncUi() {
    ui.loadButton.disabled = !hasLocalScene();
  }

  function currentScene() {
    return serializeEditorScene(api.editableObjects, api.instanceManager.serialize(), api.getEditorState());
  }

  function saveLocal({ quiet = false } = {}) {
    if (!storageAvailable()) {
      if (!quiet) toast('Tarayıcı yerel depolaması kullanılamıyor.');
      return false;
    }
    try {
      const data = currentScene();
      validateEditorScene(data);
      const text = JSON.stringify(data);
      window.localStorage.setItem(STORAGE_KEY, text);
      window.localStorage.setItem(STORAGE_TIME_KEY, new Date().toISOString());
      syncUi();
      if (!quiet) toast('Scene tarayıcıya kaydedildi.');
      return true;
    } catch (error) {
      console.error('[EditorLocalSession] local save failed', error);
      if (!quiet) toast('Yerel kayıt başarısız; JSON dosyasını kullan.');
      return false;
    }
  }

  function loadLocal() {
    if (!hasLocalScene()) {
      toast('Tarayıcıda kayıtlı scene yok.');
      return false;
    }
    try {
      const text = window.localStorage.getItem(STORAGE_KEY);
      validateEditorScene(JSON.parse(text));
      const file = new File([text], 'westeros-local.scene.json', { type: 'application/json' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      loadInput.files = transfer.files;
      loadInput.dispatchEvent(new Event('change', { bubbles: true }));
      toast('Yerel scene yükleniyor…');
      return true;
    } catch (error) {
      console.error('[EditorLocalSession] local load failed', error);
      toast('Yerel scene yüklenemedi.');
      return false;
    }
  }

  function getSnapshot() {
    let savedAt = null;
    try { savedAt = window.localStorage.getItem(STORAGE_TIME_KEY); } catch {}
    return Object.freeze({ available: storageAvailable(), hasLocalScene: hasLocalScene(), savedAt });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    removers.splice(0).reverse().forEach((remove) => remove());
    window.clearTimeout(toastTimer);
    ui.group.remove();
    ui.style.remove();
    if (window.__WESTEROS_EDITOR_LOCAL_SESSION__ === surface) delete window.__WESTEROS_EDITOR_LOCAL_SESSION__;
  }

  listen(ui.saveButton, 'click', () => saveLocal());
  listen(ui.loadButton, 'click', loadLocal);
  listen(jsonSaveButton, 'click', () => saveLocal({ quiet: true }));
  listen(window, 'pagehide', () => saveLocal({ quiet: true }), { once: true });
  listen(window, 'pagehide', dispose, { once: true });

  const surface = Object.freeze({ saveLocal, loadLocal, hasLocalScene, getSnapshot, dispose });
  window.__WESTEROS_EDITOR_LOCAL_SESSION__ = surface;
  syncUi();
  return surface;
}

const api = window.__WESTEROS_WORLD_EDITOR__;
if (api) {
  try {
    installEditorLocalSession(api);
  } catch (error) {
    console.error('[EditorLocalSession] boot failed', error);
  }
}

// Run248 additive scene-load transform guard: serialized coordinates must not be
// quantized by whichever live snap setting happened to be active before import.
const run248LoadInput = document.getElementById('we-load-file');
let run248RedispatchingSceneLoad = false;
run248LoadInput?.addEventListener('change', async (event) => {
  if (run248RedispatchingSceneLoad) return;
  const file = event.target.files?.[0];
  if (!file) return;
  event.stopImmediatePropagation();
  try {
    validateEditorScene(JSON.parse(await file.text()));
    const snapToggle = document.getElementById('we-snap-toggle');
    if (snapToggle) snapToggle.checked = false;
  } catch {
    // Invalid files are deliberately handed back to the canonical loader unchanged
    // so its existing atomic failure path, logging and user feedback remain intact.
  }
  run248RedispatchingSceneLoad = true;
  try {
    run248LoadInput.dispatchEvent(new Event('change', { bubbles: true }));
  } finally {
    run248RedispatchingSceneLoad = false;
  }
}, true);
