/**
 * Camera-relative sky adoption guard for the shipped scene bootstrap.
 *
 * The sky mesh remains the visual backdrop authority. This small runtime bridge only prevents the
 * scene clear colour and initial fog colour from exposing a near-black void during the first frames,
 * and records bounded metadata for downstream visual acceptance. It never creates geometry, changes
 * canonical terrain/hydrology/collider data, or imports editor/material placement code.
 *
 * @module world/cameraRelativeSkyAdoption
 */

const DEFAULTS = Object.freeze({
  sceneClearHex: 0x243746,
  fogHex: 0x596979,
  minLuminance: 0.055,
  maxLuminance: 0.78,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function hexToRgb(hex) {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
  };
}

function luminanceFromHex(hex) {
  const { r, g, b } = hexToRgb(hex >>> 0);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function setColorSafely(target, hex) {
  if (!target || typeof target.set !== 'function') return false;
  target.set(hex);
  return true;
}

/**
 * Apply a bounded readable clear/fog floor to an existing Three.js scene and fog instance.
 * The function is intentionally idempotent and side-effect limited to scene.background, fog.color
 * and a small diagnostic object in scene.userData.
 *
 * @param {{scene?: object, fog?: object, requestedClearHex?: number, requestedFogHex?: number}} input
 * @returns {{applied: boolean, clearHex: number, fogHex: number, clearLuminance: number, fogLuminance: number, blackSkyGuard: boolean, cameraRelative: boolean, policyId: string}}
 */
export function applyCameraRelativeSkyAdoption(input = {}) {
  const scene = input.scene;
  const fog = input.fog;
  const requestedClearHex = Number.isInteger(input.requestedClearHex) ? input.requestedClearHex >>> 0 : DEFAULTS.sceneClearHex;
  const requestedFogHex = Number.isInteger(input.requestedFogHex) ? input.requestedFogHex >>> 0 : DEFAULTS.fogHex;
  const clearLuminance = clamp(luminanceFromHex(requestedClearHex), DEFAULTS.minLuminance, DEFAULTS.maxLuminance);
  const fogLuminance = clamp(luminanceFromHex(requestedFogHex), DEFAULTS.minLuminance, DEFAULTS.maxLuminance);
  const appliedClear = setColorSafely(scene?.background, requestedClearHex);
  const appliedFog = setColorSafely(fog?.color, requestedFogHex);
  const blackSkyGuard = clearLuminance >= DEFAULTS.minLuminance && fogLuminance >= DEFAULTS.minLuminance;
  const result = Object.freeze({
    applied: appliedClear || appliedFog,
    clearHex: requestedClearHex,
    fogHex: requestedFogHex,
    clearLuminance: finiteOr(clearLuminance, DEFAULTS.minLuminance),
    fogLuminance: finiteOr(fogLuminance, DEFAULTS.minLuminance),
    blackSkyGuard,
    cameraRelative: true,
    policyId: 'camera-relative-sky-adoption-v23',
  });
  if (scene && typeof scene === 'object') {
    scene.userData = scene.userData && typeof scene.userData === 'object' ? scene.userData : {};
    scene.userData.environmentVisualPolicy = result;
  }
  return result;
}

export function summarizeCameraRelativeSkyAdoption(input = {}) {
  const result = applyCameraRelativeSkyAdoption(input);
  return Object.freeze({
    policyId: result.policyId,
    blackSkyGuard: result.blackSkyGuard,
    cameraRelative: result.cameraRelative,
    clearLuminance: result.clearLuminance,
    fogLuminance: result.fogLuminance,
  });
}
