import { serializeEditorScene, validateEditorScene } from './EditorSceneSerializer.js';

const HISTORY_LIMIT = 40;
const CAPTURE_DEBOUNCE_MS = 140;
const RESTORE_TIMEOUT_MS = 120000;
const DEMO_EPSILON = 0.001;

function isTyping(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
}

function createUi() {
  const toolbar = document.querySelector('.we-toolbar-actions');
  const link = toolbar?.querySelector('.we-link');
  if (!toolbar || !link) throw new Error('History toolbar hedefi bulunamadı.');
  const group = document.createElement('div');
  group.id = 'we-history-tools';
  group.className = 'we-history-tools';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'İşlem geçmişi');
  group.innerHTML = '<button id="we-undo" type="button" title="Geri Al (Ctrl/Cmd+Z)">↶ Geri Al</button><button id="we-redo" type="button" title="Yinele (Ctrl/Cmd+Shift+Z / Ctrl+Y)">↷ Yinele</button>';
  toolbar.insertBefore(group, link);
  const style = document.createElement('style');
  style.id = 'we-history-style';
  style.textContent = '.we-history-tools{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto}.we-history-tools button:disabled{opacity:.42;cursor:not-allowed}@media(max-width:900px){.we-toolbar-actions .we-history-tools button{display:inline-block}}';
  document.head.append(style);
  return { group, undo: group.querySelector('#we-undo'), redo: group.querySelector('#we-redo'), style };
}

function isBootDemo(object) {
  if (object?.userData?.editorAssetId === 'marker-castle') return Math.abs(object.position.x) <= DEMO_EPSILON && Math.abs(object.position.z) <= DEMO_EPSILON;
  if (object?.userData?.editorAssetId === 'marker-tree') return Math.abs(object.position.x - 8) <= DEMO_EPSILON && Math.abs(object.position.z - 6) <= DEMO_EPSILON;
  return false;
}

