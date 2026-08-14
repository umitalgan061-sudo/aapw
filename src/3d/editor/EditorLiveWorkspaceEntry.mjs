import { serializeEditorScene, validateEditorScene } from './EditorSceneSerializer.js';
import { rehydrateInstanceGroups } from './EditorFormationRehydrator.js';

const BRIDGE_FALLBACK = 'http://127.0.0.1:4173';
const SUPPORTED_FORMATS = new Set(['fbx', 'glb', 'gltf']);
const VIEW_MODES = new Set(['edit', 'live', 'split']);
const VIEW_MODE_LABELS = Object.freeze({ edit: 'DÜZENLEME', live: 'CANLI OYUN', split: 'YAN YANA' });
const host = document.getElementById('we-live-host');
const bootStatus = document.getElementById('we-live-boot');

let childWindow = null;
let childDocument = null;
let api = null;
let bridgeBase = null;
let currentMode = 'edit';
let selectedAsset = null;
let assetCatalog = [];
let gamePreview = null;
let modeControls = null;
let catalogSection = null;
let saveStatus = null;
let style = null;
let surface = null;
let disposed = false;
let installStarted = false;
const removers = [];

function listen(target, type, handler, options) {
  target?.addEventListener?.(type, handler, options);
  removers.push(() => target?.removeEventListener?.(type, handler, options));
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForEditorApi(timeoutMs = 120000) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    childWindow = host?.contentWindow || window;
    childDocument = host?.contentDocument || document;
    api = childWindow?.__WESTEROS_WORLD_EDITOR__ || null;
    if (childDocument?.body && api?.scene && api?.editableObjects && api?.instanceManager && api?.getEditorState) return api;
    await wait(100);
  }
  throw new Error('Güncel World Editor API zamanında hazır olmadı.');
}

async function waitForAuthoring(timeoutMs = 30000) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const authoring = childWindow?.__WESTEROS_EDITOR_LIVE_AUTHORING__ || null;
    if (authoring?.placeAssetAtTarget && authoring?.createTerrainFormation) return authoring;
    await wait(100);
  }
  throw new Error('Canlı arazi yerleştirme katmanı henüz hazır değil.');
}

