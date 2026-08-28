import * as THREE from 'three';
import { WORLD_DEFAULTS } from '../config.js';
import { updateDayNightLighting } from '../lighting.js';
import { updateAuroraSky } from '../sky.js';
import { updateStarfield } from '../stars.js';
import { updateWater } from '../world/water.js';
import { updateFlowAnimation } from '../world/rivers.js';

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
    updateFlowAnimation(state.river, lastElapsedSeconds);
    for (const feature of state.waterFeatures) updateFlowAnimation(feature, lastElapsedSeconds);
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

// Run216 owner usability override: edit mode is an authoring surface, not a gameplay clock.
// Keep the canonical world geometry/water while locking readable daylight and independently
// strengthening the procedural aurora. The gameplay day/night cycle remains untouched.
const EDITOR_LOCKED_TIME_RATIO = 0.5;
const EDITOR_AURORA_FACTOR = 1.35;
const EDITOR_STAR_FACTOR = 0.22;
const EDITOR_SKY_HORIZON = new THREE.Color(0x8fd4ee);
const EDITOR_SKY_ZENITH = new THREE.Color(0x285f9b);
const EDITOR_AURORA_A = new THREE.Color(0x39ffd0);
const EDITOR_AURORA_B = new THREE.Color(0x8f68ff);

