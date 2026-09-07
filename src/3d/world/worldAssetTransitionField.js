/**
 * Multi-boundary transition field for world assets.
 *
 * The field describes where an asset sits relative to coast, river/lake, road and settlement edges.
 * It deliberately does not create those features. Existing distances remain authoritative. Its purpose
 * is to prevent hard visual seams such as dry grass directly touching deep marsh props, identical forest
 * density right up to a settlement wall, or coastal vegetation behaving like inland meadow vegetation.
 *
 * Every output is deterministic and bounded, making it suitable for candidate ranking and render-only
 * material context. Coordinates, height, hydrology and colliders are never modified here.
 *
 * @module world/worldAssetTransitionField
 */

export const WORLD_ASSET_TRANSITION_FIELD_POLICY = Object.freeze({
  id: 'world-asset-transition-field-2026-09-07-v1',
  renderOnly: true,
  placementRankingOnly: true,
  deterministic: true,
  worldSpace: true,
  canonicalDistancesReadOnly: true,
  canonicalHydrologyReadOnly: true,
  canonicalRoadReadOnly: true,
  canonicalSettlementReadOnly: true,
  newGeographyIntroduced: false,
  coastalBandMeters: Object.freeze({ inner: 24, middle: 72, outer: 180 }),
  riverBandMeters: Object.freeze({ inner: 12, middle: 34, outer: 90 }),
  lakeBandMeters: Object.freeze({ inner: 10, middle: 30, outer: 84 }),
  roadBandMeters: Object.freeze({ inner: 4, middle: 11, outer: 32 }),
  settlementBandMeters: Object.freeze({ inner: 8, middle: 28, outer: 75 }),
  maximumFamilyTransitionBoost: 0.28,
  maximumMaterialTransitionMix: 0.12,
});

const FAMILY = Object.freeze({
  tree: 'tree',
  vegetation: 'vegetation',
  shrub: 'shrub',
  rock: 'rock',
  snow: 'snow',
  building: 'building',
  settlement: 'settlement',
  waterside: 'waterside',
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value, 0)));
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function band(distance, inner, outer) {
  const d = finite(distance, Infinity);
  if (!Number.isFinite(d) || d < 0) return 0;
  if (d <= inner) return 1;
  if (d >= outer) return 0;
  return 1 - smooth((d - inner) / Math.max(0.001, outer - inner));
}

function ring(distance, inner, middle, outer) {
  return Object.freeze({
    inner: band(distance, 0, inner),
    middle: band(distance, inner, middle),
    outer: band(distance, middle, outer),
    total: band(distance, 0, outer),
  });
}

function proximityGradient(distance, near, far) {
  const d = finite(distance, Infinity);
  if (!Number.isFinite(d) || d < 0) return 0;
  if (d <= near) return 1;
  if (d >= far) return 0;
  return 1 - smooth((d - near) / Math.max(0.001, far - near));
}

function normalizeFamily(family) {
  const id = String(family ?? '').trim().toLowerCase();
  if (id === 'trees') return FAMILY.tree;
  if (id === 'foliage' || id === 'grass') return FAMILY.vegetation;
  if (id === 'bush') return FAMILY.shrub;
  if (id === 'stone' || id === 'geology' || id === 'talus') return FAMILY.rock;
  if (id === 'ice' || id === 'cryosphere') return FAMILY.snow;
  if (id === 'architecture' || id === 'structure') return FAMILY.building;
  if (id === 'riverbank' || id === 'coastal') return FAMILY.waterside;
  return FAMILY[id] ?? FAMILY.vegetation;
}

