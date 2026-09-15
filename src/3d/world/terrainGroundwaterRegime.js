/**
 * Deterministic, render-only groundwater/surface-moisture regime.
 *
 * This layer never changes canonical terrain height, hydrology topology,
 * coastline, collision geometry, or vegetation placement. It only exposes
 * bounded material/surface signals to the renderer.
 */
const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
};
const round6 = (v) => Number(v.toFixed(6));

export const TERRAIN_GROUNDWATER_POLICY = Object.freeze({
  id: 'terrain-groundwater-regime-2026-09-15-v1',
  materialKey: 'terrain-groundwater-regime-v1',
  renderOnly: true,
  deterministic: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalCoastlineUnchanged: true,
  canonicalColliderUnchanged: true,
  canonicalVegetationPlacementUnchanged: true,
  newGeographyIntroduced: false,
  maxWetnessShift: 0.16,
  maxAlbedoShift: 0.12,
  maxRoughnessShift: 0.12,
  maxNormalStrength: 0.08,
  fieldScaleMeters: 410,
  neighborhoodScaleMeters: 74,
  capillaryScaleMeters: 18,
  seepageScaleMeters: 9,
  recoveryDays: 19,
  memoryDays: 32,
});

function hash2D(ix, iz, seed) {
  let h = Math.imul((ix | 0) ^ seed, 0x45d9f3b);
  h ^= Math.imul((iz | 0) + seed, 0x119de1f3);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz, seed);
  const b = hash2D(ix + 1, iz, seed);
  const c = hash2D(ix, iz + 1, seed);
  const d = hash2D(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

function fbm(x, z, seed, octaves = 4) {
  let amplitude = 0.55;
  let total = 0;
  let weight = 0;
  let px = x;
  let pz = z;
  for (let i = 0; i < octaves; i += 1) {
    total += valueNoise(px, pz, seed + i * 73) * amplitude;
    weight += amplitude;
    px = px * 2.03 + 9.7;
    pz = pz * 1.97 - 8.4;
    amplitude *= 0.48;
  }
  return total / Math.max(1e-9, weight);
}

function ridge(x, z, seed) {
  return 1 - Math.abs(fbm(x, z, seed, 4) * 2 - 1);
}

function rotate(x, z, radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return Object.freeze({ x: x * c - z * s, z: x * s + z * c });
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function normalizeGroundwaterSample(input = {}) {
  const sample = {
    worldX: safeNumber(input.worldX),
    worldZ: safeNumber(input.worldZ),
    heightMeters: safeNumber(input.heightMeters),
    slopeDegrees: clamp(safeNumber(input.slopeDegrees), 0, 89),
    moisture: clamp01(safeNumber(input.moisture, 0.5)),
    rainfall: clamp01(safeNumber(input.rainfall, 0.5)),
    runoff: clamp01(safeNumber(input.runoff, 0)),
    soilDepth: clamp(safeNumber(input.soilDepth, 0.5), 0, 6),
    permeability: clamp01(safeNumber(input.permeability, 0.5)),
    waterDistanceMeters: clamp(safeNumber(input.waterDistanceMeters, 100), 0, 5000),
    groundwaterDepthMeters: clamp(safeNumber(input.groundwaterDepthMeters, 100), 0, 5000),
    wetDays: clamp(safeNumber(input.wetDays, 0), 0, 365),
    dryDays: clamp(safeNumber(input.dryDays, 0), 0, 365),
    dayOfYear: ((Math.floor(safeNumber(input.dayOfYear, 1)) % 360) + 360) % 360,
    temperatureC: clamp(safeNumber(input.temperatureC, 12), -40, 55),
    drainage: clamp01(safeNumber(input.drainage, 0.5)),
    substrate: typeof input.substrate === 'string' ? input.substrate : 'mixed',
    biome: typeof input.biome === 'string' ? input.biome : 'temperate',
  };
  return Object.freeze(sample);
}

export function normalizedDayPhase(dayOfYear) {
  const day = ((Math.floor(safeNumber(dayOfYear, 0)) % 360) + 360) % 360;
  return Object.freeze({
    day,
    phase: day / 360,
    wetSeason: 0.5 + 0.5 * Math.cos(((day - 36) / 360) * Math.PI * 2),
    coldSeason: 0.5 + 0.5 * Math.cos(((day - 0) / 360) * Math.PI * 2),
  });
}

export function groundwaterFieldSignal(worldX, worldZ) {
  const x = safeNumber(worldX);
  const z = safeNumber(worldZ);
  const regional = fbm(x / 410, z / 410, 0x6901, 5);
  const local = fbm(x / 74, z / 74, 0x6902, 4);
  const capillary = ridge(x / 18, z / 18, 0x6903);
  const seepage = ridge(x / 9, z / 14, 0x6904);
  const rotated = rotate(x / 57, z / 91, 0.71);
  const contour = fbm(rotated.x, rotated.z, 0x6905, 3);
  return Object.freeze({
    regional: clamp01(regional),
    local: clamp01(local),
    capillary: clamp01(capillary),
    seepage: clamp01(seepage),
    contour: clamp01(contour),
    combined: clamp01(
      regional * 0.36 +
      local * 0.24 +
      capillary * 0.20 +
      seepage * 0.08 +
      contour * 0.12,
    ),
  });
}

export function rechargePotential(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const phase = normalizedDayPhase(sample.dayOfYear);
  const terrain = groundwaterFieldSignal(sample.worldX, sample.worldZ);
  const slopePenalty = 1 - smoothstep(8, 34, sample.slopeDegrees);
  const drainagePenalty = 1 - sample.drainage * 0.68;
  const soilCapacity = smoothstep(0.15, 1.8, sample.soilDepth);
  const permeability = 0.35 + sample.permeability * 0.65;
  const rainPulse = clamp01(sample.rainfall * 0.72 + sample.runoff * 0.28);
  const coldPenalty = smoothstep(-8, -1, sample.temperatureC);
  const seasonal = 0.74 + phase.wetSeason * 0.34;
  return clamp01(
    rainPulse *
    seasonal *
    terrain.combined *
    slopePenalty *
    drainagePenalty *
    soilCapacity *
    permeability *
    (1 - coldPenalty * 0.24),
  );
}

export function waterTableProximity(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const terrain = groundwaterFieldSignal(sample.worldX, sample.worldZ);
  const depthSignal = 1 - smoothstep(1.2, 38, sample.groundwaterDepthMeters);
  const surfaceSignal = 1 - smoothstep(5, 160, sample.waterDistanceMeters);
  const valleySignal = 1 - smoothstep(0.18, 0.78, terrain.regional);
  const lowland = 1 - smoothstep(42, 210, sample.heightMeters);
  return clamp01(
    depthSignal * 0.52 +
    surfaceSignal * 0.18 +
    valleySignal * 0.14 +
    lowland * 0.08 +
    terrain.seepage * 0.08,
  );
}

export function capillaryRise(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const proximity = waterTableProximity(sample);
  const poreSuitability = sample.permeability * 0.66 + (1 - sample.permeability) * 0.34;
  const soilDepth = smoothstep(0.1, 1.2, sample.soilDepth);
  const dryDemand = 0.44 + smoothstep(0.18, 0.82, 1 - sample.moisture) * 0.56;
  const slopePenalty = 1 - smoothstep(14, 46, sample.slopeDegrees) * 0.65;
  const field = groundwaterFieldSignal(sample.worldX, sample.worldZ);
  return clamp01(
    proximity *
    poreSuitability *
    soilDepth *
    dryDemand *
    slopePenalty *
    (0.72 + field.capillary * 0.28),
  );
}

export function seepageFace(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const field = groundwaterFieldSignal(sample.worldX, sample.worldZ);
  const proximity = waterTableProximity(sample);
  const slopeBand = smoothstep(4, 23, sample.slopeDegrees) * (1 - smoothstep(23, 46, sample.slopeDegrees));
  const drainage = 0.26 + sample.drainage * 0.74;
  return clamp01(proximity * field.seepage * (0.46 + slopeBand * 0.54) * drainage);
}

export function surfaceSaturation(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const recharge = rechargePotential(sample);
  const proximity = waterTableProximity(sample);
  const capillary = capillaryRise(sample);
  const seepage = seepageFace(sample);
  const rain = sample.rainfall * 0.42 + sample.runoff * 0.16;
  const memory = smoothstep(2, 24, sample.wetDays / 6) * 0.24;
  const evaporation = smoothstep(9, 31, sample.temperatureC) * (0.15 + sample.dryDays / 365);
  return clamp01(
    recharge * 0.28 +
    proximity * 0.26 +
    capillary * 0.20 +
    seepage * 0.16 +
    rain +
    memory -
    evaporation * 0.20,
  );
}

export function saturationMemory(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const current = surfaceSaturation(sample);
  const wetHistory = smoothstep(0, 28, sample.wetDays);
  const dryHistory = smoothstep(0, 42, sample.dryDays);
  const retained = current * (0.58 + wetHistory * 0.28);
  const recovered = retained * (1 - dryHistory * 0.62);
  return clamp01(recovered);
}

export function dryingResistance(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const proximity = waterTableProximity(sample);
  const capillary = capillaryRise(sample);
  const depthShield = smoothstep(0.2, 1.6, sample.soilDepth);
  const windExposure = 1 - clamp01(safeNumber(sample.windExposure, 0.5));
  const thermalDemand = smoothstep(4, 34, sample.temperatureC);
  return clamp01(
    proximity * 0.44 +
    capillary * 0.28 +
    depthShield * 0.18 +
    windExposure * 0.10 -
    thermalDemand * 0.12,
  );
}

export function surfaceFilm(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const saturation = surfaceSaturation(sample);
  const memory = saturationMemory(sample);
  const seep = seepageFace(sample);
  const lowSlope = 1 - smoothstep(4, 25, sample.slopeDegrees);
  const texture = groundwaterFieldSignal(sample.worldX, sample.worldZ).local;
  return clamp01(saturation * 0.52 + memory * 0.24 + seep * 0.15 + lowSlope * texture * 0.09);
}

export function mineralMobilization(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const film = surfaceFilm(sample);
  const runoff = clamp01(sample.runoff);
  const permeability = sample.permeability;
  const fineTransport = film * (0.42 + runoff * 0.58) * (0.62 + (1 - permeability) * 0.38);
  const saltRing = (1 - film) * seepageFace(sample) * smoothstep(2, 18, sample.waterDistanceMeters);
  return Object.freeze({
    fineTransport: clamp01(fineTransport),
    saltRing: clamp01(saltRing),
    total: clamp01(fineTransport * 0.74 + saltRing * 0.26),
  });
}

export function puddlePersistence(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const film = surfaceFilm(sample);
  const drainage = sample.drainage;
  const roughLowland = 1 - smoothstep(0.15, 0.8, drainage);
  const slope = 1 - smoothstep(1.5, 8.5, sample.slopeDegrees);
  const surface = groundwaterFieldSignal(sample.worldX, sample.worldZ);
  return clamp01(film * 0.48 + roughLowland * 0.24 + slope * 0.18 + surface.local * 0.10);
}

export function marshEdgeFactor(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const proximity = waterTableProximity(sample);
  const saturation = surfaceSaturation(sample);
  const lowland = 1 - smoothstep(20, 110, sample.heightMeters);
  const shallowSlope = 1 - smoothstep(0.8, 6.5, sample.slopeDegrees);
  return clamp01(proximity * 0.34 + saturation * 0.36 + lowland * 0.18 + shallowSlope * 0.12);
}

export function groundwaterStress(sampleInput = {}) {
  const sample = normalizeGroundwaterSample(sampleInput);
  const saturation = surfaceSaturation(sample);
  const drying = dryingResistance(sample);
  const cold = smoothstep(0, -12, sample.temperatureC);
  const wetFreeze = saturation * cold;
  const drought = smoothstep(12, 46, sample.dryDays) * (1 - drying);
  return Object.freeze({
    saturationStress: clamp01(saturation * 0.44),
    freezeStress: clamp01(wetFreeze * 0.38),
    droughtStress: clamp01(drought * 0.42),
    total: clamp01(saturation * 0.24 + wetFreeze * 0.22 + drought * 0.24),
  });
}

export function groundwaterMaterialResponse({ state, baseColor = { r: 0.5, g: 0.42, b: 0.32 }, baseRoughness = 0.86 } = {}) {
  const s = state ?? resolveTerrainGroundwaterState({});
  const film = s.surfaceFilm;
  const mineral = s.mineralMobilization.total;
  const salt = s.mineralMobilization.saltRing;
  const seep = s.seepageFace;
  const rough = clamp01(baseRoughness - film * 0.105 + mineral * 0.042 + salt * 0.018);
  const blueBias = film * 0.026 + seep * 0.012;
  const warmDeposit = salt * 0.016;
  return Object.freeze({
    color: Object.freeze({
      r: clamp01(baseColor.r + warmDeposit - film * 0.018),
      g: clamp01(baseColor.g + warmDeposit * 0.68 - film * 0.012),
      b: clamp01(baseColor.b + blueBias - mineral * 0.006),
    }),
    roughness: rough,
    normalStrength: clamp01(film * 0.045 + seep * 0.024 + mineral * 0.018),
    wetness: clamp01(film * 0.62 + seep * 0.22 + s.puddlePersistence * 0.16),
  });
}

export function resolveTerrainGroundwaterState(input = {}) {
  const sample = normalizeGroundwaterSample(input);
  const phase = normalizedDayPhase(sample.dayOfYear);
  const field = groundwaterFieldSignal(sample.worldX, sample.worldZ);
  const recharge = rechargePotential(sample);
  const proximity = waterTableProximity(sample);
  const capillary = capillaryRise(sample);
  const seepage = seepageFace(sample);
  const saturation = surfaceSaturation(sample);
  const memory = saturationMemory(sample);
  const drying = dryingResistance(sample);
  const film = surfaceFilm(sample);
  const mineral = mineralMobilization(sample);
  const puddle = puddlePersistence(sample);
  const marsh = marshEdgeFactor(sample);
  const stress = groundwaterStress(sample);
  return Object.freeze({
    policyId: TERRAIN_GROUNDWATER_POLICY.id,
    sample,
    phase,
    field,
    rechargePotential: recharge,
    waterTableProximity: proximity,
    capillaryRise: capillary,
    seepageFace: seepage,
    surfaceSaturation: saturation,
    saturationMemory: memory,
    dryingResistance: drying,
    surfaceFilm: film,
    mineralMobilization: mineral,
    puddlePersistence: puddle,
    marshEdgeFactor: marsh,
    stress,
  });
}

export function compareTerrainGroundwaterStates(aInput = {}, bInput = {}) {
  const a = resolveTerrainGroundwaterState(aInput);
  const b = resolveTerrainGroundwaterState(bInput);
  const keys = ['rechargePotential','waterTableProximity','capillaryRise','seepageFace','surfaceSaturation','saturationMemory','dryingResistance','surfaceFilm','puddlePersistence','marshEdgeFactor'];
  const delta = {};
  for (const key of keys) delta[key] = round6(b[key] - a[key]);
  return Object.freeze(delta);
}

export function terrainGroundwaterSignature(input = {}) {
  const state = resolveTerrainGroundwaterState(input);
  return Object.freeze({
    policyId: state.policyId,
    field: round6(state.field.combined),
    recharge: round6(state.rechargePotential),
    proximity: round6(state.waterTableProximity),
    capillary: round6(state.capillaryRise),
    seepage: round6(state.seepageFace),
    saturation: round6(state.surfaceSaturation),
    memory: round6(state.saturationMemory),
    drying: round6(state.dryingResistance),
    film: round6(state.surfaceFilm),
    puddle: round6(state.puddlePersistence),
    marsh: round6(state.marshEdgeFactor),
  });
}

export function validateTerrainGroundwaterState(state) {
  const required = ['rechargePotential','waterTableProximity','capillaryRise','seepageFace','surfaceSaturation','saturationMemory','dryingResistance','surfaceFilm','puddlePersistence','marshEdgeFactor'];
  const errors = [];
  for (const key of required) {
    if (!Number.isFinite(state?.[key])) errors.push(`${key}:not-finite`);
    else if (state[key] < 0 || state[key] > 1) errors.push(`${key}:out-of-range`);
  }
  if (state?.policyId !== TERRAIN_GROUNDWATER_POLICY.id) errors.push('policyId:mismatch');
  if (state?.sample && typeof state.sample.worldX !== 'number') errors.push('sample.worldX:not-number');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export const TERRAIN_GROUNDWATER_CANONICAL_INVARIANTS = Object.freeze(['canonicalHeightUnchanged','canonicalHydrologyUnchanged','canonicalCoastlineUnchanged','canonicalColliderUnchanged','canonicalVegetationPlacementUnchanged','newGeographyIntroduced:false']);

export function buildGroundwaterCatalog({ origins = [], dayStep = 30 } = {}) {
  const catalog = [];
  const safeStep = clamp(Math.floor(dayStep), 1, 180);
  const sourceOrigins = origins.length ? origins : [{ worldX: 0, worldZ: 0 },{ worldX: 180, worldZ: -120 },{ worldX: -260, worldZ: 330 },{ worldX: 740, worldZ: -520 }];
  for (const origin of sourceOrigins) {
    for (let day = 0; day < 360; day += safeStep) {
      catalog.push(terrainGroundwaterSignature({ worldX: origin.worldX, worldZ: origin.worldZ, heightMeters: 42, slopeDegrees: 6, moisture: 0.52, rainfall: 0.55, runoff: 0.18, soilDepth: 1.1, permeability: 0.48, waterDistanceMeters: 46, groundwaterDepthMeters: 14, wetDays: 9, dryDays: 3, dayOfYear: day, temperatureC: 10, drainage: 0.46, substrate: 'loam' }));
    }
  }
  return Object.freeze(catalog);
}

export function groundwaterTrend(aInput = {}, bInput = {}) {
  const a = resolveTerrainGroundwaterState(aInput);
  const b = resolveTerrainGroundwaterState(bInput);
  return Object.freeze({ wetnessDelta: round6(b.surfaceFilm - a.surfaceFilm), saturationDelta: round6(b.surfaceSaturation - a.surfaceSaturation), rechargeDelta: round6(b.rechargePotential - a.rechargePotential), capillaryDelta: round6(b.capillaryRise - a.capillaryRise), seepageDelta: round6(b.seepageFace - a.seepageFace), memoryDelta: round6(b.saturationMemory - a.saturationMemory), recoveryDelta: round6(b.dryingResistance - a.dryingResistance) });
}
