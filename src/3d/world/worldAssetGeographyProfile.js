/**
 * Deterministic, render/placement-policy-only geography profile for world assets.
 *
 * This module does not move geometry, edit terrain height, alter hydrology, or invent a new map.
 * Instead it turns the authoritative surface facts already available at placement time into a stable
 * ecological explanation for why an asset belongs at a location. The profile is intentionally useful
 * to three consumers:
 *
 * 1. placement QA - reject assets that are technically placeable but ecologically nonsensical;
 * 2. material response - tell the material system why a model is damp, dusty, frost-stressed, etc.;
 * 3. distribution - rank deterministic candidates so the same model family does not form visible
 *    grids, circular groves, or one-biome-everywhere scatter.
 *
 * The functions are pure and world-space deterministic. They require no DOM, no WebGL state and no
 * mutable singleton. This makes them safe for browser runtime, headless CI and editor authoring.
 *
 * @module world/worldAssetGeographyProfile
 */

const PI2 = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;

const clamp01 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

const clampSigned = (value) => Math.max(-1, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const smoother = (value) => {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const range = (value, low, high) => smoother((finite(value) - low) / Math.max(1e-9, high - low));
const bell = (value, center, halfWidth) => 1 - smoother(Math.abs(finite(value) - center) / Math.max(1e-9, halfWidth));

function hashUint(value) {
  let x = (Number(value) | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

function hash2(ix, iz, seed = 0) {
  const a = hashUint((ix | 0) + Math.imul((iz | 0), 0x1f123bb5) + (seed | 0));
  return a / 4294967295;
}

function hash3(ix, iy, iz, seed = 0) {
  const a = hashUint(
    (ix | 0)
      + Math.imul((iy | 0), 0x68bc21eb)
      + Math.imul((iz | 0), 0x02e5be93)
      + (seed | 0),
  );
  return a / 4294967295;
}

function valueNoise2(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoother(x - ix);
  const fz = smoother(z - iz);
  const n00 = hash2(ix, iz, seed);
  const n10 = hash2(ix + 1, iz, seed);
  const n01 = hash2(ix, iz + 1, seed);
  const n11 = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fz);
}

function signedNoise2(x, z, seed = 0) {
  return valueNoise2(x, z, seed) * 2 - 1;
}

function fbm2(x, z, seed = 0, octaves = 4) {
  let px = x;
  let pz = z;
  let amplitude = 0.56;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2(px, pz, seed + octave * 1013) * amplitude;
    normalization += amplitude;
    const angle = 0.53 + octave * 0.11;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rx = px * c - pz * s;
    const rz = px * s + pz * c;
    px = rx * 2.03 + 13.71 + octave * 1.7;
    pz = rz * 2.03 - 9.33 - octave * 1.1;
    amplitude *= 0.49;
  }
  return normalization > 0 ? total / normalization : 0.5;
}

function ridged2(x, z, seed = 0, octaves = 4) {
  let px = x;
  let pz = z;
  let amplitude = 0.58;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const n = signedNoise2(px, pz, seed + octave * 1973);
    total += (1 - Math.abs(n)) * amplitude;
    normalization += amplitude;
    const angle = -0.47 + octave * 0.17;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rx = px * c - pz * s;
    const rz = px * s + pz * c;
    px = rx * 2.07 - 5.9;
    pz = rz * 2.07 + 11.4;
    amplitude *= 0.50;
  }
  return normalization > 0 ? total / normalization : 0.5;
}

function normalizedId(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[_\s]+/g, '-');
}

const BIOME_ALIASES = Object.freeze({
  forest: /forest|wood|grove|taiga|pine|woodland/,
  meadow: /meadow|grass|pasture|plain|lowland|field/,
  heath: /heath|moor|steppe|dry|upland|scrub/,
  wetland: /wetland|marsh|swamp|bog|fen|reed/,
  riparian: /riparian|riverbank|floodplain|alluvial|stream/,
  coast: /coast|shore|beach|dune|intertidal|saltmarsh/,
  rock: /rock|cliff|ridge|mountain|bare|scree|talus|stone/,
  alpine: /alpine|subalpine|high-mountain|snowfield/,
  snow: /snow|ice|glacier|permanent-ice|cryosphere/,
  tundra: /tundra|polar|cold|frost/,
  desert: /desert|arid|badlands|salt-flat/,
  lava: /lava|volcanic|basalt|obsidian|ash|pumice/,
});

function parseBiome(value) {
  const id = normalizedId(value);
  const flags = {};
  for (const [key, pattern] of Object.entries(BIOME_ALIASES)) flags[key] = pattern.test(id) ? 1 : 0;
  return Object.freeze({ id, ...flags });
}

function angularDifference(a, b) {
  let delta = finite(a) - finite(b);
  while (delta > Math.PI) delta -= PI2;
  while (delta < -Math.PI) delta += PI2;
  return delta;
}

function aspectComponents(aspectRadians) {
  const aspect = finite(aspectRadians, 0);
  return Object.freeze({
    radians: aspect,
    northness: clamp01(0.5 + 0.5 * Math.cos(aspect)),
    southness: clamp01(0.5 + 0.5 * Math.cos(aspect - Math.PI)),
    eastness: clamp01(0.5 + 0.5 * Math.cos(aspect - HALF_PI)),
    westness: clamp01(0.5 + 0.5 * Math.cos(aspect + HALF_PI)),
  });
}

