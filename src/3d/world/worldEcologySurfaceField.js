/**
 * Deterministic render-only ecological surface field.
 *
 * This module never invents or edits geography. Callers provide authoritative surface facts
 * (height, slope, hydrology/coast proximity, biome labels and snow/water state). The field only
 * decorrelates visual/material/vegetation response in world space so broad canonical surfaces do
 * not collapse into uniform colour, roughness, normal or repeated placement bands.
 *
 * The output is intentionally unitless and bounded. It is safe to consume from render-only
 * material, vegetation and habitat systems.
 */

export const WORLD_ECOLOGY_SURFACE_FIELD_REVISION = 'v1-authority-preserving-multiscale-ecotones';

export const WORLD_ECOLOGY_SURFACE_FIELD_POLICY = Object.freeze({
  id: 'world-ecology-surface-field-2026-09-03-v1',
  renderOnly: true,
  deterministic: true,
  worldSpace: true,
  canonicalTerrainReadOnly: true,
  canonicalHydrologyReadOnly: true,
  canonicalCoastlineReadOnly: true,
  canonicalColliderReadOnly: true,
  canonicalRoadsReadOnly: true,
  newGeographyIntroduced: false,
  macroScaleMeters: 420,
  mesoScaleMeters: 118,
  patchScaleMeters: 34,
  fineScaleMeters: 9.5,
  warpScaleMeters: 250,
  warpAmplitudeMeters: 46,
  ridgeScaleMeters: 72,
  sedimentScaleMeters: 51,
  cohortScaleMeters: 27,
  anisotropicDepositionalFabric: true,
  exposureShelterResponse: true,
  hydrologyResponse: true,
  ecologyResponse: true,
  weatheringResponse: true,
  placementRankingResponse: true,
});

const TAU = Math.PI * 2;
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (value) => value - Math.floor(value);
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const smoother01 = (value) => {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const smoothRange = (edge0, edge1, value) => smoother01(
  (finite(value) - edge0) / Math.max(1e-9, edge1 - edge0),
);
const bell = (value, center, halfWidth) => {
  const distance = Math.abs(finite(value) - center) / Math.max(1e-9, halfWidth);
  return 1 - smoother01(distance);
};

function hashUint(value) {
  let x = (value | 0) ^ 0x9e3779b9;
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
  let amplitude = 0.56;
  let total = 0;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2(px, pz, seed + octave * 1013) * amplitude;
    normalizer += amplitude;
    const rotated = rotate2(px, pz, 0.61 + octave * 0.13);
    px = rotated.x * lacunarity + 13.71 + octave * 2.41;
    pz = rotated.z * lacunarity - 9.33 + octave * 3.17;
    amplitude *= persistence;
  }
  return normalizer > 0 ? total / normalizer : 0.5;
}

function ridged2(x, z, seed = 0, octaves = 4) {
  let px = x;
  let pz = z;
  let amplitude = 0.58;
  let total = 0;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const n = signedNoise2(px, pz, seed + octave * 1973);
    const ridge = 1 - Math.abs(n);
    total += ridge * ridge * amplitude;
    normalizer += amplitude;
    const rotated = rotate2(px, pz, -0.43 + octave * 0.19);
    px = rotated.x * 2.12 - 7.9;
    pz = rotated.z * 2.12 + 12.6;
    amplitude *= 0.48;
  }
  return normalizer > 0 ? total / normalizer : 0.5;
}

function cellular2(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let nearest = Infinity;
  let second = Infinity;
  let nearestValue = 0.5;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cx = ix + dx;
      const cz = iz + dz;
      const jx = hash2(cx, cz, seed + 17);
      const jz = hash2(cx, cz, seed + 53);
      const px = cx + 0.12 + jx * 0.76;
      const pz = cz + 0.12 + jz * 0.76;
      const distance = Math.hypot(x - px, z - pz);
      if (distance < nearest) {
        second = nearest;
        nearest = distance;
        nearestValue = hash2(cx, cz, seed + 89);
      } else if (distance < second) {
        second = distance;
      }
    }
  }
  return Object.freeze({
    nearest: clamp01(nearest / 1.35),
    edge: clamp01((second - nearest) / 0.72),
    value: nearestValue,
  });
}

