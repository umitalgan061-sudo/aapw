const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const round = (v, p = 4) => Number((Number.isFinite(v) ? v : 0).toFixed(p));

export const V65_SURFACE_POLICY = Object.freeze({
  id: 'environment-runtime-surface-v65-2026-09-14',
  deterministic: true,
  materialRoles: Object.freeze(['grass', 'soil', 'mud', 'rock', 'scree', 'snow', 'ice', 'shore', 'wet']),
  weatherModes: Object.freeze(['clear', 'overcast', 'rain', 'snow', 'storm', 'mist', 'freeze']),
  maxWetness: 1,
  snowlineWidthMeters: 180,
  antiTilingScale: 0.73,
});

export const normalizeWeather = (weather = {}) => ({
  precipitation: clamp(weather.precipitation, 0, 1),
  cloud: clamp(weather.cloud, 0, 1),
  wind: clamp(weather.wind, 0, 1),
  humidity: clamp(weather.humidity, 0, 1),
  temperature: clamp(weather.temperature, -1, 1),
  time: clamp(weather.time, 0, 1),
  season: weather.season || 'temperate',
  mode: weather.mode || 'clear',
});

export const normalizeSurface = (surface = {}) => ({
  slope: clamp(surface.slope, 0, 90),
  elevation: Number.isFinite(surface.elevation) ? surface.elevation : 0,
  moisture: clamp(surface.moisture, 0, 1),
  waterDistance: Math.max(0, Number.isFinite(surface.waterDistance) ? surface.waterDistance : 9999),
  snow: clamp(surface.snow, 0, 1),
  roughness: clamp(surface.roughness, 0, 1),
  exposed: clamp(surface.exposed, 0, 1),
  biome: surface.biome || 'grassland',
});

export const weatherWetness = (surface, weather) => {
  const s = normalizeSurface(surface);
  const w = normalizeWeather(weather);
  const precipitation = w.precipitation * (0.48 + w.humidity * 0.32);
  const drainage = clamp(s.slope / 60, 0, 1) * 0.34;
  const proximity = clamp(1 - s.waterDistance / 250, 0, 1) * 0.26;
  return round(clamp(s.moisture * 0.46 + precipitation + proximity - drainage, 0, 1));
};

export const freezeFactor = (surface, weather) => {
  const s = normalizeSurface(surface);
  const w = normalizeWeather(weather);
  return round(clamp((-w.temperature + 0.18) / 1.18 * (0.55 + s.elevation / 2600) + s.snow * 0.5, 0, 1));
};

export const snowlineBlend = (elevation, snowline, width = V65_SURFACE_POLICY.snowlineWidthMeters) => {
  const distance = Number.isFinite(elevation) ? elevation - snowline : -9999;
  return round(clamp(0.5 + distance / Math.max(width, 1), 0, 1));
};

export const precipitationType = (surface, weather) => {
  const w = normalizeWeather(weather);
  const s = normalizeSurface(surface);
  if (w.precipitation < 0.05) return 'none';
  if (w.temperature < -0.38 || s.snow > 0.82) return 'snow';
  if (w.temperature < -0.05) return 'sleet';
  return 'rain';
};

export const roleWeights = (surface, weather, snowline = 720) => {
  const s = normalizeSurface(surface);
  const w = normalizeWeather(weather);
  const wet = weatherWetness(s, w);
  const freeze = freezeFactor(s, w);
  const snowBlend = snowlineBlend(s.elevation, snowline);
  const shore = clamp(1 - s.waterDistance / 120, 0, 1);
  const rockExposure = clamp((s.slope - 12) / 48 + s.exposed * 0.36, 0, 1);
  const raw = {
    grass: (1 - rockExposure) * (1 - freeze) * (1 - shore * 0.55) * 0.72,
    soil: (1 - rockExposure) * (1 - wet) * 0.38,
    mud: wet * (1 - freeze) * 0.52,
    rock: rockExposure * 0.58,
    scree: rockExposure * clamp((s.slope - 28) / 40, 0, 1) * 0.64,
    snow: Math.max(s.snow, snowBlend * freeze) * 0.92,
    ice: s.snow * freeze * shore * 0.34,
    shore: shore * (1 - rockExposure) * 0.74,
    wet: wet * 0.46,
  };
  const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, round(v / total)]));
};

export const blendMaterial = (a, b, amount) => {
  const t = clamp(amount, 0, 1);
  const result = {};
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const key of keys) result[key] = round((a?.[key] || 0) * (1 - t) + (b?.[key] || 0) * t);
  return result;
};

export const antiTilingPhase = (x, z, salt = 0) => {
  const n = Math.sin((x * 0.0049 + z * 0.0037 + salt) * 17.173);
  return round((n - Math.floor(n)) * Math.PI * 2, 5);
};