export const WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY = Object.freeze({
  id: 'world-asset-geography-profile-2026-09-07-v1',
  renderOnly: true,
  placementRankingOnly: true,
  deterministic: true,
  worldSpace: true,
  canonicalTerrainReadOnly: true,
  canonicalHydrologyReadOnly: true,
  canonicalRoadReadOnly: true,
  canonicalSettlementReadOnly: true,
  canonicalSourceMapReadOnly: true,
  newGeographyIntroduced: false,
  profileVersion: 1,
  seed: 0x6a09e667,
  candidateGridMeters: 42,
  domainWarpMeters: 68,
  macroScaleMeters: 420,
  mesoScaleMeters: 128,
  fineScaleMeters: 38,
  cohortScaleMeters: 23,
  aspectSectorCount: 8,
  maxPreferredSlopeDegrees: 48,
  hardNoPlaceWaterMeters: 0.03,
  scoreFloor: 0.24,
  scoreStrong: 0.68,
  scoreExcellent: 0.84,
  distanceWeights: Object.freeze({ river: 0.25, lake: 0.24, coast: 0.18, road: 0.12, settlement: 0.10, relief: 0.11 }),
  materialResponseBounds: Object.freeze({ color: 0.15, roughness: 0.14, scale: 0.22 }),
});

export const WORLD_ASSET_GEOGRAPHY_DOMAINS = Object.freeze({
  woodland: Object.freeze({
    canonicalNames: ['forest', 'woodland', 'grove', 'taiga'],
    maxSlope: 32,
    moistureCenter: 0.63,
    moistureHalfWidth: 0.36,
    elevationWindow: Object.freeze([0, 280]),
    wetTolerance: 0.62,
    snowTolerance: 0.14,
    preferredAspect: 0.0,
    aspectTolerance: Math.PI,
  }),
  meadow: Object.freeze({
    canonicalNames: ['meadow', 'grassland', 'pasture', 'plain', 'lowland'],
    maxSlope: 18,
    moistureCenter: 0.55,
    moistureHalfWidth: 0.44,
    elevationWindow: Object.freeze([0, 180]),
    wetTolerance: 0.72,
    snowTolerance: 0.10,
    preferredAspect: 0.0,
    aspectTolerance: Math.PI,
  }),
  heath: Object.freeze({
    canonicalNames: ['heath', 'moor', 'upland', 'steppe', 'scrub'],
    maxSlope: 28,
    moistureCenter: 0.36,
    moistureHalfWidth: 0.42,
    elevationWindow: Object.freeze([35, 420]),
    wetTolerance: 0.48,
    snowTolerance: 0.34,
    preferredAspect: Math.PI,
    aspectTolerance: Math.PI,
  }),
  wetland: Object.freeze({
    canonicalNames: ['wetland', 'marsh', 'bog', 'fen'],
    maxSlope: 8,
    moistureCenter: 0.86,
    moistureHalfWidth: 0.26,
    elevationWindow: Object.freeze([-2, 40]),
    wetTolerance: 1,
    snowTolerance: 0.42,
    preferredAspect: 0,
    aspectTolerance: Math.PI,
  }),
  riparian: Object.freeze({
    canonicalNames: ['riparian', 'riverbank', 'floodplain', 'alluvial'],
    maxSlope: 12,
    moistureCenter: 0.74,
    moistureHalfWidth: 0.30,
    elevationWindow: Object.freeze([-2, 90]),
    wetTolerance: 1,
    snowTolerance: 0.30,
    preferredAspect: 0,
    aspectTolerance: Math.PI,
  }),
  coast: Object.freeze({
    canonicalNames: ['coast', 'shore', 'beach', 'dune', 'intertidal'],
    maxSlope: 22,
    moistureCenter: 0.71,
    moistureHalfWidth: 0.36,
    elevationWindow: Object.freeze([-1, 18]),
    wetTolerance: 1,
    snowTolerance: 0.55,
    preferredAspect: 0,
    aspectTolerance: Math.PI,
  }),
  alpine: Object.freeze({
    canonicalNames: ['alpine', 'subalpine', 'high-mountain'],
    maxSlope: 44,
    moistureCenter: 0.48,
    moistureHalfWidth: 0.42,
    elevationWindow: Object.freeze([140, 650]),
    wetTolerance: 0.70,
    snowTolerance: 1,
    preferredAspect: 0,
    aspectTolerance: Math.PI,
  }),
  scree: Object.freeze({
    canonicalNames: ['scree', 'talus', 'bare', 'rock'],
    maxSlope: 72,
    moistureCenter: 0.34,
    moistureHalfWidth: 0.48,
    elevationWindow: Object.freeze([45, 700]),
    wetTolerance: 0.55,
    snowTolerance: 0.90,
    preferredAspect: 0,
    aspectTolerance: Math.PI,
  }),
  snowfield: Object.freeze({
    canonicalNames: ['snowfield', 'ice', 'glacier', 'permanent-ice'],
    maxSlope: 55,
    moistureCenter: 0.50,
    moistureHalfWidth: 0.60,
    elevationWindow: Object.freeze([0, 800]),
    wetTolerance: 1,
    snowTolerance: 1,
    preferredAspect: 0,
    aspectTolerance: Math.PI,
  }),
  volcanic: Object.freeze({
    canonicalNames: ['lava', 'volcanic', 'basalt', 'obsidian', 'ash', 'pumice'],
    maxSlope: 54,
    moistureCenter: 0.28,
    moistureHalfWidth: 0.50,
    elevationWindow: Object.freeze([0, 750]),
    wetTolerance: 0.45,
    snowTolerance: 0.68,
    preferredAspect: 0,
    aspectTolerance: Math.PI,
  }),
});