function warpedCoordinates(x, z, seed = 0) {
  const scale = WORLD_ECOLOGY_SURFACE_FIELD_POLICY.warpScaleMeters;
  const amp = WORLD_ECOLOGY_SURFACE_FIELD_POLICY.warpAmplitudeMeters;
  const qx = signedNoise2(x / scale + 7.3, z / scale - 11.1, seed + 211);
  const qz = signedNoise2(x / scale - 19.7, z / scale + 5.9, seed + 337);
  const rx = signedNoise2(
    (x + qx * amp) / (scale * 0.47),
    (z + qz * amp) / (scale * 0.47),
    seed + 509,
  );
  const rz = signedNoise2(
    (x - qz * amp) / (scale * 0.47),
    (z + qx * amp) / (scale * 0.47),
    seed + 673,
  );
  return Object.freeze({
    x: x + (qx * 0.63 + rx * 0.37) * amp,
    z: z + (qz * 0.63 + rz * 0.37) * amp,
    qx,
    qz,
    rx,
    rz,
  });
}

function normalizedBiomeFlags(value) {
  const id = String(value || '').trim().toLowerCase();
  return Object.freeze({
    forest: /forest|wood|grove|taiga|pine/.test(id) ? 1 : 0,
    meadow: /meadow|grass|pasture|plain|lowland/.test(id) ? 1 : 0,
    heath: /heath|steppe|moor|dry|upland/.test(id) ? 1 : 0,
    wetland: /wetland|marsh|swamp|bog|fen|riparian/.test(id) ? 1 : 0,
    coast: /coast|shore|beach|intertidal|dune/.test(id) ? 1 : 0,
    rock: /rock|cliff|ridge|mountain|scree|talus|bare/.test(id) ? 1 : 0,
    alpine: /alpine|subalpine|mountain|ridge/.test(id) ? 1 : 0,
    snow: /snow|ice|glacier|permanent-ice|cryosphere/.test(id) ? 1 : 0,
    tundra: /tundra|cold|polar/.test(id) ? 1 : 0,
  });
}

function proximityWeight(distance, nearMeters, farMeters) {
  const value = finite(distance, Infinity);
  if (!Number.isFinite(value)) return 0;
  return 1 - smoothRange(nearMeters, farMeters, Math.max(0, value));
}

function signedAspectResponse(aspectRadians, directionRadians) {
  const aspect = finite(aspectRadians, 0);
  return Math.cos(aspect - directionRadians);
}

function physicalSurfaceFactors(input = {}) {
  const elevation = finite(input.elevationMeters ?? input.heightMeters, 0);
  const slopeDegrees = Math.max(0, finite(input.slopeDegrees, 0));
  const slope = clamp01(slopeDegrees / 58);
  const steep = smoothRange(22, 52, slopeDegrees);
  const gentle = 1 - smoothRange(7, 27, slopeDegrees);
  const aspectRadians = Number.isFinite(Number(input.aspectRadians))
    ? Number(input.aspectRadians)
    : Number.isFinite(Number(input.aspectDegrees))
      ? Number(input.aspectDegrees) / 180 * Math.PI
      : 0;
  const southness = clamp01(signedAspectResponse(aspectRadians, Math.PI * 0.5) * 0.5 + 0.5);
  const northness = 1 - southness;
  const eastness = clamp01(signedAspectResponse(aspectRadians, 0) * 0.5 + 0.5);
  const baseMoisture = clamp01(finite(input.moisture, 0.5));
  const snow = clamp01(finite(input.snow, input.snowCover ?? 0));
  const waterDepth = Math.max(0, finite(input.waterDepth, 0));
  const river = proximityWeight(input.riverDistance, 0, 92);
  const lake = proximityWeight(input.lakeDistance, 0, 125);
  const coast = proximityWeight(input.coastDistance, 0, 150);
  const road = proximityWeight(input.roadDistance, 0, 30);
  const settlement = proximityWeight(input.settlementDistance, 0, 65);
  const biome = normalizedBiomeFlags(input.biome);
  const hydrology = clamp01(Math.max(river, lake, coast * 0.36, waterDepth > 0 ? 1 : 0));
  const elevationCold = smoothRange(155, 520, elevation);
  const thermal = clamp01(
    0.62
      - elevationCold * 0.34
      - northness * steep * 0.08
      - snow * 0.40
      + southness * steep * 0.06
      - biome.tundra * 0.22,
  );
  return Object.freeze({
    elevation,
    slopeDegrees,
    slope,
    steep,
    gentle,
    aspectRadians,
    southness,
    northness,
    eastness,
    baseMoisture,
    snow,
    waterDepth,
    river,
    lake,
    coast,
    road,
    settlement,
    hydrology,
    thermal,
    biome,
  });
}

