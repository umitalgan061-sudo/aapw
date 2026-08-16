import * as THREE from 'three';
import { PALETTES, PALETTE_FAMILIES, findPalette } from '../materials/palettes.js';
import { getPaletteMaterial } from '../materials/textureFactory.js';
import { matchPalette } from '../materials/textureMatcher.js';
import { surveyParts } from '../materials/meshPartClassifier.js';
import { kitForPalette, resolveKit } from '../materials/figureKits.js';
import { createLayeredMaterial, meshHeightRange, MAX_BANDS } from '../materials/layeredMaterial.js';
import { hashString } from '../materials/textureCore.js';
import { autoTextureObject, describeFigure, restoreOriginalMaterials } from './EditorAutoTexture.js';
import { findEditorAsset } from './editorAssetLibrary.js';

const api = window.__WESTEROS_WORLD_EDITOR__;
if (!api?.scene || !api?.camera || !api?.renderer) {
  console.warn('[EditorMaterialStudio] World Editor API unavailable.');
} else {
  installMaterialStudio(api);
}

function installMaterialStudio(editor) {
  const paletteList = Object.values(PALETTES);
  const inspector = document.getElementById('we-inspector');
  const viewport = document.querySelector('.we-viewport-wrap');
  if (!inspector || !viewport) return;

  const studio = document.createElement('section');
  studio.id = 'we-material-studio';
  studio.className = 'we-material-studio';
  studio.innerHTML = `
    <div class="we-section-title we-material-title"><span>MATERIAL STUDIO</span><span class="we-pro-badge">PRO</span></div>
    <div id="we-material-summary" class="we-material-summary">Bir obje seçildiğinde materyal yapısı burada görünür.</div>
    <div class="we-material-actions">
      <button id="we-material-auto" type="button">Akıllı Çoklu Doku</button>
      <button id="we-material-restore" type="button">Özgün Materyal</button>
    </div>
    <div class="we-material-settings">
      <label>Kalite
        <select id="we-material-size" class="we-input">
          <option value="128">128 · Mobil</option>
          <option value="256" selected>256 · Dengeli</option>
          <option value="512">512 · Hero</option>
        </select>
      </label>
      <label>Ana palet
        <select id="we-material-base" class="we-input"></select>
      </label>
    </div>
    <div class="we-material-tabs" role="tablist" aria-label="Materyal düzenleme modu">
      <button type="button" class="is-active" data-material-tab="surfaces">Yüzeyler</button>
      <button type="button" data-material-tab="layers">Katmanlar</button>
      <button type="button" data-material-tab="library">Doku Kütüphanesi</button>
    </div>
    <div class="we-material-tab is-active" data-material-panel="surfaces">
      <div class="we-material-help">Her mesh/material slotuna ayrı doku atayabilirsin. Bu mod mevcut material slotu sayısı kadar yüzeyi destekler.</div>
      <div id="we-material-surfaces" class="we-material-surfaces"></div>
    </div>
    <div class="we-material-tab" data-material-panel="layers">
      <div class="we-material-help">Tek mesh / tek materyalli figürler için mobil-güvenli çoklu doku katmanı. İnsan gibi modellerde çizme, pantolon, kemer, üst giysi, ten ve saç aynı mesh üzerinde ayrı görünür.</div>
      <label class="we-material-target-label">Hedef mesh <select id="we-material-layer-target" class="we-input"></select></label>
      <div id="we-material-layers" class="we-material-layers"></div>
      <div class="we-material-actions">
        <button id="we-material-suggest-layers" type="button">Akıllı Katman Öner</button>
        <button id="we-material-add-layer" type="button">+ Katman</button>
        <button id="we-material-apply-layers" type="button">Katmanları Uygula</button>
      </div>
      <div id="we-material-layer-note" class="we-material-note"></div>
    </div>
    <div class="we-material-tab" data-material-panel="library">
      <div class="we-material-library-tools">
        <input id="we-material-search" class="we-input" type="search" placeholder="Doku ara…" autocomplete="off">
        <select id="we-material-family" class="we-input"></select>
      </div>
      <div id="we-material-library" class="we-material-library"></div>
    </div>
    <div id="we-material-quality" class="we-material-quality"></div>`;
  inspector.append(studio);

  const viewportTools = document.createElement('div');
  viewportTools.className = 'we-pro-viewport-tools';
  viewportTools.innerHTML = `
    <button type="button" data-view="perspective" title="Perspektif">Persp</button>
    <button type="button" data-view="top" title="Tam tepeden">Top</button>
    <button type="button" data-view="front" title="Önden">Front</button>
    <button type="button" data-view="right" title="Sağdan">Right</button>
    <span class="we-pro-divider"></span>
    <span id="we-pro-render-info">—</span>`;
  viewport.append(viewportTools);

  const $ = (id) => document.getElementById(id);
  const els = {
    summary: $('we-material-summary'), size: $('we-material-size'), base: $('we-material-base'),
    surfaces: $('we-material-surfaces'), layerTarget: $('we-material-layer-target'),
    layers: $('we-material-layers'), layerNote: $('we-material-layer-note'), quality: $('we-material-quality'),
    search: $('we-material-search'), family: $('we-material-family'), library: $('we-material-library')
  };

  fillPaletteSelect(els.base, paletteList);
  els.family.append(new Option('Tüm aileler', ''));
  for (const family of PALETTE_FAMILIES) els.family.append(new Option(family, family));

  let selected = null;
  let activePaletteId = paletteList[0]?.id || '';
  let layerDraft = [];
  let pendingLoadRecipes = new Map();
  let selectionTimer = 0;

  editor.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  editor.renderer.toneMappingExposure = 1.05;
  editor.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  document.querySelectorAll('[data-material-tab]').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.materialTab));
  });
  viewportTools.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });

  $('we-material-auto').addEventListener('click', () => {
    if (!selected || selected.isInstancedMesh) return;
    const paletteId = els.base.value || undefined;
    const size = Number(els.size.value) || 256;
    const result = autoTextureObject(selected, { lookupAsset: findEditorAsset, paletteId, size });
    if (!result.ok) return setQuality(result.error, 'warn');
    selected.userData.editorMaterialRecipe = {
      version: 1, mode: 'auto', basePaletteId: result.paletteId,
      textureSize: size
    };
    activePaletteId = result.paletteId;
    refreshSelected(true);
    setQuality(`${result.label}: ${result.meshes} yüzey çoklu doku sistemiyle güncellendi.`, 'ok');
  });

  $('we-material-restore').addEventListener('click', () => {
    if (!selected || selected.isInstancedMesh) return;
    const restored = restoreOriginalMaterials(selected);
    delete selected.userData.editorMaterialRecipe;
    refreshSelected(true);
    setQuality(restored ? `${restored} mesh özgün materyaline döndürüldü.` : 'Geri alınacak editör materyali yok.', restored ? 'ok' : 'warn');
  });

  els.size.addEventListener('change', () => {
    if (!selected) return;
    const recipe = cloneRecipe(selected.userData.editorMaterialRecipe);
    if (!recipe) return;
    recipe.textureSize = Number(els.size.value) || 256;
    applyRecipe(selected, recipe);
    refreshSelected(true);
  });

  els.base.addEventListener('change', () => {
    activePaletteId = els.base.value;
    renderLibrary();
  });
  els.search.addEventListener('input', renderLibrary);
  els.family.addEventListener('change', renderLibrary);

  $('we-material-suggest-layers').addEventListener('click', suggestLayers);
  $('we-material-add-layer').addEventListener('click', () => {
    if (layerDraft.length >= MAX_BANDS) return;
    const lastTo = layerDraft.at(-1)?.to ?? 0;
    const remaining = Math.max(0.05, 1 - lastTo);
    layerDraft.push({ to: Math.min(1, lastTo + remaining), palette: activePaletteId || els.base.value });
    normalizeLayerEnds();
    renderLayers();
  });
  $('we-material-apply-layers').addEventListener('click', applyLayerDraft);

  document.getElementById('we-auto-texture')?.addEventListener('click', () => queueMicrotask(captureToolbarAuto));
  document.getElementById('we-restore-texture')?.addEventListener('click', () => queueMicrotask(() => {
    const object = editor.getSelectedObject?.();
    if (object) delete object.userData.editorMaterialRecipe;
  }));
  document.getElementById('we-auto-texture-all')?.addEventListener('click', () => queueMicrotask(() => {
    for (const object of editor.editableObjects || []) captureAutoRecipe(object);
  }));

  const loadInput = document.getElementById('we-load-file');
  loadInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      pendingLoadRecipes = new Map((data.objects || []).filter((record) => record?.materialRecipe).map((record) => [record.id, record.materialRecipe]));
      if (pendingLoadRecipes.size) restorePendingRecipes(0);
    } catch (error) {
      console.warn('[EditorMaterialStudio] material recipe restore skipped', error);
    }
  }, true);

  function switchTab(name) {
    studio.querySelectorAll('[data-material-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.materialTab === name));
    studio.querySelectorAll('[data-material-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.materialPanel === name));
  }

  function setView(mode) {
    const target = editor.orbitControls?.target?.clone() || new THREE.Vector3();
    const distance = Math.max(30, editor.camera.position.distanceTo(target));
    editor.camera.up.set(0, 1, 0);
    if (mode === 'top') {
      editor.camera.up.set(0, 0, -1);
      editor.camera.position.copy(target).add(new THREE.Vector3(0, distance, 0.001));
    } else if (mode === 'front') editor.camera.position.copy(target).add(new THREE.Vector3(0, distance * 0.18, distance));
    else if (mode === 'right') editor.camera.position.copy(target).add(new THREE.Vector3(distance, distance * 0.18, 0));
    else editor.camera.position.copy(target).add(new THREE.Vector3(distance * 0.72, distance * 0.5, distance * 0.72));
    editor.camera.lookAt(target);
    editor.orbitControls?.update();
  }

  function captureToolbarAuto() {
    const object = editor.getSelectedObject?.();
    if (object) captureAutoRecipe(object);
    refreshSelected(true);
  }

  function captureAutoRecipe(object) {
    const paletteId = object?.userData?.autoTexturePaletteId;
    if (!paletteId) return;
    object.userData.editorMaterialRecipe = { version: 1, mode: 'auto', basePaletteId: paletteId, textureSize: 256 };
  }

  function refreshSelected(force = false) {
    const next = editor.getSelectedObject?.() || null;
    if (!force && next === selected) return;
    selected = next;
    if (!selected || selected.isInstancedMesh) {
      els.summary.textContent = selected?.isInstancedMesh ? 'Instance grupları ortak materyal kullanır; tekil Material Studio düzenlemesi kapalı.' : 'Bir obje seçildiğinde materyal yapısı burada görünür.';
      els.surfaces.replaceChildren();
      els.layerTarget.replaceChildren();
      els.layers.replaceChildren();
      return;
    }

    const recipe = selected.userData.editorMaterialRecipe || null;
    const match = matchPalette(describeFigure(selected, findEditorAsset));
    const paletteId = recipe?.basePaletteId || selected.userData.autoTexturePaletteId || match.paletteId;
    if (findPalette(paletteId)) {
      els.base.value = paletteId;
      activePaletteId = paletteId;
    }
    els.size.value = String(recipe?.textureSize || 256);
    const meshes = collectMeshes(selected);
    const surfaces = buildSurfaces(selected, meshes);
    const uvMeshes = meshes.filter((mesh) => mesh.geometry?.attributes?.uv).length;
    const named = surfaces.filter((surface) => surface.slot).length;
    els.summary.innerHTML = `<strong>${escapeHtml(selected.name || 'Adsız obje')}</strong><span>${meshes.length} mesh · ${surfaces.length} material yüzeyi · ${named} tanınan parça · ${uvMeshes}/${meshes.length} UV</span>`;
    renderSurfaces(meshes, surfaces, recipe);
    renderLayerTargets(meshes, recipe);
    if (recipe?.mode === 'layers' && Array.isArray(recipe.layers)) layerDraft = cloneRecipe(recipe.layers) || [];
    else suggestLayers(false);
    renderLayers();
    renderLibrary();
    const warnings = [];
    if (uvMeshes < meshes.length) warnings.push(`${meshes.length - uvMeshes} mesh UV taşımıyor`);
    if (!named && meshes.length > 1) warnings.push('parça adları sınıflandırılamadı');
    setQuality(warnings.length ? warnings.join(' · ') : 'Materyal yapısı düzenlemeye hazır.', warnings.length ? 'warn' : 'ok');
  }

  function renderSurfaces(meshes, surfaces, recipe) {
    els.surfaces.replaceChildren();
    if (!surfaces.length) {
      els.surfaces.textContent = 'Bu objede düzenlenebilir mesh/material yüzeyi bulunamadı.';
      return;
    }
    surfaces.forEach((surface) => {
      const row = document.createElement('div');
      row.className = 'we-material-surface-row';
      const info = document.createElement('div');
      info.className = 'we-material-surface-info';
      const title = document.createElement('strong');
      title.textContent = surface.mesh.name || `Mesh ${surface.meshIndex + 1}`;
      const meta = document.createElement('span');
      meta.textContent = `${surface.slot ? `Parça: ${surface.slot}` : 'Genel yüzey'} · slot ${surface.materialIndex + 1}${surface.materialName ? ` · ${surface.materialName}` : ''}`;
      info.append(title, meta);
      const select = document.createElement('select');
      select.className = 'we-input';
      fillPaletteSelect(select, paletteList);
      const current = recipe?.surfaceOverrides?.[surface.key] || surface.material?.userData?.paletteId || els.base.value;
      if (findPalette(current)) select.value = current;
      select.addEventListener('change', () => {
        const nextRecipe = recipeForSurfaceEdit(selected, selected.userData.editorMaterialRecipe);
        nextRecipe.textureSize = Number(els.size.value) || 256;
        nextRecipe.surfaceOverrides[surface.key] = select.value;
        nextRecipe.basePaletteId = els.base.value;
        applyRecipe(selected, nextRecipe);
        activePaletteId = select.value;
        setQuality(`${title.textContent}: ${findPalette(select.value)?.label || select.value} uygulandı.`, 'ok');
        renderLibrary();
      });
      row.append(info, select);
      els.surfaces.append(row);
    });
  }

  function renderLayerTargets(meshes, recipe) {
    els.layerTarget.replaceChildren();
    meshes.forEach((mesh, index) => els.layerTarget.append(new Option(mesh.name || `Mesh ${index + 1}`, String(index))));
    const target = Number(recipe?.targetMeshIndex);
    els.layerTarget.value = String(Number.isInteger(target) && target >= 0 && target < meshes.length ? target : 0);
  }

  function suggestLayers(render = true) {
    if (!selected) return;
    const match = matchPalette(describeFigure(selected, findEditorAsset));
    const palette = findPalette(els.base.value || match.paletteId);
    const kit = kitForPalette(palette);
    if (!kit?.bands?.length) {
      if (render) setQuality('Bu asset için hazır katman reçetesi yok. Yüzeyler sekmesinden material slotlarını ayrı ayrı düzenleyebilirsin.', 'warn');
      layerDraft = [];
      if (render) renderLayers();
      return;
    }
    const seed = hashString(`${selected.userData.editorId || selected.name}|material-studio`);
    layerDraft = resolveKit(kit, seed).bands.slice(0, MAX_BANDS).map((band) => ({ to: band.to, palette: band.palette }));
    if (render) renderLayers();
  }

  function renderLayers() {
    els.layers.replaceChildren();
    layerDraft.forEach((band, index) => {
      const row = document.createElement('div');
      row.className = 'we-material-layer-row';
      const number = document.createElement('span');
      number.textContent = `${index + 1}`;
      const end = document.createElement('input');
      end.className = 'we-number';
      end.type = 'number'; end.min = '1'; end.max = '100'; end.step = '1'; end.value = String(Math.round(band.to * 100));
      const select = document.createElement('select');
      select.className = 'we-input';
      fillPaletteSelect(select, paletteList);
      if (findPalette(band.palette)) select.value = band.palette;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×'; remove.title = 'Katmanı kaldır';
      end.addEventListener('change', () => { band.to = THREE.MathUtils.clamp(Number(end.value) / 100 || 1, 0.01, 1); normalizeLayerEnds(); renderLayers(); });
      select.addEventListener('change', () => { band.palette = select.value; activePaletteId = select.value; renderLibrary(); });
      remove.addEventListener('click', () => { layerDraft.splice(index, 1); normalizeLayerEnds(); renderLayers(); });
      row.append(number, end, select, remove);
      els.layers.append(row);
    });
    els.layerNote.textContent = layerDraft.length ? `${layerDraft.length}/${MAX_BANDS} katman · “Bitiş %” mesh yüksekliği içindeki sınırdır.` : 'Katman yok. Akıllı öneriyi kullan veya + Katman ile oluştur.';
  }

  function normalizeLayerEnds() {
    layerDraft.sort((a, b) => a.to - b.to);
    if (layerDraft.length) layerDraft[layerDraft.length - 1].to = 1;
  }

  function applyLayerDraft() {
    if (!selected || !layerDraft.length) return setQuality('Önce en az bir katman oluştur.', 'warn');
    normalizeLayerEnds();
    const recipe = {
      version: 1, mode: 'layers', basePaletteId: els.base.value,
      textureSize: Number(els.size.value) || 256,
      targetMeshIndex: Number(els.layerTarget.value) || 0,
      layers: layerDraft.map((band) => ({ to: band.to, palette: band.palette }))
    };
    const ok = applyRecipe(selected, recipe);
    setQuality(ok ? `${layerDraft.length} doku katmanı tek mesh üzerinde uygulandı.` : 'Katman materyali uygulanamadı; hedef mesh geometri/UV bilgilerini kontrol et.', ok ? 'ok' : 'warn');
    refreshSelected(true);
  }

  function renderLibrary() {
    const query = normalize(els.search.value);
    const family = els.family.value;
    const filtered = paletteList.filter((palette) => (!family || palette.family === family) && (!query || normalize(`${palette.label} ${palette.id} ${palette.family}`).includes(query)));
    els.library.replaceChildren();
    filtered.slice(0, 80).forEach((palette) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `we-material-chip${activePaletteId === palette.id ? ' is-active' : ''}`;
      const swatch = document.createElement('span');
      swatch.className = 'we-material-chip-swatch';
      swatch.style.background = `linear-gradient(135deg, ${hex(palette.light)} 0%, ${hex(palette.base)} 52%, ${hex(palette.dark)} 100%)`;
      const text = document.createElement('span');
      const strong = document.createElement('strong'); strong.textContent = palette.label;
      const small = document.createElement('small'); small.textContent = `${palette.family} · R ${palette.roughness.toFixed(2)} · M ${palette.metalness.toFixed(2)}`;
      text.append(strong, small);
      button.append(swatch, text);
      button.addEventListener('click', () => {
        activePaletteId = palette.id;
        els.base.value = palette.id;
        renderLibrary();
      });
      els.library.append(button);
    });
  }

  function applyRecipe(object, recipe) {
    if (!object || !recipe) return false;
    let ok = false;
    if (recipe.mode === 'auto') {
      ok = autoTextureObject(object, {
        lookupAsset: findEditorAsset,
        paletteId: recipe.basePaletteId,
        size: Number(recipe.textureSize) || 256
      }).ok;
    } else if (recipe.mode === 'surface') {
      ok = applySurfaceRecipe(object, recipe);
    } else if (recipe.mode === 'layers') {
      ok = applyLayerRecipe(object, recipe);
    }
    if (ok) object.userData.editorMaterialRecipe = cloneRecipe(recipe);
    return ok;
  }

  function applySurfaceRecipe(object, recipe) {
    const meshes = collectMeshes(object);
    const surfaces = buildSurfaces(object, meshes);
    const size = Number(recipe.textureSize) || 256;
    let applied = 0;
    const pending = new Map();
    for (const surface of surfaces) {
      const paletteId = recipe.surfaceOverrides?.[surface.key];
      if (!findPalette(paletteId)) continue;
      if (!pending.has(surface.mesh)) pending.set(surface.mesh, Array.isArray(surface.mesh.material) ? [...surface.mesh.material] : [surface.mesh.material]);
      const material = getPaletteMaterial(paletteId, { size, variant: `${object.userData.editorId || object.name}:${surface.key}` });
      if (!material) continue;
      pending.get(surface.mesh)[surface.materialIndex] = material;
      applied += 1;
    }
    for (const [mesh, materials] of pending) {
      if (mesh.userData.originalMaterial === undefined) mesh.userData.originalMaterial = mesh.material;
      mesh.material = materials.length === 1 ? materials[0] : materials;
    }
    return applied > 0;
  }

  function applyLayerRecipe(object, recipe) {
    const meshes = collectMeshes(object);
    const mesh = meshes[Number(recipe.targetMeshIndex) || 0];
    const range = meshHeightRange(mesh);
    if (!mesh || !range || !Array.isArray(recipe.layers) || !recipe.layers.length) return false;
    const material = createLayeredMaterial({
      bands: recipe.layers.slice(0, MAX_BANDS), heightRange: range,
      variant: `${object.userData.editorId || object.name}:custom`, size: Math.min(512, Math.max(64, Number(recipe.textureSize) || 256))
    });
    if (!material) return false;
    if (mesh.userData.originalMaterial === undefined) mesh.userData.originalMaterial = mesh.material;
    mesh.material = material;
    return true;
  }

  function restorePendingRecipes(attempt) {
    window.setTimeout(() => {
      for (const object of editor.editableObjects || []) {
        const id = object.userData?.editorId;
        const recipe = pendingLoadRecipes.get(id);
        if (!recipe) continue;
        if (applyRecipe(object, recipe)) pendingLoadRecipes.delete(id);
      }
      if (pendingLoadRecipes.size && attempt < 24) restorePendingRecipes(attempt + 1);
      else refreshSelected(true);
    }, attempt === 0 ? 80 : 150);
  }

  function setQuality(message, state = '') {
    els.quality.textContent = message;
    els.quality.dataset.state = state;
  }

  function updateRenderInfo() {
    const info = editor.renderer.info?.render;
    const memory = editor.renderer.info?.memory;
    document.getElementById('we-pro-render-info').textContent = `${info?.triangles ?? 0} tri · ${info?.calls ?? 0} draw · ${memory?.textures ?? 0} tex`;
  }

  selectionTimer = window.setInterval(() => {
    refreshSelected();
    updateRenderInfo();
  }, 250);
  window.addEventListener('pagehide', () => window.clearInterval(selectionTimer), { once: true });
  refreshSelected(true);
  renderLibrary();
}