export const WORLD_ASSET_GEOGRAPHY_FAMILIES = Object.freeze({
  vegetation: Object.freeze({
    preferredDomains: Object.freeze({ woodland: 1.00, meadow: 0.86, heath: 0.72, wetland: 0.68, riparian: 0.76, coast: 0.42, alpine: 0.48, scree: 0.08, snowfield: 0.02, volcanic: 0.24 }),
    antiDomains: Object.freeze({ snowfield: 0.72, scree: 0.62, coast: 0.14 }),
    maxSlope: 38,
    moistureCenter: 0.60,
    elevationComfortMeters: 230,
    cohesionMeters: 24,
    gapMeters: 5.5,
    preferredClusterSize: 6,
    scale: Object.freeze([0.78, 1.24]),
  }),
  tree: Object.freeze({
    preferredDomains: Object.freeze({ woodland: 1.00, meadow: 0.72, heath: 0.56, riparian: 0.82, wetland: 0.52, coast: 0.16, alpine: 0.18, scree: 0.00, snowfield: 0.00, volcanic: 0.12 }),
    antiDomains: Object.freeze({ snowfield: 0.98, scree: 0.82, volcanic: 0.34 }),
    maxSlope: 34,
    moistureCenter: 0.64,
    elevationComfortMeters: 200,
    cohesionMeters: 29,
    gapMeters: 7.0,
    preferredClusterSize: 7,
    scale: Object.freeze([0.74, 1.30]),
  }),
  shrub: Object.freeze({
    preferredDomains: Object.freeze({ woodland: 0.66, meadow: 0.78, heath: 0.96, wetland: 0.70, riparian: 0.74, coast: 0.55, alpine: 0.52, scree: 0.18, snowfield: 0.04, volcanic: 0.36 }),
    antiDomains: Object.freeze({ snowfield: 0.80, scree: 0.30 }),
    maxSlope: 42,
    moistureCenter: 0.52,
    elevationComfortMeters: 300,
    cohesionMeters: 18,
    gapMeters: 4.0,
    preferredClusterSize: 5,
    scale: Object.freeze([0.60, 1.40]),
  }),
  rock: Object.freeze({
    preferredDomains: Object.freeze({ woodland: 0.04, meadow: 0.12, heath: 0.52, wetland: 0.06, riparian: 0.08, coast: 0.54, alpine: 0.92, scree: 1.00, snowfield: 0.42, volcanic: 0.96 }),
    antiDomains: Object.freeze({ wetland: 0.84, meadow: 0.34 }),
    maxSlope: 72,
    moistureCenter: 0.40,
    elevationComfortMeters: 420,
    cohesionMeters: 33,
    gapMeters: 3.0,
    preferredClusterSize: 4,
    scale: Object.freeze([0.65, 1.48]),
  }),
  snow: Object.freeze({
    preferredDomains: Object.freeze({ woodland: 0.10, meadow: 0.06, heath: 0.24, wetland: 0.12, riparian: 0.12, coast: 0.46, alpine: 0.76, scree: 0.62, snowfield: 1.00, volcanic: 0.12 }),
    antiDomains: Object.freeze({ meadow: 0.54, wetland: 0.20 }),
    maxSlope: 55,
    moistureCenter: 0.52,
    elevationComfortMeters: 420,
    cohesionMeters: 36,
    gapMeters: 4.0,
    preferredClusterSize: 3,
    scale: Object.freeze([0.76, 1.22]),
  }),
  building: Object.freeze({
    preferredDomains: Object.freeze({ woodland: 0.48, meadow: 0.86, heath: 0.72, wetland: 0.10, riparian: 0.34, coast: 0.60, alpine: 0.16, scree: 0.04, snowfield: 0.00, volcanic: 0.20 }),
    antiDomains: Object.freeze({ wetland: 0.90, riparian: 0.46, snowfield: 0.96, scree: 0.76 }),
    maxSlope: 12,
    moistureCenter: 0.50,
    elevationComfortMeters: 180,
    cohesionMeters: 45,
    gapMeters: 2.5,
    preferredClusterSize: 3,
    scale: Object.freeze([0.90, 1.14]),
  }),
  settlement: Object.freeze({
    preferredDomains: Object.freeze({ woodland: 0.56, meadow: 0.92, heath: 0.74, wetland: 0.06, riparian: 0.42, coast: 0.72, alpine: 0.12, scree: 0.00, snowfield: 0.00, volcanic: 0.12 }),
    antiDomains: Object.freeze({ wetland: 0.96, riparian: 0.52, snowfield: 0.99, scree: 0.88 }),
    maxSlope: 12,
    moistureCenter: 0.49,
    elevationComfortMeters: 210,
    cohesionMeters: 65,
    gapMeters: 5,
    preferredClusterSize: 5,
    scale: Object.freeze([0.94, 1.08]),
  }),
  waterside: Object.freeze({
    preferredDomains: Object.freeze({ woodland: 0.18, meadow: 0.52, heath: 0.20, wetland: 0.94, riparian: 1.00, coast: 0.98, alpine: 0.38, scree: 0.10, snowfield: 0.28, volcanic: 0.12 }),
    antiDomains: Object.freeze({ meadow: 0.02, scree: 0.58 }),
    maxSlope: 18,
    moistureCenter: 0.82,
    elevationComfortMeters: 90,
    cohesionMeters: 22,
    gapMeters: 2.0,
    preferredClusterSize: 4,
    scale: Object.freeze([0.80, 1.22]),
  }),
});