function spatialFields(x, z, seed = 0) {
  const warped = warpedCoordinates(x, z, seed);
  const macro = fbm2(
    warped.x / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.macroScaleMeters,
    warped.z / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.macroScaleMeters,
    seed + 1009,
    5,
    0.49,
  );
  const meso = fbm2(
    warped.x / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.mesoScaleMeters,
    warped.z / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.mesoScaleMeters,
    seed + 2017,
    5,
    0.50,
  );
  const patch = fbm2(
    warped.x / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.patchScaleMeters,
    warped.z / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.patchScaleMeters,
    seed + 3011,
    4,
    0.48,
  );
  const fine = fbm2(
    warped.x / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.fineScaleMeters,
    warped.z / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.fineScaleMeters,
    seed + 4001,
    3,
    0.46,
  );
  const ridge = ridged2(
    warped.x / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.ridgeScaleMeters,
    warped.z / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.ridgeScaleMeters,
    seed + 5003,
    4,
  );
  const sedimentAngle = (hash2(Math.floor(x / 400), Math.floor(z / 400), seed + 6101) - 0.5) * 1.7;
  const sediment = rotate2(warped.x, warped.z, sedimentAngle);
  const sedimentBands = fbm2(
    sediment.x / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.sedimentScaleMeters,
    sediment.z / (WORLD_ECOLOGY_SURFACE_FIELD_POLICY.sedimentScaleMeters * 0.24),
    seed + 7001,
    4,
    0.46,
  );
  const cells = cellular2(
    warped.x / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.cohortScaleMeters,
    warped.z / WORLD_ECOLOGY_SURFACE_FIELD_POLICY.cohortScaleMeters,
    seed + 8009,
  );
  return Object.freeze({
    warped,
    macro,
    meso,
    patch,
    fine,
    ridge,
    sedimentBands,
    sedimentAngle,
    cells,
  });
}

function ecologicalResponse(surface, spatial) {
  const b = surface.biome;
  const concavityHint = clamp01(finite(surface.concavity, 0.5));
  const shelterHint = clamp01(finite(surface.shelter, 0.5));
  const erosionHint = clamp01(finite(surface.erosion, 0.5));
  const depositionHint = clamp01(finite(surface.deposition, 0.5));
  const topographicShelter = clamp01(
    shelterHint * 0.42
      + (1 - surface.steep) * 0.15
      + surface.northness * surface.slope * 0.12
      + (1 - spatial.ridge) * 0.18
      + spatial.macro * 0.13,
  );
  const exposure = clamp01(
    surface.steep * 0.34
      + surface.southness * surface.slope * 0.10
      + spatial.ridge * 0.27
      + (1 - topographicShelter) * 0.23
      + erosionHint * 0.12,
  );
  const hydricPulse = clamp01(
    surface.hydrology * 0.57
      + surface.baseMoisture * 0.31
      + concavityHint * 0.12,
  );
  const moisture = clamp01(
    surface.baseMoisture * 0.38
      + hydricPulse * 0.30
      + topographicShelter * 0.13
      + (1 - spatial.meso) * 0.10
      + spatial.patch * 0.09
      + b.wetland * 0.27
      + b.forest * 0.08
      - exposure * 0.18,
  );
  const aridity = clamp01(
    (1 - moisture) * 0.56
      + exposure * 0.23
      + surface.thermal * 0.08
      + spatial.meso * 0.13
      + b.heath * 0.22,
  );
  const deposition = clamp01(
    depositionHint * 0.34
      + surface.gentle * 0.16
      + concavityHint * 0.16
      + surface.river * 0.12
      + (1 - spatial.ridge) * 0.08
      + spatial.sedimentBands * 0.14,
  );
  const erosion = clamp01(
    erosionHint * 0.28
      + surface.steep * 0.26
      + exposure * 0.20
      + spatial.ridge * 0.13
      + (1 - deposition) * 0.13,
  );
  const lithic = clamp01(
    b.rock * 0.45
      + surface.steep * 0.24
      + erosion * 0.18
      + spatial.ridge * 0.17
      - deposition * 0.16
      - moisture * 0.05,
  );
  const soilDepth = clamp01(
    deposition * 0.42
      + surface.gentle * 0.17
      + moisture * 0.14
      + topographicShelter * 0.12
      + (1 - lithic) * 0.15,
  );
  const frost = clamp01(
    surface.snow * 0.62
      + (1 - surface.thermal) * 0.24
      + b.tundra * 0.22
      + b.alpine * 0.10
      - surface.thermal * 0.08,
  );
  return Object.freeze({
    shelter: topographicShelter,
    exposure,
    moisture,
    aridity,
    deposition,
    erosion,
    lithic,
    soilDepth,
    frost,
  });
}

