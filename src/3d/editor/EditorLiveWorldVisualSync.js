import { WORLD_DEFAULTS } from '../config.js';
import { updateDayNightLighting } from '../lighting.js';
import { updateAuroraSky } from '../sky.js';
import { updateStarfield } from '../stars.js';
import { updateWater } from '../world/water.js';

export function installEditorLiveWorldVisualSync(api, liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__) {
  if (!api?.camera) throw new Error('Live World visual sync için editor camera gerekli.');
  if (!liveSurface?.liveState) throw new Error('Live World visual sync için canlı world state gerekli.');
  if (window.__WESTEROS_EDITOR_LIVE_VISUALS__) return window.__WESTEROS_EDITOR_LIVE_VISUALS__;

  const state = liveSurface.liveState;
  let disposed = false;
  let frame = 0;
  let lastElapsedSeconds = 0;
  let lastNightFactor = 0;

  function tick() {
    if (disposed) return;
    const elapsedSeconds = state.clock?.getElapsedTime?.() ?? 0;
    lastElapsedSeconds = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    const dayNight = updateDayNightLighting(
      state.lights,
      lastElapsedSeconds,
      WORLD_DEFAULTS.DAY_LENGTH_SECONDS,
      WORLD_DEFAULTS.START_TIME_OF_DAY_RATIO
    );
    lastNightFactor = dayNight.nightFactor;
    updateWater(state.water, api.camera.position, lastElapsedSeconds);
    updateAuroraSky(state.sky, api.camera.position, lastElapsedSeconds, dayNight);
    updateStarfield(state.stars, api.camera.position, lastElapsedSeconds, dayNight.nightFactor);
    frame = window.requestAnimationFrame(tick);
  }

  function getSnapshot() {
    return Object.freeze({
      elapsedSeconds: lastElapsedSeconds,
      nightFactor: lastNightFactor,
      waterCenter: Object.freeze(state.water.position.toArray()),
      skyCenter: Object.freeze(state.sky.position.toArray()),
      starsCenter: Object.freeze(state.stars.position.toArray()),
      cameraPosition: Object.freeze(api.camera.position.toArray())
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame) window.cancelAnimationFrame(frame);
    window.removeEventListener('pagehide', dispose);
    if (window.__WESTEROS_EDITOR_LIVE_VISUALS__ === surface) delete window.__WESTEROS_EDITOR_LIVE_VISUALS__;
  }

  const surface = Object.freeze({ getSnapshot, dispose });
  window.__WESTEROS_EDITOR_LIVE_VISUALS__ = surface;
  window.addEventListener('pagehide', dispose, { once: true });
  tick();
  return surface;
}

const api = window.__WESTEROS_WORLD_EDITOR__;
const liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__;
if (api && liveSurface) {
  try {
    installEditorLiveWorldVisualSync(api, liveSurface);
  } catch (error) {
    console.error('[EditorLiveWorldVisualSync] boot failed', error);
  }
}