export function installEditorBrightAuthoringVisualSync(api, liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__) {
  if (!api?.scene || !api?.camera || !api?.renderer) throw new Error('Bright authoring environment için editor scene/camera/renderer gerekli.');
  if (!liveSurface?.liveState) throw new Error('Bright authoring environment için canlı world state gerekli.');
  if (window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__) return window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__;

  window.__WESTEROS_EDITOR_LIVE_VISUALS__?.dispose?.();

  const state = liveSurface.liveState;
  const previousExposure = Number(api.renderer.toneMappingExposure) || 1;
  const skyUniforms = state.sky?.material?.uniforms || null;
  const previousAuroraA = skyUniforms?.uAuroraColorA?.value?.clone?.() || null;
  const previousAuroraB = skyUniforms?.uAuroraColorB?.value?.clone?.() || null;
  const authoringLights = new THREE.Group();
  authoringLights.name = 'Editor Bright Authoring Lights';
  authoringLights.userData.editorLocked = true;

  const ambient = new THREE.AmbientLight(0xffffff, 1.55);
  ambient.name = 'Editor Ambient Readability';
  const fill = new THREE.HemisphereLight(0xdff7ff, 0x60734c, 2.0);
  fill.name = 'Editor Hemisphere Readability';
  const key = new THREE.DirectionalLight(0xfff4d8, 2.8);
  key.name = 'Editor Daylight Key';
  key.position.set(650, 900, 350);
  const rim = new THREE.DirectionalLight(0x9bdfff, 1.4);
  rim.name = 'Editor Aurora Fill';
  rim.position.set(-500, 520, -700);
  authoringLights.add(ambient, fill, key, rim);
  api.scene.add(authoringLights);

  api.renderer.toneMappingExposure = Math.max(previousExposure, 1.15);
  if (skyUniforms?.uAuroraColorA?.value) skyUniforms.uAuroraColorA.value.copy(EDITOR_AURORA_A);
  if (skyUniforms?.uAuroraColorB?.value) skyUniforms.uAuroraColorB.value.copy(EDITOR_AURORA_B);

  let disposed = false;
  let frame = 0;
  let lastElapsedSeconds = 0;

  function tick() {
    if (disposed) return;
    const elapsedSeconds = state.clock?.getElapsedTime?.() ?? 0;
    lastElapsedSeconds = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;

    updateDayNightLighting(
      state.lights,
      0,
      WORLD_DEFAULTS.DAY_LENGTH_SECONDS,
      EDITOR_LOCKED_TIME_RATIO
    );
    state.lights.sun.intensity = Math.max(state.lights.sun.intensity, 2.35);
    state.lights.hemisphere.intensity = Math.max(state.lights.hemisphere.intensity, 1.65);

    const authoringSky = {
      horizonColor: EDITOR_SKY_HORIZON,
      zenithColor: EDITOR_SKY_ZENITH,
      nightFactor: EDITOR_AURORA_FACTOR
    };
    updateWater(state.water, api.camera.position, lastElapsedSeconds);
    updateFlowAnimation(state.river, lastElapsedSeconds);
    for (const feature of state.waterFeatures) updateFlowAnimation(feature, lastElapsedSeconds);
    updateAuroraSky(state.sky, api.camera.position, lastElapsedSeconds, authoringSky);
    updateStarfield(state.stars, api.camera.position, lastElapsedSeconds, EDITOR_STAR_FACTOR);
    frame = window.requestAnimationFrame(tick);
  }

  function getSnapshot() {
    return Object.freeze({
      mode: 'bright-authoring',
      lockedTimeRatio: EDITOR_LOCKED_TIME_RATIO,
      elapsedSeconds: lastElapsedSeconds,
      nightFactor: 0,
      auroraFactor: EDITOR_AURORA_FACTOR,
      starFactor: EDITOR_STAR_FACTOR,
      sunIntensity: Number(state.lights?.sun?.intensity || 0),
      hemisphereIntensity: Number(state.lights?.hemisphere?.intensity || 0),
      ambientIntensity: ambient.intensity,
      fillIntensity: fill.intensity,
      keyIntensity: key.intensity,
      rimIntensity: rim.intensity,
      fogDisabled: api.scene.fog === null,
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
    api.scene.remove(authoringLights);
    api.renderer.toneMappingExposure = previousExposure;
    if (previousAuroraA && skyUniforms?.uAuroraColorA?.value) skyUniforms.uAuroraColorA.value.copy(previousAuroraA);
    if (previousAuroraB && skyUniforms?.uAuroraColorB?.value) skyUniforms.uAuroraColorB.value.copy(previousAuroraB);
    if (window.__WESTEROS_EDITOR_LIVE_VISUALS__ === surface) delete window.__WESTEROS_EDITOR_LIVE_VISUALS__;
    if (window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__ === surface) delete window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__;
  }

  const surface = Object.freeze({ getSnapshot, dispose });
  window.__WESTEROS_EDITOR_LIVE_VISUALS__ = surface;
  window.__WESTEROS_EDITOR_BRIGHT_ENVIRONMENT__ = surface;
  window.addEventListener('pagehide', dispose, { once: true });
  tick();
  return surface;
}

const brightAuthoringApi = window.__WESTEROS_WORLD_EDITOR__;
const brightAuthoringLiveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__;
if (brightAuthoringApi && brightAuthoringLiveSurface) {
  try {
    installEditorBrightAuthoringVisualSync(brightAuthoringApi, brightAuthoringLiveSurface);
  } catch (error) {
    console.error('[EditorLiveWorldVisualSync] bright authoring boot failed', error);
  }
}

// Run216 owner visual follow-up: the bright authoring sky must still read unmistakably as aurora.
// The canonical shader intentionally uses a conservative 0.55 aurora multiplier for gameplay;
// keep that gameplay contract untouched and boost only the editor's existing uNightFactor uniform.
const EDITOR_VISIBLE_AURORA_FACTOR = 3.4;

export function installEditorVisibleAuroraBoost(api, liveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__) {
  if (!api?.camera) throw new Error('Visible aurora boost için editor camera gerekli.');
  if (!liveSurface?.liveState?.sky?.material?.uniforms) throw new Error('Visible aurora boost için editor sky uniforms gerekli.');
  if (window.__WESTEROS_EDITOR_VISIBLE_AURORA__) return window.__WESTEROS_EDITOR_VISIBLE_AURORA__;

  const uniforms = liveSurface.liveState.sky.material.uniforms;
  let disposed = false;
  let frame = 0;
  let lastAppliedFactor = 0;

  function tick() {
    if (disposed) return;
    if (uniforms.uNightFactor) {
      const current = Number(uniforms.uNightFactor.value) || 0;
      uniforms.uNightFactor.value = Math.max(current, EDITOR_VISIBLE_AURORA_FACTOR);
      lastAppliedFactor = uniforms.uNightFactor.value;
    }
    frame = window.requestAnimationFrame(tick);
  }

  function getSnapshot() {
    return Object.freeze({
      mode: 'visible-aurora-boost',
      configuredFactor: EDITOR_VISIBLE_AURORA_FACTOR,
      actualUniformFactor: Number(uniforms.uNightFactor?.value || 0),
      lastAppliedFactor,
      auroraColorA: uniforms.uAuroraColorA?.value?.getHexString?.() || '',
      auroraColorB: uniforms.uAuroraColorB?.value?.getHexString?.() || ''
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame) window.cancelAnimationFrame(frame);
    window.removeEventListener('pagehide', dispose);
    if (window.__WESTEROS_EDITOR_VISIBLE_AURORA__ === surface) delete window.__WESTEROS_EDITOR_VISIBLE_AURORA__;
  }

  const surface = Object.freeze({ getSnapshot, dispose });
  window.__WESTEROS_EDITOR_VISIBLE_AURORA__ = surface;
  window.addEventListener('pagehide', dispose, { once: true });
  tick();
  return surface;
}

const visibleAuroraApi = window.__WESTEROS_WORLD_EDITOR__;
const visibleAuroraLiveSurface = window.__WESTEROS_EDITOR_LIVE_WORLD__;
if (visibleAuroraApi && visibleAuroraLiveSurface) {
  try {
    installEditorVisibleAuroraBoost(visibleAuroraApi, visibleAuroraLiveSurface);
  } catch (error) {
    console.error('[EditorLiveWorldVisualSync] visible aurora boost boot failed', error);
  }
}
