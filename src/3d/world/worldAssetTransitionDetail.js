/**
 * World-space transition detail for render-only asset geography.
 *
 * Canonical coastline, hydrology, road and settlement distances remain authoritative. This module
 * only perturbs how material/ecology responses fade across those boundaries so a forest edge, river
 * bank, salt band or road verge does not read as a mathematically concentric halo.
 *
 * All values are deterministic, bounded and derived from caller supplied world X/Z plus authoritative
 * distance/context signals. No geometry, terrain height, hydrology classification, collider or road
 * coordinates are changed here.
 *
 * @module world/worldAssetTransitionDetail
 */

export const WORLD_ASSET_TRANSITION_DETAIL_REVISION = 'v1-world-space-irregular-boundary-fabric';

export const WORLD_ASSET_TRANSITION_DETAIL_POLICY = Object.freeze({
  id: 'world-asset-transition-detail-2026-09-07-v1',
  revision: WORLD_ASSET_TRANSITION_DETAIL_REVISION,
  renderOnly: true,
  deterministic: true,
  canonicalDistanceReadOnly: true,
  canonicalHydrologyReadOnly: true,
  canonicalRoadReadOnly: true,
  canonicalSettlementReadOnly: true,
  newGeographyIntroduced: false,
  boundaryWarpMeters: Object.freeze({ coast: 9.0, river: 6.0, lake: 5.5, road: 3.5, settlement: 7.0 }),
  boundaryWarpScalesMeters: Object.freeze({ macro: 210, meso: 64, fine: 17 }),
  materialNoiseScalesMeters: Object.freeze({ macro: 280, meso: 92, patch: 31, fine: 8.5 }),
  anisotropy: 1.35,
  secondaryCarrierBlend: 0.34,
  materialResponseLimit: 0.18,
  roughnessResponseLimit: 0.16,
  normalResponseLimit: 0.14,
});

const TAU = Math.PI * 2;
const INV_UINT = 1 / 4294967295;
const clamp01 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
};
const clampSigned = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < -1 ? -1 : n > 1 ? 1 : n;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const lerp = (a, b, t) => a + (b - a) * clamp01(t);
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const smoother01 = (value) => {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const fract = (value) => value - Math.floor(value);

function hashUint(value) {
  let x = (value | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

function hash2(ix, iz, seed = 0) {
  return hashUint(
    (ix | 0)
      + Math.imul((iz | 0), 0x1f123bb5)
      + (seed | 0),
  ) * INV_UINT;
}

function hash3(ix, iy, iz, seed = 0) {
  return hashUint(
    (ix | 0)
      + Math.imul((iy | 0), 0x68bc21eb)
      + Math.imul((iz | 0), 0x02e5be93)
      + (seed | 0),
  ) * INV_UINT;
}

function valueNoise2(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoother01(fract(x));
  const fz = smoother01(fract(z));
  const n00 = hash2(ix, iz, seed);
  const n10 = hash2(ix + 1, iz, seed);
  const n01 = hash2(ix, iz + 1, seed);
  const n11 = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fz);
}

function signedNoise2(x, z, seed = 0) {
  return valueNoise2(x, z, seed) * 2 - 1;
}

function rotate2(x, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return Object.freeze({ x: x * c - z * s, z: x * s + z * c });
}

function fbm2(x, z, seed = 0, octaves = 5, persistence = 0.5, lacunarity = 2.03) {
  let px = x;
  let pz = z;
  let total = 0;
  let weight = 0;
  let amplitude = 0.56;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2(px, pz, seed + octave * 1013) * amplitude;
    weight += amplitude;
    const frame = rotate2(px, pz, 0.49 + octave * 0.11);
    px = frame.x * lacunarity + 13.7 + octave * 1.7;
    pz = frame.z * lacunarity - 9.3 - octave * 1.1;
    amplitude *= persistence;
  }
  return weight > 0 ? total / weight : 0.5;
}

function ridged2(x, z, seed = 0, octaves = 4) {
  let px = x;
  let pz = z;
  let total = 0;
  let weight = 0;
  let amplitude = 0.58;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += (1 - Math.abs(signedNoise2(px, pz, seed + octave * 1973))) * amplitude;
    weight += amplitude;
    const frame = rotate2(px, pz, -0.43 + octave * 0.17);
    px = frame.x * 2.08 - 7.9;
    pz = frame.z * 2.08 + 11.8;
    amplitude *= 0.49;
  }
  return weight > 0 ? total / weight : 0.5;
}