function familyTransitionResponse(family, field) {
  const f = normalizeFamily(family);
  const coast = field.coast;
  const river = Math.max(field.river.inner, field.lake.inner);
  const settlement = field.settlement;
  const road = field.road;
  const exposure = field.exposure;
  const moisture = field.moisture;
  const snow = field.snow;

  switch (f) {
    case FAMILY.waterside:
      return clamp01(
        coast.total * 0.42
          + river.total * 0.48
          + field.lake.total * 0.26
          + field.riparian * 0.24
          + field.maritime * 0.12,
      );
    case FAMILY.tree:
      return clamp01(
        (1 - coast.inner * 0.72) * 0.42
          + (1 - settlement.inner * 0.76) * 0.16
          + moisture * 0.16
          + field.shelter * 0.16
          + (1 - exposure) * 0.10,
      );
    case FAMILY.vegetation:
      return clamp01(
        moisture * 0.18
          + coast.middle * 0.12
          + field.wetland * 0.24
          + field.meadow * 0.24
          + (1 - settlement.inner) * 0.08
          + (1 - road.inner) * 0.04,
      );
    case FAMILY.shrub:
      return clamp01(
        field.heath * 0.24
          + coast.middle * 0.16
          + exposure * 0.14
          + (1 - moisture) * 0.12
          + (1 - settlement.inner) * 0.10
          + field.dryness * 0.18,
      );
    case FAMILY.rock:
      return clamp01(
        field.lithic * 0.30
          + field.alpine * 0.18
          + field.talus * 0.20
          + exposure * 0.14
          + coast.inner * 0.10
          + (1 - moisture) * 0.08,
      );
    case FAMILY.snow:
      return clamp01(
        snow * 0.42
          + field.frost * 0.18
          + exposure * 0.10
          + field.alpine * 0.18
          + (1 - moisture) * 0.04
          + (1 - coast.inner) * 0.08,
      );
    case FAMILY.building:
    case FAMILY.settlement:
      return clamp01(
        (1 - coast.inner) * 0.14
          + (1 - river.inner) * 0.14
          + (1 - field.slope) * 0.32
          + (1 - settlement.inner) * 0.08
          + (1 - exposure) * 0.14
          + field.access * 0.18,
      );
    default:
      return 0.5;
  }
}

function transitionGradient(a, b, weight) {
  return clamp01(Math.abs(finite(a) - finite(b)) * clamp01(weight));
}

function materialTransition(field) {
  const salt = clamp01(field.coast.inner * 0.72 + field.maritime * 0.12);
  const damp = clamp01(field.river.inner * 0.50 + field.lake.inner * 0.42 + field.wetland * 0.18);
  const dust = clamp01(field.road.inner * 0.70 + field.road.middle * 0.28);
  const wear = clamp01(field.settlement.inner * 0.64 + field.settlement.middle * 0.26);
  const weathering = clamp01(
    field.exposure * 0.22
      + field.erosion * 0.24
      + salt * 0.18
      + damp * 0.10
      + field.frost * 0.16
      + field.lithic * 0.10,
  );
  return Object.freeze({
    salt,
    damp,
    dust,
    wear,
    weathering,
    albedoShift: clamp01(salt * 0.34 + dust * 0.18 + damp * 0.10),
    roughnessShift: clamp01(weathering * 0.42 + dust * 0.14),
    normalStrength: clamp01(0.26 + weathering * 0.40 + field.lithic * 0.18),
  });
}