function inferFamily(metadata = {}) {
  const signature = [metadata.category, metadata.kind, metadata.family, metadata.assetFamily, metadata.name, metadata.id, metadata.src]
    .filter(Boolean)
    .join('|')
    .toLowerCase();
  if (/settlement|village|town|city|keep|castle|fort/.test(signature)) return 'settlement';
  if (/building|house|hut|tower|wall|gate|structure/.test(signature)) return 'building';
  if (/snow|ice|glacier|frost|winter/.test(signature)) return 'snow';
  if (/rock|stone|boulder|cliff|talus|scree/.test(signature)) return 'rock';
  if (/shrub|bush|hedge|heather/.test(signature)) return 'shrub';
  if (/tree|pine|oak|birch|woodland|forest/.test(signature)) return 'tree';
  if (/grass|plant|vegetation|flower|fern|reed/.test(signature)) return 'vegetation';
  if (/water|dock|pier|bridge|boat|shore/.test(signature)) return 'waterside';
  return 'vegetation';
}

function normalizeSurface(surface = {}) {
  const biome = parseBiome(surface.biome);
  const aspect = aspectComponents(
    Number.isFinite(Number(surface.aspectRadians))
      ? Number(surface.aspectRadians)
      : Number.isFinite(Number(surface.aspectDegrees))
        ? Number(surface.aspectDegrees) * Math.PI / 180
        : 0,
  );
  const slopeDegrees = Math.max(0, finite(surface.slopeDegrees, 0));
  const heightMeters = finite(surface.height ?? surface.elevation ?? surface.heightMeters, 0);
  const moisture = clamp01(surface.moisture ?? surface.wetness ?? 0.5);
  const snow = clamp01(surface.snow ?? surface.snowAmount ?? surface.snowWeight ?? 0);
  const waterDepth = Math.max(0, finite(surface.waterDepth, 0));
  const riverDistance = Math.max(0, finite(surface.riverDistance, Infinity));
  const lakeDistance = Math.max(0, finite(surface.lakeDistance, Infinity));
  const coastDistance = Math.max(0, finite(surface.coastDistance, Infinity));
  const roadDistance = Math.max(0, finite(surface.roadDistance, Infinity));
  const settlementDistance = Math.max(0, finite(surface.settlementDistance, Infinity));
  const concavity = clampSigned(surface.concavity ?? surface.moistureRetention ?? 0);
  const erosion = clamp01(surface.erosion ?? surface.rockfallSource ?? 0.4);
  const deposition = clamp01(surface.deposition ?? surface.depositionalBench ?? 0.4);
  const shelter = clamp01(surface.shelter ?? surface.topographicShelter ?? 0.5);
  const lithic = clamp01(surface.lithic ?? surface.rockWeight ?? 0.3);
  return Object.freeze({
    x: finite(surface.x, 0),
    z: finite(surface.z, 0),
    heightMeters,
    slopeDegrees,
    slope: clamp01(slopeDegrees / 60),
    aspect,
    moisture,
    snow,
    waterDepth,
    riverDistance,
    lakeDistance,
    coastDistance,
    roadDistance,
    settlementDistance,
    concavity,
    erosion,
    deposition,
    shelter,
    lithic,
    biome,
  });
}

function surfaceDistances(surface) {
  return Object.freeze({
    river: clamp01(1 - surface.riverDistance / 92),
    lake: clamp01(1 - surface.lakeDistance / 125),
    coast: clamp01(1 - surface.coastDistance / 150),
    road: clamp01(1 - surface.roadDistance / 36),
    settlement: clamp01(1 - surface.settlementDistance / 70),
  });
}

function landformProfile(surface, spatial) {
  const slopeComfort = 1 - range(surface.slopeDegrees, 12, 48);
  const elevationLow = 1 - range(surface.heightMeters, 0, 180);
  const elevationMid = bell(surface.heightMeters, 190, 190);
  const elevationHigh = range(surface.heightMeters, 160, 560);
  const bowl = clamp01(0.5 + surface.concavity * 0.5);
  const ridge = 1 - bowl;
  const drainage = clamp01(spatial.swale * 0.44 + spatial.ridge * 0.24 + bowl * 0.32);
  const exposed = clamp01(range(surface.slopeDegrees, 18, 52) * 0.62 + surface.erosion * 0.20 + ridge * 0.18);
  const depositional = clamp01((1 - surface.slope) * 0.45 + surface.deposition * 0.28 + spatial.sediment * 0.27);
  return Object.freeze({
    slopeComfort,
    elevationLow,
    elevationMid,
    elevationHigh,
    bowl,
    ridge,
    drainage,
    exposed,
    depositional,
  });
}

function spatialProfile(x, z) {
  const P = WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY;
  const warpX = signedNoise2(x / P.domainWarpMeters + 7.3, z / P.domainWarpMeters - 11.1, P.seed + 211);
  const warpZ = signedNoise2(x / P.domainWarpMeters - 19.7, z / P.domainWarpMeters + 5.9, P.seed + 337);
  const wx = x + (warpX * 0.61) * P.domainWarpMeters;
  const wz = z + (warpZ * 0.61) * P.domainWarpMeters;
  const macro = fbm2(wx / P.macroScaleMeters, wz / P.macroScaleMeters, P.seed + 1009, 4);
  const meso = fbm2(wx / P.mesoScaleMeters, wz / P.mesoScaleMeters, P.seed + 2017, 4);
  const fine = fbm2(wx / P.fineScaleMeters, wz / P.fineScaleMeters, P.seed + 3011, 3);
  const swale = fbm2(wx / 88 + wz / 270 + 3.1, wz / 520 - wx / 140 - 7.3, P.seed + 4013, 3);
  const ridge = ridged2(wx / 76 - 4.1, wz / 190 + 8.7, P.seed + 5039, 3);
  const sediment = fbm2(wx / 132 + wz / 420 + 14.4, wz / 59 - wx / 510 - 5.7, P.seed + 6047, 3);
  const cohort = valueNoise2(wx / P.cohortScaleMeters, wz / P.cohortScaleMeters, P.seed + 7069);
  const directionNoise = signedNoise2(wx / 310 + 4.6, wz / 96 - 15.8, P.seed + 8089);
  return Object.freeze({ wx, wz, macro, meso, fine, swale, ridge, sediment, cohort, directionNoise });
}