function domainWarp(x, z, seed = 0) {
  const macroScale = WORLD_ASSET_TRANSITION_DETAIL_POLICY.boundaryWarpScalesMeters.macro;
  const mesoScale = WORLD_ASSET_TRANSITION_DETAIL_POLICY.boundaryWarpScalesMeters.meso;
  const macroX = signedNoise2(x / macroScale + 7.3, z / macroScale - 11.2, seed + 211);
  const macroZ = signedNoise2(x / macroScale - 13.6, z / macroScale + 5.1, seed + 337);
  const mesoX = signedNoise2((x + macroX * 46) / mesoScale, (z + macroZ * 39) / mesoScale, seed + 509);
  const mesoZ = signedNoise2((x - macroZ * 39) / mesoScale, (z + macroX * 46) / mesoScale, seed + 673);
  return Object.freeze({
    x: x + (macroX * 0.68 + mesoX * 0.32) * 46,
    z: z + (macroZ * 0.68 + mesoZ * 0.32) * 39,
    macroX,
    macroZ,
    mesoX,
    mesoZ,
  });
}

function hasWorldCoordinates(surface) {
  return Number.isFinite(Number(surface?.x)) && Number.isFinite(Number(surface?.z));
}

function directionalCarriers(x, z, seed) {
  const warped = domainWarp(x, z, seed);
  const macro = fbm2(
    warped.x / WORLD_ASSET_TRANSITION_DETAIL_POLICY.materialNoiseScalesMeters.macro,
    warped.z / WORLD_ASSET_TRANSITION_DETAIL_POLICY.materialNoiseScalesMeters.macro,
    seed + 101,
    5,
    0.49,
  );
  const meso = fbm2(
    warped.x / WORLD_ASSET_TRANSITION_DETAIL_POLICY.materialNoiseScalesMeters.meso,
    warped.z / WORLD_ASSET_TRANSITION_DETAIL_POLICY.materialNoiseScalesMeters.meso,
    seed + 202,
    5,
    0.50,
  );
  const patch = fbm2(
    warped.x / WORLD_ASSET_TRANSITION_DETAIL_POLICY.materialNoiseScalesMeters.patch,
    warped.z / WORLD_ASSET_TRANSITION_DETAIL_POLICY.materialNoiseScalesMeters.patch,
    seed + 303,
    4,
    0.48,
  );
  const fine = fbm2(
    warped.x / WORLD_ASSET_TRANSITION_DETAIL_POLICY.materialNoiseScalesMeters.fine,
    warped.z / WORLD_ASSET_TRANSITION_DETAIL_POLICY.materialNoiseScalesMeters.fine,
    seed + 404,
    3,
    0.46,
  );
  const ridge = ridged2(
    warped.x / 118,
    warped.z / 67,
    seed + 505,
    4,
  );
  const directionalFrame = rotate2(warped.x, warped.z, 0.56 + macro * 0.63);
  const linear = fbm2(
    directionalFrame.x / 92,
    directionalFrame.z / 21,
    seed + 606,
    4,
    0.47,
  );
  const cross = fbm2(
    directionalFrame.x / 37,
    directionalFrame.z / 151,
    seed + 707,
    4,
    0.46,
  );
  return Object.freeze({
    warped,
    macro,
    meso,
    patch,
    fine,
    ridge,
    linear,
    cross,
    anisotropic: clamp01(linear * 0.58 + cross * 0.27 + ridge * 0.15),
  });
}