export function sampleWorldAssetTransitionField(surface = {}) {
  const coast = ring(
    surface.coastDistance,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.coastalBandMeters.inner,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.coastalBandMeters.middle,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.coastalBandMeters.outer,
  );
  const river = ring(
    surface.riverDistance,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.riverBandMeters.inner,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.riverBandMeters.middle,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.riverBandMeters.outer,
  );
  const lake = ring(
    surface.lakeDistance,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.lakeBandMeters.inner,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.lakeBandMeters.middle,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.lakeBandMeters.outer,
  );
  const road = ring(
    surface.roadDistance,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.roadBandMeters.inner,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.roadBandMeters.middle,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.roadBandMeters.outer,
  );
  const settlement = ring(
    surface.settlementDistance,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.settlementBandMeters.inner,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.settlementBandMeters.middle,
    WORLD_ASSET_TRANSITION_FIELD_POLICY.settlementBandMeters.outer,
  );

  const moisture = clamp01(surface.moisture ?? 0.5);
  const slope = clamp01(finite(surface.slopeDegrees, 0) / 60);
  const snow = clamp01(surface.snow);
  const exposure = clamp01(surface.exposure ?? (slope * 0.65 + (1 - clamp01(surface.shelter ?? 0.5)) * 0.35));
  const shelter = clamp01(surface.shelter ?? 0.5);
  const lithic = clamp01(surface.lithic ?? 0.5);
  const erosion = clamp01(surface.erosion ?? 0.5);
  const deposition = clamp01(surface.deposition ?? 0.5);
  const biome = String(surface.biome ?? '').toLowerCase();

  const wetland = clamp01(
    moisture * 0.62
      + river.inner * 0.28
      + lake.inner * 0.24
      + (/(marsh|swamp|bog|fen|wetland)/.test(biome) ? 0.42 : 0),
  );
  const meadow = clamp01(
    (1 - slope) * 0.44
      + moisture * 0.22
      + deposition * 0.16
      + (/(meadow|grass|plain)/.test(biome) ? 0.28 : 0),
  );
  const heath = clamp01(
    (1 - moisture) * 0.36
      + exposure * 0.20
      + lithic * 0.10
      + (/(heath|steppe|scrub|dry)/.test(biome) ? 0.32 : 0),
  );
  const alpine = clamp01(
    slope * 0.52
      + lithic * 0.22
      + snow * 0.12
      + (/(alpine|mountain|ridge|cliff)/.test(biome) ? 0.26 : 0),
  );
  const talus = clamp01(lithic * 0.34 + erosion * 0.34 + slope * 0.22 + alpine * 0.18);
  const riparian = clamp01(river.total * 0.52 + lake.total * 0.22 + wetland * 0.26);
  const maritime = clamp01(coast.total * 0.70 + coast.middle * 0.18);
  const dryness = clamp01((1 - moisture) * 0.70 + heath * 0.22 + (1 - wetland) * 0.08);
  const frost = clamp01(snow * 0.64 + alpine * 0.18 + exposure * 0.10 + (1 - shelter) * 0.08);
  const access = clamp01(
    (1 - road.inner) * 0.28
      + road.middle * 0.20
      + settlement.middle * 0.20
      + (1 - slope) * 0.18
      + deposition * 0.14,
  );

  const field = {
    policyId: WORLD_ASSET_TRANSITION_FIELD_POLICY.id,
    coast,
    river,
    lake,
    road,
    settlement,
    moisture,
    slope,
    snow,
    exposure,
    shelter,
    lithic,
    erosion,
    deposition,
    wetland,
    meadow,
    heath,
    alpine,
    talus,
    riparian,
    maritime,
    dryness,
    frost,
    access,
    transition: Object.freeze({
      coastRiver: transitionGradient(coast.total, river.total, 0.86),
      coastInland: transitionGradient(coast.total, 1 - coast.total, 0.52),
      wetDry: transitionGradient(wetland, dryness, 0.90),
      roadWild: transitionGradient(road.total, 1 - road.total, 0.48),
      settlementWild: transitionGradient(settlement.total, 1 - settlement.total, 0.52),
      relief: clamp01(slope * 0.70 + alpine * 0.20 + talus * 0.10),
    }),
  };
  field.material = materialTransition(field);
  return Object.freeze(field);
}

export function worldAssetTransitionResponse(surface, family) {
  const field = sampleWorldAssetTransitionField(surface);
  const response = familyTransitionResponse(family, field);
  const familyScore = clamp01(response * (0.80 + field.access * 0.20));
  return Object.freeze({
    policyId: WORLD_ASSET_TRANSITION_FIELD_POLICY.id,
    family: normalizeFamily(family),
    field,
    response,
    familyScore,
    material: field.material,
  });
}

export function transitionFieldDiagnostics(surface, family = FAMILY.vegetation) {
  const result = worldAssetTransitionResponse(surface, family);
  const field = result.field;
  const flags = [];
  if (field.coast.inner > 0.62) flags.push('coastal-inner-band');
  if (field.river.inner > 0.62 || field.lake.inner > 0.62) flags.push('freshwater-edge');
  if (field.wetland > 0.68) flags.push('wetland-dominant');
  if (field.heath > 0.68) flags.push('dry-heath-dominant');
  if (field.alpine > 0.68) flags.push('alpine-dominant');
  if (field.talus > 0.68) flags.push('talus-risk');
  if (field.settlement.inner > 0.62) flags.push('settlement-inner-band');
  if (field.road.inner > 0.62) flags.push('road-inner-band');
  return Object.freeze({
    ...result,
    flags,
    requiresTransitionHandling: flags.length > 0,
  });
}

export function transitionFieldPolicyId() {
  return WORLD_ASSET_TRANSITION_FIELD_POLICY.id;
}
