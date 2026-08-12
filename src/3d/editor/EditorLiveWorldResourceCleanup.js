import { disposeAuroraSky } from '../sky.js';
import { disposeStarfield } from '../stars.js';
import { disposeDayNightLighting } from '../lighting.js';
import { WORLD_SCALE } from '../config.js';
import { disposeWater } from '../world/water.js';
import { disposeRiverMesh, disposeWaterfallMesh } from '../world/rivers.js';
import { disposeSettlements } from '../world/settlements.js';
import { disposeRoadNetwork } from '../world/roads.js';
import { disposeVegetation } from '../world/vegetation.js';
import { worldXZToNormalizedReference, WORLD_REFERENCE_ALIGNMENT } from '../world/worldReferenceAlignment.js';
import {
  WORLD_REFERENCE_MAP,
  REFERENCE_BIOME_ZONES,
  REFERENCE_RELIEF_CHAINS,
  sampleReferenceInfluence
} from '../world/worldReferenceMap.js';

const HTERRAIN_EDITOR_SCHEMA = 'westeros-hterrain-editor-v1';
const HTERRAIN_RESOLUTION = 513;
const TERRAIN_LAND_ASSET = 'editor-land-cell';
const TERRAIN_WATER_ASSET = 'editor-water-cell';

function hterrainSurfaceForBiome(kind) {
  if (kind === 'snow') return 'snow';
  if (kind === 'mountain' || kind === 'rocky-hills') return 'rock';
  if (kind === 'desert' || kind === 'arid') return 'earth';
  return 'grass';
}

function nearestReferenceBiome(uv) {
  let bestZone = null;
  let bestInfluence = 0;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(uv.x, uv.y, zone);
    if (influence > bestInfluence) {
      bestInfluence = influence;
      bestZone = zone;
    }
  }
  return Object.freeze({
    id: bestZone?.id || 'reference-default-grassland',
    kind: bestZone?.kind || 'grassland',
    influence: bestInfluence,
    surface: hterrainSurfaceForBiome(bestZone?.kind)
  });
}

function plainBiomeZones() {
  return REFERENCE_BIOME_ZONES.map((zone) => ({
    id: zone.id,
    kind: zone.kind,
    center: [...zone.center],
    radius: [...zone.radius],
    elevationBias: zone.elevationBias
  }));
}

function plainReliefChains() {
  return REFERENCE_RELIEF_CHAINS.map((chain) => ({
    id: chain.id,
    points: chain.points.map((point) => [...point])
  }));
}

function round6(value) {
  return Number(Number(value).toFixed(6));
}