function irregularBoundaryOffset(carriers, familyScale, seedSalt) {
  const macro = carriers.macro - 0.5;
  const meso = carriers.meso - 0.5;
  const fine = carriers.fine - 0.5;
  const linear = carriers.linear - 0.5;
  const cross = carriers.cross - 0.5;
  const phase = hash2(Math.floor(carriers.warped.x / 220), Math.floor(carriers.warped.z / 220), seedSalt);
  const directional = (linear * 0.62 + cross * 0.38) * WORLD_ASSET_TRANSITION_DETAIL_POLICY.anisotropy;
  return clampSigned(
    macro * 0.48 + meso * 0.33 + fine * 0.08 + directional * 0.11 + (phase - 0.5) * 0.07,
  ) * familyScale;
}

function warpedDistance(distance, carriers, familyScale, seedSalt) {
  if (!Number.isFinite(Number(distance)) || distance < 0) return Infinity;
  return Math.max(0, distance + irregularBoundaryOffset(carriers, familyScale, seedSalt));
}

function band(distance, inner, outer) {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (distance <= inner) return 1;
  if (distance >= outer) return 0;
  return 1 - smoother01((distance - inner) / Math.max(0.001, outer - inner));
}

function bandProfile(distance, inner, middle, outer) {
  const total = band(distance, 0, outer);
  const innerWeight = band(distance, 0, inner);
  const middleWeight = band(distance, inner, middle) * (1 - innerWeight * 0.85);
  const outerWeight = band(distance, middle, outer) * (1 - middleWeight * 0.88);
  return Object.freeze({
    inner: clamp01(innerWeight),
    middle: clamp01(middleWeight),
    outer: clamp01(outerWeight),
    total: clamp01(total),
  });
}

function finiteDistance(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : Infinity;
}

function sourceBands(surface, carriers) {
  const p = WORLD_ASSET_TRANSITION_DETAIL_POLICY.boundaryWarpMeters;
  return Object.freeze({
    coast: bandProfile(warpedDistance(finiteDistance(surface.coastDistance), carriers, p.coast, 1101), 24, 72, 180),
    river: bandProfile(warpedDistance(finiteDistance(surface.riverDistance), carriers, p.river, 1201), 12, 34, 90),
    lake: bandProfile(warpedDistance(finiteDistance(surface.lakeDistance), carriers, p.lake, 1301), 10, 30, 84),
    road: bandProfile(warpedDistance(finiteDistance(surface.roadDistance), carriers, p.road, 1401), 4, 11, 32),
    settlement: bandProfile(warpedDistance(finiteDistance(surface.settlementDistance), carriers, p.settlement, 1501), 8, 28, 75),
  });
}

