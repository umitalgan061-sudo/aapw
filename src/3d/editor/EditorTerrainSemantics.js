function terrainButton(mode) {
  return document.querySelector(`[data-terrain-mode="${mode}"]`);
}

export function installEditorTerrainSemantics(terrain = window.__WESTEROS_EDITOR_TERRAIN__) {
  if (!terrain?.setMode) throw new Error('Terrain semantics için terrain controller gerekli.');
  if (window.__WESTEROS_EDITOR_TERRAIN_SEMANTICS__) return window.__WESTEROS_EDITOR_TERRAIN_SEMANTICS__;

  const landRemove = terrainButton('land-remove');
  const waterRemove = terrainButton('water-remove');
  if (!landRemove || !waterRemove) throw new Error('Terrain dönüşüm butonları bulunamadı.');

  const previousLandLabel = landRemove.textContent;
  const previousWaterLabel = waterRemove.textContent;
  const removers = [];
  let semanticMode = null;
  let disposed = false;

  landRemove.textContent = 'Kara → Deniz';
  landRemove.title = 'Canlı kara yüzeyinin üstüne kalıcı su hücresi yerleştir';
  waterRemove.textContent = 'Deniz → Kara';
  waterRemove.title = 'Canlı deniz yüzeyinin üstüne kalıcı kara hücresi yerleştir';

  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  }

  function clearPressed() {
    if (semanticMode === 'land-to-water') landRemove.setAttribute('aria-pressed', 'false');
    if (semanticMode === 'water-to-land') waterRemove.setAttribute('aria-pressed', 'false');
    semanticMode = null;
  }

  function applyPressed(mode) {
    clearPressed();
    semanticMode = mode;
    landRemove.setAttribute('aria-pressed', String(mode === 'land-to-water'));
    waterRemove.setAttribute('aria-pressed', String(mode === 'water-to-land'));
    terrainButton('land-add')?.setAttribute('aria-pressed', 'false');
    terrainButton('water-add')?.setAttribute('aria-pressed', 'false');
  }

  function activateSemantic(event, semantic, underlyingMode) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const next = semanticMode === semantic ? null : semantic;
    if (!next) {
      terrain.setMode(null);
      clearPressed();
      return;
    }
    const activated = terrain.setMode(underlyingMode);
    if (activated !== false) applyPressed(semantic);
  }

  function onDocumentClick(event) {
    const target = event.target?.closest?.('[data-terrain-mode], #we-road-tools, #we-placement-tools');
    if (!target) return;
    if (target === landRemove) {
      activateSemantic(event, 'land-to-water', 'water-add');
      return;
    }
    if (target === waterRemove) {
      activateSemantic(event, 'water-to-land', 'land-add');
      return;
    }
    if (semanticMode) clearPressed();
  }

  function getSnapshot() {
    return Object.freeze({
      semanticMode,
      landRemoveLabel: landRemove.textContent,
      waterRemoveLabel: waterRemove.textContent
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    removers.splice(0).reverse().forEach((remove) => remove());
    clearPressed();
    landRemove.textContent = previousLandLabel;
    waterRemove.textContent = previousWaterLabel;
    landRemove.removeAttribute('title');
    waterRemove.removeAttribute('title');
    if (window.__WESTEROS_EDITOR_TERRAIN_SEMANTICS__ === surface) delete window.__WESTEROS_EDITOR_TERRAIN_SEMANTICS__;
  }

  listen(document, 'click', onDocumentClick, true);
  listen(window, 'pagehide', dispose, { once: true });

  const surface = Object.freeze({ getSnapshot, clear: () => { terrain.setMode(null); clearPressed(); }, dispose });
  window.__WESTEROS_EDITOR_TERRAIN_SEMANTICS__ = surface;
  return surface;
}

const terrain = window.__WESTEROS_EDITOR_TERRAIN__;
if (terrain) {
  try {
    installEditorTerrainSemantics(terrain);
  } catch (error) {
    console.error('[EditorTerrainSemantics] boot failed', error);
  }
}
