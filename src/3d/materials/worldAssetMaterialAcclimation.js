/**
 * Deterministic habitat/material acclimation for authored world assets.
 *
 * This layer does not create, move or deform geography. It converts the already-authoritative
 * ecological and boundary context into a bounded physical-aging vocabulary that can be consumed by
 * asset materials: wet darkening, salt bloom, freeze-thaw abrasion, mineral exposure, organic patina,
 * dust/trampling, sediment film and directional wind scour.
 *
 * The intent is to make the same authored asset behave like the same material under different climates,
 * geology and hydrology rather than receiving a one-size-fits-all tint. World-space deterministic carriers
 * keep the response spatially coherent without introducing a new map, shoreline, river, road or collider.
 *
 * @module materials/worldAssetMaterialAcclimation
 */

export const WORLD_ASSET_MATERIAL_ACCLIMATION_REVISION = 'v1-deterministic-habitat-material-acclimation';

export const WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY = Object.freeze({
  id: 'world-asset-material-acclimation-2026-09-07-v1',
  revision: WORLD_ASSET_MATERIAL_ACCLIMATION_REVISION,
  renderOnly: true,
  deterministic: true,
  worldSpace: true,
  bounded: true,
  geometryUnchanged: true,
  placementUnchanged: true,
  sourceMapsPreserved: true,
  sourceUvsPreserved: true,
  canonicalTerrainReadOnly: true,
  canonicalHydrologyReadOnly: true,
  canonicalRoadReadOnly: true,
  canonicalSettlementReadOnly: true,
  canonicalColliderReadOnly: true,
  newGeographyIntroduced: false,
  channelBudgets: Object.freeze({
    albedo: 0.085,
    roughness: 0.105,
    normal: 0.082,
    metalness: 0.055,
    microOcclusion: 0.16,
  }),
  climateGain: Object.freeze({
    maritime: 0.90,
    riparian: 0.84,
    alpine: 1.05,
    dryland: 0.74,
    woodland: 0.70,
    settlement: 0.68,
  }),
});