function localMaterialCarriers(carriers, surface) {
  const slope = clamp01(finite(surface.slopeDegrees) / 55);
  const moisture = clamp01(surface.moisture ?? 0.5);
  const exposure = clamp01(surface.exposure ?? (slope * 0.66 + (1 - finite(surface.shelter, 0.5)) * 0.34));
  const shelter = clamp01(surface.shelter ?? 0.5);
  const erosion = clamp01(surface.erosion ?? 0.5);
  const deposition = clamp01(surface.deposition ?? 0.5);
  const snow = clamp01(surface.snow ?? surface.snowCover ?? 0);
  const lithic = clamp01(surface.lithic ?? 0.5);
  const ridge = clamp01(carriers.ridge);
  const anisotropic = clamp01(carriers.anisotropic);

  const trampling = clamp01(
    Math.max(
      sourceDistanceWeight(surface.roadDistance, 0, 32) * 0.62,
      sourceDistanceWeight(surface.settlementDistance, 0, 75) * 0.48,
    ),
  );
  const saltStress = clamp01(
    sourceDistanceWeight(surface.coastDistance, 0, 180) * 0.56
      + sourceDistanceWeight(surface.coastDistance, 0, 52) * 0.24,
  );
  const freshwaterDamp = clamp01(
    sourceDistanceWeight(surface.riverDistance, 0, 90) * 0.48
      + sourceDistanceWeight(surface.lakeDistance, 0, 84) * 0.30,
  );
  const riparianSediment = clamp01(
    freshwaterDamp * 0.48
      + deposition * 0.22
      + carriers.cross * 0.14
      + (1 - carriers.ridge) * 0.16,
  );
  const intertidalDebris = clamp01(
    saltStress * 0.44
      + carriers.linear * 0.24
      + carriers.patch * 0.17
      + (1 - slope) * 0.15,
  );
  const frostStress = clamp01(
    snow * 0.62
      + coldClimateProxy(surface) * 0.20
      + exposure * snow * 0.18,
  );
  const windShear = clamp01(
    exposure * 0.49
      + carriers.linear * 0.22
      + carriers.ridge * 0.19
      + (1 - shelter) * 0.10,
  );
  const moss = clamp01(
    freshwaterDamp * 0.30
      + moisture * 0.25
      + shelter * 0.22
      + deposition * 0.09
      + carriers.patch * 0.08
      - saltStress * 0.12
      - windShear * 0.08,
  );
  const lichen = clamp01(
    lithic * 0.37
      + exposure * 0.19
      + saltStress * 0.12
      + frostStress * 0.16
      + carriers.fine * 0.10
      + shelter * 0.06,
  );
  const dust = clamp01(
    trampling * 0.46
      + (1 - moisture) * 0.21
      + exposure * 0.12
      + carriers.patch * 0.12
      + carriers.fine * 0.09,
  );
  const weathering = clamp01(
    saltStress * 0.16
      + freshwaterDamp * 0.09
      + frostStress * 0.18
      + windShear * 0.18
      + erosion * 0.21
      + lithic * 0.08
      + carriers.meso * 0.10,
  );
  const sedimentFabric = clamp01(
    riparianSediment * 0.35
      + intertidalDebris * 0.23
      + deposition * 0.18
      + anisotropic * 0.16
      + carriers.cross * 0.08,
  );
  const wetPolish = clamp01(freshwaterDamp * 0.44 + saltStress * 0.22 + shelter * 0.16 + moss * 0.18);
  const granularRoughness = clamp01(
    lithic * 0.33
      + dust * 0.22
      + weathering * 0.19
      + carriers.fine * 0.14
      + frostStress * 0.12,
  );
  const normalEnergy = clamp01(
    slope * 0.18
      + erosion * 0.18
      + lithic * 0.20
      + carriers.meso * 0.15
      + carriers.patch * 0.12
      + sedimentFabric * 0.17,
  );
  return Object.freeze({
    slope,
    moisture,
    exposure,
    shelter,
    erosion,
    deposition,
    snow,
    lithic,
    trampling,
    saltStress,
    freshwaterDamp,
    riparianSediment,
    intertidalDebris,
    frostStress,
    windShear,
    moss,
    lichen,
    dust,
    weathering,
    sedimentFabric,
    wetPolish,
    granularRoughness,
    normalEnergy,
  });
}

function sourceDistanceWeight(distance, near, far) {
  const d = finiteDistance(distance);
  if (!Number.isFinite(d)) return 0;
  if (d <= near) return 1;
  if (d >= far) return 0;
  return 1 - smoother01((d - near) / Math.max(0.001, far - near));
}

function coldClimateProxy(surface) {
  const snow = clamp01(surface.snow ?? surface.snowCover ?? 0);
  const elevation = Math.max(0, finite(surface.elevationMeters ?? surface.heightMeters, 0));
  const elevationCold = smoother01((elevation - 160) / 380);
  const biome = String(surface.biome ?? '').toLowerCase();
  const tundra = /tundra|polar|subarctic|frost|ice/.test(biome) ? 1 : 0;
  return clamp01(snow * 0.56 + elevationCold * 0.22 + tundra * 0.22);
}

function boundaryBlend(a, b, weight) {
  const wa = clamp01(a);
  const wb = clamp01(b);
  return clamp01(wa * (1 - clamp01(weight)) + wb * clamp01(weight));
}

