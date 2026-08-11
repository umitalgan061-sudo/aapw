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

// Run262 additive terrain-elevation extension lives in this already-precached editor module so the
// existing offline shell remains complete without replacing any service-worker source line.
async function installRun262TerrainElevationBrush() {
  const api = window.__WESTEROS_WORLD_EDITOR__;
  const liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__;
  const terrainController = window.__WESTEROS_EDITOR_TERRAIN__;
  const liveAuthoring = window.__WESTEROS_EDITOR_LIVE_AUTHORING__;
  if (!api?.scene || !api?.canvas || !Array.isArray(api.editableObjects)) throw new Error('Run262 terrain elevation için World Editor API eksik.');
  if (!liveSurface?.liveState?.chunkManager || !liveSurface.liveState.groundCollider) throw new Error('Run262 terrain elevation için canlı terrain state gerekli.');
  if (!terrainController?.getMode || !terrainController?.getCellSize || !liveAuthoring?.surfacePointFromClient) throw new Error('Run262 terrain elevation için terrain controller/live authoring gerekli.');
  if (window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__) return window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__;

  const [{ default: THREE }, { snapEditorTerrainCell }] = await Promise.all([
    import('three'),
    import('./EditorTerrainCellModel.js')
  ]);
  const LAND_ASSET_ID = 'editor-land-cell';
  const WATER_ASSET_ID = 'editor-water-cell';
  const MIN_STRENGTH_METERS = 0.1;
  const MAX_STRENGTH_METERS = 20;
  const DEFAULT_STRENGTH_METERS = 1;
  const PENDING_PAINT_TTL_MS = 5000;
  const tools = document.getElementById('we-terrain-tools');
  if (!tools) throw new Error('Run262 terrain elevation araç grubu bulunamadı.');

  const label = document.createElement('label');
  label.className = 'we-terrain-size-label';
  label.textContent = 'Kot Δ ';
  const input = document.createElement('input');
  input.id = 'we-terrain-elevation-strength';
  input.className = 'we-number we-terrain-size';
  input.type = 'number';
  input.min = String(MIN_STRENGTH_METERS);
  input.max = String(MAX_STRENGTH_METERS);
  input.step = '0.1';
  input.value = String(DEFAULT_STRENGTH_METERS);
  input.inputMode = 'decimal';
  input.setAttribute('aria-label', 'Arazi fırçası kot değişimi metre');
  label.append(input, document.createTextNode(' m'));
  tools.append(label);

  const chunkManager = liveSurface.liveState.chunkManager;
  const groundCollider = liveSurface.liveState.groundCollider;
  const originalGetGroundHeight = groundCollider.getGroundHeight;
  const basePositions = new WeakMap();
  const removers = [];
  let activeStamps = Object.freeze([]);
  let pendingPaint = null;
  let observer = null;
  let applyTimer = 0;
  let disposed = false;

  function clampStrength(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_STRENGTH_METERS;
    return THREE.MathUtils.clamp(Math.abs(numeric), MIN_STRENGTH_METERS, MAX_STRENGTH_METERS);
  }
  function isTerrainCell(object) {
    const assetId = object?.userData?.editorAssetId;
    return assetId === LAND_ASSET_ID || assetId === WATER_ASSET_ID;
  }
  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  }
  function strengthMeters() {
    const value = clampStrength(input.value);
    input.value = String(value);
    return value;
  }
  function buildStamps() {
    return Object.freeze(api.editableObjects.filter(isTerrainCell).map((object) => Object.freeze({
      assetId: object.userData.editorAssetId,
      x: Number(object.position.x),
      z: Number(object.position.z),
      sizeX: Math.max(0.001, Math.abs(Number(object.scale.x) || 0)),
      sizeZ: Math.max(0.001, Math.abs(Number(object.scale.z) || 0)),
      strengthMeters: clampStrength(object.scale.y),
      direction: object.userData.editorAssetId === LAND_ASSET_ID ? 1 : -1
    })));
  }
  function sampleStamp(stamp, worldX, worldZ) {
    const dx = Math.abs(worldX - stamp.x);
    const dz = Math.abs(worldZ - stamp.z);
    if (dx >= stamp.sizeX || dz >= stamp.sizeZ) return 0;
    return stamp.direction * stamp.strengthMeters * (1 - dx / stamp.sizeX) * (1 - dz / stamp.sizeZ);
  }
  function sampleOffsetAt(worldX, worldZ) {
    let offset = 0;
    for (const stamp of activeStamps) offset += sampleStamp(stamp, worldX, worldZ);
    return offset;
  }
  function loadedMeshes() {
    return [...chunkManager.loaded.values()].filter((mesh) => mesh?.isMesh && mesh.geometry?.attributes?.position && mesh.parent === api.scene);
  }
  function baseArray(mesh) {
    const position = mesh.geometry.attributes.position;
    let base = basePositions.get(mesh.geometry);
    if (!base || base.length !== position.array.length) {
      base = new Float32Array(position.array);
      basePositions.set(mesh.geometry, base);
    }
    return base;
  }
  function applyMesh(mesh) {
    const position = mesh.geometry.attributes.position;
    const base = baseArray(mesh);
    for (let index = 0; index < position.count; index += 1) {
      const offset = index * 3;
      position.setY(index, base[offset + 1] + sampleOffsetAt(mesh.position.x + base[offset], mesh.position.z + base[offset + 2]));
    }
    position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
  function findPaintedCell(mode, cell) {
    const assetId = mode === 'land-add' ? LAND_ASSET_ID : WATER_ASSET_ID;
    return api.editableObjects.find((object) => object?.userData?.editorAssetId === assetId && Math.abs(object.position.x - cell.x) < 0.001 && Math.abs(object.position.z - cell.z) < 0.001 && Math.abs(Math.abs(object.scale.x) - cell.size) < 0.001 && Math.abs(Math.abs(object.scale.z) - cell.size) < 0.001) || null;
  }
  function applyPendingPaintStrength() {
    if (!pendingPaint) return false;
    if (performance.now() > pendingPaint.expiresAt) {
      pendingPaint = null;
      return false;
    }
    const object = findPaintedCell(pendingPaint.mode, pendingPaint.cell);
    if (!object) return false;
    object.scale.y = pendingPaint.strengthMeters;
    object.userData.editorTerrainElevationMeters = pendingPaint.mode === 'land-add' ? object.scale.y : -object.scale.y;
    object.updateMatrixWorld?.(true);
    api.writeInspector?.(object);
    pendingPaint = null;
    return true;
  }
  function syncLandMarkers() {
    for (const object of api.editableObjects) {
      if (object?.userData?.editorAssetId !== LAND_ASSET_ID) continue;
      const baseHeight = Number(originalGetGroundHeight.call(groundCollider, object.position.x, object.position.z));
      if (!Number.isFinite(baseHeight)) continue;
      object.position.y = baseHeight + sampleOffsetAt(object.position.x, object.position.z);
      object.updateMatrixWorld?.(true);
    }
  }
  function applyNow() {
    if (disposed) return Object.freeze({ stampCount: 0, chunkCount: 0 });
    applyPendingPaintStrength();
    activeStamps = buildStamps();
    const meshes = loadedMeshes();
    for (const mesh of meshes) applyMesh(mesh);
    syncLandMarkers();
    return Object.freeze({ stampCount: activeStamps.length, chunkCount: meshes.length });
  }
  function scheduleApply() {
    if (disposed) return;
    window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(applyNow, 0);
  }
  function onPointerDown(event) {
    if (event.target !== api.canvas || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    const mode = terrainController.getMode();
    if (mode !== 'land-add' && mode !== 'water-add') return;
    const point = liveAuthoring.surfacePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    pendingPaint = Object.freeze({
      mode,
      cell: snapEditorTerrainCell(point, terrainController.getCellSize()),
      strengthMeters: strengthMeters(),
      expiresAt: performance.now() + PENDING_PAINT_TTL_MS
    });
  }
  function onPointerUp(event) {
    if (event.button !== 0) return;
    if (applyPendingPaintStrength()) scheduleApply();
  }
  function onStrengthChange() {
    const selected = api.getSelectedObject?.();
    const strength = strengthMeters();
    if (!isTerrainCell(selected)) return;
    selected.scale.y = strength;
    selected.userData.editorTerrainElevationMeters = selected.userData.editorAssetId === LAND_ASSET_ID ? strength : -strength;
    selected.updateMatrixWorld?.(true);
    api.writeInspector?.(selected);
    api.refreshHierarchy?.();
    scheduleApply();
  }

  groundCollider.getGroundHeight = function run262ElevatedGroundHeight(worldX, worldZ) {
    const baseHeight = Number(originalGetGroundHeight.call(this, worldX, worldZ));
    return (Number.isFinite(baseHeight) ? baseHeight : 0) + sampleOffsetAt(worldX, worldZ);
  };
  const hierarchy = document.getElementById('we-hierarchy');
  observer = hierarchy ? new MutationObserver(scheduleApply) : null;
  observer?.observe(hierarchy, { childList: true, subtree: true, characterData: true });
  listen(document, 'pointerdown', onPointerDown, true);
  listen(api.canvas, 'pointerup', onPointerUp, true);
  listen(input, 'change', onStrengthChange);
  listen(api.orbitControls, 'end', scheduleApply);

  function getSnapshot() {
    return Object.freeze({
      stampCount: activeStamps.length,
      landStampCount: activeStamps.filter((stamp) => stamp.direction > 0).length,
      waterStampCount: activeStamps.filter((stamp) => stamp.direction < 0).length,
      strengthMeters: strengthMeters(),
      loadedTerrainChunkCount: loadedMeshes().length,
      groundColliderPatched: groundCollider.getGroundHeight !== originalGetGroundHeight,
      pendingPaint: Boolean(pendingPaint)
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(applyTimer);
    observer?.disconnect();
    removers.splice(0).reverse().forEach((remove) => remove());
    groundCollider.getGroundHeight = originalGetGroundHeight;
    activeStamps = Object.freeze([]);
    for (const mesh of loadedMeshes()) {
      const position = mesh.geometry.attributes.position;
      const base = basePositions.get(mesh.geometry);
      if (!base || base.length !== position.array.length) continue;
      position.array.set(base);
      position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
    label.remove();
    if (window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__ === surface) delete window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__;
  }
  const surface = Object.freeze({ applyNow, sampleOffsetAt, getStrengthMeters: strengthMeters, getSnapshot, dispose });
  window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__ = surface;
  applyNow();
  listen(window, 'pagehide', dispose, { once: true });
  return surface;
}

installRun262TerrainElevationBrush().catch((error) => {
  console.error('[EditorTerrainSemantics] Run262 terrain elevation boot failed', error);
});
