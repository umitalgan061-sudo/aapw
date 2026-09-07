/**
 * Regional asset-geography anchors.
 *
 * These anchors are a render/distribution policy, not a new map. They describe how existing surface
 * facts should bias asset families in broad geographic regions. The runtime can feed the same anchor
 * weights into candidate ranking, editor previews, or material response without changing coordinates
 * or canonical terrain height.
 *
 * The design goal is to avoid the common open-world failure mode where one generic vegetation rule
 * produces the same tree density and prop vocabulary everywhere. Regional anchors introduce broad
 * ecological tendencies while leaving canonical biome zones, hydrology and the owner map in control.
 */

const clamp01 = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export const WORLD_ASSET_REGIONAL_ANCHOR_POLICY = Object.freeze({
  id: 'world-asset-regional-anchors-2026-09-07-v1',
  renderOnly: true,
  distributionOnly: true,
  canonicalTerrainReadOnly: true,
  canonicalHydrologyReadOnly: true,
  canonicalSettlementReadOnly: true,
  canonicalRoadReadOnly: true,
  newGeographyIntroduced: false,
  deterministic: true,
  regionalInfluenceMax: 0.34,
  edgeBlendNormalizedDistance: 0.16,
  maritimeModeration: true,
  elevationBandResponse: true,
  climateBandResponse: true,
});