const EPSILON = 1e-6;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value, 0)));
const clampSigned = (value) => Math.max(-1, Math.min(1, finite(value, 0)));
const lerp = (a, b, t) => a + (b - a) * clamp01(t);
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const smoother01 = (value) => {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const mean = (values, fallback = 0) => {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return fallback;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
};
const min = (a, b) => Math.min(finite(a, 0), finite(b, 0));
const max = (a, b) => Math.max(finite(a, 0), finite(b, 0));

function normalize01(value, center = 0.5, scale = 0.5) {
  return clamp01((finite(value, center) - center) / Math.max(EPSILON, scale) * 0.5 + 0.5);
}

function safeDistance(value, fallback = Infinity) {
  const d = Number(value);
  return Number.isFinite(d) && d >= 0 ? d : fallback;
}

function proximity(distance, near, far) {
  const d = safeDistance(distance);
  if (!Number.isFinite(d)) return 0;
  if (d <= near) return 1;
  if (d >= far) return 0;
  return 1 - smoother01((d - near) / Math.max(EPSILON, far - near));
}

function ringBand(distance, inner, middle, outer) {
  return Object.freeze({
    core: proximity(distance, 0, inner),
    transition: proximity(distance, inner, middle),
    fringe: proximity(distance, middle, outer),
    total: proximity(distance, 0, outer),
  });
}

function familyId(family) {
  const id = String(family ?? 'generic').trim().toLowerCase();
  if (id === 'masonry' || id === 'stonework') return 'masonry';
  if (id === 'stone' || id === 'rock' || id === 'cliff' || id === 'bedrock') return 'rock';
  if (id === 'soil' || id === 'ground' || id === 'earth') return 'soil';
  if (id === 'wood' || id === 'timber') return 'wood';
  if (id === 'tree' || id === 'foliage' || id === 'vegetation') return 'foliage';
  if (id === 'metal' || id === 'iron' || id === 'steel') return 'metal';
  if (id === 'roof' || id === 'tile' || id === 'thatch') return 'roof';
  if (id === 'snow' || id === 'ice' || id === 'cryosphere') return 'cryosphere';
  if (id === 'building' || id === 'settlement' || id === 'structure') return 'masonry';
  return id || 'generic';
}

function familyGain(family) {
  switch (familyId(family)) {
    case 'rock': return 1.08;
    case 'masonry': return 0.94;
    case 'soil': return 1.06;
    case 'wood': return 1.00;
    case 'foliage': return 0.84;
    case 'metal': return 0.70;
    case 'roof': return 0.88;
    case 'cryosphere': return 0.76;
    default: return 0.86;
  }
}

function familyChannelBias(family) {
  switch (familyId(family)) {
    case 'rock':
      return Object.freeze({ salt: 1.12, mineral: 1.20, abrasion: 1.12, biofilm: 0.86, dust: 0.78 });
    case 'masonry':
      return Object.freeze({ salt: 1.06, mineral: 1.00, abrasion: 0.92, biofilm: 0.98, dust: 1.06 });
    case 'soil':
      return Object.freeze({ salt: 0.92, mineral: 1.10, abrasion: 0.86, biofilm: 0.94, dust: 1.18 });
    case 'wood':
      return Object.freeze({ salt: 0.90, mineral: 0.66, abrasion: 0.92, biofilm: 1.16, dust: 1.02 });
    case 'foliage':
      return Object.freeze({ salt: 0.72, mineral: 0.46, abrasion: 0.72, biofilm: 1.24, dust: 0.76 });
    case 'metal':
      return Object.freeze({ salt: 1.20, mineral: 0.74, abrasion: 1.08, biofilm: 0.62, dust: 0.96 });
    case 'roof':
      return Object.freeze({ salt: 1.06, mineral: 0.72, abrasion: 1.00, biofilm: 0.82, dust: 0.96 });
    case 'cryosphere':
      return Object.freeze({ salt: 0.42, mineral: 0.58, abrasion: 0.90, biofilm: 0.20, dust: 0.68 });
    default:
      return Object.freeze({ salt: 0.90, mineral: 0.82, abrasion: 0.90, biofilm: 0.82, dust: 0.92 });
  }
}

function canonicalBands(surface = {}) {
  return Object.freeze({
    coast: ringBand(surface.coastDistance, 24, 72, 180),
    river: ringBand(surface.riverDistance, 12, 34, 90),
    lake: ringBand(surface.lakeDistance, 10, 30, 84),
    road: ringBand(surface.roadDistance, 4, 11, 32),
    settlement: ringBand(surface.settlementDistance, 8, 28, 75),
  });
}

function climateSignals(surface = {}, bands) {
  const moisture = clamp01(surface.moisture ?? surface.moistureRetention ?? 0.5);
  const shelter = clamp01(surface.shelter ?? surface.topographicShelter ?? 0.5);
  const exposure = clamp01(surface.exposure ?? surface.windExposure ?? 0.5);
  const slope = clamp01(finite(surface.slopeDegrees, 0) / 60);
  const elevation = Math.max(0, finite(surface.elevationMeters ?? surface.heightMeters ?? surface.elevation, 0));
  const snow = clamp01(surface.snow ?? surface.snowCover ?? 0);
  const erosion = clamp01(surface.erosion ?? 0.5);
  const deposition = clamp01(surface.deposition ?? 0.5);
  const lithic = clamp01(surface.lithic ?? 0.5);
  const coldElevation = smoother01((elevation - 160) / 520);
  const cold = clamp01(snow * 0.54 + coldElevation * 0.26 + exposure * 0.08 + (1 - shelter) * 0.06 + slope * 0.06);
  const maritime = clamp01(bands.coast.total * 0.72 + bands.coast.fringe * 0.18);
  const riparian = clamp01(
    bands.river.total * 0.46
      + bands.lake.total * 0.26
      + moisture * 0.17
      + bands.river.transition * 0.11,
  );
  const dryland = clamp01((1 - moisture) * 0.64 + (1 - riparian) * 0.14 + (1 - maritime) * 0.09 + exposure * 0.13);
  const alpine = clamp01(slope * 0.46 + lithic * 0.22 + cold * 0.20 + exposure * 0.12);
  const woodland = clamp01(surface.woodland ?? surface.forest ?? 0);
  const settlement = clamp01(bands.settlement.total * 0.76 + bands.road.total * 0.18 + surface.disturbance * 0.06);
  const windScour = clamp01(exposure * 0.46 + (1 - shelter) * 0.22 + alpine * 0.18 + maritime * 0.08 + surface.windShear * 0.06);
  const freezeThaw = clamp01(cold * 0.48 + exposure * cold * 0.20 + lithic * cold * 0.16 + erosion * 0.08 + slope * 0.08);
  const wetting = clamp01(riparian * 0.40 + moisture * 0.34 + shelter * 0.12 + bands.lake.core * 0.08 + bands.river.core * 0.06);
  const drying = clamp01(dryland * 0.50 + exposure * 0.18 + windScour * 0.18 + (1 - shelter) * 0.14);
  const saltStress = clamp01(maritime * 0.50 + bands.coast.core * 0.27 + windScour * maritime * 0.17 + surface.saltStress * 0.06);
  const abrasion = clamp01(erosion * 0.34 + windScour * 0.28 + slope * 0.12 + bands.road.core * 0.10 + bands.settlement.core * 0.08 + lithic * 0.08);
  const sedimentFilm = clamp01(
    deposition * 0.36
      + riparian * 0.26
      + bands.coast.transition * 0.14
      + bands.road.transition * 0.10
      + bands.lake.transition * 0.08
      + moisture * 0.06,
  );
  const organicFilm = clamp01(
    moisture * 0.30
      + woodland * 0.26
      + riparian * 0.14
      + shelter * 0.14
      + (1 - saltStress) * 0.08
      + (1 - windScour) * 0.08,
  );
  const dust = clamp01(
    bands.road.core * 0.42
      + bands.settlement.core * 0.18
      + dryland * 0.20
      + windScour * 0.10
      + sedimentFilm * 0.10,
  );
  const biofilm = clamp01(organicFilm * 0.50 + wetting * 0.20 + (1 - saltStress) * 0.12 + shelter * 0.12 + woodland * 0.06);
  const mineralExposure = clamp01(lithic * 0.44 + abrasion * 0.20 + alpine * 0.16 + sedimentFilm * 0.10 + dryland * 0.10);

  return Object.freeze({
    moisture,
    shelter,
    exposure,
    slope,
    elevation,
    snow,
    erosion,
    deposition,
    lithic,
    cold,
    maritime,
    riparian,
    dryland,
    alpine,
    woodland,
    settlement,
    windScour,
    freezeThaw,
    wetting,
    drying,
    saltStress,
    abrasion,
    sedimentFilm,
    organicFilm,
    dust,
    biofilm,
    mineralExposure,
  });
}

function directionalWeathering(surface = {}, climate, bands) {
  const aspect = finite(surface.aspectRadians ?? surface.aspect, 0);
  const flowAngle = finite(surface.sedimentAngle ?? surface.flowAngle, aspect);
  const aspectSin = (Math.sin(aspect) + 1) * 0.5;
  const aspectCos = (Math.cos(aspect) + 1) * 0.5;
  const flowAlignment = (Math.cos(aspect - flowAngle) + 1) * 0.5;
  const roadAlignment = (Math.cos(aspect - finite(surface.roadBearingRadians, flowAngle)) + 1) * 0.5;
  const marineFacing = clamp01(aspectCos * 0.54 + aspectSin * 0.46);
  const windFacing = clamp01(aspectSin * 0.48 + aspectCos * 0.22 + climate.exposure * 0.30);
  const downslope = clamp01(climate.slope * (0.66 + 0.34 * flowAlignment));
  const drainageStreak = clamp01(climate.riparian * (0.34 + 0.66 * flowAlignment));
  const roadWearDirection = clamp01(bands.road.total * (0.30 + roadAlignment * 0.70));
  const saltFacing = clamp01(climate.saltStress * (0.34 + marineFacing * 0.66));
  const frostFace = clamp01(climate.freezeThaw * (0.28 + windFacing * 0.72));
  const rainShadow = clamp01((1 - climate.shelter) * 0.52 + (1 - windFacing) * 0.26 + climate.drying * 0.22);
  return Object.freeze({
    aspect,
    flowAngle,
    aspectSin,
    aspectCos,
    flowAlignment,
    roadAlignment,
    marineFacing,
    windFacing,
    downslope,
    drainageStreak,
    roadWearDirection,
    saltFacing,
    frostFace,
    rainShadow,
  });
}

function interactionSignals(climate, directional, bands) {
  const wetSaltCycle = clamp01(climate.wetting * 0.42 + climate.saltStress * 0.20 + climate.freezeThaw * 0.18 + directional.frostFace * 0.20);
  const dryAbrasionCycle = clamp01(climate.drying * 0.34 + climate.abrasion * 0.34 + directional.roadWearDirection * 0.12 + directional.rainShadow * 0.20);
  const weatheringAxis = clamp01(
    climate.abrasion * 0.26
      + directional.windFacing * 0.20
      + directional.downslope * 0.18
      + directional.drainageStreak * 0.16
      + climate.freezeThaw * 0.10
      + climate.saltStress * 0.10,
  );
  const edgeComplexity = clamp01(
    bands.coast.transition * 0.22
      + bands.river.transition * 0.22
      + bands.lake.transition * 0.16
      + bands.road.transition * 0.16
      + bands.settlement.transition * 0.12
      + (climate.wetting * climate.drying) * 0.12,
  );
  const patinaPotential = clamp01(
    climate.biofilm * 0.34
      + climate.wetting * 0.26
      + climate.shelter * 0.16
      + climate.woodland * 0.10
      + (1 - climate.saltStress) * 0.08
      + edgeComplexity * 0.06,
  );
  const crustPotential = clamp01(
    climate.saltStress * 0.28
      + climate.dryland * 0.18
      + climate.wetting * 0.16
      + climate.freezeThaw * 0.18
      + climate.sedimentFilm * 0.12
      + directional.saltFacing * 0.08,
  );
  const scourPotential = clamp01(
    climate.windScour * 0.42
      + climate.abrasion * 0.22
      + directional.windFacing * 0.18
      + directional.roadWearDirection * 0.08
      + climate.alpine * 0.10,
  );
  const stainingPotential = clamp01(
    climate.wetting * 0.26
      + climate.sedimentFilm * 0.22
      + directional.drainageStreak * 0.20
      + climate.organicFilm * 0.14
      + bands.river.transition * 0.10
      + bands.coast.transition * 0.08,
  );
  return Object.freeze({
    wetSaltCycle,
    dryAbrasionCycle,
    weatheringAxis,
    edgeComplexity,
    patinaPotential,
    crustPotential,
    scourPotential,
    stainingPotential,
  });
}

function materialResponseForFamily(family, climate, directional, interaction) {
  const id = familyId(family);
  const bias = familyChannelBias(id);
  const gain = familyGain(id);
  const maritimeGain = WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.climateGain.maritime;
  const riparianGain = WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.climateGain.riparian;
  const alpineGain = WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.climateGain.alpine;
  const dryGain = WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.climateGain.dryland;
  const settlementGain = WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.climateGain.settlement;

  const saltBloom = clamp01(climate.saltStress * bias.salt * maritimeGain * (0.38 + directional.saltFacing * 0.62));
  const mineralReveal = clamp01(climate.mineralExposure * bias.mineral * (0.55 + alpineGain * 0.45));
  const abrasion = clamp01(climate.abrasion * bias.abrasion * (0.44 + interaction.scourPotential * 0.56));
  const wetDarkening = clamp01(climate.wetting * riparianGain * (0.42 + climate.biofilm * 0.28 + interaction.stainingPotential * 0.30));
  const dryDust = clamp01(climate.dust * bias.dust * dryGain * (0.36 + interaction.dryAbrasionCycle * 0.64));
  const freezeThaw = clamp01(climate.freezeThaw * alpineGain * (0.38 + directional.frostFace * 0.62));
  const organicPatina = clamp01(climate.biofilm * bias.biofilm * (0.42 + interaction.patinaPotential * 0.58));
  const sedimentStain = clamp01(climate.sedimentFilm * riparianGain * (0.42 + directional.drainageStreak * 0.58));
  const settlementWear = clamp01(climate.settlement * settlementGain * (0.42 + climate.abrasion * 0.20 + directional.roadWearDirection * 0.38));
  const windScour = clamp01(climate.windScour * gain * (0.40 + directional.windFacing * 0.60));
  const frostCrust = clamp01(freezeThaw * (0.50 + interaction.crustPotential * 0.50));
  const moistureFilm = clamp01(wetDarkening * (0.72 + climate.moisture * 0.28));
  const particulateLoad = clamp01(dryDust * 0.72 + sedimentStain * 0.18 + settlementWear * 0.10);
  const biofilmLoad = clamp01(organicPatina * 0.82 + moistureFilm * 0.10 + climate.woodland * 0.08);
  const exposureMask = clamp01(abrasion * 0.38 + windScour * 0.24 + freezeThaw * 0.20 + mineralReveal * 0.18);

  const albedoShift = clampSigned(
    saltBloom * 0.48
      + moistureFilm * -0.38
      + dryDust * 0.34
      + sedimentStain * 0.28
      + mineralReveal * 0.22
      + organicPatina * -0.16
      + frostCrust * 0.30
      - 0.20,
  );
  const roughnessShift = clampSigned(
    particulateLoad * 0.34
      + abrasion * 0.28
      + windScour * 0.18
      + mineralReveal * 0.14
      + settlementWear * 0.10
      - moistureFilm * 0.20
      - biofilmLoad * 0.08,
  );
  const normalResponse = clampSigned(
    exposureMask * 0.34
      + sedimentStain * 0.18
      + freezeThaw * 0.18
      + mineralReveal * 0.16
      + windScour * 0.14
      - moistureFilm * 0.10,
  );
  const metalnessReduction = clamp01(
    saltBloom * 0.44
      + freezeThaw * 0.14
      + settlementWear * 0.18
      + moistureFilm * 0.12
      + abrasion * 0.12,
  );
  const microOcclusion = clamp01(
    moistureFilm * 0.22
      + particulateLoad * 0.26
      + biofilmLoad * 0.20
      + sedimentStain * 0.20
      + frostCrust * 0.12,
  );

  return Object.freeze({
    family: id,
    gain,
    saltBloom,
    mineralReveal,
    abrasion,
    wetDarkening,
    dryDust,
    freezeThaw,
    organicPatina,
    sedimentStain,
    settlementWear,
    windScour,
    frostCrust,
    moistureFilm,
    particulateLoad,
    biofilmLoad,
    exposureMask,
    albedoShift,
    roughnessShift,
    normalResponse,
    metalnessReduction,
    microOcclusion,
    directional: directional,
    interaction: interaction,
  });
}

function capResponse(response) {
  const budgets = WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.channelBudgets;
  return Object.freeze({
    ...response,
    albedoShift: clampSigned(response.albedoShift) * budgets.albedo,
    roughnessShift: clampSigned(response.roughnessShift) * budgets.roughness,
    normalResponse: clampSigned(response.normalResponse) * budgets.normal,
    metalnessReduction: clamp01(response.metalnessReduction) * budgets.metalness,
    microOcclusion: clamp01(response.microOcclusion) * budgets.microOcclusion,
  });
}

export function sampleWorldAssetMaterialAcclimation(surface = {}, family = 'generic') {
  const bands = canonicalBands(surface);
  const climate = climateSignals(surface, bands);
  const directional = directionalWeathering(surface, climate, bands);
  const interaction = interactionSignals(climate, directional, bands);
  const raw = materialResponseForFamily(family, climate, directional, interaction);
  const response = capResponse(raw);
  return Object.freeze({
    revision: WORLD_ASSET_MATERIAL_ACCLIMATION_REVISION,
    policyId: WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.id,
    canonicalOnly: true,
    coordinateAware: Number.isFinite(Number(surface.x)) && Number.isFinite(Number(surface.z)),
    x: finite(surface.x, 0),
    z: finite(surface.z, 0),
    bands,
    climate,
    directional,
    interaction,
    response,
  });
}

export function worldAssetMaterialAcclimationResponse(surface = {}, family = 'generic') {
  return sampleWorldAssetMaterialAcclimation(surface, family).response;
}

export function worldAssetMaterialAcclimationBands(surface = {}) {
  return sampleWorldAssetMaterialAcclimation(surface).bands;
}

export function worldAssetMaterialAcclimationClimate(surface = {}) {
  return sampleWorldAssetMaterialAcclimation(surface).climate;
}

export function worldAssetMaterialAcclimationDirectional(surface = {}) {
  const detail = sampleWorldAssetMaterialAcclimation(surface);
  return detail.directional;
}

export function worldAssetMaterialAcclimationInteraction(surface = {}) {
  const detail = sampleWorldAssetMaterialAcclimation(surface);
  return detail.interaction;
}

export function worldAssetMaterialAcclimationPolicy() {
  return WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY;
}

export function worldAssetMaterialAcclimationRevision() {
  return WORLD_ASSET_MATERIAL_ACCLIMATION_REVISION;
}

export function worldAssetMaterialAcclimationFamilyGain(family) {
  return familyGain(family);
}

export function worldAssetMaterialAcclimationFamilyBias(family) {
  return familyChannelBias(familyId(family));
}

export function worldAssetMaterialAcclimationDeterminismProbe(samples = [], family = 'generic') {
  const first = samples.map((surface) => sampleWorldAssetMaterialAcclimation(surface, family));
  const second = samples.map((surface) => sampleWorldAssetMaterialAcclimation(surface, family));
  const same = first.length === second.length
    && first.every((entry, index) => JSON.stringify(entry) === JSON.stringify(second[index]));
  return Object.freeze({
    deterministic: same,
    sampleCount: samples.length,
    first,
    second,
  });
}

export function worldAssetMaterialAcclimationFamilyMatrix(surface = {}) {
  const families = ['rock', 'masonry', 'soil', 'wood', 'foliage', 'metal', 'roof', 'cryosphere', 'generic'];
  const result = {};
  for (const family of families) result[family] = worldAssetMaterialAcclimationResponse(surface, family);
  return Object.freeze(result);
}

export function worldAssetMaterialAcclimationVariance(samples = [], family = 'generic') {
  const values = samples.map((surface) => worldAssetMaterialAcclimationResponse(surface, family));
  const channels = {
    albedoShift: values.map((value) => value.albedoShift),
    roughnessShift: values.map((value) => value.roughnessShift),
    normalResponse: values.map((value) => value.normalResponse),
    metalnessReduction: values.map((value) => value.metalnessReduction),
    microOcclusion: values.map((value) => value.microOcclusion),
  };
  const variance = {};
  for (const [channel, series] of Object.entries(channels)) {
    const center = mean(series, 0);
    variance[channel] = mean(series.map((value) => (value - center) ** 2), 0);
  }
  return Object.freeze({ family, sampleCount: values.length, variance, values: Object.freeze(values) });
}

export function worldAssetMaterialAcclimationDistanceSweep({
  surface = {},
  family = 'generic',
  distanceKey = 'coastDistance',
  distances = [0, 8, 16, 24, 36, 52, 72, 96, 128, 180, 260],
} = {}) {
  return Object.freeze(distances.map((distance) => {
    const sample = { ...surface, [distanceKey]: distance };
    const detail = sampleWorldAssetMaterialAcclimation(sample, family);
    return Object.freeze({
      distance,
      response: detail.response,
      bands: detail.bands,
    });
  }));
}

export function worldAssetMaterialAcclimationSummarize(detail) {
  if (!detail) return Object.freeze({ available: false });
  const climate = detail.climate ?? {};
  const response = detail.response ?? {};
  return Object.freeze({
    available: true,
    policyId: detail.policyId,
    revision: detail.revision,
    coordinateAware: Boolean(detail.coordinateAware),
    maritime: climate.maritime ?? 0,
    riparian: climate.riparian ?? 0,
    alpine: climate.alpine ?? 0,
    dryland: climate.dryland ?? 0,
    wetting: climate.wetting ?? 0,
    drying: climate.drying ?? 0,
    saltStress: climate.saltStress ?? 0,
    abrasion: climate.abrasion ?? 0,
    freezeThaw: climate.freezeThaw ?? 0,
    albedoShift: response.albedoShift ?? 0,
    roughnessShift: response.roughnessShift ?? 0,
    normalResponse: response.normalResponse ?? 0,
    metalnessReduction: response.metalnessReduction ?? 0,
    microOcclusion: response.microOcclusion ?? 0,
  });
}

export function worldAssetMaterialAcclimationCaps() {
  return Object.freeze({ ...WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.channelBudgets });
}

export function worldAssetMaterialAcclimationContract(surface = {}) {
  const detail = sampleWorldAssetMaterialAcclimation(surface, 'generic');
  return Object.freeze({
    policyId: detail.policyId,
    revision: detail.revision,
    renderOnly: WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.renderOnly,
    deterministic: WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.deterministic,
    worldSpace: WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.worldSpace,
    canonicalTerrainReadOnly: WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.canonicalTerrainReadOnly,
    canonicalHydrologyReadOnly: WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.canonicalHydrologyReadOnly,
    canonicalRoadReadOnly: WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.canonicalRoadReadOnly,
    canonicalSettlementReadOnly: WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.canonicalSettlementReadOnly,
    canonicalColliderReadOnly: WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.canonicalColliderReadOnly,
    newGeographyIntroduced: WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.newGeographyIntroduced,
    coordinateAware: detail.coordinateAware,
  });
}

export function worldAssetMaterialAcclimationEnvironmentalSignature(surface = {}) {
  const detail = sampleWorldAssetMaterialAcclimation(surface, 'generic');
  const climate = detail.climate;
  const directional = detail.directional;
  return Object.freeze([
    `m:${climate.moisture.toFixed(4)}`,
    `s:${climate.saltStress.toFixed(4)}`,
    `f:${climate.freezeThaw.toFixed(4)}`,
    `a:${climate.abrasion.toFixed(4)}`,
    `w:${climate.wetting.toFixed(4)}`,
    `d:${climate.drying.toFixed(4)}`,
    `wind:${directional.windFacing.toFixed(4)}`,
    `flow:${directional.flowAlignment.toFixed(4)}`,
  ].join('|'));
}

export function worldAssetMaterialAcclimationEdgeProfile(surface = {}) {
  const detail = sampleWorldAssetMaterialAcclimation(surface, 'generic');
  return Object.freeze({
    coast: detail.bands.coast,
    river: detail.bands.river,
    lake: detail.bands.lake,
    road: detail.bands.road,
    settlement: detail.bands.settlement,
    edgeComplexity: detail.interaction.edgeComplexity,
    stainingPotential: detail.interaction.stainingPotential,
    patinaPotential: detail.interaction.patinaPotential,
    crustPotential: detail.interaction.crustPotential,
    scourPotential: detail.interaction.scourPotential,
  });
}

export function worldAssetMaterialAcclimationPhysicalStory(surface = {}, family = 'generic') {
  const detail = sampleWorldAssetMaterialAcclimation(surface, family);
  const response = detail.response;
  const story = [];
  if (response.saltBloom > 0.035) story.push('salt-bloom');
  if (response.wetDarkening > 0.035) story.push('wet-darkening');
  if (response.dryDust > 0.035) story.push('dust-film');
  if (response.sedimentStain > 0.035) story.push('sediment-stain');
  if (response.freezeThaw > 0.035) story.push('freeze-thaw');
  if (response.organicPatina > 0.035) story.push('organic-patina');
  if (response.windScour > 0.035) story.push('wind-scour');
  if (response.settlementWear > 0.035) story.push('human-wear');
  if (response.mineralReveal > 0.035) story.push('mineral-exposure');
  return Object.freeze(story);
}

export function worldAssetMaterialAcclimationBoundsPass(detail) {
  if (!detail?.response) return false;
  const response = detail.response;
  const budgets = WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.channelBudgets;
  return Math.abs(response.albedoShift) <= budgets.albedo + EPSILON
    && Math.abs(response.roughnessShift) <= budgets.roughness + EPSILON
    && Math.abs(response.normalResponse) <= budgets.normal + EPSILON
    && response.metalnessReduction >= -EPSILON
    && response.metalnessReduction <= budgets.metalness + EPSILON
    && response.microOcclusion >= -EPSILON
    && response.microOcclusion <= budgets.microOcclusion + EPSILON;
}