function domainScore(surface, landform, spatial, domainName) {
  const D = WORLD_ASSET_GEOGRAPHY_DOMAINS[domainName];
  if (!D) return 0;
  const slopeFit = 1 - range(surface.slopeDegrees, D.maxSlope * 0.75, D.maxSlope);
  const moistureFit = bell(surface.moisture, D.moistureCenter, D.moistureHalfWidth);
  const elevationLow = D.elevationWindow[0];
  const elevationHigh = D.elevationWindow[1];
  const elevationFit = Math.max(
    range(surface.heightMeters, elevationLow, elevationLow + Math.max(1, (elevationHigh - elevationLow) * 0.24)),
    1 - range(surface.heightMeters, elevationHigh - Math.max(1, (elevationHigh - elevationLow) * 0.24), elevationHigh + 1),
    bell(surface.heightMeters, (elevationLow + elevationHigh) * 0.5, (elevationHigh - elevationLow) * 0.5),
  );
  const snowFit = D.snowTolerance >= 0.99 ? 1 : 1 - clamp01((surface.snow - D.snowTolerance) / 0.75);
  const waterFit = surface.waterDepth > WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.hardNoPlaceWaterMeters ? 0 : 1;
  const form = domainName === 'wetland'
    ? landform.depositional * 0.50 + landform.bowl * 0.28 + (1 - landform.exposed) * 0.22
    : domainName === 'riparian'
      ? spatial.swale * 0.38 + landform.depositional * 0.34 + (1 - landform.exposed) * 0.28
      : domainName === 'coast'
        ? surfaceDistances(surface).coast * 0.62 + (1 - landform.exposed) * 0.16 + spatial.sediment * 0.22
        : domainName === 'alpine' || domainName === 'snowfield'
          ? landform.elevationHigh * 0.40 + landform.exposed * 0.24 + spatial.ridge * 0.36
          : domainName === 'scree'
            ? landform.exposed * 0.52 + landform.ridge * 0.28 + surface.lithic * 0.20
            : domainName === 'volcanic'
              ? surface.biome.lava * 0.56 + surface.lithic * 0.24 + spatial.macro * 0.20
              : domainName === 'woodland'
                ? (1 - landform.exposed) * 0.26 + surface.moisture * 0.34 + spatial.meso * 0.24 + (1 - spatial.ridge) * 0.16
                : domainName === 'heath'
                  ? (1 - surface.moisture) * 0.33 + landform.elevationMid * 0.28 + landform.exposed * 0.20 + spatial.macro * 0.19
                  : domainName === 'meadow'
                    ? (1 - landform.exposed) * 0.34 + surface.moisture * 0.26 + spatial.swale * 0.18 + spatial.sediment * 0.22
                    : 0.5;
  return clamp01(
    slopeFit * 0.20
      + moistureFit * 0.22
      + elevationFit * 0.16
      + snowFit * 0.12
      + waterFit * 0.10
      + clamp01(form) * 0.20,
  );
}

function computeDomains(surface, landform, spatial) {
  const scores = {};
  for (const domainName of Object.keys(WORLD_ASSET_GEOGRAPHY_DOMAINS)) {
    scores[domainName] = domainScore(surface, landform, spatial, domainName);
  }
  return Object.freeze(scores);
}

function scoreFamily(family, domains, surface, landform, spatial) {
  const profile = WORLD_ASSET_GEOGRAPHY_FAMILIES[family] ?? WORLD_ASSET_GEOGRAPHY_FAMILIES.vegetation;
  let positive = 0;
  let negative = 0;
  for (const [domain, weight] of Object.entries(profile.preferredDomains)) positive += domains[domain] * weight;
  for (const [domain, weight] of Object.entries(profile.antiDomains)) negative += domains[domain] * weight;
  positive /= Math.max(1, Object.keys(profile.preferredDomains).length);
  negative /= Math.max(1, Object.keys(profile.antiDomains).length);
  const slopePenalty = range(surface.slopeDegrees, profile.maxSlope * 0.82, profile.maxSlope);
  const moistureFit = bell(surface.moisture, profile.moistureCenter, 0.50);
  const elevationFit = bell(surface.heightMeters, profile.elevationComfortMeters, Math.max(80, profile.elevationComfortMeters * 0.80));
  const climateSpread = clamp01(
    surface.biome.snow * (family === 'snow' ? 1 : profile.antiDomains.snowfield ?? 0.4)
      + surface.biome.tundra * (family === 'snow' ? 0.42 : 0.12),
  );
  const morphologicalSupport = clamp01(
    landform.slopeComfort * 0.28
      + landform.depositional * 0.20
      + landform.exposed * (family === 'rock' || family === 'snow' ? 0.34 : 0.08)
      + spatial.ridge * (family === 'rock' || family === 'snow' ? 0.22 : 0.06),
  );
  const score = clamp01(
    positive * 0.37
      + moistureFit * 0.12
      + elevationFit * 0.12
      + morphologicalSupport * 0.17
      + climateSpread * 0.08
      + (1 - slopePenalty) * 0.14
      - negative * 0.27,
  );
  return Object.freeze({
    score,
    preferredSignal: positive,
    antiSignal: negative,
    slopePenalty,
    moistureFit,
    elevationFit,
    climateSpread,
    morphologicalSupport,
  });
}