function familyMaterialResponse(carriers, bands, local, family) {
  const id = String(family ?? 'vegetation').trim().toLowerCase();
  const coast = bands.coast;
  const freshwater = Math.max(bands.river.total, bands.lake.total);
  const settlement = bands.settlement;
  const road = bands.road;
  const maritime = coast.total;
  const wet = clamp01(local.freshwaterDamp * 0.52 + local.moisture * 0.24 + local.moss * 0.24);
  const dry = clamp01((1 - local.moisture) * 0.58 + local.dust * 0.26 + local.exposure * 0.16);
  const exposed = clamp01(local.exposure * 0.64 + local.windShear * 0.22 + carriers.ridge * 0.14);
  const familyDamp = id === 'rock' ? wet * 0.70 : id === 'snow' ? wet * 0.38 : wet;
  const familySalt = id === 'rock' || id === 'building' ? maritime * 0.84 : maritime * 0.58;
  const familyDust = id === 'building' || id === 'settlement' ? Math.max(road.total, settlement.total) * 0.78 : road.total * 0.52;
  const familyFrost = id === 'snow' ? local.frostStress * 1.1 : local.frostStress;
  const regionalCarrier = clamp01(
    carriers.macro * 0.31
      + carriers.meso * 0.27
      + carriers.patch * 0.20
      + carriers.fine * 0.12
      + carriers.anisotropic * 0.10,
  );

  const colorDrift = clampSigned(
    (dry - wet) * 0.28
      + (familySalt - familyDamp) * 0.22
      + (regionalCarrier - 0.5) * 0.11,
  ) * WORLD_ASSET_TRANSITION_DETAIL_POLICY.materialResponseLimit;
  const roughnessDelta = clampSigned(
    local.granularRoughness * 0.46
      + familyDust * 0.16
      + familySalt * 0.12
      + familyFrost * 0.12
      - familyDamp * 0.22
      - 0.42,
  ) * WORLD_ASSET_TRANSITION_DETAIL_POLICY.roughnessResponseLimit;
  const normalDelta = clampSigned(
    local.normalEnergy * 0.50
      + local.weathering * 0.21
      + local.sedimentFabric * 0.14
      + exposed * 0.15
      - 0.48,
  ) * WORLD_ASSET_TRANSITION_DETAIL_POLICY.normalResponseLimit;
  const opacityDelta = clampSigned(
    local.saltStress * 0.022 - local.frostStress * 0.014 + local.dust * 0.006,
  );

  return Object.freeze({
    family: id,
    wet,
    dry,
    exposed,
    maritime,
    freshwater,
    road: road.total,
    settlement: settlement.total,
    dust: familyDust,
    salt: familySalt,
    frost: familyFrost,
    moss: local.moss,
    lichen: local.lichen,
    sedimentFabric: local.sedimentFabric,
    weathering: local.weathering,
    colorDrift,
    roughnessDelta,
    normalDelta,
    opacityDelta,
    intertidalDebris: local.intertidalDebris,
    riparianSediment: local.riparianSediment,
    trampling: local.trampling,
    wetPolish: local.wetPolish,
  });
}

function transitionNarrative(bands, local) {
  const flags = [];
  if (bands.coast.inner > 0.60) flags.push('salt-exposed-edge');
  if (bands.river.inner > 0.60 || bands.lake.inner > 0.60) flags.push('freshwater-margin');
  if (local.riparianSediment > 0.64) flags.push('alluvial-sediment');
  if (local.intertidalDebris > 0.60) flags.push('intertidal-debris');
  if (local.trampling > 0.58) flags.push('trampled-verge');
  if (local.moss > 0.66) flags.push('moss-favoring');
  if (local.lichen > 0.68) flags.push('lichen-favoring');
  if (local.frostStress > 0.68) flags.push('frost-weathered');
  if (local.windShear > 0.68) flags.push('wind-exposed');
  if (local.sedimentFabric > 0.68) flags.push('directional-sediment');
  return Object.freeze(flags);
}

