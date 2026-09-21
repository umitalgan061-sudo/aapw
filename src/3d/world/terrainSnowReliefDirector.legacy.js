/**
 * Render-facing snow relief director.
 *
 * This module composes canonical snow coverage with the already-authoritative four-neighbour
 * wind/snow exposure fabric. It never edits terrain height, hydrology, collider height, owner-map
 * geography or placement. The output is a bounded material/vertex-color response that allows
 * packed wind slab, ridge crust, lee powder, firn and glacial continuity to remain visually distinct
 * in shipped terrain renders.
 *
 * @module world/terrainSnowReliefDirector
 */

const clamp01 = (value) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
  const t = clamp01((value - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
};
const saturateSigned = (value) => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
const freeze = (value) => Object.freeze(value);

export const TERRAIN_SNOW_RELIEF_DIRECTOR_POLICY = freeze({
  id: 'terrain-snow-relief-director-2026-09-08-v1-render-facing',
  renderOnly: true,
  canonicalCoverageAuthority: 'terrainBiomeShading.resolveTerrainSnowCoverage',
  windExposureAuthority: 'terrainWindSnowExposure.terrainWindExposureFromNeighbours',
  heightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  placementAuthorityUnchanged: true,
  worldGridOverlay: false,
  periodicStriping: false,
  visibleSnowFloor: 0.045,
  visibleSnowCeiling: 0.98,
  ridgeCrustGain: 0.38,
  windSlabGain: 0.31,
  leePowderGain: 0.42,
  firnGain: 0.24,
  glacialContinuityGain: 0.22,
  rockExposureGain: 0.34,
  screeExposureGain: 0.28,
  driftBreakupGain: 0.26,
  moistureBreakupGain: 0.16,
  microContrastGain: 0.12,
  minimumMaterialSeparation: 0.035,
  maximumMaterialSeparation: 0.42,
  cliffSnowSuppressionStartDegrees: 48,
  cliffSnowSuppressionFullDegrees: 72,
  gentleBowlStartDegrees: 4,
  gentleBowlFullDegrees: 22,
  nearShoreSnowSuppressionMeters: 0.75,
  farShoreSnowSuppressionMeters: 8.0,
  textureRepeatMeters: 22,
  macroScalesMeters: freeze([38, 96, 240, 620, 1450, 3200]),
});

export const SNOW_RELIEF_MATERIAL_FAMILIES = freeze({
  neutral: freeze({ id: 'snow-neutral', temperature: 0.0, brightness: 0.0, roughness: 0.86 }),
  packed: freeze({ id: 'snow-packed', temperature: -0.28, brightness: -0.07, roughness: 0.91 }),
  accumulated: freeze({ id: 'snow-accumulated', temperature: 0.18, brightness: 0.06, roughness: 0.78 }),
  firn: freeze({ id: 'snow-firn', temperature: -0.16, brightness: -0.025, roughness: 0.94 }),
  crust: freeze({ id: 'snow-crust', temperature: -0.38, brightness: -0.095, roughness: 0.96 }),
  powder: freeze({ id: 'snow-powder', temperature: 0.21, brightness: 0.08, roughness: 0.72 }),
  rock: freeze({ id: 'snow-rock-exposure', temperature: 0.04, brightness: -0.22, roughness: 0.98 }),
  scree: freeze({ id: 'snow-scree-exposure', temperature: 0.08, brightness: -0.16, roughness: 0.99 }),
});

function hash2D(x, y, seed = 0x4a11) {
  let value = Math.imul((Math.floor(x) | 0) ^ seed, 0x45d9f3b);
  value ^= Math.imul((Math.floor(y) | 0) + seed, 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  return (value >>> 0) / 0x100000000;
}

function valueNoise2D(x, y, cells, seed) {
  const gx = x * cells;
  const gy = y * cells;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2D(x0, y0, seed);
  const b = hash2D(x0 + 1, y0, seed);
  const c = hash2D(x0, y0 + 1, seed);
  const d = hash2D(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

export function reliefMacroNoise(worldX = 0, worldZ = 0, seed = 0x2016) {
  const x = Number.isFinite(worldX) ? worldX : 0;
  const z = Number.isFinite(worldZ) ? worldZ : 0;
  let total = 0;
  let weight = 0;
  let amplitude = 0.55;
  for (let octave = 0; octave < 6; octave += 1) {
    const scale = TERRAIN_SNOW_RELIEF_DIRECTOR_POLICY.macroScalesMeters[octave];
    total += valueNoise2D(x / scale, z / scale, 4, seed + octave * 131) * amplitude;
    weight += amplitude;
    amplitude *= 0.48;
  }
  return total / Math.max(1e-9, weight);
}

export function reliefMicroBreakup(worldX = 0, worldZ = 0, seed = 0x7811) {
  const macro = reliefMacroNoise(worldX, worldZ, seed);
  const grain = valueNoise2D(worldX / 26, worldZ / 26, 12, seed + 17);
  const pebble = valueNoise2D(worldX / 7, worldZ / 7, 10, seed + 31);
  const channel = valueNoise2D(worldX / 54, worldZ / 54, 9, seed + 47);
  return freeze({
    macro,
    grain,
    pebble,
    channel,
    signed: saturateSigned((macro - 0.5) * 0.68 + (grain - 0.5) * 0.22 + (pebble - 0.5) * 0.10),
    breakup: clamp01(Math.abs(macro - 0.5) * 1.65 + Math.abs(grain - 0.5) * 0.68 + Math.abs(channel - 0.5) * 0.45),
  });
}

function normalizeInput(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return freeze({
    snowAmount: clamp01(value.snowAmount),
    permanentIce: clamp01(value.permanentIce),
    tundra: clamp01(value.tundra),
    windwardScour: clamp01(value.windwardScour),
    leeDeposit: clamp01(value.leeDeposit),
    ridgeExposure: clamp01(value.ridgeExposure),
    concavityHold: clamp01(value.concavityHold),
    gentleSlope: clamp01(value.gentleSlope),
    slopeDegrees: Math.max(0, Number.isFinite(value.slopeDegrees) ? value.slopeDegrees : 0),
    heightAboveSeaMeters: Number.isFinite(value.heightAboveSeaMeters) ? value.heightAboveSeaMeters : 0,
    worldX: Number.isFinite(value.worldX) ? value.worldX : 0,
    worldZ: Number.isFinite(value.worldZ) ? value.worldZ : 0,
    shorelineDistanceMeters: Number.isFinite(value.shorelineDistanceMeters)
      ? Math.max(0, value.shorelineDistanceMeters)
      : Number.POSITIVE_INFINITY,
    rockWeight: clamp01(value.rockWeight),
    screeWeight: clamp01(value.screeWeight),
    moisture: clamp01(value.moisture),
    canonicalSnowSupply: clamp01(value.canonicalSnowSupply ?? value.snowAmount),
  });
}

function resolveClimate(input) {
  const ice = input.permanentIce;
  const tundra = input.tundra * (1 - ice);
  const cold = clamp01(ice + tundra * 0.72);
  const transition = 4 * ice * (1 - ice);
  return freeze({ ice, tundra, cold, transition });
}

function resolveTerrainResponse(input, climate, noise) {
  const P = TERRAIN_SNOW_RELIEF_DIRECTOR_POLICY;
  const cliffSuppression = smoothstep(
    P.cliffSnowSuppressionStartDegrees,
    P.cliffSnowSuppressionFullDegrees,
    input.slopeDegrees,
  );
  const bowlSupport = smoothstep(
    P.gentleBowlStartDegrees,
    P.gentleBowlFullDegrees,
    input.slopeDegrees,
  ) * input.concavityHold;
  const shoreSuppression = 1 - smoothstep(
    P.nearShoreSnowSuppressionMeters,
    P.farShoreSnowSuppressionMeters,
    input.shorelineDistanceMeters,
  );
  const windSlab = input.windwardScour * (0.58 + input.ridgeExposure * 0.42) * (1 - input.concavityHold * 0.44);
  const ridgeCrust = clamp01(input.ridgeExposure * (0.62 + input.windwardScour * 0.38) * (1 - input.leeDeposit * 0.54));
  const leePowder = input.leeDeposit * (0.56 + bowlSupport * 0.44) * (1 - input.ridgeExposure * 0.52);
  const firn = climate.ice * input.snowAmount * (0.34 + input.concavityHold * 0.42 + input.gentleSlope * 0.24);
  const rockExposure = clamp01(input.rockWeight + cliffSuppression * 0.42 + input.ridgeExposure * 0.18);
  const screeExposure = clamp01(input.screeWeight + input.ridgeExposure * 0.24 + (1 - input.gentleSlope) * 0.16);
  const driftBreakup = clamp01(input.leeDeposit * 0.62 + input.concavityHold * 0.28 + noise.breakup * 0.22);
  const moistureBreakup = clamp01(input.moisture * 0.55 + noise.channel * 0.33 + shoreSuppression * 0.22);
  return freeze({
    cliffSuppression,
    bowlSupport,
    shoreSuppression,
    windSlab,
    ridgeCrust,
    leePowder,
    firn,
    rockExposure,
    screeExposure,
    driftBreakup,
    moistureBreakup,
  });
}

function resolveMaterialWeights(input, climate, terrain, noise) {
  const P = TERRAIN_SNOW_RELIEF_DIRECTOR_POLICY;
  const snow = clamp01(input.snowAmount);
  const visible = smoothstep(P.visibleSnowFloor, P.visibleSnowCeiling, snow);
  const packed = clamp01(
    snow * (0.20 + climate.cold * 0.24)
      + terrain.windSlab * P.windSlabGain
      + terrain.ridgeCrust * P.ridgeCrustGain
      + climate.transition * 0.08,
  );
  const accumulated = clamp01(
    snow * (0.18 + terrain.bowlSupport * 0.28)
      + terrain.leePowder * P.leePowderGain
      + terrain.driftBreakup * P.driftBreakupGain,
  );
  const firn = clamp01(terrain.firn * P.firnGain + climate.ice * snow * 0.19 + terrain.ridgeCrust * 0.08);
  const crust = clamp01(terrain.ridgeCrust * 0.72 + terrain.windSlab * 0.28);
  const powder = clamp01(terrain.leePowder * 0.74 + accumulated * 0.28 - crust * 0.26);
  const glacial = clamp01(climate.ice * snow * P.glacialContinuityGain + climate.transition * 0.12);
  const rock = clamp01(terrain.rockExposure * P.rockExposureGain);
  const scree = clamp01(terrain.screeExposure * P.screeExposureGain);
  const breakup = clamp01(noise.breakup * P.microContrastGain + terrain.moistureBreakup * P.moistureBreakupGain);
  const totalSnow = clamp01(visible * (1 - Math.max(rock * 0.42, scree * 0.32)));
  const neutral = clamp01(totalSnow - Math.max(packed, accumulated, firn) * 0.72);
  const separation = Math.max(P.minimumMaterialSeparation, Math.min(P.maximumMaterialSeparation, 0.04 + breakup * 0.18));
  return freeze({ visible, packed, accumulated, firn, crust, powder, glacial, rock, scree, breakup, totalSnow, neutral, separation });
}

function resolvePaletteBias(weights, terrain, climate) {
  const cold = weights.packed * -0.30 + weights.crust * -0.18 + weights.firn * -0.14 + climate.ice * -0.08;
  const warm = weights.accumulated * 0.16 + weights.powder * 0.21 + terrain.moistureBreakup * 0.06;
  const temperatureBias = saturateSigned(cold + warm);
  const brightnessBias = saturateSigned(weights.accumulated * 0.11 - weights.packed * 0.10 - weights.rock * 0.18 + weights.glacial * -0.02);
  const roughnessBias = saturateSigned(weights.crust * 0.16 + weights.packed * 0.11 - weights.powder * 0.18 - weights.accumulated * 0.12);
  return freeze({ temperatureBias, brightnessBias, roughnessBias });
}

export function resolveTerrainSnowRelief(input = {}) {
  const safe = normalizeInput(input);
  const climate = resolveClimate(safe);
  const noise = reliefMicroBreakup(safe.worldX, safe.worldZ);
  const terrain = resolveTerrainResponse(safe, climate, noise);
  const weights = resolveMaterialWeights(safe, climate, terrain, noise);
  const palette = resolvePaletteBias(weights, terrain, climate);
  const dominantFamily = weights.crust > weights.powder && weights.crust > weights.firn
    ? SNOW_RELIEF_MATERIAL_FAMILIES.crust.id
    : weights.powder > weights.packed && weights.powder > weights.firn
      ? SNOW_RELIEF_MATERIAL_FAMILIES.powder.id
      : weights.firn > weights.packed
        ? SNOW_RELIEF_MATERIAL_FAMILIES.firn.id
        : weights.packed > weights.neutral
          ? SNOW_RELIEF_MATERIAL_FAMILIES.packed.id
          : SNOW_RELIEF_MATERIAL_FAMILIES.neutral.id;
  return freeze({
    policyId: TERRAIN_SNOW_RELIEF_DIRECTOR_POLICY.id,
    canonicalSnowSupply: safe.canonicalSnowSupply,
    climate,
    noise,
    terrain,
    weights,
    palette,
    dominantFamily,
    renderOnly: true,
    heightAuthorityUnchanged: true,
    hydrologyAuthorityUnchanged: true,
    colliderAuthorityUnchanged: true,
    placementAuthorityUnchanged: true,
  });
}

export function applyTerrainSnowReliefToColor(color, input = {}) {
  const result = resolveTerrainSnowRelief(input);
  const target = color && typeof color === 'object' ? color : { r: 1, g: 1, b: 1 };
  const r = clamp01(Number.isFinite(target.r) ? target.r : 1);
  const g = clamp01(Number.isFinite(target.g) ? target.g : 1);
  const b = clamp01(Number.isFinite(target.b) ? target.b : 1);
  const cold = result.palette.temperatureBias;
  const bright = result.palette.brightnessBias;
  const breakup = result.weights.breakup;
  const rockMix = result.weights.rock * 0.18 + result.weights.scree * 0.12;
  return freeze({
    r: clamp01((r + cold * 0.08 + bright * 0.05) * (1 - rockMix) + rockMix * 0.56),
    g: clamp01((g + cold * 0.05 + bright * 0.04) * (1 - rockMix) + rockMix * 0.58),
    b: clamp01((b - cold * 0.10 + bright * 0.06) * (1 - rockMix) + rockMix * 0.60),
    breakup,
    dominantFamily: result.dominantFamily,
  });
}

export function terrainSnowReliefDigest(result) {
  const value = result && typeof result === 'object' ? result : resolveTerrainSnowRelief();
  const ordered = [
    value.policyId,
    value.dominantFamily,
    value.weights.visible.toFixed(6),
    value.weights.packed.toFixed(6),
    value.weights.accumulated.toFixed(6),
    value.weights.firn.toFixed(6),
    value.weights.crust.toFixed(6),
    value.weights.powder.toFixed(6),
    value.weights.glacial.toFixed(6),
    value.weights.rock.toFixed(6),
    value.weights.scree.toFixed(6),
    value.palette.temperatureBias.toFixed(6),
    value.palette.brightnessBias.toFixed(6),
    value.palette.roughnessBias.toFixed(6),
  ];
  return ordered.join('|');
}

export function buildTerrainSnowReliefField({
  xMin = -1000,
  xMax = 1000,
  zMin = -1000,
  zMax = 1000,
  columns = 16,
  rows = 16,
  sample = () => ({}),
} = {}) {
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeRows = Math.max(1, Math.floor(rows));
  const field = [];
  for (let row = 0; row < safeRows; row += 1) {
    const z = lerp(zMin, zMax, safeRows === 1 ? 0.5 : row / (safeRows - 1));
    for (let column = 0; column < safeColumns; column += 1) {
      const x = lerp(xMin, xMax, safeColumns === 1 ? 0.5 : column / (safeColumns - 1));
      const input = sample({ worldX: x, worldZ: z, row, column });
      const result = resolveTerrainSnowRelief({ ...input, worldX: x, worldZ: z });
      field.push(freeze({ row, column, worldX: x, worldZ: z, result, digest: terrainSnowReliefDigest(result) }));
    }
  }
  return freeze(field);
}

export function summarizeTerrainSnowReliefField(field = []) {
  const rows = Array.isArray(field) ? field : [];
  if (rows.length === 0) return freeze({ count: 0, uniqueDigests: 0, minSnow: 0, maxSnow: 0, dominantFamilies: freeze([]) });
  const visible = rows.map((row) => row.result.weights.visible);
  const families = [...new Set(rows.map((row) => row.result.dominantFamily))].sort();
  return freeze({
    count: rows.length,
    uniqueDigests: new Set(rows.map((row) => row.digest)).size,
    minSnow: Math.min(...visible),
    maxSnow: Math.max(...visible),
    dominantFamilies: freeze(families),
  });
}

export function validateTerrainSnowReliefResult(result) {
  const value = result && typeof result === 'object' ? result : null;
  if (!value) return freeze({ ok: false, reason: 'missing-result' });
  const checks = {
    policy: value.policyId === TERRAIN_SNOW_RELIEF_DIRECTOR_POLICY.id,
    finite: [
      value.weights.visible,
      value.weights.packed,
      value.weights.accumulated,
      value.weights.firn,
      value.weights.crust,
      value.weights.powder,
      value.weights.glacial,
      value.weights.rock,
      value.weights.scree,
      value.palette.temperatureBias,
      value.palette.brightnessBias,
      value.palette.roughnessBias,
    ].every(Number.isFinite),
    bounded: [
      value.weights.visible,
      value.weights.packed,
      value.weights.accumulated,
      value.weights.firn,
      value.weights.crust,
      value.weights.powder,
      value.weights.glacial,
      value.weights.rock,
      value.weights.scree,
    ].every((entry) => entry >= 0 && entry <= 1),
    provenance: value.heightAuthorityUnchanged && value.hydrologyAuthorityUnchanged && value.colliderAuthorityUnchanged,
  };
  return freeze({ ok: Object.values(checks).every(Boolean), checks });
}

export function resolveTerrainSnowReliefSafely(input = {}) {
  try {
    const result = resolveTerrainSnowRelief(input);
    const validation = validateTerrainSnowReliefResult(result);
    if (!validation.ok) return freeze({ ...resolveTerrainSnowRelief({}), fallback: true, validation });
    return freeze({ ...result, fallback: false, validation });
  } catch (error) {
    return freeze({
      ...resolveTerrainSnowRelief({}),
      fallback: true,
      validation: freeze({ ok: false, checks: { exception: false }, reason: error instanceof Error ? error.message : String(error) }),
    });
  }
}