function preferredAspectForFamily(family, surface, domains) {
  const p = WORLD_ASSET_GEOGRAPHY_FAMILIES[family] ?? WORLD_ASSET_GEOGRAPHY_FAMILIES.vegetation;
  const candidates = Object.entries(p.preferredDomains)
    .sort((a, b) => (domains[b[0]] * b[1]) - (domains[a[0]] * a[1]))
    .slice(0, 3);
  if (!candidates.length) return surface.aspect.radians;
  const thermal = surface.aspect.southness > surface.aspect.northness ? 0.22 : -0.18;
  const exposure = family === 'rock' || family === 'snow' ? 0.42 : 0.18;
  return surface.aspect.radians + thermal + exposure;
}

function ecologicalCohortValue(surface, spatial, family) {
  const profile = WORLD_ASSET_GEOGRAPHY_FAMILIES[family] ?? WORLD_ASSET_GEOGRAPHY_FAMILIES.vegetation;
  const familySeed = hashUint(family.length * 4093 + profile.preferredClusterSize * 97);
  const domain = valueNoise2(spatial.wx / Math.max(1, profile.cohesionMeters), spatial.wz / Math.max(1, profile.cohesionMeters), familySeed);
  const meso = fbm2(spatial.wx / 180 + 1.7, spatial.wz / 180 - 4.2, familySeed + 71, 3);
  const fine = valueNoise2(spatial.wx / Math.max(1, profile.gapMeters), spatial.wz / Math.max(1, profile.gapMeters), familySeed + 113);
  const deterministicJitter = hash3(Math.floor(spatial.wx), Math.floor(surface.heightMeters), Math.floor(spatial.wz), familySeed);
  return clamp01(domain * 0.48 + meso * 0.30 + fine * 0.14 + deterministicJitter * 0.08);
}

function materialContext(family, surface, landform, domains, familyScore) {
  const moisture = surface.moisture;
  const cold = clamp01(surface.snow * 0.72 + surface.biome.tundra * 0.52 + surface.biome.snow * 0.88);
  const mineral = clamp01(surface.lithic * 0.55 + domains.scree * 0.22 + domains.volcanic * 0.23);
  const dampness = clamp01(
    moisture * 0.54
      + domains.wetland * 0.18
      + domains.riparian * 0.14
      + (1 - landform.exposed) * 0.14,
  );
  const dryness = clamp01(
    (1 - moisture) * 0.42
      + domains.heath * 0.28
      + domains.scree * 0.20
      + landform.exposed * 0.10,
  );
  const weathering = clamp01(
    surface.erosion * 0.42
      + landform.exposed * 0.27
      + (1 - surface.shelter) * 0.18
      + mineral * 0.13,
  );
  const lichen = clamp01(cold * 0.30 + dampness * 0.34 + domains.rock * 0.18 + domains.alpine * 0.18);
  const moss = clamp01(dampness * 0.58 + domains.woodland * 0.22 + domains.riparian * 0.20);
  const sediment = clamp01(
    surface.deposition * 0.34
      + domains.riparian * 0.30
      + domains.coast * 0.18
      + landform.depositional * 0.18,
  );
  const snowCover = clamp01(surface.snow * 0.56 + domains.snowfield * 0.28 + cold * 0.16);
  const familyScale = WORLD_ASSET_GEOGRAPHY_FAMILIES[family]?.scale ?? [0.8, 1.2];
  const weatherScale = 1 + (familyScore.score - 0.5) * 0.18 + (surface.shelter - 0.5) * 0.10;
  return Object.freeze({
    family,
    moisture,
    cold,
    mineral,
    dampness,
    dryness,
    weathering,
    lichen,
    moss,
    sediment,
    snowCover,
    albedoMacro: 0.88 + dryness * 0.12 - dampness * 0.06,
    albedoMeso: 0.86 + mineral * 0.08,
    albedoFine: 0.96 + (surface.moisture - 0.5) * 0.06,
    normalMacro: clamp01(0.34 + landform.exposed * 0.40 + mineral * 0.26),
    normalFine: clamp01(0.38 + surface.erosion * 0.32 + mineral * 0.30),
    roughnessMacro: clamp01(0.52 + dampness * 0.28 + weathering * 0.20),
    roughnessFine: clamp01(0.48 + weathering * 0.26 + mineral * 0.18 + dryness * 0.08),
    preferredScale: Object.freeze([
      clamp01((familyScale[0] - 0.5) / 1.0),
      clamp01((familyScale[1] - 0.5) / 1.2),
    ]),
    weatherScale,
  });
}