function fallbackDetail(surface) {
  return Object.freeze({
    revision: WORLD_ASSET_TRANSITION_DETAIL_REVISION,
    policyId: WORLD_ASSET_TRANSITION_DETAIL_POLICY.id,
    coordinateAware: false,
    carriers: Object.freeze({ macro: 0.5, meso: 0.5, patch: 0.5, fine: 0.5, ridge: 0.5, linear: 0.5, cross: 0.5, anisotropic: 0.5, warped: { x: finite(surface?.x, 0), z: finite(surface?.z, 0) } }),
    bands: Object.freeze({
      coast: bandProfile(finiteDistance(surface?.coastDistance), 24, 72, 180),
      river: bandProfile(finiteDistance(surface?.riverDistance), 12, 34, 90),
      lake: bandProfile(finiteDistance(surface?.lakeDistance), 10, 30, 84),
      road: bandProfile(finiteDistance(surface?.roadDistance), 4, 11, 32),
      settlement: bandProfile(finiteDistance(surface?.settlementDistance), 8, 28, 75),
    }),
    local: Object.freeze({
      slope: clamp01(finite(surface?.slopeDegrees) / 55),
      moisture: clamp01(surface?.moisture ?? 0.5),
      exposure: clamp01(surface?.exposure ?? 0.5),
      shelter: clamp01(surface?.shelter ?? 0.5),
      erosion: clamp01(surface?.erosion ?? 0.5),
      deposition: clamp01(surface?.deposition ?? 0.5),
      snow: clamp01(surface?.snow ?? 0),
      lithic: clamp01(surface?.lithic ?? 0.5),
      trampling: 0,
      saltStress: 0,
      freshwaterDamp: 0,
      riparianSediment: 0,
      intertidalDebris: 0,
      frostStress: 0,
      windShear: 0,
      moss: 0,
      lichen: 0,
      dust: 0,
      weathering: 0,
      sedimentFabric: 0,
      wetPolish: 0,
      granularRoughness: 0.5,
      normalEnergy: 0.5,
    }),
    material: Object.freeze({}),
    flags: Object.freeze([]),
  });
}

export function sampleWorldAssetTransitionDetail(surface = {}, { seed = 0, family = 'vegetation' } = {}) {
  const baseSeed = hashUint(finite(seed, 0));
  if (!hasWorldCoordinates(surface)) return fallbackDetail(surface);
  const carriers = directionalCarriers(finite(surface.x), finite(surface.z), baseSeed);
  const bands = sourceBands(surface, carriers);
  const local = localMaterialCarriers(carriers, surface);
  const material = familyMaterialResponse(carriers, bands, local, family);
  return Object.freeze({
    revision: WORLD_ASSET_TRANSITION_DETAIL_REVISION,
    policyId: WORLD_ASSET_TRANSITION_DETAIL_POLICY.id,
    coordinateAware: true,
    seed: baseSeed,
    x: finite(surface.x),
    z: finite(surface.z),
    carriers,
    bands,
    local,
    material,
    flags: transitionNarrative(bands, local),
  });
}

export function applyTransitionDetailToCanonicalBands(surface = {}, { seed = 0 } = {}) {
  const detail = sampleWorldAssetTransitionDetail(surface, { seed });
  return Object.freeze({
    coast: detail.bands.coast,
    river: detail.bands.river,
    lake: detail.bands.lake,
    road: detail.bands.road,
    settlement: detail.bands.settlement,
    detail,
  });
}

export function sampleTransitionFamilyMaterial(surface = {}, family = 'vegetation', options = {}) {
  return sampleWorldAssetTransitionDetail(surface, { ...options, family }).material;
}

export function transitionDetailPolicyId() {
  return WORLD_ASSET_TRANSITION_DETAIL_POLICY.id;
}

export function transitionDetailRevision() {
  return WORLD_ASSET_TRANSITION_DETAIL_REVISION;
}

export function transitionDetailCoordinateAware(surface = {}) {
  return hasWorldCoordinates(surface);
}

export function transitionDetailFlagSet(surface = {}, options = {}) {
  return sampleWorldAssetTransitionDetail(surface, options).flags;
}