export const WORLD_ASSET_REGIONAL_ANCHORS = Object.freeze({
  northWesteros: Object.freeze({
    id: 'north-westeros',
    x: 0.17,
    y: 0.25,
    radius: Object.freeze([0.20, 0.23]),
    climate: Object.freeze({ cold: 1, tundra: 0.88, snow: 0.74, maritime: 0.70 }),
    assets: Object.freeze({
      tree: 0.56,
      vegetation: 0.72,
      shrub: 0.82,
      rock: 0.68,
      snow: 1.00,
      waterside: 0.58,
      building: 0.74,
      settlement: 0.72,
    }),
    surface: Object.freeze({ wet: 0.16, shelter: 0.18, exposure: 0.22, lithic: 0.20 }),
    palette: Object.freeze({ grassHueBias: -0.10, rockCoolBias: 0.18, snowValueBias: 0.08, woodWeatheringBias: 0.10 }),
  }),
  riverlands: Object.freeze({
    id: 'riverlands',
    x: 0.40,
    y: 0.51,
    radius: Object.freeze([0.18, 0.16]),
    climate: Object.freeze({ cold: 0.32, tundra: 0.08, snow: 0.10, maritime: 0.58 }),
    assets: Object.freeze({
      tree: 0.94,
      vegetation: 1.00,
      shrub: 0.78,
      rock: 0.24,
      snow: 0.10,
      waterside: 0.96,
      building: 0.82,
      settlement: 0.90,
    }),
    surface: Object.freeze({ wet: 0.86, shelter: 0.62, exposure: 0.10, lithic: 0.26 }),
    palette: Object.freeze({ grassHueBias: 0.05, rockCoolBias: 0.00, snowValueBias: 0.00, woodWeatheringBias: 0.08 }),
  }),
  vale: Object.freeze({
    id: 'vale',
    x: 0.48,
    y: 0.39,
    radius: Object.freeze([0.12, 0.13]),
    climate: Object.freeze({ cold: 0.46, tundra: 0.14, snow: 0.26, maritime: 0.61 }),
    assets: Object.freeze({
      tree: 0.76,
      vegetation: 0.82,
      shrub: 0.62,
      rock: 0.86,
      snow: 0.42,
      waterside: 0.48,
      building: 0.76,
      settlement: 0.68,
    }),
    surface: Object.freeze({ wet: 0.58, shelter: 0.48, exposure: 0.44, lithic: 0.78 }),
    palette: Object.freeze({ grassHueBias: -0.01, rockCoolBias: 0.12, snowValueBias: 0.06, woodWeatheringBias: 0.12 }),
  }),
  westerlands: Object.freeze({
    id: 'westerlands',
    x: 0.31,
    y: 0.49,
    radius: Object.freeze([0.14, 0.15]),
    climate: Object.freeze({ cold: 0.28, tundra: 0.04, snow: 0.06, maritime: 0.76 }),
    assets: Object.freeze({
      tree: 0.86,
      vegetation: 0.90,
      shrub: 0.74,
      rock: 0.42,
      snow: 0.06,
      waterside: 0.58,
      building: 0.88,
      settlement: 0.86,
    }),
    surface: Object.freeze({ wet: 0.62, shelter: 0.54, exposure: 0.18, lithic: 0.42 }),
    palette: Object.freeze({ grassHueBias: 0.03, rockCoolBias: 0.02, snowValueBias: 0.00, woodWeatheringBias: 0.13 }),
  }),
  reach: Object.freeze({
    id: 'reach',
    x: 0.34,
    y: 0.66,
    radius: Object.freeze([0.18, 0.15]),
    climate: Object.freeze({ cold: 0.10, tundra: 0.00, snow: 0.02, maritime: 0.62 }),
    assets: Object.freeze({
      tree: 0.88,
      vegetation: 0.98,
      shrub: 0.68,
      rock: 0.22,
      snow: 0.02,
      waterside: 0.46,
      building: 0.90,
      settlement: 0.92,
    }),
    surface: Object.freeze({ wet: 0.52, shelter: 0.48, exposure: 0.08, lithic: 0.24 }),
    palette: Object.freeze({ grassHueBias: 0.08, rockCoolBias: -0.02, snowValueBias: 0.00, woodWeatheringBias: 0.06 }),
  }),
  stormlands: Object.freeze({
    id: 'stormlands',
    x: 0.53,
    y: 0.66,
    radius: Object.freeze([0.14, 0.14]),
    climate: Object.freeze({ cold: 0.30, tundra: 0.05, snow: 0.08, maritime: 0.91 }),
    assets: Object.freeze({
      tree: 0.94,
      vegetation: 0.92,
      shrub: 0.72,
      rock: 0.48,
      snow: 0.08,
      waterside: 0.76,
      building: 0.82,
      settlement: 0.78,
    }),
    surface: Object.freeze({ wet: 0.82, shelter: 0.34, exposure: 0.34, lithic: 0.44 }),
    palette: Object.freeze({ grassHueBias: 0.02, rockCoolBias: 0.05, snowValueBias: 0.01, woodWeatheringBias: 0.18 }),
  }),
  dorne: Object.freeze({
    id: 'dorne',
    x: 0.54,
    y: 0.90,
    radius: Object.freeze([0.18, 0.14]),
    climate: Object.freeze({ cold: 0.00, tundra: 0.00, snow: 0.00, maritime: 0.34 }),
    assets: Object.freeze({
      tree: 0.32,
      vegetation: 0.56,
      shrub: 0.96,
      rock: 0.68,
      snow: 0.00,
      waterside: 0.40,
      building: 0.84,
      settlement: 0.88,
    }),
    surface: Object.freeze({ wet: 0.18, shelter: 0.30, exposure: 0.62, lithic: 0.74 }),
    palette: Object.freeze({ grassHueBias: -0.06, rockCoolBias: -0.12, snowValueBias: 0.00, woodWeatheringBias: 0.04 }),
  }),
  essosWest: Object.freeze({
    id: 'essos-west',
    x: 0.78,
    y: 0.44,
    radius: Object.freeze([0.18, 0.22]),
    climate: Object.freeze({ cold: 0.08, tundra: 0.00, snow: 0.00, maritime: 0.44 }),
    assets: Object.freeze({
      tree: 0.62,
      vegetation: 0.76,
      shrub: 0.74,
      rock: 0.62,
      snow: 0.02,
      waterside: 0.54,
      building: 0.94,
      settlement: 0.96,
    }),
    surface: Object.freeze({ wet: 0.42, shelter: 0.40, exposure: 0.36, lithic: 0.62 }),
    palette: Object.freeze({ grassHueBias: 0.01, rockCoolBias: -0.03, snowValueBias: 0.00, woodWeatheringBias: 0.08 }),
  }),
  valyria: Object.freeze({
    id: 'valyria',
    x: 0.66,
    y: 0.67,
    radius: Object.freeze([0.12, 0.10]),
    climate: Object.freeze({ cold: 0.12, tundra: 0.00, snow: 0.00, maritime: 0.52 }),
    assets: Object.freeze({
      tree: 0.08,
      vegetation: 0.22,
      shrub: 0.18,
      rock: 1.00,
      snow: 0.00,
      waterside: 0.36,
      building: 0.54,
      settlement: 0.38,
    }),
    surface: Object.freeze({ wet: 0.28, shelter: 0.18, exposure: 0.72, lithic: 1.00 }),
    palette: Object.freeze({ grassHueBias: -0.16, rockCoolBias: -0.08, snowValueBias: 0.00, woodWeatheringBias: 0.20 }),
  }),
});