export function installEditorHistoryController(api) {
  if (!api?.editableObjects || !api?.instanceManager || !api?.getEditorState) throw new Error('History için World Editor API eksik.');
  if (window.__WESTEROS_EDITOR_HISTORY__) return window.__WESTEROS_EDITOR_HISTORY__;

  const ui = createUi();
  const loadInput = document.getElementById('we-load-file');
  const renderStatus = document.getElementById('we-render-status');
  const toastNode = document.getElementById('we-toast');
  const history = [];
  const redoStack = [];
  const removers = [];
  let captureTimer = 0;
  let restoreTimer = 0;
  let bootFrame = 0;
  let restoring = false;
  let disposed = false;
  let observersStarted = false;

  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  }

  function serializeText() {
    const data = serializeEditorScene(api.editableObjects, api.instanceManager.serialize(), api.getEditorState());
    validateEditorScene(data);
    return JSON.stringify(data);
  }

  function syncUi() {
    ui.undo.disabled = restoring || history.length <= 1;
    ui.redo.disabled = restoring || redoStack.length === 0;
  }

  function pushSnapshot(text = serializeText(), { clearRedo = true } = {}) {
    if (restoring || disposed) return false;
    if (history.at(-1) === text) return false;
    history.push(text);
    if (history.length > HISTORY_LIMIT) history.shift();
    if (clearRedo) redoStack.length = 0;
    syncUi();
    return true;
  }

  function captureNow() {
    window.clearTimeout(captureTimer);
    captureTimer = 0;
    if (restoring || disposed || !observersStarted) return false;
    try { return pushSnapshot(); }
    catch (error) {
      console.error('[EditorHistoryController] snapshot failed', error);
      return false;
    }
  }

  function scheduleCapture() {
    if (restoring || disposed || !observersStarted) return;
    window.clearTimeout(captureTimer);
    captureTimer = window.setTimeout(captureNow, CAPTURE_DEBOUNCE_MS);
  }

  function finishRestore() {
    if (!restoring) return;
    restoring = false;
    window.clearTimeout(restoreTimer);
    restoreTimer = 0;
    syncUi();
  }

  function restoreText(text) {
    if (restoring || disposed) return false;
    try {
      validateEditorScene(JSON.parse(text));
      const file = new File([text], 'westeros-history.scene.json', { type: 'application/json' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      restoring = true;
      syncUi();
      loadInput.files = transfer.files;
      loadInput.dispatchEvent(new Event('change', { bubbles: true }));
      restoreTimer = window.setTimeout(finishRestore, RESTORE_TIMEOUT_MS);
      return true;
    } catch (error) {
      restoring = false;
      console.error('[EditorHistoryController] restore failed', error);
      syncUi();
      return false;
    }
  }

  function undo() {
    if (restoring || history.length <= 1) return false;
    captureNow();
    const current = history.pop();
    redoStack.push(current);
    const target = history.at(-1);
    syncUi();
    return restoreText(target);
  }

  function redo() {
    if (restoring || redoStack.length === 0) return false;
    const target = redoStack.pop();
    if (history.at(-1) !== target) history.push(target);
    if (history.length > HISTORY_LIMIT) history.shift();
    syncUi();
    return restoreText(target);
  }

  function onKeyDown(event) {
    if (isTyping(event.target) || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && event.shiftKey) {
      if (redo()) event.preventDefault();
      return;
    }
    if (key === 'y') {
      if (redo()) event.preventDefault();
      return;
    }
    if (key === 'z') {
      if (undo()) event.preventDefault();
    }
  }

  function onToastMutation() {
    if (!restoring) return;
    const text = toastNode?.textContent?.trim();
    if (text === 'Scene JSON yüklendi.' || text === 'Scene JSON yüklenemedi.') finishRestore();
  }

  function startObserversWhenBootClean() {
    if (disposed) return;
    const liveReady = Boolean(window.__WESTEROS_EDITOR_LIVE_AUTHORING__);
    const demoPresent = api.editableObjects.some(isBootDemo);
    if ((!liveReady || demoPresent) && bootFrame < 180) {
      bootFrame += 1;
      requestAnimationFrame(startObserversWhenBootClean);
      return;
    }
    observersStarted = true;
    pushSnapshot(serializeText());
    hierarchyObserver.observe(renderStatus, { childList: true, characterData: true, subtree: true });
    for (const id of ['we-name','we-pos-x','we-pos-y','we-pos-z','we-rot-x','we-rot-y','we-rot-z','we-scale-x','we-scale-y','we-scale-z']) {
      listen(document.getElementById(id), 'change', scheduleCapture);
    }
    const transform = window.__WESTEROS_EDITOR_TRANSFORM__?.transform;
    if (transform) listen(transform, 'dragging-changed', (event) => { if (!event.value) scheduleCapture(); });
    syncUi();
  }

  function getSnapshot() {
    return Object.freeze({
      historyDepth: history.length,
      redoDepth: redoStack.length,
      restoring,
      observersStarted,
      limit: HISTORY_LIMIT
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    hierarchyObserver.disconnect();
    toastObserver.disconnect();
    removers.splice(0).reverse().forEach((remove) => remove());
    window.clearTimeout(captureTimer);
    window.clearTimeout(restoreTimer);
    ui.group.remove();
    ui.style.remove();
    if (window.__WESTEROS_EDITOR_HISTORY__ === surface) delete window.__WESTEROS_EDITOR_HISTORY__;
  }

  const hierarchyObserver = new MutationObserver(scheduleCapture);
  const toastObserver = new MutationObserver(onToastMutation);
  if (toastNode) toastObserver.observe(toastNode, { childList: true, characterData: true, subtree: true });
  listen(ui.undo, 'click', undo);
  listen(ui.redo, 'click', redo);
  listen(window, 'keydown', onKeyDown);
  listen(window, 'pagehide', dispose, { once: true });

  const surface = Object.freeze({ undo, redo, captureNow, scheduleCapture, getSnapshot, dispose });
  window.__WESTEROS_EDITOR_HISTORY__ = surface;
  requestAnimationFrame(startObserversWhenBootClean);
  syncUi();
  return surface;
}

const api = window.__WESTEROS_WORLD_EDITOR__;
if (api) {
  try { installEditorHistoryController(api); }
  catch (error) { console.error('[EditorHistoryController] boot failed', error); }
}