export function sampleWorldAssetGeographyProfile(surfaceInput = {}, metadata = {}) {
  const surface = normalizeSurface(surfaceInput);
  const family = metadata.family || metadata.assetFamily || inferFamily(metadata);
  const safeFamily = WORLD_ASSET_GEOGRAPHY_FAMILIES[family] ? family : 'vegetation';
  const spatial = spatialProfile(surface.x, surface.z);
  const landform = landformProfile(surface, spatial);
  const domains = computeDomains(surface, landform, spatial);
  const familyResponse = scoreFamily(safeFamily, domains, surface, landform, spatial);
  const distances = surfaceDistances(surface);
  const preferredAspect = preferredAspectForFamily(safeFamily, surface, domains);
  const cohort = ecologicalCohortValue(surface, spatial, safeFamily);
  const score = clamp01(
    familyResponse.score * 0.72
      + distances.river * 0.06 * (safeFamily === 'waterside' ? 1.25 : 0.42)
      + distances.lake * 0.05 * (safeFamily === 'waterside' ? 1.18 : 0.36)
      + distances.coast * 0.03 * (safeFamily === 'waterside' || safeFamily === 'settlement' ? 1.25 : 0.34)
      + distances.road * 0.02
      + distances.settlement * 0.02
      + cohort * 0.10,
  );
  const material = materialContext(safeFamily, surface, landform, domains, familyResponse);
  const placementClass = score >= WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreExcellent
    ? 'excellent'
    : score >= WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreStrong
      ? 'strong'
      : score >= WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor
        ? 'conditional'
        : 'poor';
  const climateSignal = clamp01(
    surface.biome.snow * 0.46
      + surface.biome.tundra * 0.20
      + surface.biome.coast * 0.10
      + surface.biome.wetland * 0.08
      + surface.biome.desert * 0.06
      + surface.biome.lava * 0.10,
  );
  const rotation = preferredAspect + (cohort - 0.5) * 0.62 + spatial.directionNoise * 0.14;
  return Object.freeze({
    policyId: WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.id,
    family: safeFamily,
    placementScore: score,
    placementClass,
    climateSignal,
    surface,
    landform,
    domains,
    familyResponse,
    distances,
    cohort,
    preferredAspect,
    preferredRotationRadians: rotation,
    material,
    spatial: Object.freeze({
      macro: spatial.macro,
      meso: spatial.meso,
      fine: spatial.fine,
      cohort: spatial.cohort,
      directionNoise: spatial.directionNoise,
    }),
  });
}

export function isWorldAssetGeographicallyPlausible(profile, { minimumScore = WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor } = {}) {
  if (!profile || typeof profile !== 'object') return false;
  if (!Number.isFinite(profile.placementScore)) return false;
  if (profile.surface?.waterDepth > WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.hardNoPlaceWaterMeters) return false;
  return profile.placementScore >= finite(minimumScore, WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor);
}

export function assetGeographyPlacementDecision(profile, {
  rejectPoor = true,
  minimumScore = WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor,
  strongScore = WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreStrong,
} = {}) {
  const score = clamp01(profile?.placementScore);
  const plausible = isWorldAssetGeographicallyPlausible(profile, { minimumScore });
  const decision = plausible ? (score >= strongScore ? 'accept-strong' : 'accept-conditional') : rejectPoor ? 'reject' : 'accept-poor';
  const reasons = [];
  if (profile?.surface?.waterDepth > WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.hardNoPlaceWaterMeters) reasons.push('water-depth');
  if (profile?.familyResponse?.slopePenalty > 0.72) reasons.push('slope');
  if (profile?.familyResponse?.antiSignal > 0.58) reasons.push('anti-domain');
  if (profile?.familyResponse?.moistureFit < 0.20) reasons.push('moisture');
  if (profile?.familyResponse?.elevationFit < 0.20) reasons.push('elevation');
  if (score < minimumScore) reasons.push('score');
  return Object.freeze({
    accept: decision !== 'reject',
    decision,
    score,
    plausible,
    reasons: [...new Set(reasons)],
  });
}

export function deterministicAssetCohortOffset(x, z, family = 'vegetation') {
  const profile = WORLD_ASSET_GEOGRAPHY_FAMILIES[family] ?? WORLD_ASSET_GEOGRAPHY_FAMILIES.vegetation;
  const seed = hashUint(family.length * 6151 + profile.preferredClusterSize * 193);
  const macro = valueNoise2(x / Math.max(1, profile.cohesionMeters), z / Math.max(1, profile.cohesionMeters), seed);
  const micro = valueNoise2(x / Math.max(1, profile.gapMeters), z / Math.max(1, profile.gapMeters), seed + 47);
  return clamp01(macro * 0.62 + micro * 0.23 + hash2(Math.floor(x), Math.floor(z), seed + 97) * 0.15);
}

export function deterministicAssetScale(profile, x, z) {
  const family = profile?.family ?? 'vegetation';
  const range = WORLD_ASSET_GEOGRAPHY_FAMILIES[family]?.scale ?? [0.8, 1.2];
  const cohort = deterministicAssetCohortOffset(x, z, family);
  const shelter = clamp01(profile?.surface?.shelter ?? 0.5);
  const exposure = clamp01(profile?.surface?.slopeDegrees / 48);
  const raw = 0.55 * cohort + 0.25 * shelter + 0.20 * (1 - exposure);
  return lerp(range[0], range[1], clamp01(raw));
}

export function deterministicAssetYaw(profile, x, z) {
  const base = finite(profile?.preferredRotationRadians, 0);
  const family = profile?.family ?? 'vegetation';
  const cohort = deterministicAssetCohortOffset(x + 17.3, z - 9.7, family);
  const jitter = (cohort - 0.5) * Math.PI * 0.42;
  const windBias = clamp01(profile?.surface?.slopeDegrees / 42) * 0.17;
  return base + jitter + windBias;
}

export function evaluateAssetDistributionCandidate({ x = 0, z = 0, surface = {}, metadata = {} } = {}) {
  const profile = sampleWorldAssetGeographyProfile({ ...surface, x, z }, metadata);
  const decision = assetGeographyPlacementDecision(profile);
  return Object.freeze({
    x,
    z,
    profile,
    decision,
    scale: deterministicAssetScale(profile, x, z),
    yaw: deterministicAssetYaw(profile, x, z),
  });
}