export const triplanarResponse = (normal = {}) => {
  const nx = Math.abs(Number.isFinite(normal.x) ? normal.x : 0);
  const ny = Math.abs(Number.isFinite(normal.y) ? normal.y : 1);
  const nz = Math.abs(Number.isFinite(normal.z) ? normal.z : 0);
  const total = nx + ny + nz || 1;
  return { x: round(nx / total), y: round(ny / total), z: round(nz / total) };
};

export const detailScale = (distance, slope) => {
  const d = Math.max(0, Number.isFinite(distance) ? distance : 0);
  const s = clamp(slope, 0, 90);
  return round(clamp(1 - d / 2200, 0.12, 1) * clamp(1 - s / 140, 0.28, 1));
};

export const wetEdgeProfile = (surface, weather) => {
  const s = normalizeSurface(surface);
  const wet = weatherWetness(s, weather);
  const distance = clamp(1 - s.waterDistance / 160, 0, 1);
  return {
    strength: round(distance * (0.52 + wet * 0.48)),
    foam: round(distance * wet * 0.72),
    darkening: round(distance * wet * 0.38),
    roughnessDrop: round(distance * wet * 0.22),
  };
};

export const weatherVisibility = (weather, distance = 0) => {
  const w = normalizeWeather(weather);
  const d = Math.max(0, Number.isFinite(distance) ? distance : 0);
  const mist = w.cloud * 0.22 + w.humidity * 0.2 + (w.mode === 'mist' ? 0.42 : 0) + w.precipitation * 0.26;
  return round(clamp(1 - mist - d / 18000, 0.06, 1));
};

export const atmosphereLuma = (weather, skyLuma = 0.55) => {
  const w = normalizeWeather(weather);
  const stormPenalty = w.precipitation * 0.16 + w.cloud * 0.12;
  const dayBoost = Math.sin(w.time * Math.PI) * 0.22;
  return round(Math.max(0.08, skyLuma + dayBoost - stormPenalty));
};

export const groundReaction = (surface, weather, snowline = 720) => {
  const s = normalizeSurface(surface);
  const w = normalizeWeather(weather);
  const roles = roleWeights(s, w, snowline);
  const precip = precipitationType(s, w);
  const edge = wetEdgeProfile(s, w);
  const phase = antiTilingPhase(s.x || 0, s.z || 0, s.elevation);
  return {
    roles,
    precipitation: precip,
    phase,
    triplanar: triplanarResponse(s.normal),
    wetEdge: edge,
    freeze: freezeFactor(s, w),
    visibility: weatherVisibility(w, s.waterDistance),
    luma: atmosphereLuma(w),
    detail: detailScale(s.distance, s.slope),
  };
};

export const buildWeatherTimeline = (frames = [], surface = {}) => frames.map((weather, index) => ({
  index,
  mode: normalizeWeather(weather).mode,
  reaction: groundReaction(surface, weather, weather.snowline ?? 720),
}));

export const compareSurfaceStates = (before, after) => ({
  wetDelta: round(weatherWetness(after.surface, after.weather) - weatherWetness(before.surface, before.weather)),
  freezeDelta: round(freezeFactor(after.surface, after.weather) - freezeFactor(before.surface, before.weather)),
  visibilityDelta: round(weatherVisibility(after.weather) - weatherVisibility(before.weather)),
  precipitationChanged: precipitationType(before.surface, before.weather) !== precipitationType(after.surface, after.weather),
});

export const validateSurfaceResponse = (reaction) => {
  const errors = [];
  if (!reaction?.roles) errors.push('roles-missing');
  if (reaction?.phase < 0 || reaction?.phase > Math.PI * 2) errors.push('phase-range');
  if (reaction?.visibility < 0.06 || reaction?.visibility > 1) errors.push('visibility-range');
  if (reaction?.luma < 0.08) errors.push('black-sky-risk');
  const total = Object.values(reaction?.roles || {}).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 0.015) errors.push('role-normalization');
  return { ok: errors.length === 0, errors };
};

export const surfaceRuntimeSummary = (samples = [], weather = {}) => {
  const reactions = samples.map((surface) => groundReaction(surface, weather, surface.snowline ?? 720));
  const precipitation = {};
  let visibility = 0;
  for (const item of reactions) {
    precipitation[item.precipitation] = (precipitation[item.precipitation] || 0) + 1;
    visibility += item.visibility;
  }
  return {
    sampleCount: samples.length,
    meanVisibility: round(visibility / (samples.length || 1)),
    precipitation,
    blackSkySafe: reactions.every((item) => item.luma >= 0.08),
    validated: reactions.every((item) => validateSurfaceResponse(item).ok),
  };
};
