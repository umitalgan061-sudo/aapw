import * as THREE from 'three';
import { snapEditorTerrainCell } from './EditorTerrainCellModel.js';

const LAND_ASSET_ID = 'editor-land-cell';
const WATER_ASSET_ID = 'editor-water-cell';
const DEFAULT_STRENGTH_METERS = 1;
const MIN_STRENGTH_METERS = 0.1;
const MAX_STRENGTH_METERS = 20;
const APPLY_DELAY_MS = 0;
const PENDING_PAINT_TTL_MS = 5000;

function clampStrength(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_STRENGTH_METERS;
  return THREE.MathUtils.clamp(Math.abs(numeric), MIN_STRENGTH_METERS, MAX_STRENGTH_METERS);
}

function isTerrainCell(object) {
  const assetId = object?.userData?.editorAssetId;
  return assetId === LAND_ASSET_ID || assetId === WATER_ASSET_ID;
}

function createStrengthUi() {
  const group = document.getElementById('we-terrain-tools');
  if (!group) throw new Error('Terrain elevation strength UI için terrain araçları bulunamadı.');
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
  group.append(label);
  return Object.freeze({ label, input });
}

export function installEditorTerrainElevationBrush(
  api = window.__WESTEROS_WORLD_EDITOR__,
  liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__,
  terrain = window.__WESTEROS_EDITOR_TERRAIN__,
  liveAuthoring = window.__WESTEROS_EDITOR_LIVE_AUTHORING__
) {
  if (!api?.scene || !api?.canvas || !Array.isArray(api.editableObjects)) {
    throw new Error('Terrain elevation brush için World Editor API eksik.');
  }
  if (!liveSurface?.liveState?.chunkManager || !liveSurface.liveState.groundCollider) {
    throw new Error('Terrain elevation brush için canlı terrain/chunk state gerekli.');
  }
  if (!terrain?.getMode || !terrain?.getCellSize || !liveAuthoring?.surfacePointFromClient) {
    throw new Error('Terrain elevation brush için terrain controller/live authoring gerekli.');
  }
  if (window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__) return window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__;

  const ui = createStrengthUi();
  const chunkManager = liveSurface.liveState.chunkManager;
  const groundCollider = liveSurface.liveState.groundCollider;
  const originalGetGroundHeight = groundCollider.getGroundHeight;
  const basePositions = new WeakMap();
  const removers = [];
  let activeStamps = Object.freeze([]);
  let pendingPaint = null;
  let mutationObserver = null;
  let applyTimer = 0;
  let disposed = false;

  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  }

  function strengthMeters() {
    const value = clampStrength(ui.input.value);
    ui.input.value = String(value);
    return value;
  }

  function buildStamps() {
    return Object.freeze(api.editableObjects.filter(isTerrainCell).map((object) => Object.freeze({
      id: String(object.userData.editorId || object.uuid),
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
    const weightX = 1 - dx / stamp.sizeX;
    const weightZ = 1 - dz / stamp.sizeZ;
    return stamp.direction * stamp.strengthMeters * weightX * weightZ;
  }

  function sampleOffsetAt(worldX, worldZ) {
    let offset = 0;
    for (const stamp of activeStamps) offset += sampleStamp(stamp, worldX, worldZ);
    return offset;
  }

  function loadedTerrainMeshes() {
    return [...chunkManager.loaded.values()].filter((mesh) => mesh?.isMesh && mesh.geometry?.attributes?.position && mesh.parent === api.scene);
  }

  function basePositionArray(mesh) {
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
    const base = basePositionArray(mesh);
    for (let index = 0; index < position.count; index += 1) {
      const offset = index * 3;
      const localX = base[offset];
      const baseY = base[offset + 1];
      const localZ = base[offset + 2];
      const worldX = mesh.position.x + localX;
      const worldZ = mesh.position.z + localZ;
      position.setY(index, baseY + sampleOffsetAt(worldX, worldZ));
    }
    position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }

  function syncLandCellMarkers() {
    for (const object of api.editableObjects) {
      if (object?.userData?.editorAssetId !== LAND_ASSET_ID) continue;
      const baseHeight = Number(originalGetGroundHeight.call(groundCollider, object.position.x, object.position.z));
      if (!Number.isFinite(baseHeight)) continue;
      object.position.y = baseHeight + sampleOffsetAt(object.position.x, object.position.z);
      object.updateMatrixWorld?.(true);
    }
  }

  function findPaintedCellByCell(mode, cell) {
    if (mode !== 'land-add' && mode !== 'water-add') return null;
    const assetId = mode === 'land-add' ? LAND_ASSET_ID : WATER_ASSET_ID;
    return api.editableObjects.find((object) => (
      object?.userData?.editorAssetId === assetId &&
      Math.abs(object.position.x - cell.x) < 0.001 &&
      Math.abs(object.position.z - cell.z) < 0.001 &&
      Math.abs(Math.abs(object.scale.x) - cell.size) < 0.001 &&
      Math.abs(Math.abs(object.scale.z) - cell.size) < 0.001
    )) || null;
  }

  function applyStrengthToCell(object, mode, strength) {
    if (!object) return false;
    object.scale.y = clampStrength(strength);
    object.userData.editorTerrainElevationMeters = mode === 'land-add' ? object.scale.y : -object.scale.y;
    object.updateMatrixWorld?.(true);
    api.writeInspector?.(object);
    return true;
  }

  function applyPendingPaintStrength() {
    if (!pendingPaint) return false;
    if (performance.now() > pendingPaint.expiresAt) {
      pendingPaint = null;
      return false;
    }
    const object = findPaintedCellByCell(pendingPaint.mode, pendingPaint.cell);
    if (!object) return false;
    applyStrengthToCell(object, pendingPaint.mode, pendingPaint.strengthMeters);
    pendingPaint = null;
    return true;
  }

  function applyNow() {
    if (disposed) return Object.freeze({ stampCount: 0, chunkCount: 0 });
    applyPendingPaintStrength();
    activeStamps = buildStamps();
    const meshes = loadedTerrainMeshes();
    for (const mesh of meshes) applyMesh(mesh);
    syncLandCellMarkers();
    return Object.freeze({ stampCount: activeStamps.length, chunkCount: meshes.length });
  }

  function scheduleApply() {
    if (disposed) return;
    window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(applyNow, APPLY_DELAY_MS);
  }

  function pendingCellFromEvent(event) {
    if (event.target !== api.canvas || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return null;
    const mode = terrain.getMode();
    if (mode !== 'land-add' && mode !== 'water-add') return null;
    const point = liveAuthoring.surfacePointFromClient(event.clientX, event.clientY);
    if (!point) return null;
    return Object.freeze({
      mode,
      cell: snapEditorTerrainCell(point, terrain.getCellSize()),
      strengthMeters: strengthMeters(),
      expiresAt: performance.now() + PENDING_PAINT_TTL_MS
    });
  }

  function onDocumentPointerDown(event) {
    const pending = pendingCellFromEvent(event);
    if (pending) pendingPaint = pending;
  }

  function onCanvasPointerUp(event) {
    if (disposed || event.button !== 0) return;
    if (applyPendingPaintStrength()) scheduleApply();
  }

  function onStrengthChange() {
    const strength = strengthMeters();
    const selected = api.getSelectedObject?.();
    if (!isTerrainCell(selected)) return;
    const mode = selected.userData.editorAssetId === LAND_ASSET_ID ? 'land-add' : 'water-add';
    applyStrengthToCell(selected, mode, strength);
    api.refreshHierarchy?.();
    scheduleApply();
  }

  function onOrbitEnd() {
    scheduleApply();
  }

  groundCollider.getGroundHeight = function editorElevatedGroundHeight(worldX, worldZ) {
    const baseHeight = Number(originalGetGroundHeight.call(this, worldX, worldZ));
    return (Number.isFinite(baseHeight) ? baseHeight : 0) + sampleOffsetAt(worldX, worldZ);
  };

  const hierarchy = document.getElementById('we-hierarchy');
  mutationObserver = hierarchy ? new MutationObserver(scheduleApply) : null;
  mutationObserver?.observe(hierarchy, { childList: true, subtree: true, characterData: true });
  listen(document, 'pointerdown', onDocumentPointerDown, true);
  listen(api.canvas, 'pointerup', onCanvasPointerUp, true);
  listen(ui.input, 'change', onStrengthChange);
  listen(api.orbitControls, 'end', onOrbitEnd);

  function getSnapshot() {
    return Object.freeze({
      stampCount: activeStamps.length,
      landStampCount: activeStamps.filter((stamp) => stamp.direction > 0).length,
      waterStampCount: activeStamps.filter((stamp) => stamp.direction < 0).length,
      strengthMeters: strengthMeters(),
      loadedTerrainChunkCount: loadedTerrainMeshes().length,
      groundColliderPatched: groundCollider.getGroundHeight !== originalGetGroundHeight,
      pendingPaint: Boolean(pendingPaint)
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(applyTimer);
    mutationObserver?.disconnect();
    removers.splice(0).reverse().forEach((remove) => remove());
    pendingPaint = null;
    groundCollider.getGroundHeight = originalGetGroundHeight;
    activeStamps = Object.freeze([]);
    for (const mesh of loadedTerrainMeshes()) {
      const position = mesh.geometry.attributes.position;
      const base = basePositions.get(mesh.geometry);
      if (!base || base.length !== position.array.length) continue;
      position.array.set(base);
      position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
    ui.label.remove();
    if (window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__ === surface) delete window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__;
  }

  const surface = Object.freeze({
    applyNow,
    sampleOffsetAt,
    getStrengthMeters: strengthMeters,
    getSnapshot,
    dispose
  });
  window.__WESTEROS_EDITOR_TERRAIN_ELEVATION__ = surface;
  applyNow();
  listen(window, 'pagehide', dispose, { once: true });
  return surface;
}

try {
  installEditorTerrainElevationBrush();
} catch (error) {
  console.error('[EditorTerrainElevationBrush] boot failed', error);
}