function domainWeights(surface, spatial, response) {
  const b = surface.biome;
  const wetMeadow = clamp01(
    response.moisture * 0.46
      + response.soilDepth * 0.20
      + surface.gentle * 0.14
      + surface.river * 0.08
      + (1 - spatial.meso) * 0.12
      + b.meadow * 0.18
      + b.wetland * 0.18
      - response.lithic * 0.20,
  );
  const dryHeath = clamp01(
    response.aridity * 0.45
      + response.exposure * 0.21
      + spatial.meso * 0.11
      + spatial.patch * 0.08
      + b.heath * 0.28
      - response.moisture * 0.14,
  );
  const woodland = clamp01(
    response.moisture * 0.31
      + response.shelter * 0.24
      + response.soilDepth * 0.18
      + (1 - surface.steep) * 0.08
      + (1 - spatial.patch) * 0.07
      + b.forest * 0.43
      - response.exposure * 0.17
      - response.frost * 0.18,
  );
  const scrub = clamp01(
    dryHeath * 0.26
      + response.shelter * 0.18
      + response.soilDepth * 0.16
      + spatial.patch * 0.16
      + (1 - woodland) * 0.12
      + (1 - wetMeadow) * 0.12,
  );
  const bareRock = clamp01(
    response.lithic * 0.55
      + response.erosion * 0.22
      + surface.steep * 0.13
      + spatial.ridge * 0.10
      + b.rock * 0.27,
  );
  const talus = clamp01(
    bell(surface.slopeDegrees, 32, 18) * 0.32
      + response.lithic * 0.22
      + response.deposition * 0.18
      + response.erosion * 0.12
      + spatial.sedimentBands * 0.16,
  );
  const riparian = clamp01(
    Math.max(surface.river, surface.lake * 0.74) * 0.53
      + response.moisture * 0.20
      + response.soilDepth * 0.12
      + response.shelter * 0.08
      + (1 - response.lithic) * 0.07,
  );
  const coastal = clamp01(
    surface.coast * 0.66
      + b.coast * 0.42
      + response.exposure * surface.coast * 0.10,
  );
  const alpine = clamp01(
    b.alpine * 0.46
      + response.frost * 0.22
      + response.lithic * 0.14
      + surface.steep * 0.10
      + (1 - surface.thermal) * 0.08,
  );
  return Object.freeze({
    wetMeadow,
    dryHeath,
    woodland,
    scrub,
    bareRock,
    talus,
    riparian,
    coastal,
    alpine,
  });
}

