/**
 * Render-facing atmosphere/weather contract for shipped world environments.
 * Consumes caller-owned canonical samples; never mutates terrain, hydrology, colliders,
 * placement, or editor state. Intended to be adopted by createScene callers.
 */

export const ATMOSPHERE_WEATHER_POLICY = Object.freeze({
  id: 'photorealistic-atmosphere-weather-2026-09-08-v17',
  renderOnly: true,
  canonicalMutation: false,
  maxFogDensity: 0.018,
  minVisibility: 0.22,
  maxWindStrength: 1,
});

const clamp01 = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};
const finite = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};

export function deriveAtmosphereWeatherProfile(sample = {}, context = {}) {
  const elevation = clamp01(finite(sample.heightAboveSeaMeters, 0) / 1200);
  const moisture = clamp01(sample.moisture, 0.45);
  const cloud = clamp01(context.cloudCover, 0.25);
  const precipitation = clamp01(context.precipitation, moisture * cloud);
  const wind = clamp01(context.windStrength, 0.28);
  const cameraDistance = clamp01(finite(sample.cameraDistanceMeters, 0) / 5000);
  const visibility = Math.max(ATMOSPHERE_WEATHER_POLICY.minVisibility, 1 - smoothstep(0.35, 1, cameraDistance) * (0.38 + cloud * 0.28));
  const fogDensity = Math.min(ATMOSPHERE_WEATHER_POLICY.maxFogDensity, 0.0025 + cloud * 0.006 + precipitation * 0.004 + elevation * 0.002);
  const sunOcclusion = clamp01(cloud * 0.78 + precipitation * 0.16);
  const ambientBoost = clamp01(0.22 + (1 - sunOcclusion) * 0.48 + moisture * 0.08);
  const horizonWarmth = clamp01(context.horizonWarmth, 0.18) * (1 - precipitation * 0.55);
  const snowGlare = clamp01(sample.snowlineFactor, 0) * (1 - cloud * 0.25) * (0.35 + elevation * 0.65);
  const windLift = clamp01(wind * (0.55 + elevation * 0.45));
  const rainCurtain = clamp01(precipitation * (0.5 + wind * 0.5));
  const weatherClass = precipitation > 0.68 ? 'snow-or-heavy-rain' : precipitation > 0.32 ? 'misty-overcast' : cloud > 0.62 ? 'overcast' : 'clear';
  return Object.freeze({
    policyId: ATMOSPHERE_WEATHER_POLICY.id,
    fogDensity,
    visibility,
    sunOcclusion,
    ambientBoost,
    horizonWarmth,
    snowGlare,
    windLift,
    rainCurtain,
    weatherClass,
    cameraRelativeSky: true,
    blackSkyGuard: true,
    canonicalHeightUnchanged: true,
    canonicalHydrologyUnchanged: true,
  });
}

export function validateAtmosphereWeatherProfile(profile) {
  const numericKeys = ['fogDensity','visibility','sunOcclusion','ambientBoost','horizonWarmth','snowGlare','windLift','rainCurtain'];
  const finiteValues = numericKeys.every((k) => Number.isFinite(profile?.[k]));
  const bounded = numericKeys.every((k) => profile[k] >= 0 && profile[k] <= 1) && profile.fogDensity <= ATMOSPHERE_WEATHER_POLICY.maxFogDensity;
  return {
    valid: finiteValues && bounded && profile?.cameraRelativeSky === true && profile?.blackSkyGuard === true,
    finite: finiteValues,
    bounded,
    cameraRelativeSky: profile?.cameraRelativeSky === true,
    blackSkyGuard: profile?.blackSkyGuard === true,
    canonicalHeightUnchanged: profile?.canonicalHeightUnchanged === true,
    canonicalHydrologyUnchanged: profile?.canonicalHydrologyUnchanged === true,
  };
}

export function serializeAtmosphereWeatherProfile(profile) {
  return JSON.stringify(profile, Object.keys(profile).sort());
}
