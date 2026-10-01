/**
 * Applies the bounded atmosphere/weather profile to caller-owned renderer and scene objects.
 * This adapter owns only render-state projection; terrain, hydrology, collider, placement,
 * gameplay and editor state remain external.
 */

const clamp01 = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};
const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function applyAtmosphereWeatherProfile(target = {}, profile = {}) {
  const scene = target.scene && typeof target.scene === 'object' ? target.scene : null;
  const renderer = target.renderer && typeof target.renderer === 'object' ? target.renderer : null;
  const fogDensity = clamp01(finite(profile.fogDensity, 0.0025));
  const visibility = clamp01(profile.visibility, 1);
  const ambientBoost = clamp01(profile.ambientBoost, 0.22);
  const sunOcclusion = clamp01(profile.sunOcclusion, 0);
  const horizonWarmth = clamp01(profile.horizonWarmth, 0.18);
  const cameraRelativeSky = profile.cameraRelativeSky === true;
  const blackSkyGuard = profile.blackSkyGuard === true;

  if (scene) {
    if (scene.fog && typeof scene.fog === 'object') {
      if ('density' in scene.fog) scene.fog.density = fogDensity;
      if ('near' in scene.fog) scene.fog.near = Math.max(1, 120 * visibility);
      if ('far' in scene.fog) scene.fog.far = Math.max(300, 9000 * visibility);
    }
    if (scene.userData && typeof scene.userData === 'object') {
      scene.userData.atmosphereWeather = Object.freeze({
        cameraRelativeSky,
        blackSkyGuard,
        ambientBoost,
        sunOcclusion,
        horizonWarmth,
      });
    }
  }

  if (renderer) {
    if ('toneMappingExposure' in renderer) {
      renderer.toneMappingExposure = 0.82 + ambientBoost * 0.38 - sunOcclusion * 0.12;
    }
    if (renderer.outputColorSpace == null && 'outputEncoding' in renderer) {
      renderer.outputEncoding = renderer.outputEncoding;
    }
  }

  return Object.freeze({
    applied: Boolean(scene || renderer),
    fogDensity,
    visibility,
    toneMappingExposure: renderer && 'toneMappingExposure' in renderer ? renderer.toneMappingExposure : null,
    cameraRelativeSky,
    blackSkyGuard,
    canonicalMutation: false,
  });
}

export function validateAtmosphereWeatherApplication(result) {
  return {
    valid: Boolean(result) && Number.isFinite(result.fogDensity) && result.fogDensity >= 0 && result.fogDensity <= 1 && Number.isFinite(result.visibility) && result.visibility >= 0 && result.visibility <= 1 && result.cameraRelativeSky === true && result.blackSkyGuard === true && result.canonicalMutation === false,
    applied: result?.applied === true,
    canonicalMutation: result?.canonicalMutation === false,
  };
}