function materialSignals(surface, spatial, response, domains) {
  const albedoMacro = clamp01(spatial.macro * 0.54 + spatial.meso * 0.28 + spatial.cells.value * 0.18);
  const albedoMeso = clamp01(spatial.meso * 0.45 + spatial.patch * 0.36 + spatial.sedimentBands * 0.19);
  const albedoFine = clamp01(spatial.patch * 0.46 + spatial.fine * 0.42 + spatial.cells.edge * 0.12);
  const roughnessMacro = clamp01(
    0.38
      + response.aridity * 0.17
      + response.lithic * 0.12
      + response.frost * 0.08
      + spatial.meso * 0.14
      - response.moisture * 0.13,
  );
  const roughnessFine = clamp01(
    0.34
      + spatial.fine * 0.24
      + response.erosion * 0.14
      + domains.talus * 0.12
      + domains.scrub * 0.07
      - domains.wetMeadow * 0.09,
  );
  const normalMacro = clamp01(
    surface.slope * 0.18
      + response.erosion * 0.21
      + response.lithic * 0.18
      + spatial.ridge * 0.15
      + spatial.meso * 0.12
      + domains.talus * 0.16,
  );
  const normalFine = clamp01(
    spatial.fine * 0.28
      + spatial.patch * 0.15
      + response.erosion * 0.14
      + response.soilDepth * 0.10
      + domains.scrub * 0.11
      + domains.bareRock * 0.14
      + domains.wetMeadow * 0.08,
  );
  const weathering = clamp01(
    response.moisture * 0.20
      + response.exposure * 0.20
      + response.frost * 0.13
      + response.erosion * 0.18
      + surface.coast * 0.11
      + spatial.meso * 0.10
      + spatial.fine * 0.08,
  );
  const lichen = clamp01(
    domains.bareRock * 0.38
      + response.moisture * 0.26
      + response.shelter * 0.14
      + (1 - surface.thermal) * 0.10
      + spatial.patch * 0.12,
  );
  const moss = clamp01(
    response.moisture * 0.44
      + response.shelter * 0.25
      + domains.woodland * 0.16
      + spatial.patch * 0.08
      - response.exposure * 0.17,
  );
  return Object.freeze({
    albedoMacro,
    albedoMeso,
    albedoFine,
    roughnessMacro,
    roughnessFine,
    normalMacro,
    normalFine,
    weathering,
    lichen,
    moss,
    sedimentFabric: spatial.sedimentBands,
    sedimentAngle: spatial.sedimentAngle,
  });
}

function placementSignals(surface, spatial, response, domains, seed) {
  const cohort = clamp01(
    spatial.cells.value * 0.42
      + spatial.patch * 0.24
      + spatial.meso * 0.18
      + response.shelter * 0.16,
  );
  const vegetationCapacity = clamp01(
    domains.woodland * 0.30
      + domains.wetMeadow * 0.19
      + domains.scrub * 0.16
      + domains.riparian * 0.15
      + response.soilDepth * 0.13
      - domains.bareRock * 0.19
      - response.frost * 0.09
      - surface.road * 0.22
      - surface.settlement * 0.11,
  );
  const rockCapacity = clamp01(
    domains.bareRock * 0.43
      + domains.talus * 0.34
      + response.erosion * 0.12
      + spatial.cells.edge * 0.11
      - domains.wetMeadow * 0.16,
  );
  const candidateRank = hash3(
    Math.floor(surface.x * 0.71),
    Math.floor((surface.elevation + 2048) * 0.17),
    Math.floor(surface.z * 0.71),
    seed + 9209,
  );
  return Object.freeze({
    cohort,
    vegetationCapacity,
    rockCapacity,
    candidateRank,
    canopyAge: clamp01(cohort * 0.58 + spatial.macro * 0.24 + response.shelter * 0.18),
    understory: clamp01(response.moisture * 0.31 + response.shelter * 0.24 + response.soilDepth * 0.18 + spatial.fine * 0.13 + domains.woodland * 0.14),
    windPruning: clamp01(response.exposure * 0.52 + surface.slope * 0.14 + (1 - response.shelter) * 0.20 + spatial.patch * 0.14),
  });
}

export function sampleWorldEcologySurfaceField(input = {}) {
  const x = finite(input.x, 0);
  const z = finite(input.z, 0);
  const seed = hashUint(finite(input.seed, 0));
  const physical = physicalSurfaceFactors(input);
  const surface = Object.freeze({
    ...physical,
    x,
    z,
    concavity: clamp01(finite(input.concavity, 0.5)),
    shelter: clamp01(finite(input.shelter, 0.5)),
    erosion: clamp01(finite(input.erosion, 0.5)),
    deposition: clamp01(finite(input.deposition, 0.5)),
  });
  const spatial = spatialFields(x, z, seed);
  const response = ecologicalResponse(surface, spatial);
  const domains = domainWeights(surface, spatial, response);
  const material = materialSignals(surface, spatial, response, domains);
  const placement = placementSignals(surface, spatial, response, domains, seed);
  return Object.freeze({
    revision: WORLD_ECOLOGY_SURFACE_FIELD_REVISION,
    policyId: WORLD_ECOLOGY_SURFACE_FIELD_POLICY.id,
    x,
    z,
    seed,
    physical: surface,
    spatial,
    response,
    domains,
    material,
    placement,
  });
}