export function rankAssetDistributionCandidates(candidates = [], metadata = {}) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  return candidates
    .map((candidate, index) => ({
      index,
      candidate: evaluateAssetDistributionCandidate({ ...candidate, metadata }),
    }))
    .sort((a, b) => {
      const delta = b.candidate.profile.placementScore - a.candidate.profile.placementScore;
      if (Math.abs(delta) > 1e-9) return delta;
      const cohort = b.candidate.profile.cohort - a.candidate.profile.cohort;
      if (Math.abs(cohort) > 1e-9) return cohort;
      return a.index - b.index;
    })
    .map(({ candidate }) => candidate);
}

export function distributeAssetCandidates(candidates = [], metadata = {}, {
  targetCount = null,
  minimumScore = WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor,
  spacingMeters = null,
  clusterBias = 0.32,
} = {}) {
  const ranked = rankAssetDistributionCandidates(candidates, metadata);
  const family = metadata.family || metadata.assetFamily || inferFamily(metadata);
  const profile = WORLD_ASSET_GEOGRAPHY_FAMILIES[family] ?? WORLD_ASSET_GEOGRAPHY_FAMILIES.vegetation;
  const minimumSpacing = positive(spacingMeters, profile.gapMeters);
  const limit = targetCount == null ? ranked.length : Math.max(0, Math.floor(targetCount));
  const selected = [];
  for (const item of ranked) {
    if (selected.length >= limit) break;
    if (item.profile.placementScore < minimumScore) continue;
    let nearest = Infinity;
    for (const existing of selected) nearest = Math.min(nearest, Math.hypot(item.x - existing.x, item.z - existing.z));
    const cohort = item.profile.cohort;
    const adjacencyBonus = selected.length === 0 ? 1 : clamp01(nearest / Math.max(1, minimumSpacing));
    const clusterAllowance = clusterBias * (0.35 + cohort * 0.65);
    if (selected.length > 0 && nearest < minimumSpacing * (1 - clusterAllowance) && cohort < 0.62) continue;
    if (selected.length > 0 && adjacencyBonus < 0.20 && cohort < 0.78) continue;
    selected.push(item);
  }
  return Object.freeze({
    family,
    selected,
    rejected: ranked.filter((item) => !selected.includes(item)),
    targetCount: limit,
    spacingMeters: minimumSpacing,
    deterministic: true,
  });
}

export function compareAssetGeographyProfiles(a, b) {
  if (!a || !b) return null;
  return Object.freeze({
    placementScoreDelta: finite(a.placementScore) - finite(b.placementScore),
    moistureDelta: finite(a.surface?.moisture) - finite(b.surface?.moisture),
    slopeDelta: finite(a.surface?.slopeDegrees) - finite(b.surface?.slopeDegrees),
    elevationDelta: finite(a.surface?.heightMeters) - finite(b.surface?.heightMeters),
    climateSignalDelta: finite(a.climateSignal) - finite(b.climateSignal),
    cohortDelta: finite(a.cohort) - finite(b.cohort),
    domainDistances: Object.freeze(Object.fromEntries(
      Object.keys(WORLD_ASSET_GEOGRAPHY_DOMAINS).map((key) => [key, finite(a.domains?.[key]) - finite(b.domains?.[key])]),
    )),
  });
}

export function validateAssetGeographyProfile(profile) {
  const errors = [];
  const warnings = [];
  if (!profile || typeof profile !== 'object') return { ok: false, errors: ['missing-profile'], warnings };
  if (!WORLD_ASSET_GEOGRAPHY_FAMILIES[profile.family]) errors.push('unknown-family');
  if (!Number.isFinite(profile.placementScore) || profile.placementScore < 0 || profile.placementScore > 1) errors.push('score-out-of-range');
  if (!Number.isFinite(profile.surface?.slopeDegrees) || profile.surface.slopeDegrees < 0) errors.push('invalid-slope');
  if (!Number.isFinite(profile.surface?.heightMeters)) errors.push('invalid-elevation');
  if (!Number.isFinite(profile.surface?.moisture) || profile.surface.moisture < 0 || profile.surface.moisture > 1) errors.push('invalid-moisture');
  if (profile.surface?.waterDepth > WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.hardNoPlaceWaterMeters && profile.family !== 'waterside') warnings.push('water-exposure');
  if (profile.familyResponse?.slopePenalty > 0.85) warnings.push('near-slope-limit');
  if (profile.familyResponse?.antiSignal > 0.65) warnings.push('strong-anti-domain');
  if (profile.placementClass === 'poor') warnings.push('poor-geographic-fit');
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

export function summarizeAssetGeography(profile) {
  if (!profile) return null;
  const domains = Object.entries(profile.domains ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, score]) => ({ id, score }));
  return Object.freeze({
    family: profile.family,
    placementScore: profile.placementScore,
    placementClass: profile.placementClass,
    climateSignal: profile.climateSignal,
    topDomains: domains,
    moisture: profile.surface.moisture,
    elevationMeters: profile.surface.heightMeters,
    slopeDegrees: profile.surface.slopeDegrees,
    snow: profile.surface.snow,
    cohort: profile.cohort,
    preferredRotationRadians: profile.preferredRotationRadians,
    material: Object.freeze({
      dampness: profile.material.dampness,
      dryness: profile.material.dryness,
      mineral: profile.material.mineral,
      weathering: profile.material.weathering,
      snowCover: profile.material.snowCover,
      roughnessMacro: profile.material.roughnessMacro,
      normalMacro: profile.material.normalMacro,
    }),
  });
}
