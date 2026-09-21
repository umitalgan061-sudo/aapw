import { disposeAuroraSky } from '../sky.js';
import { disposeStarfield } from '../stars.js';
import { disposeDayNightLighting } from '../lighting.js';
import { disposeWater } from '../world/water.js';
import { disposeRiverMesh, disposeWaterfallMesh } from '../world/rivers.js';
import { disposeSettlements } from '../world/settlements.js';
import { disposeRoadNetwork } from '../world/roads.js';
import { disposeVegetation } from '../world/vegetation.js';

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