export function transitionDetailMaterialResponse(surface = {}, family = 'vegetation', options = {}) {
  return Object.freeze({
    policyId: WORLD_ASSET_TRANSITION_DETAIL_POLICY.id,
    family,
    ...sampleTransitionFamilyMaterial(surface, family, options),
  });
}

export function transitionDetailDeterminismProbe(samples = [], options = {}) {
  const first = samples.map((sample, index) => sampleWorldAssetTransitionDetail(sample, {
    ...options,
    seed: hashUint(finite(options.seed, 0) + index * 1013),
  }));
  const second = samples.map((sample, index) => sampleWorldAssetTransitionDetail(sample, {
    ...options,
    seed: hashUint(finite(options.seed, 0) + index * 1013),
  }));
  const same = first.length === second.length && first.every((value, index) => JSON.stringify(value) === JSON.stringify(second[index]));
  return Object.freeze({
    deterministic: same,
    sampleCount: samples.length,
    first,
    second,
  });
}

export function transitionDetailSpatialProbe(points = [], options = {}) {
  const result = points.map((point, index) => sampleWorldAssetTransitionDetail(point, {
    ...options,
    seed: hashUint(finite(options.seed, 0) + index * 1739),
  }));
  return Object.freeze({
    revision: WORLD_ASSET_TRANSITION_DETAIL_REVISION,
    count: result.length,
    coordinateAwareCount: result.filter((item) => item.coordinateAware).length,
    edgeFlagCount: result.filter((item) => item.flags.length > 0).length,
    results: Object.freeze(result),
  });
}

export function transitionDetailFamilyMatrix(surface = {}, families = []) {
  const list = Array.isArray(families) && families.length > 0
    ? families
    : ['tree', 'vegetation', 'shrub', 'rock', 'snow', 'building', 'settlement', 'waterside'];
  const output = {};
  for (const family of list) output[family] = sampleTransitionFamilyMaterial(surface, family);
  return Object.freeze(output);
}

export function summarizeTransitionDetail(detail) {
  if (!detail) return Object.freeze({ available: false });
  const local = detail.local ?? {};
  const bands = detail.bands ?? {};
  return Object.freeze({
    available: true,
    revision: detail.revision,
    policyId: detail.policyId,
    coordinateAware: Boolean(detail.coordinateAware),
    coast: bands.coast?.total ?? 0,
    freshwater: Math.max(bands.river?.total ?? 0, bands.lake?.total ?? 0),
    road: bands.road?.total ?? 0,
    settlement: bands.settlement?.total ?? 0,
    saltStress: local.saltStress ?? 0,
    freshwaterDamp: local.freshwaterDamp ?? 0,
    trampling: local.trampling ?? 0,
    weathering: local.weathering ?? 0,
    sedimentFabric: local.sedimentFabric ?? 0,
    moss: local.moss ?? 0,
    lichen: local.lichen ?? 0,
    flags: Object.freeze([...(detail.flags ?? [])]),
  });
}

export function transitionDetailSurfaceFingerprint(surface = {}, seed = 0) {
  const detail = sampleWorldAssetTransitionDetail(surface, { seed });
  const parts = [
    detail.revision,
    detail.coordinateAware ? '1' : '0',
    Number(detail.carriers?.macro ?? 0).toFixed(6),
    Number(detail.carriers?.meso ?? 0).toFixed(6),
    Number(detail.carriers?.patch ?? 0).toFixed(6),
    Number(detail.local?.saltStress ?? 0).toFixed(6),
    Number(detail.local?.freshwaterDamp ?? 0).toFixed(6),
    Number(detail.material?.roughnessDelta ?? 0).toFixed(6),
    Number(detail.material?.normalDelta ?? 0).toFixed(6),
  ];
  return parts.join('|');
}