export function ecologySurfaceMaterialContext(field) {
  if (!field?.response || !field?.material) return Object.freeze({});
  return Object.freeze({
    moisture: field.response.moisture,
    exposure: field.response.exposure,
    shelter: field.response.shelter,
    aridity: field.response.aridity,
    deposition: field.response.deposition,
    erosion: field.response.erosion,
    lithic: field.response.lithic,
    soilDepth: field.response.soilDepth,
    frost: field.response.frost,
    wetMeadow: field.domains.wetMeadow,
    dryHeath: field.domains.dryHeath,
    woodland: field.domains.woodland,
    scrub: field.domains.scrub,
    bareRock: field.domains.bareRock,
    talus: field.domains.talus,
    riparian: field.domains.riparian,
    coastal: field.domains.coastal,
    alpine: field.domains.alpine,
    albedoMacro: field.material.albedoMacro,
    albedoMeso: field.material.albedoMeso,
    albedoFine: field.material.albedoFine,
    roughnessMacro: field.material.roughnessMacro,
    roughnessFine: field.material.roughnessFine,
    normalMacro: field.material.normalMacro,
    normalFine: field.material.normalFine,
    weathering: field.material.weathering,
    lichen: field.material.lichen,
    moss: field.material.moss,
    sedimentFabric: field.material.sedimentFabric,
    sedimentAngle: field.material.sedimentAngle,
  });
}

export function ecologyPlacementAcceptance(field, {
  family = 'vegetation',
  threshold = 0.5,
  minimum = 0.02,
} = {}) {
  if (!field?.placement) return false;
  const capacity = family === 'rock'
    ? field.placement.rockCapacity
    : family === 'vegetation'
      ? field.placement.vegetationCapacity
      : clamp01((field.placement.vegetationCapacity + field.placement.rockCapacity) * 0.5);
  const target = clamp01(threshold);
  const rank = clamp01(field.placement.candidateRank);
  return capacity >= minimum && rank <= clamp01(capacity * (1.10 - target * 0.45));
}

export function ecologyCohortTransform(field, {
  minScale = 0.82,
  maxScale = 1.18,
  yawRadians = null,
} = {}) {
  const age = clamp01(field?.placement?.canopyAge ?? 0.5);
  const pruning = clamp01(field?.placement?.windPruning ?? 0.5);
  const cohort = clamp01(field?.placement?.cohort ?? 0.5);
  const scale = lerp(minScale, maxScale, clamp01(age * 0.62 + cohort * 0.38)) * lerp(1, 0.91, pruning);
  const yaw = Number.isFinite(Number(yawRadians))
    ? Number(yawRadians)
    : fract(cohort * 0.754877666 + field.seed * 0.000000119) * TAU;
  return Object.freeze({
    scale,
    yaw,
    crownCompression: clamp01(pruning * 0.72 + (1 - age) * 0.18),
    trunkLean: (field.spatial?.warped?.qx ?? 0) * 0.028 + (field.spatial?.warped?.qz ?? 0) * 0.018,
    understory: clamp01(field?.placement?.understory ?? 0.5),
  });
}

export function summarizeEcologySurfaceField(field) {
  if (!field) return Object.freeze({ available: false });
  const dominantDomain = Object.entries(field.domains ?? {})
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
  return Object.freeze({
    available: true,
    revision: field.revision,
    dominantDomain,
    moisture: field.response?.moisture ?? 0,
    aridity: field.response?.aridity ?? 0,
    exposure: field.response?.exposure ?? 0,
    deposition: field.response?.deposition ?? 0,
    erosion: field.response?.erosion ?? 0,
    lithic: field.response?.lithic ?? 0,
    vegetationCapacity: field.placement?.vegetationCapacity ?? 0,
    rockCapacity: field.placement?.rockCapacity ?? 0,
  });
}