function collectMeshes(root) {
  const meshes = [];
  root?.traverse((child) => { if (child.isMesh && !child.isInstancedMesh) meshes.push(child); });
  return meshes;
}

function buildSurfaces(root, meshes) {
  const survey = surveyParts(root);
  return survey.map((surface) => {
    const meshIndex = meshes.indexOf(surface.mesh);
    const materials = Array.isArray(surface.mesh.material) ? surface.mesh.material : [surface.mesh.material];
    return {
      ...surface, meshIndex, key: `m${meshIndex}:s${surface.materialIndex}`,
      material: materials[surface.materialIndex] || null
    };
  }).filter((surface) => surface.meshIndex >= 0);
}

function recipeForSurfaceEdit(object, previous) {
  const recipe = previous?.mode === 'surface' ? cloneRecipe(previous) : {
    version: 1, mode: 'surface', basePaletteId: object.userData.autoTexturePaletteId || '', textureSize: 256, surfaceOverrides: {}
  };
  recipe.mode = 'surface';
  recipe.surfaceOverrides ||= {};
  return recipe;
}

function fillPaletteSelect(select, palettes) {
  select.replaceChildren();
  for (const family of PALETTE_FAMILIES) {
    const group = document.createElement('optgroup');
    group.label = family;
    for (const palette of palettes) if (palette.family === family) group.append(new Option(palette.label, palette.id));
    if (group.children.length) select.append(group);
  }
}

function cloneRecipe(value) {
  if (!value) return null;
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function normalize(value) {
  return String(value || '').toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function hex(value) {
  return `#${Number(value || 0).toString(16).padStart(6, '0').slice(-6)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}