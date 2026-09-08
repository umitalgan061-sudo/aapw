/**
 * Camera-relative atmospheric perspective for the shipped world scene.
 *
 * Render-only: canonical terrain height, hydrology, collider, roads, settlements and
 * placement data are never changed. The director keeps the sky readable at distance,
 * removes the near-black background failure, and shapes fog/exposure from the active
 * camera without introducing map/grid terms.
 *
 * @module atmosphericPerspectiveDirector
 */

const DEFAULTS = Object.freeze({
  horizonColor: 0x4e6472,
  zenithColor: 0x13202b,
  nightColor: 0x071018,
  fogNearMeters: 900,
  fogFarMeters: 7200,
  nightFogNearMeters: 520,
  nightFogFarMeters: 5200,
  minExposure: 0.72,
  maxExposure: 1.16,
  minBackgroundLuma: 0.055,
  maxBackgroundLuma: 0.42,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rgbToLuma(color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

function applyColorLumaFloor(color, minLuma, maxLuma) {
  const luma = rgbToLuma(color);
  const target = clamp(luma, minLuma, maxLuma);
  if (luma <= 1e-6) {
    color.setRGB(target, target, target);
    return color;
  }
  color.multiplyScalar(target / luma);
  return color;
}

function cloneConfig(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}

function resolvePhase({ hour = 12, sunElevation = null } = {}) {
  if (Number.isFinite(sunElevation)) return clamp((sunElevation + 0.22) / 0.74, 0, 1);
  const normalizedHour = ((finite(hour, 12) % 24) + 24) % 24;
  if (normalizedHour <= 5 || normalizedHour >= 21) return 0;
  if (normalizedHour < 8) return smoothstep(5, 8, normalizedHour);
  if (normalizedHour > 18) return 1 - smoothstep(18, 21, normalizedHour);
  return 1;
}

function horizonMix(camera, farPlane) {
  const altitude = Math.max(0, finite(camera?.position?.y, 0));
  return clamp(altitude / Math.max(1, finite(farPlane, DEFAULTS.fogFarMeters)), 0, 1);
}

function setFogRange(fog, near, far) {
  if (!fog) return;
  fog.near = near;
  fog.far = Math.max(near + 1, far);
}

function chooseBackgroundColor(THREE, phase, config) {
  const color = new THREE.Color(config.nightColor);
  const horizon = new THREE.Color(config.horizonColor);
  const zenith = new THREE.Color(config.zenithColor);
  color.lerp(horizon.clone().lerp(zenith, 0.56), phase);
  return applyColorLumaFloor(color, config.minBackgroundLuma, config.maxBackgroundLuma);
}

function applyHemisphere(THREE, lights, phase, config) {
  const hemi = lights?.hemisphere;
  if (!hemi?.color || !hemi?.groundColor) return;
  hemi.color.copy(chooseBackgroundColor(THREE, phase, config));
  hemi.groundColor.copy(new THREE.Color(0x221b16).lerp(new THREE.Color(0x5b664f), phase * 0.78));
  hemi.intensity = lerp(0.28, 0.88, phase);
}

function applySun(lights, phase) {
  const sun = lights?.sun;
  if (!sun) return;
  sun.intensity = lerp(0.14, 1.2, phase);
  if (sun.color?.setHSL) sun.color.setHSL(lerp(0.60, 0.10, phase), 0.28, lerp(0.52, 0.66, phase));
}

function applyFog(THREE, scene, phase, camera, config) {
  const fog = scene?.fog;
  if (!fog) return;
  const altitudeMix = horizonMix(camera, config.fogFarMeters);
  const near = lerp(config.nightFogNearMeters, config.fogNearMeters, phase) * lerp(1.0, 1.22, altitudeMix);
  const far = lerp(config.nightFogFarMeters, config.fogFarMeters, phase) * lerp(0.86, 1.0, altitudeMix);
  setFogRange(fog, near, far);
  if (fog.color) fog.color.copy(chooseBackgroundColor(THREE, phase, config));
}

function safelySetBackground(THREE, scene, phase, config) {
  if (!scene) return;
  if (!scene.background?.isColor) scene.background = new THREE.Color();
  scene.background.copy(chooseBackgroundColor(THREE, phase, config));
}

export function createAtmosphericPerspectiveDirector({ THREE, scene, camera, renderer, lights, config = {}, clock = null } = {}) {
  if (!THREE || !scene || !camera) throw new TypeError('[atmosphere] THREE, scene and camera are required');
  const resolved = cloneConfig(config);
  const state = { phase: 1, elapsedSeconds: 0, lastExposure: 1 };
  const update = ({ hour = 12, sunElevation = null, deltaSeconds = 0 } = {}) => {
    state.phase = resolvePhase({ hour, sunElevation });
    state.elapsedSeconds += Math.max(0, finite(deltaSeconds, 0));
    safelySetBackground(THREE, scene, state.phase, resolved);
    applyHemisphere(THREE, lights, state.phase, resolved);
    applySun(lights, state.phase);
    applyFog(THREE, scene, state.phase, camera, resolved);
    const altitudeBias = smoothstep(40, 1600, Math.max(0, finite(camera.position.y, 0)));
    state.lastExposure = clamp(lerp(resolved.minExposure, resolved.maxExposure, state.phase) + altitudeBias * 0.04, resolved.minExposure, resolved.maxExposure);
    if (renderer?.toneMappingExposure !== undefined) renderer.toneMappingExposure = state.lastExposure;
    return Object.freeze({ phase: state.phase, exposure: state.lastExposure, fog: scene.fog ? { near: scene.fog.near, far: scene.fog.far } : null });
  };
  const updateFromClock = (hourProvider) => {
    const elapsed = clock?.getElapsedTime?.() ?? 0;
    return update({ hour: typeof hourProvider === 'function' ? hourProvider(elapsed) : 12 });
  };
  safelySetBackground(THREE, scene, state.phase, resolved);
  return Object.freeze({
    id: 'atmospheric-perspective-director-v7',
    contract: 'render-only-camera-relative-atmosphere',
    update,
    updateFromClock,
    getState: () => Object.freeze({ ...state }),
  });
}

export const ATMOSPHERIC_PERSPECTIVE_DEFAULTS = DEFAULTS;