function extensionOf(file) {
  const match = String(file || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function assetIdForPath(file) {
  let hash = 2166136261;
  for (const character of String(file)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `manifest-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function humanName(file) {
  const name = String(file || '').split('/').pop()?.replace(/\.[^.]+$/, '') || 'Model';
  return name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function categoryFor(file) {
  const parts = String(file || '').split('/');
  const modelsIndex = parts.indexOf('models');
  const afterModels = modelsIndex >= 0 ? parts.slice(modelsIndex + 1) : [];
  if (afterModels[0] === 'settlements' && afterModels[1]) return afterModels[1];
  return afterModels[0] || 'models';
}

function normalizeManifestAsset(record) {
  const file = record?.file;
  const format = extensionOf(file);
  if (!String(file || '').startsWith('assets/models/') || !SUPPORTED_FORMATS.has(format)) return null;
  const descriptor = {
    id: record.id ? `manifest-${record.id}` : assetIdForPath(file),
    name: humanName(file),
    category: categoryFor(file),
    format,
    src: file,
    sizeBytes: null,
  };
  if (record.textures && format === 'fbx') descriptor.resourcePath = record.textures;
  return descriptor;
}

async function fetchJson(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function resolveBridge() {
  if (bridgeBase !== null) return bridgeBase;
  for (const candidate of [...new Set([window.location.origin, BRIDGE_FALLBACK])]) {
    try {
      const health = await fetchJson(`${candidate}/__editor/health`);
      if (health?.ok) {
        bridgeBase = candidate;
        return bridgeBase;
      }
    } catch {}
  }
  bridgeBase = '';
  return bridgeBase;
}

async function loadAssetCatalog() {
  const bridge = await resolveBridge();
  if (bridge) {
    const payload = await fetchJson(`${bridge}/__editor/models`);
    const models = Array.isArray(payload.models) ? payload.models : [];
    if (models.length) return { source: 'workspace', models };
  }
  const manifest = await fetchJson('./assets_manifest.json');
  const models = (Array.isArray(manifest.assets) ? manifest.assets : [])
    .map(normalizeManifestAsset)
    .filter(Boolean)
    .sort((a, b) => a.src.localeCompare(b.src, 'tr'));
  return { source: 'manifest', models };
}

function toast(message) {
  const target = childDocument?.getElementById('we-toast');
  if (!target) return;
  target.textContent = message;
  target.classList.add('is-visible');
  childWindow.setTimeout(() => target.classList.remove('is-visible'), 2200);
}

function installStyle() {
  style = childDocument.createElement('style');
  style.id = 'we-live-workspace-v2-style';
  style.textContent = `
    .we-viewport-wrap{position:relative!important;overflow:hidden!important}
    #we-live-game-preview-v2{position:absolute;z-index:20;inset:0;width:100%;height:100%;border:0;background:#05070a}
    #we-live-workspace-modes{position:absolute;right:10px;top:10px;z-index:60;display:flex;gap:5px;padding:5px;border:1px solid rgba(240,195,79,.5);border-radius:7px;background:rgba(11,15,22,.9);backdrop-filter:blur(8px)}
    #we-live-workspace-modes button{padding:6px 8px;font-size:10px;font-weight:800;letter-spacing:.06em}
    #we-live-workspace-modes button.is-active{border-color:var(--we-gold-2);color:var(--we-gold-2);background:#201a0b}
    body[data-we-live-workspace-mode="live"] #we-canvas{visibility:visible!important;pointer-events:none!important}
    body[data-we-live-workspace-mode="live"] #we-live-game-preview-v2{display:block}
    body[data-we-live-workspace-mode="edit"] #we-canvas{visibility:visible!important;width:100%!important;height:100%!important;pointer-events:auto!important}
    body[data-we-live-workspace-mode="edit"] #we-live-game-preview-v2{display:none}
    body[data-we-live-workspace-mode="split"] #we-canvas{visibility:visible!important;width:50%!important;height:100%!important;right:auto!important;pointer-events:auto!important}
    body[data-we-live-workspace-mode="split"] #we-live-game-preview-v2{display:block;left:50%;width:50%}
    #we-live-workspace-catalog{margin-top:10px;padding-top:10px;border-top:1px solid var(--we-border,rgba(255,255,255,.12))}
    #we-live-workspace-catalog .we-live-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;margin-top:4px}
    #we-live-workspace-catalog .we-live-row button:first-child{min-width:0;text-align:left;display:grid;gap:2px}
    #we-live-workspace-catalog .we-live-row strong,#we-live-workspace-catalog .we-live-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #we-live-workspace-catalog .we-live-row span{font-size:10px;color:var(--we-muted,#a6adbb)}
    #we-live-workspace-catalog .we-live-row button.is-selected{border-color:var(--we-gold,#d5ad4c);box-shadow:inset 3px 0 0 var(--we-gold,#d5ad4c)}
    #we-live-workspace-catalog-list{max-height:280px;overflow:auto;margin-top:6px}
    #we-live-workspace-save-state{display:inline-flex;align-items:center;gap:5px;color:var(--we-muted,#a6adbb);font-size:11px}
    #we-live-workspace-save-state::before{content:'';width:7px;height:7px;border-radius:50%;background:#8b6b20}
    #we-live-workspace-save-state[data-connected="true"]::before{background:#4aa96c}
    @media(max-width:640px){#we-live-workspace-modes{right:5px;top:5px;max-width:calc(100% - 10px);overflow:auto}#we-live-workspace-modes button{min-height:38px}#we-live-workspace-modes button[data-mode="split"]{display:none}#we-live-workspace-catalog-list{max-height:190px}}
  `;
  childDocument.head.append(style);
}

function setMode(mode) {
  if (!VIEW_MODES.has(mode) || !childDocument?.body) return false;
  currentMode = mode;
  childDocument.body.dataset.weLiveWorkspaceMode = mode;
  modeControls?.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.mode === mode));
  const badge = childDocument.querySelector('.we-viewport-badge');
  if (badge) badge.textContent = mode === 'edit' ? 'EDIT MODE · LIVE WORLD' : `${VIEW_MODE_LABELS[mode]} · GAME3D`;
  childWindow.dispatchEvent(new Event('resize'));
  return true;
}

function installGamePreview() {
  const viewport = childDocument.querySelector('.we-viewport-wrap');
  if (!viewport) throw new Error('Editör viewport bulunamadı.');
  gamePreview = childDocument.createElement('iframe');
  gamePreview.id = 'we-live-game-preview-v2';
  gamePreview.title = 'Mevcut Westeros 3D oyununun canlı görünümü';
  gamePreview.src = './game3d.html?editorPreview=1';
  gamePreview.allow = 'fullscreen';
  viewport.prepend(gamePreview);

  modeControls = childDocument.createElement('div');
  modeControls.id = 'we-live-workspace-modes';
  modeControls.setAttribute('role', 'group');
  modeControls.setAttribute('aria-label', 'Editör görünüm modu');
  for (const mode of ['edit', 'live', 'split']) {
    const button = childDocument.createElement('button');
    button.type = 'button';
    button.dataset.mode = mode;
    button.textContent = VIEW_MODE_LABELS[mode];
    listen(button, 'click', () => setMode(mode));
    modeControls.append(button);
  }
  viewport.append(modeControls);
  setMode(host ? 'live' : 'edit');
}

function bytesLabel(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.ceil(value / 1024)} KB`;
}

function renderCatalog() {
  const list = catalogSection?.querySelector('#we-live-workspace-catalog-list');
  const search = catalogSection?.querySelector('#we-live-workspace-search');
  if (!list || !search) return;
  const query = search.value.trim().toLocaleLowerCase('tr-TR');
  const filtered = assetCatalog.filter((asset) => !query || `${asset.name} ${asset.category} ${asset.src}`.toLocaleLowerCase('tr-TR').includes(query));
  list.replaceChildren();
  for (const asset of filtered.slice(0, 1000)) {
    const row = childDocument.createElement('div');
    row.className = 'we-live-row';
    const select = childDocument.createElement('button');
    select.type = 'button';
    select.className = selectedAsset?.id === asset.id ? 'is-selected' : '';
    const strong = childDocument.createElement('strong');
    strong.textContent = asset.name;
    const meta = childDocument.createElement('span');
    const size = bytesLabel(asset.sizeBytes);
    meta.textContent = `${asset.category} · ${asset.format.toUpperCase()}${size ? ` · ${size}` : ''} · ${asset.src}`;
    select.append(strong, meta);
    listen(select, 'click', () => { selectedAsset = asset; renderCatalog(); });
    listen(select, 'dblclick', () => void placeAsset(asset));
    const add = childDocument.createElement('button');
    add.type = 'button';
    add.textContent = '+';
    add.title = `${asset.name} sahneye ekle`;
    add.setAttribute('aria-label', `${asset.name} sahneye ekle`);
    listen(add, 'click', () => void placeAsset(asset));
    row.append(select, add);
    list.append(row);
  }
  const status = catalogSection.querySelector('#we-live-workspace-catalog-status');
  if (status) status.textContent = `${filtered.length}/${assetCatalog.length} model gösteriliyor`;
}

async function placeAsset(asset) {
  if (!asset) return null;
  selectedAsset = asset;
  renderCatalog();
  try {
    const authoring = await waitForAuthoring();
    const object = await authoring.placeAssetAtTarget(asset);
    if (object) setMode('edit');
    return object;
  } catch (error) {
    console.error('[EditorLiveWorkspaceEntry] asset placement failed', error);
    toast(`${asset.name} yerleştirilemedi: ${error.message}`);
    return null;
  }
}

async function installCatalog() {
  const panel = childDocument.querySelector('.we-assets-panel');
  const formation = panel?.querySelector('.we-formation');
  if (!panel) throw new Error('Asset paneli bulunamadı.');
  catalogSection = childDocument.createElement('section');
  catalogSection.id = 'we-live-workspace-catalog';
  catalogSection.innerHTML = '<div class="we-section-title">TÜM PROJE MODELLERİ</div><input id="we-live-workspace-search" class="we-input" type="search" placeholder="FBX / GLB / GLTF ara…" autocomplete="off"><div id="we-live-workspace-catalog-status" class="we-muted">Model kataloğu taranıyor…</div><div id="we-live-workspace-catalog-list"></div>';
  if (formation) panel.insertBefore(catalogSection, formation);
  else panel.append(catalogSection);
  listen(catalogSection.querySelector('#we-live-workspace-search'), 'input', renderCatalog);
  const result = await loadAssetCatalog();
  assetCatalog = result.models;
  const status = catalogSection.querySelector('#we-live-workspace-catalog-status');
  if (status) status.textContent = `${assetCatalog.length} model · ${result.source === 'workspace' ? 'repo dosya sisteminden canlı tarama' : 'assets_manifest yedeği'}`;
  renderCatalog();
}

function currentScene() {
  return validateEditorScene(serializeEditorScene(api.editableObjects, api.instanceManager.serialize(), api.getEditorState()));
}

function downloadScene(scene) {
  const blob = new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'westeros-world.scene.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

async function saveToWorkspace() {
  const scene = currentScene();
  const bridge = await resolveBridge();
  if (!bridge) {
    downloadScene(scene);
    if (saveStatus) {
      saveStatus.dataset.connected = 'false';
      saveStatus.textContent = 'Köprü yok · JSON indirildi';
    }
    toast('Yerel repo köprüsü yok; JSON indirildi.');
    return { ok: false, downloaded: true };
  }
  const result = await fetchJson(`${bridge}/__editor/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene }),
  });
  if (!result.ok) throw new Error(result.error || 'Kayıt başarısız.');
  if (saveStatus) {
    saveStatus.dataset.connected = 'true';
    saveStatus.textContent = `Koda kaydedildi · ${result.revision.slice(0, 8)}`;
  }
  toast(`Repo içine kaydedildi: ${result.revisionFile}`);
  return result;
}

function installSaveBridge() {
  const toolbar = childDocument.querySelector('.we-toolbar-actions');
  const gameLink = toolbar?.querySelector('.we-link');
  if (!toolbar || !gameLink) throw new Error('Editör toolbar hedefi bulunamadı.');
  const button = childDocument.createElement('button');
  button.id = 'we-save-to-code';
  button.type = 'button';
  button.textContent = 'Koda Kaydet';
  button.title = 'Scene revizyonunu repo içindeki scenes/editor-live klasörüne yaz';
  toolbar.insertBefore(button, gameLink);
  removers.push(() => button.remove());
  saveStatus = childDocument.createElement('span');
  saveStatus.id = 'we-live-workspace-save-state';
  saveStatus.dataset.connected = 'false';
  saveStatus.textContent = 'Repo köprüsü aranıyor';
  childDocument.querySelector('.we-statusbar')?.append(saveStatus);
  listen(button, 'click', () => saveToWorkspace().catch((error) => {
    console.error('[EditorLiveWorkspaceEntry] workspace save failed', error);
    if (saveStatus) {
      saveStatus.dataset.connected = 'false';
      saveStatus.textContent = 'Kayıt başarısız';
    }
    toast(`Kayıt başarısız: ${error.message}`);
  }));
  resolveBridge().then((bridge) => {
    if (!saveStatus) return;
    saveStatus.dataset.connected = String(Boolean(bridge));
    saveStatus.textContent = bridge ? 'Yerel repo bağlantısı hazır' : 'Köprü yok · indirme modu';
  });
}

function assetForId(assetId) {
  return assetCatalog.find((asset) => asset.id === assetId) || null;
}

async function loadWorkspaceScene(data) {
  const validated = validateEditorScene(data);
  const authoring = await waitForAuthoring();
  api.instanceManager.clear();
  for (const object of [...api.editableObjects]) {
    api.scene.remove(object);
    const index = api.editableObjects.indexOf(object);
    if (index >= 0) api.editableObjects.splice(index, 1);
  }
  for (const record of validated.objects) {
    const asset = assetForId(record.asset);
    if (!asset) continue;
    const object = await authoring.placeAssetAtTarget(asset);
    if (!object) continue;
    object.userData.editorId = record.id;
    object.name = record.name;
    object.position.set(...record.transform.position);
    object.rotation.set(...record.transform.rotation);
    object.scale.set(...record.transform.scale);
    object.updateMatrixWorld(true);
  }
  await rehydrateInstanceGroups(validated.instanceGroups, api.instanceManager, assetForId);
  const snapToggle = childDocument.getElementById('we-snap-toggle');
  const snapSize = childDocument.getElementById('we-snap-size');
  if (snapToggle) snapToggle.checked = validated.editor?.snapEnabled !== false;
  if (snapSize) snapSize.value = Number(validated.editor?.snapSize) || 1;
  api.grid.visible = false;
  api.refreshHierarchy();
  toast('Workspace scene tüm proje assetleriyle yüklendi.');
  return validated;
}

function installExtendedLoad() {
  const input = childDocument.getElementById('we-load-file');
  if (!input) return;
  listen(input, 'change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.stopImmediatePropagation();
    file.text()
      .then((text) => JSON.parse(text))
      .then(loadWorkspaceScene)
      .catch((error) => {
        console.error('[EditorLiveWorkspaceEntry] workspace load failed', error);
        toast(`Scene yüklenemedi: ${error.message}`);
      })
      .finally(() => { event.target.value = ''; });
  }, true);
}

function installFormationBridge() {
  const button = childDocument.getElementById('we-create-formation');
  if (!button) return;
  listen(button, 'click', (event) => {
    if (!selectedAsset) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rows = Math.max(1, Math.min(100, Number(childDocument.getElementById('we-rows')?.value) || 1));
    const columns = Math.max(1, Math.min(100, Number(childDocument.getElementById('we-columns')?.value) || 1));
    const spacing = Math.max(0.25, Number(childDocument.getElementById('we-spacing')?.value) || 1.5);
    waitForAuthoring()
      .then((authoring) => authoring.createTerrainFormation(selectedAsset, rows, columns, spacing))
      .then(() => {
        setMode('edit');
        toast(`${rows * columns} instance oluşturuldu.`);
      })
      .catch((error) => {
        console.error('[EditorLiveWorkspaceEntry] formation failed', error);
        toast(error.message);
      });
  }, true);
}

function installKeyboard() {
  listen(childWindow, 'keydown', (event) => {
    const target = event.target;
    const typing = target instanceof childWindow.HTMLInputElement || target instanceof childWindow.HTMLTextAreaElement || target?.isContentEditable;
    if (typing || !event.ctrlKey || !event.shiftKey || event.code !== 'KeyL') return;
    event.preventDefault();
    setMode(currentMode === 'live' ? 'edit' : 'live');
  });
}

function dispose() {
  if (disposed) return;
  disposed = true;
  removers.splice(0).reverse().forEach((remove) => {
    try { remove(); } catch {}
  });
  gamePreview?.remove();
  modeControls?.remove();
  catalogSection?.remove();
  saveStatus?.remove();
  style?.remove();
  if (childDocument?.body) delete childDocument.body.dataset.weLiveWorkspaceMode;
  if (childWindow?.__WESTEROS_EDITOR_LIVE_WORKSPACE_V2__ === surface) delete childWindow.__WESTEROS_EDITOR_LIVE_WORKSPACE_V2__;
}

async function install() {
  await waitForEditorApi();
  installStyle();
  installGamePreview();
  installSaveBridge();
  installExtendedLoad();
  installFormationBridge();
  installKeyboard();
  await installCatalog();
  surface = Object.freeze({
    setMode,
    save: saveToWorkspace,
    loadSceneData: loadWorkspaceScene,
    getSnapshot: () => Object.freeze({
      disposed,
      currentMode,
      bridgeBase,
      catalogCount: assetCatalog.length,
      selectedAssetId: selectedAsset?.id || null,
      gamePreviewLoaded: Boolean(gamePreview?.isConnected),
      canonicalEditorLoaded: Boolean(api?.scene),
      authoringReady: Boolean(childWindow?.__WESTEROS_EDITOR_LIVE_AUTHORING__?.placeAssetAtTarget),
    }),
    dispose,
  });
  childWindow.__WESTEROS_EDITOR_LIVE_WORKSPACE_V2__ = surface;
  childDocument.body.dataset.editorLiveWorkspace = 'ready';
  document.body.dataset.ready = 'true';
  listen(window, 'pagehide', dispose, { once: true });
}

function startInstall() {
  if (installStarted) return;
  installStarted = true;
  install().catch((error) => {
    console.error('[EditorLiveWorkspaceEntry] live workspace boot failed', error);
    if (bootStatus) bootStatus.textContent = `Canlı World Editor başlatılamadı: ${error.message}`;
    document.body.dataset.bootError = error.message;
  });
}

if (host) {
  host.addEventListener('load', startInstall, { once: true });
  if (host.contentDocument?.readyState === 'complete') queueMicrotask(startInstall);
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startInstall, { once: true });
} else {
  queueMicrotask(startInstall);
}