export function installEditorHTerrainBridge(
  api = window.__WESTEROS_WORLD_EDITOR__,
  liveAuthoring = window.__WESTEROS_EDITOR_LIVE_AUTHORING__
) {
  if (!api?.editableObjects || !api?.getSelectedObject || !liveAuthoring?.targetGroundPoint) {
    throw new Error('HTerrain bridge için canlı World Editor authoring API gerekli.');
  }
  if (window.__WESTEROS_EDITOR_HTERRAIN__) return window.__WESTEROS_EDITOR_HTERRAIN__;

  const rightPanel = document.querySelector('.we-right-panel');
  const inspectorWrap = rightPanel?.querySelector('.we-inspector-wrap');
  if (!rightPanel || !inspectorWrap) throw new Error('HTerrain panel hedefi bulunamadı.');

  const section = document.createElement('section');
  section.id = 'we-hterrain-wrap';
  section.className = 'we-hterrain-wrap';
  section.innerHTML = `
    <div class="we-panel-title">GODOT HTERRAIN</div>
    <div class="we-hterrain-lock" title="Canonical 2D map source-of-truth korunur">MAP.PNG KİLİDİ · AÇIK</div>
    <div id="we-hterrain-status" class="we-muted">513² HTerrain authoring hazırlanıyor…</div>
    <label class="we-hterrain-label">Yüzey
      <select id="we-hterrain-surface" class="we-input">
        <option value="auto">Auto · map.png biome</option>
        <option value="grass">Ot / çayır</option>
        <option value="earth">Toprak / çöl</option>
        <option value="rock">Kaya / dağ</option>
        <option value="snow">Kar</option>
      </select>
    </label>
    <label class="we-hterrain-label">Splat karışımı
      <input id="we-hterrain-blend" class="we-number" type="number" min="0" max="1" step="0.05" value="0.70">
    </label>
    <div class="we-hterrain-actions">
      <button id="we-hterrain-apply-surface" type="button">Seçili Hücreye Ata</button>
      <button id="we-hterrain-export" type="button">HTerrain JSON İndir</button>
    </div>
    <div id="we-hterrain-target" class="we-muted"></div>`;
  rightPanel.insertBefore(section, inspectorWrap);

  const style = document.createElement('style');
  style.id = 'we-hterrain-style';
  style.textContent = '.we-hterrain-wrap{padding:10px;border-bottom:1px solid var(--we-border);display:grid;gap:7px}.we-hterrain-lock{font-size:10px;letter-spacing:.08em;color:var(--we-gold-2);border:1px solid rgba(240,195,79,.35);padding:5px 7px;border-radius:5px;background:rgba(240,195,79,.06)}.we-hterrain-label{display:grid;gap:4px;color:var(--we-muted);font-size:11px}.we-hterrain-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}.we-hterrain-actions button{min-height:30px}';
  document.head.append(style);

  const status = section.querySelector('#we-hterrain-status');
  const targetStatus = section.querySelector('#we-hterrain-target');
  const surfaceSelect = section.querySelector('#we-hterrain-surface');
  const blendInput = section.querySelector('#we-hterrain-blend');
  const applyButton = section.querySelector('#we-hterrain-apply-surface');
  const exportButton = section.querySelector('#we-hterrain-export');
  const removers = [];
  let observer = null;
  let disposed = false;
  let lastManifest = null;

  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  }

  function isTerrainCell(object) {
    const assetId = object?.userData?.editorAssetId;
    return assetId === TERRAIN_LAND_ASSET || assetId === TERRAIN_WATER_ASSET;
  }

  function mapUvForObject(object) {
    return worldXZToNormalizedReference(
      Number(object.position.x),
      Number(object.position.z),
      WORLD_SCALE.MAP_BOUNDS,
      WORLD_SCALE.METERS_PER_MAP_UNIT
    );
  }

  function radiusUvForObject(object) {
    const radiusX = Math.max(1, Math.abs(Number(object.scale.x) || 0));
    const radiusZ = Math.max(1, Math.abs(Number(object.scale.z) || 0));
    return Object.freeze({
      x: radiusX / (WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits * WORLD_SCALE.METERS_PER_MAP_UNIT),
      y: radiusZ / (WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits * WORLD_SCALE.METERS_PER_MAP_UNIT)
    });
  }

  function heightDeltaForObject(object) {
    const explicit = Number(object.userData?.editorTerrainElevationMeters);
    if (Number.isFinite(explicit)) return Math.max(-20, Math.min(20, explicit));
    const magnitude = Math.max(0.1, Math.min(20, Math.abs(Number(object.scale.y) || 1)));
    return object.userData?.editorAssetId === TERRAIN_WATER_ASSET ? -magnitude : magnitude;
  }

  function requestedBlend() {
    const value = Number(blendInput.value);
    const blend = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.7;
    blendInput.value = String(blend);
    return blend;
  }

  function strokeForObject(object) {
    const uv = mapUvForObject(object);
    const radiusUv = radiusUvForObject(object);
    const biome = nearestReferenceBiome(uv);
    const override = String(object.userData?.editorHTerrainSurface || 'auto');
    const surface = override === 'auto' ? biome.surface : override;
    return Object.freeze({
      id: String(object.userData?.editorId || object.uuid),
      uv: [round6(uv.x), round6(uv.y)],
      radiusUv: [round6(radiusUv.x), round6(radiusUv.y)],
      heightDeltaMeters: round6(heightDeltaForObject(object)),
      surface,
      surfaceBlend: object.userData?.editorAssetId === TERRAIN_WATER_ASSET ? 0 : round6(requestedBlend()),
      referenceBiome: biome.id
    });
  }

  function buildManifest() {
    const cells = api.editableObjects.filter(isTerrainCell).slice().sort((a, b) =>
      String(a.userData?.editorId || '').localeCompare(String(b.userData?.editorId || ''))
    );
    const strokes = cells.map(strokeForObject);
    const manifest = {
      schema: HTERRAIN_EDITOR_SCHEMA,
      mapReferenceSha256: WORLD_REFERENCE_MAP.sha256,
      referenceCanvas: {
        width: WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
        height: WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits
      },
      hterrainResolution: HTERRAIN_RESOLUTION,
      mapLocked: true,
      applyMapReference: true,
      biomeZones: plainBiomeZones(),
      reliefChains: plainReliefChains(),
      strokes
    };
    lastManifest = Object.freeze(manifest);
    return manifest;
  }

  function downloadManifest() {
    const manifest = buildManifest();
    const blob = new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'westeros-hterrain-authoring.json';
    anchor.click();
    URL.revokeObjectURL(url);
    refreshStatus();
  }

  function applySurfaceToSelected() {
    const object = api.getSelectedObject();
    if (!isTerrainCell(object)) {
      status.textContent = 'Önce bir Kara/Deniz terrain hücresi seç.';
      return false;
    }
    const value = String(surfaceSelect.value || 'auto');
    object.userData.editorHTerrainSurface = value;
    const uv = mapUvForObject(object);
    const autoBiome = nearestReferenceBiome(uv);
    status.textContent = value === 'auto'
      ? `Seçili hücre map.png biome'una bağlı: ${autoBiome.id} → ${autoBiome.surface}.`
      : `Seçili hücre HTerrain yüzeyi: ${value}.`;
    refreshTarget();
    return true;
  }

  function refreshTarget() {
    const target = liveAuthoring.targetGroundPoint();
    try {
      const uv = worldXZToNormalizedReference(
        Number(target.x), Number(target.z), WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT
      );
      const biome = nearestReferenceBiome(uv);
      targetStatus.textContent = `Hedef map UV ${uv.x.toFixed(3)}, ${uv.y.toFixed(3)} · ${biome.id} · ${biome.surface}`;
    } catch {
      targetStatus.textContent = 'Hedef canonical map.png sınırının dışında; HTerrain export burada bloklanır.';
    }
  }

  function refreshStatus() {
    const cells = api.editableObjects.filter(isTerrainCell);
    const land = cells.filter((object) => object.userData?.editorAssetId === TERRAIN_LAND_ASSET).length;
    const water = cells.length - land;
    status.textContent = `${cells.length} authored hücre · kara ${land} · su ${water} · Godot ${HTERRAIN_RESOLUTION}²`;
    refreshTarget();
  }

  function getSnapshot() {
    const manifest = buildManifest();
    return Object.freeze({
      schema: manifest.schema,
      mapLocked: manifest.mapLocked,
      mapReferenceSha256: manifest.mapReferenceSha256,
      resolution: manifest.hterrainResolution,
      strokeCount: manifest.strokes.length,
      biomeZoneCount: manifest.biomeZones.length,
      reliefChainCount: manifest.reliefChains.length,
      lastManifest
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    removers.splice(0).reverse().forEach((remove) => remove());
    section.remove();
    style.remove();
    if (window.__WESTEROS_EDITOR_HTERRAIN__ === surface) delete window.__WESTEROS_EDITOR_HTERRAIN__;
  }

  listen(applyButton, 'click', applySurfaceToSelected);
  listen(exportButton, 'click', downloadManifest);
  listen(blendInput, 'change', refreshStatus);
  listen(api.orbitControls, 'end', refreshTarget);
  listen(window, 'pagehide', dispose, { once: true });
  const hierarchy = document.getElementById('we-hierarchy');
  observer = hierarchy ? new MutationObserver(refreshStatus) : null;
  observer?.observe(hierarchy, { childList: true, subtree: true, characterData: true });

  const surface = Object.freeze({
    buildManifest,
    downloadManifest,
    applySurfaceToSelected,
    getSnapshot,
    dispose
  });
  window.__WESTEROS_EDITOR_HTERRAIN__ = surface;
  refreshStatus();
  return surface;
}

export function installEditorLiveWorldResourceCleanup(liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__) {
  if (!liveSurface?.liveState) throw new Error('Live World resource cleanup için canlı state gerekli.');
  if (window.__WESTEROS_EDITOR_LIVE_RESOURCE_CLEANUP__) return window.__WESTEROS_EDITOR_LIVE_RESOURCE_CLEANUP__;

  const state = liveSurface.liveState;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pagehide', dispose);
    state.chunkManager?.disposeAll?.();
    if (state.water) disposeWater(state.water);
    if (state.sky) disposeAuroraSky(state.sky);
    if (state.stars) disposeStarfield(state.stars);
    if (state.river) disposeRiverMesh(state.river);
    for (const waterfall of state.waterfalls || []) disposeWaterfallMesh(waterfall);
    if (state.settlements) disposeSettlements(state.settlements);
    if (state.roads) disposeRoadNetwork(state.roads);
    if (state.vegetation) disposeVegetation(state.vegetation);
    if (state.lights) disposeDayNightLighting(state.scene, state.lights);
    if (window.__WESTEROS_EDITOR_LIVE_RESOURCE_CLEANUP__ === surface) delete window.__WESTEROS_EDITOR_LIVE_RESOURCE_CLEANUP__;
  }

  const surface = Object.freeze({ dispose, getSnapshot: () => Object.freeze({ disposed }) });
  window.__WESTEROS_EDITOR_LIVE_RESOURCE_CLEANUP__ = surface;
  window.addEventListener('pagehide', dispose, { once: true });
  return surface;
}

const liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__;
if (liveSurface) {
  try {
    installEditorLiveWorldResourceCleanup(liveSurface);
  } catch (error) {
    console.error('[EditorLiveWorldResourceCleanup] boot failed', error);
  }
}

const editorApi = window.__WESTEROS_WORLD_EDITOR__;
const liveAuthoring = window.__WESTEROS_EDITOR_LIVE_AUTHORING__;
if (editorApi && liveAuthoring) {
  try {
    installEditorHTerrainBridge(editorApi, liveAuthoring);
  } catch (error) {
    console.error('[EditorHTerrainBridge] boot failed', error);
  }
}
