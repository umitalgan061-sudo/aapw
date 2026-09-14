const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
};

function hashString(value) {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

export const V64_ATMOSPHERE_POLICY = Object.freeze({
  id: 'buzul-muhafizi-v64-atmosphere-streaming-20260914',
  blackSkyLumaFloor: 0.08,
  nearFogMeters: 160,
  farFogRatio: 0.72,
  maxFogMeters: 12000,
  fullWorldDistance: 7000,
  maxDecalsPerSample: 12,
  streaming: Object.freeze({
    nearMeters: 240,
    midMeters: 900,
    farMeters: 2800,
    hysteresisMeters: 60,
    maxResidentBatches: 64,
  }),
});

const DECAL_FAMILIES = Object.freeze({
  grass: Object.freeze(['flattened-grass', 'soil-breakup', 'leaf-litter']),
  forest: Object.freeze(['leaf-litter', 'root-exposure', 'moss-patch']),
  wetland: Object.freeze(['wet-mud', 'reed-mat', 'water-stain']),
  coastal: Object.freeze(['salt-stain', 'wet-sand', 'driftwood']),
  alpine: Object.freeze(['scree-fan', 'rock-scar', 'snow-grit']),
  tundra: Object.freeze(['snow-grit', 'frost-crack', 'rock-scar']),
  taiga: Object.freeze(['needle-litter', 'moss-patch', 'root-exposure']),
  desert: Object.freeze(['dust-sheet', 'pebble-field', 'wind-scar']),
});

function climateBand(terrain) {
  if (terrain.snowWeight > 0.72 || terrain.elevation01 > 0.86) return 'cold';
  if (terrain.moisture > 0.72) return 'wet';
  if (terrain.moisture < 0.18) return 'dry';
  return 'temperate';
}

export function createGroundDecalPlanV64({ terrain = {}, water = {}, cameraDistance = 420, seed = 'v64-decals' } = {}) {
  const biome = text(terrain.biome, 'grassland').toLowerCase();
  const slope = clamp(terrain.slope, 0, 89.9);
  const moisture = clamp01(terrain.moisture);
  const snowWeight = clamp01(terrain.snowWeight);
  const relief = clamp01(terrain.relief ?? terrain.localRelief);
  const waterDistance = clamp(water.waterDistance ?? water.distance, 0, 50000);
  const shoreline = water.class && water.class !== 'land' && water.class !== 'unknown'
    ? clamp01(1 - waterDistance / 60)
    : 0;
  const names = DECAL_FAMILIES[biome] ?? DECAL_FAMILIES.grass;
  const scaleFade = cameraDistance < 220 ? 1 : cameraDistance < 900 ? 0.62 : 0.28;
  const density = clamp01((0.28 + relief * 0.45 + moisture * 0.18) * (1 - slope / 100) * scaleFade);
  const selected = names.map((family, index) => {
    const weight = clamp01(density * (0.7 + ((index + seed.length) % 5) * 0.08));
    const shorelineBoost = family.includes('wet') || family.includes('water') ? shoreline : 0;
    const snowBoost = family.includes('snow') || family.includes('frost') ? snowWeight : 0;
    return Object.freeze({
      family,
      weight: round(clamp01(weight + shorelineBoost * 0.22 + snowBoost * 0.2)),
      scale: round(0.65 + ((index * 17 + seed.length) % 11) / 20),
      rotationPhase: round(Math.sin(seed.length * 0.37 + index * 1.71)),
    });
  }).filter((item) => item.weight > 0.08).slice(0, V64_ATMOSPHERE_POLICY.maxDecalsPerSample);

  return freeze({
    biome,
    climate: climateBand({ moisture, snowWeight, elevation01: terrain.elevation01 }),
    density: round(density),
    selected: Object.freeze(selected),
    shorelineWeight: round(shoreline),
    distanceFade: round(scaleFade),
    forbiddenOnWater: water.class !== 'land',
    worldSpace: true,
    regularGrid: false,
    fingerprint: hashString(JSON.stringify({ biome, slope, moisture, snowWeight, relief, waterDistance, cameraDistance, selected })),
  });
}

export function createAtmosphereWeatherPlanV64({ camera = {}, terrain = {}, weather = {} } = {}) {
  const distance = clamp(camera.distance, 0.1, 20000);
  const altitude = clamp(terrain.y ?? terrain.height, -200, 5000);
  const phase = text(weather.phase, distance > 5000 ? 'day' : 'ambient');
  const visibility = clamp(weather.visibilityMeters ?? distance * 1.9, 200, V64_ATMOSPHERE_POLICY.maxFogMeters);
  const precipitation = clamp01(weather.precipitation);
  const wind = clamp01(weather.wind);
  const fogNear = Math.min(V64_ATMOSPHERE_POLICY.nearFogMeters + altitude * 0.02, visibility * 0.22);
  const fogFar = Math.max(fogNear + 120, Math.min(visibility, distance * V64_ATMOSPHERE_POLICY.farFogRatio));
  const backgroundLuma = Math.max(V64_ATMOSPHERE_POLICY.blackSkyLumaFloor, Number.isFinite(weather.backgroundLuminance) ? weather.backgroundLuminance : 0.16);
  return freeze({
    phase,
    visibilityMeters: round(visibility),
    wind: round(wind),
    precipitation: round(precipitation),
    fog: Object.freeze({
      nearMeters: round(fogNear),
      farMeters: round(fogFar),
      ordered: fogFar > fogNear,
    }),
    sky: Object.freeze({
      cameraRelative: true,
      backgroundLuminance: round(backgroundLuma),
      blackSky: backgroundLuma < V64_ATMOSPHERE_POLICY.blackSkyLumaFloor ? 1 : 0,
      dayNightPhase: phase,
    }),
    exposure: Object.freeze({
      minimum: round(0.72 + precipitation * 0.08),
      maximum: round(1.24 + wind * 0.04),
      bounded: true,
    }),
    farMountainFade: round(clamp01(1 - (distance - 900) / 6200)),
    fingerprint: hashString(JSON.stringify({ distance, altitude, phase, visibility, precipitation, wind, fogNear, fogFar, backgroundLuma })),
  });
}

function lodTier(distance) {
  if (distance < V64_ATMOSPHERE_POLICY.streaming.nearMeters) return 'near';
  if (distance < V64_ATMOSPHERE_POLICY.streaming.midMeters) return 'mid';
  if (distance < V64_ATMOSPHERE_POLICY.streaming.farMeters) return 'far';
  return 'impostor';
}

export function createStreamingCullingPlanV64({ cameraDistance = 420, visibleObjects = 0, residentBatches = 0, mobile = false } = {}) {
  const distance = clamp(cameraDistance, 0.1, 20000);
  const requestedObjects = Math.max(0, Math.floor(Number.isFinite(visibleObjects) ? visibleObjects : 0));
  const budget = mobile ? 320 : 720;
  const tier = lodTier(distance);
  const desiredVisible = tier === 'near' ? Math.min(requestedObjects, budget) : tier === 'mid' ? Math.min(requestedObjects, Math.floor(budget * 0.72)) : tier === 'far' ? Math.min(requestedObjects, Math.floor(budget * 0.38)) : Math.min(requestedObjects, Math.floor(budget * 0.16));
  const resident = Math.max(0, Math.floor(Number.isFinite(residentBatches) ? residentBatches : 0));
  return freeze({
    tier,
    cameraDistance: round(distance),
    desiredVisible,
    cullCount: Math.max(0, requestedObjects - desiredVisible),
    mobile,
    batchBudget: mobile ? 32 : V64_ATMOSPHERE_POLICY.streaming.maxResidentBatches,
    residentBatches: resident,
    residentOverBudget: resident > (mobile ? 32 : V64_ATMOSPHERE_POLICY.streaming.maxResidentBatches),
    hysteresisMeters: V64_ATMOSPHERE_POLICY.streaming.hysteresisMeters,
    transitionStable: true,
    fingerprint: hashString(`${distance}|${requestedObjects}|${resident}|${mobile}|${tier}`),
  });
}

export function createEnvironmentWindFieldV64({ seed = 'v64-wind', sampleCount = 24, moisture = 0.5, elevation01 = 0.5 } = {}) {
  const count = Math.min(96, Math.max(1, Math.floor(Number.isFinite(sampleCount) ? sampleCount : 24)));
  const wetBias = clamp01(moisture);
  const elevationBias = clamp01(elevation01);
  const samples = Array.from({ length: count }, (_, index) => {
    const phase = index * 1.731 + seed.length * 0.17;
    const speed = clamp01(0.28 + 0.32 * Math.abs(Math.sin(phase)) + wetBias * 0.16 + elevationBias * 0.13);
    const direction = Math.sin(phase * 0.67) * Math.PI;
    return Object.freeze({
      index,
      direction: round(direction),
      speed: round(speed),
      gust: round(clamp01(0.1 + Math.abs(Math.cos(phase * 0.91)) * 0.38)),
      coherence: round(0.58 + Math.sin(phase * 0.31) * 0.15),
    });
  });
  return freeze({
    seed,
    samples: Object.freeze(samples),
    deterministic: true,
    worldSpace: true,
    vegetationOnly: false,
    fingerprint: hashString(JSON.stringify(samples)),
  });
}

export function createEnvironmentalAudioZonesV64({ terrain = {}, water = {} } = {}) {
  const biome = text(terrain.biome, 'unknown').toLowerCase();
  const wet = clamp01(terrain.moisture);
  const waterDistance = clamp(water.waterDistance ?? water.distance, 0, 50000);
  const shoreline = water.class && water.class !== 'land' && water.class !== 'unknown' ? clamp01(1 - waterDistance / 180) : 0;
  const zones = [
    ['wind', 0.5 + terrain.elevation01 * 0.25],
    ['foliage', biome === 'forest' || biome === 'taiga' ? 0.85 : 0.38],
    ['water', shoreline],
    ['wet-ground', wet * 0.62],
    ['rockfall', clamp01((terrain.slope - 42) / 38)],
  ];
  return freeze({
    zones: Object.freeze(zones.map(([id, intensity]) => Object.freeze({ id, intensity: round(clamp01(intensity)), rangeMeters: id === 'water' ? 220 : 140 }))),
    crossfadeMeters: 24,
    canonicalContextOnly: true,
    fingerprint: hashString(JSON.stringify(zones)),
  });
}

export function createV64AtmosphereSummary(input) {
  const atmosphere = createAtmosphereWeatherPlanV64(input);
  const streaming = createStreamingCullingPlanV64({ cameraDistance: input?.camera?.distance ?? 420, visibleObjects: input?.visibleObjects ?? 0, residentBatches: input?.residentBatches ?? 0, mobile: input?.mobile === true });
  const wind = createEnvironmentWindFieldV64({ seed: input?.seed ?? 'v64-wind', moisture: input?.terrain?.moisture ?? 0.5, elevation01: input?.terrain?.elevation01 ?? 0.5 });
  const audio = createEnvironmentalAudioZonesV64({ terrain: input?.terrain ?? {}, water: input?.water ?? {} });
  return freeze({
    atmosphere,
    streaming,
    wind,
    audio,
    readable: atmosphere.sky.blackSky === 0 && atmosphere.fog.ordered,
    fingerprint: hashString(JSON.stringify({ atmosphere, streaming, wind, audio })),
  });
}