function ellipseInfluence(normalizedX, normalizedY, anchor) {
  const rx = Math.max(1e-6, anchor.radius[0]);
  const ry = Math.max(1e-6, anchor.radius[1]);
  const dx = (normalizedX - anchor.x) / rx;
  const dy = (normalizedY - anchor.y) / ry;
  const d = Math.hypot(dx, dy);
  return 1 - smooth(d);
}

export function regionalAnchorInfluences(normalizedX, normalizedY) {
  const x = clamp01(normalizedX);
  const y = clamp01(normalizedY);
  return Object.freeze(Object.fromEntries(
    Object.entries(WORLD_ASSET_REGIONAL_ANCHORS).map(([id, anchor]) => [id, ellipseInfluence(x, y, anchor)]),
  ));
}

function strongestAnchors(influences, maximum = 3) {
  return Object.entries(influences)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maximum)
    .filter(([, weight]) => weight > 0.02);
}

function weightedRegionalProperty(property, influences, fallback) {
  let totalWeight = 0;
  let total = 0;
  for (const [id, weight] of Object.entries(influences)) {
    const value = WORLD_ASSET_REGIONAL_ANCHORS[id]?.[property];
    if (Number.isFinite(Number(value)) && weight > 0) {
      total += Number(value) * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? total / totalWeight : fallback;
}

function weightedFamilyResponse(family, influences) {
  let totalWeight = 0;
  let total = 0;
  for (const [id, weight] of Object.entries(influences)) {
    const value = WORLD_ASSET_REGIONAL_ANCHORS[id]?.assets?.[family];
    if (Number.isFinite(Number(value)) && weight > 0) {
      total += Number(value) * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? total / totalWeight : 0.5;
}

function weightedClimateResponse(key, influences) {
  return weightedRegionalProperty('climate', influences, 0)[key] ?? 0.5;
}

export function sampleRegionalAssetAnchor(normalizedX, normalizedY, family = 'vegetation') {
  const x = clamp01(normalizedX);
  const y = clamp01(normalizedY);
  const influences = regionalAnchorInfluences(x, y);
  const top = strongestAnchors(influences);
  const response = clamp01(weightedFamilyResponse(family, influences));
  const cold = weightedRegionalProperty('climate', Object.fromEntries(Object.entries(influences).filter(([, w]) => w > 0)), 0.3);
  const wet = weightedRegionalProperty('surface', Object.fromEntries(Object.entries(influences).filter(([, w]) => w > 0)), 0.5);
  let climateCold = 0.3;
  let climateTundra = 0;
  let climateSnow = 0;
  let climateMaritime = 0.5;
  let surfaceWet = 0.5;
  let surfaceShelter = 0.5;
  let surfaceExposure = 0.5;
  let surfaceLithic = 0.5;
  let paletteGrass = 0;
  let paletteRock = 0;
  let paletteSnow = 0;
  let paletteWood = 0;
  let colorWeight = 0;
  for (const [id, weight] of Object.entries(influences)) {
    if (!(weight > 0)) continue;
    const anchor = WORLD_ASSET_REGIONAL_ANCHORS[id];
    climateCold += 0;
    climateCold += 0;
    climateCold = lerp(climateCold, finite(anchor.climate?.cold, climateCold), weight * 0.10);
    climateTundra += finite(anchor.climate?.tundra, 0) * weight;
    climateSnow += finite(anchor.climate?.snow, 0) * weight;
    climateMaritime += finite(anchor.climate?.maritime, climateMaritime) * weight;
    surfaceWet += finite(anchor.surface?.wet, surfaceWet) * weight;
    surfaceShelter += finite(anchor.surface?.shelter, surfaceShelter) * weight;
    surfaceExposure += finite(anchor.surface?.exposure, surfaceExposure) * weight;
    surfaceLithic += finite(anchor.surface?.lithic, surfaceLithic) * weight;
    paletteGrass += finite(anchor.palette?.grassHueBias, 0) * weight;
    paletteRock += finite(anchor.palette?.rockCoolBias, 0) * weight;
    paletteSnow += finite(anchor.palette?.snowValueBias, 0) * weight;
    paletteWood += finite(anchor.palette?.woodWeatheringBias, 0) * weight;
    colorWeight += weight;
  }
  if (colorWeight > 0) {
    climateTundra /= colorWeight;
    climateSnow /= colorWeight;
    climateMaritime /= colorWeight;
    surfaceWet /= colorWeight;
    surfaceShelter /= colorWeight;
    surfaceExposure /= colorWeight;
    surfaceLithic /= colorWeight;
    paletteGrass /= colorWeight;
    paletteRock /= colorWeight;
    paletteSnow /= colorWeight;
    paletteWood /= colorWeight;
  }
  const maritime = clamp01(climateMaritime);
  return Object.freeze({
    policyId: WORLD_ASSET_REGIONAL_ANCHOR_POLICY.id,
    normalizedX: x,
    normalizedY: y,
    family,
    response,
    influences,
    strongestAnchors: top.map(([id, weight]) => ({ id, weight })),
    climate: Object.freeze({
      cold: clamp01(climateCold),
      tundra: clamp01(climateTundra),
      snow: clamp01(climateSnow),
      maritime,
      maritimeModeration: clamp01(maritime * WORLD_ASSET_REGIONAL_ANCHOR_POLICY.regionalInfluenceMax),
    }),
    surface: Object.freeze({
      wet: clamp01(surfaceWet),
      shelter: clamp01(surfaceShelter),
      exposure: clamp01(surfaceExposure),
      lithic: clamp01(surfaceLithic),
    }),
    palette: Object.freeze({
      grassHueBias: clampSigned(paletteGrass),
      rockCoolBias: clampSigned(paletteRock),
      snowValueBias: clampSigned(paletteSnow),
      woodWeatheringBias: clampSigned(paletteWood),
    }),
  });
}

function clampSigned(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
}

export function applyRegionalAnchorToPlacementScore(profile, anchor, {
  maximumInfluence = WORLD_ASSET_REGIONAL_ANCHOR_POLICY.regionalInfluenceMax,
} = {}) {
  if (!profile) return 0;
  const regional = clamp01(anchor?.response ?? 0.5);
  const score = clamp01(profile.placementScore);
  const influence = clamp01(anchor?.strongestAnchors?.[0]?.weight ?? 0) * clamp01(maximumInfluence);
  const centered = (regional - 0.5) * 2;
  return clamp01(score + centered * influence * 0.22);
}

export function regionalAssetMaterialBias(anchor) {
  return Object.freeze({
    grassHueBias: clampSigned(anchor?.palette?.grassHueBias) * 0.12,
    rockCoolBias: clampSigned(anchor?.palette?.rockCoolBias) * 0.12,
    snowValueBias: clampSigned(anchor?.palette?.snowValueBias) * 0.08,
    woodWeatheringBias: clampSigned(anchor?.palette?.woodWeatheringBias) * 0.12,
  });
}

export function regionalAnchorDistance(a, b) {
  if (!a || !b) return Infinity;
  const dx = finite(a.normalizedX) - finite(b.normalizedX);
  const dy = finite(a.normalizedY) - finite(b.normalizedY);
  return Math.hypot(dx, dy);
}

export function regionalAnchorBlend(a, b, amount = 0.5) {
  const t = clamp01(amount);
  return Object.freeze({
    normalizedX: lerp(finite(a?.normalizedX), finite(b?.normalizedX), t),
    normalizedY: lerp(finite(a?.normalizedY), finite(b?.normalizedY), t),
    response: lerp(finite(a?.response, 0.5), finite(b?.response, 0.5), t),
    climate: Object.freeze({
      cold: lerp(finite(a?.climate?.cold, 0.3), finite(b?.climate?.cold, 0.3), t),
      tundra: lerp(finite(a?.climate?.tundra), finite(b?.climate?.tundra), t),
      snow: lerp(finite(a?.climate?.snow), finite(b?.climate?.snow), t),
      maritime: lerp(finite(a?.climate?.maritime, 0.5), finite(b?.climate?.maritime, 0.5), t),
    }),
    surface: Object.freeze({
      wet: lerp(finite(a?.surface?.wet, 0.5), finite(b?.surface?.wet, 0.5), t),
      shelter: lerp(finite(a?.surface?.shelter, 0.5), finite(b?.surface?.shelter, 0.5), t),
      exposure: lerp(finite(a?.surface?.exposure, 0.5), finite(b?.surface?.exposure, 0.5), t),
      lithic: lerp(finite(a?.surface?.lithic, 0.5), finite(b?.surface?.lithic, 0.5), t),
    }),
  });
}

export function regionalAnchorDiagnostics(points = [], family = 'vegetation') {
  const samples = points.map((point) => sampleRegionalAssetAnchor(point.x, point.y, family));
  if (!samples.length) return Object.freeze({ count: 0, min: 0, max: 0, mean: 0, range: 0 });
  const values = samples.map((sample) => sample.response);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Object.freeze({
    count: samples.length,
    min,
    max,
    mean,
    range: max - min,
    deterministic: true,
  });
}