export function transitionDetailBoundaryVariance(samples = [], family = 'vegetation', options = {}) {
  const values = samples.map((surface, index) => sampleTransitionFamilyMaterial(surface, family, {
    ...options,
    seed: hashUint(finite(options.seed, 0) + index * 1973),
  }));
  const roughness = values.map((entry) => finite(entry.roughnessDelta, 0));
  const color = values.map((entry) => finite(entry.colorDrift, 0));
  const mean = (items) => items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : 0;
  const meanRoughness = mean(roughness);
  const meanColor = mean(color);
  return Object.freeze({
    family,
    sampleCount: values.length,
    roughnessVariance: mean(roughness.map((value) => (value - meanRoughness) ** 2)),
    colorVariance: mean(color.map((value) => (value - meanColor) ** 2)),
    values: Object.freeze(values),
  });
}

export function transitionDetailBoundarySeries({
  center = { x: 0, z: 0 },
  radiusMeters = 120,
  samples = 24,
  family = 'vegetation',
  seed = 0,
} = {}) {
  const count = Math.max(4, Math.min(256, Math.round(finite(samples, 24))));
  const radius = Math.max(1, finite(radiusMeters, 120));
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * TAU;
    const x = finite(center.x) + Math.cos(angle) * radius;
    const z = finite(center.z) + Math.sin(angle) * radius;
    const detail = sampleWorldAssetTransitionDetail({ x, z, coastDistance: radius, moisture: 0.52, biome: 'coast' }, { seed, family });
    result.push(Object.freeze({ angleRadians: angle, x, z, detail }));
  }
  return Object.freeze(result);
}

export function transitionDetailMonotoneDistanceResponse({
  surface = {},
  family = 'vegetation',
  distanceKey = 'riverDistance',
  distances = [0, 4, 8, 12, 18, 26, 40, 64, 90, 120],
  seed = 0,
} = {}) {
  return Object.freeze(distances.map((distance, index) => {
    const sample = { ...surface, [distanceKey]: distance };
    const detail = sampleWorldAssetTransitionDetail(sample, { seed: hashUint(finite(seed, 0) + index * 31), family });
    return Object.freeze({ distance, detail });
  }));
}

export function transitionDetailCompactContract(surface = {}) {
  const detail = sampleWorldAssetTransitionDetail(surface);
  return Object.freeze({
    revision: detail.revision,
    coordinateAware: detail.coordinateAware,
    policyId: detail.policyId,
    canonicalDistanceReadOnly: WORLD_ASSET_TRANSITION_DETAIL_POLICY.canonicalDistanceReadOnly,
    canonicalHydrologyReadOnly: WORLD_ASSET_TRANSITION_DETAIL_POLICY.canonicalHydrologyReadOnly,
    canonicalRoadReadOnly: WORLD_ASSET_TRANSITION_DETAIL_POLICY.canonicalRoadReadOnly,
    canonicalSettlementReadOnly: WORLD_ASSET_TRANSITION_DETAIL_POLICY.canonicalSettlementReadOnly,
    newGeographyIntroduced: WORLD_ASSET_TRANSITION_DETAIL_POLICY.newGeographyIntroduced,
  });
}

export function transitionDetailVisualLanguage(surface = {}) {
  const detail = sampleWorldAssetTransitionDetail(surface, { family: 'rock' });
  const local = detail.local;
  const language = [];
  if (local.lithic > 0.64) language.push('lithic');
  if (local.saltStress > 0.48) language.push('salt-weathered');
  if (local.freshwaterDamp > 0.48) language.push('water-dampened');
  if (local.sedimentFabric > 0.56) language.push('depositional');
  if (local.trampling > 0.44) language.push('human-verge');
  if (local.frostStress > 0.52) language.push('frost');
  if (local.windShear > 0.52) language.push('wind-scoured');
  if (local.moss > 0.46) language.push('moss');
  if (local.lichen > 0.54) language.push('lichen');
  return Object.freeze(language);
}

export function transitionDetailMaterialCaps() {
  return Object.freeze({
    maximumColorMix: WORLD_ASSET_TRANSITION_DETAIL_POLICY.materialResponseLimit,
    maximumRoughnessDelta: WORLD_ASSET_TRANSITION_DETAIL_POLICY.roughnessResponseLimit,
    maximumNormalDelta: WORLD_ASSET_TRANSITION_DETAIL_POLICY.normalResponseLimit,
  });
}
