const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const lerp = (a, b, t) => a + (b - a) * t;

export const V66_EXPOSURE_POLICY = Object.freeze({
  id: 'environment-runtime-exposure-v66-2026-09-15',
  version: 66,
  deterministic: true,
  mutation: false,
  sunArcSamples: 12,
  blackSkyLumaFloor: 0.08,
});

export const normalizeExposureInputV66 = (input = {}) => ({
  elevation: Number(input.elevation) || 0,
  slope: clamp(input.slope, 0, 90),
  aspect: ((Number(input.aspect) || 0) % 360 + 360) % 360,
  latitude: Number(input.latitude) || 0,
  dayOfYear: Math.max(1, Math.min(365, Number(input.dayOfYear) || 180)),
  hour: ((Number(input.hour) || 12) % 24 + 24) % 24,
  cloud: clamp(input.cloud),
  humidity: clamp(input.humidity),
  precipitation: clamp(input.precipitation),
  snow: clamp(input.snow),
  vegetation: clamp(input.vegetation ?? input.vegetationCover),
});

export const estimateSunDirectionV66 = (input = {}) => {
  const s = normalizeExposureInputV66(input);
  const seasonal = Math.sin(((s.dayOfYear - 80) / 365) * Math.PI * 2);
  const declination = 23.44 * seasonal;
  const hourAngle = (s.hour - 12) * 15;
  const lat = s.latitude * Math.PI / 180;
  const dec = declination * Math.PI / 180;
  const ha = hourAngle * Math.PI / 180;
  const altitude = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const azimuth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
  return {
    altitudeDeg: altitude * 180 / Math.PI,
    azimuthDeg: ((azimuth * 180 / Math.PI) + 180 + 360) % 360,
    daylight: altitude > 0,
    seasonal,
  };
};

export const computeTerrainExposureV66 = (input = {}) => {
  const s = normalizeExposureInputV66(input);
  const sun = estimateSunDirectionV66(s);
  const aspectDelta = Math.abs(((sun.azimuthDeg - s.aspect + 540) % 360) - 180);
  const facing = 1 - aspectDelta / 180;
  const slopePenalty = clamp(s.slope / 62);
  const cloudPenalty = s.cloud * 0.42;
  const humidityPenalty = s.humidity * 0.11;
  const snowBounce = s.snow * 0.12;
  const solar = sun.daylight ? clamp(Math.sin(Math.max(0, sun.altitudeDeg) * Math.PI / 180) * (0.54 + facing * 0.46)) : 0;
  const exposure = clamp(solar * (1 - cloudPenalty) * (1 - humidityPenalty) + snowBounce - slopePenalty * 0.08);
  return {
    sun,
    exposure,
    solar,
    facing,
    thermalBias: clamp(exposure * 0.64 + s.elevation / 4200 * 0.2 - s.snow * 0.3),
    shadeBias: clamp(1 - exposure),
    snowPersistence: clamp(s.snow * 0.58 + (1 - exposure) * 0.42),
  };
};

export const buildCanopyExposureV66 = (sample = {}, canopy = {}) => {
  const base = computeTerrainExposureV66(sample);
  const density = clamp(canopy.density ?? 0.5);
  const height = Math.max(0, Number(canopy.height) || 0);
  const openness = clamp(canopy.openness ?? (1 - density));
  const leafPass = clamp(0.42 + openness * 0.58 - density * 0.16);
  const understory = clamp(base.exposure * leafPass + (1 - density) * 0.22);
  return {
    direct: clamp(base.exposure * leafPass),
    diffuse: clamp(0.26 + openness * 0.34),
    understory,
    trunkShade: clamp(density * 0.76 + height / 40 * 0.08),
    ambientRetention: clamp(0.3 + density * 0.5 + (1 - base.exposure) * 0.2),
  };
};

export const computeFogVisibilityV66 = (input = {}, distance = 1000) => {
  const s = normalizeExposureInputV66(input);
  const d = Math.max(0, Number(distance) || 0);
  const humidityFog = clamp(s.humidity * 0.52 + s.precipitation * 0.38 + s.cloud * 0.1);
  const density = clamp(0.00018 + humidityFog * 0.00064);
  const visibility = Math.exp(-density * d);
  return {
    density,
    visibility: clamp(visibility),
    horizonVisibility: clamp(Math.exp(-density * 6000)),
    contrastRetention: clamp(visibility * (0.86 + (1 - humidityFog) * 0.14)),
  };
};

export const buildSkyLumaEnvelopeV66 = ({ samples = [], weather = {} } = {}) => {
  const normalized = samples.map(normalizeExposureInputV66);
  const values = normalized.map((sample) => computeTerrainExposureV66({ ...sample, ...weather }));
  const mean = values.length ? values.reduce((sum, item) => sum + item.exposure, 0) / values.length : 0.24;
  const minLuma = clamp(0.1 + mean * 0.18, V66_EXPOSURE_POLICY.blackSkyLumaFloor, 0.46);
  return {
    skyLumaFloor: Number(minLuma.toFixed(4)),
    groundMeanExposure: Number(mean.toFixed(4)),
    blackSkyRisk: minLuma < V66_EXPOSURE_POLICY.blackSkyLumaFloor ? 'high' : 'low',
    samples: values.length,
  };
};

export const buildCameraExposureV66 = ({ camera = {}, weather = {}, terrain = {} } = {}) => {
  const input = { ...terrain, ...weather };
  const ground = computeTerrainExposureV66(input);
  const distance = Math.max(1, Number(camera.distance) || 1200);
  const fog = computeFogVisibilityV66(input, distance);
  const autoExposure = clamp(0.38 + ground.exposure * 0.36 + (1 - fog.visibility) * 0.24);
  return {
    targetEV: Number(lerp(-0.3, 0.9, autoExposure).toFixed(4)),
    compensation: Number(lerp(-0.18, 0.2, ground.shadeBias).toFixed(4)),
    fog,
    ground,
    preserveDarkDetail: ground.shadeBias > 0.62,
    preserveSnowHighlight: input.snow > 0.55,
  };
};

export const validateExposureRuntimeV66 = (runtime) => {
  const errors = [];
  if (runtime?.policy !== V66_EXPOSURE_POLICY.id) errors.push('policy');
  if (runtime?.deterministic !== true) errors.push('determinism');
  if ((runtime?.sky?.skyLumaFloor ?? 0) < V66_EXPOSURE_POLICY.blackSkyLumaFloor) errors.push('black-sky');
  return { ok: errors.length === 0, errors };
};

export const exposureTelemetryV66 = (runtime) => ({
  skyLumaFloor: runtime?.sky?.skyLumaFloor ?? 0,
  exposure: runtime?.sky?.groundMeanExposure ?? 0,
  blackSkyRisk: runtime?.sky?.blackSkyRisk ?? 'unknown',
  sampleCount: runtime?.sky?.samples ?? 0,
});

export const getV66ExposureSummary = () => Object.freeze({
  contract: V66_EXPOSURE_POLICY,
  features: ['solar-aspect', 'canopy-exposure', 'fog-visibility', 'sky-luma-floor', 'camera-exposure'],
  authority: 'camera-relative-visual-response',
});
