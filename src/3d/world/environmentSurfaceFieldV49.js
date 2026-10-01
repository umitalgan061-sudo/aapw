const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

const normalizeVector = (vector, fallback = { x: 0, y: 1, z: 0 }) => {
  const x = finite(vector?.x, fallback.x);
  const y = finite(vector?.y, fallback.y);
  const z = finite(vector?.z, fallback.z);
  const length = Math.hypot(x, y, z);
  if (!length) return { ...fallback };
  return { x: x / length, y: y / length, z: z / length };
};

const hash01 = (seed) => {
  let value = 2166136261;
  const text = String(seed);
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return ((value >>> 0) % 1000003) / 1000003;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const digest = (payload) => {
  const serialized = stableStringify(payload);
  let hash = 0;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = ((hash << 5) - hash + serialized.charCodeAt(index)) | 0;
  }
  return `surface-field-v49-${Math.abs(hash).toString(16)}`;
};

const normalizeSample = (sample = {}) => {
  const position = {
    x: finite(sample.position?.x),
    y: finite(sample.position?.y),
    z: finite(sample.position?.z),
  };
  const normal = normalizeVector(sample.normal);
  const slope = clamp01(sample.slope ?? (1 - Math.abs(normal.y)));
  const elevation = clamp01(sample.elevation);
  const moisture = clamp01(sample.moisture);
  const waterDistance = Math.max(0, finite(sample.waterDistance, 9999));
  const canopy = clamp01(sample.canopy);
  const roughness = clamp01(sample.roughness ?? 0.72);
  const ambient = clamp01(sample.ambient ?? 0.54);
  return {
    id: String(sample.id ?? `${position.x}:${position.y}:${position.z}`),
    position,
    normal,
    slope,
    elevation,
    moisture,
    waterDistance,
    canopy,
    roughness,
    ambient,
    biome: String(sample.biome ?? 'temperate'),
    isCanonical: sample.isCanonical !== false,
    isRendered: sample.isRendered !== false,
    isCollider: sample.isCollider !== false,
    hasRoad: sample.hasRoad === true,
    hasSettlement: sample.hasSettlement === true,
    hasAsset: sample.hasAsset !== false,
    skyLuminance: clamp01(sample.skyLuminance ?? 0.72),
    waterCoverage: clamp01(sample.waterCoverage),
    waterDepth: Math.max(0, finite(sample.waterDepth)),
    tileBoundaryDistance: Math.max(0, finite(sample.tileBoundaryDistance, 9999)),
    textureRepeatRisk: clamp01(sample.textureRepeatRisk),
  };
};

const classifyBand = (sample) => {
  if (sample.waterCoverage > 0.2 || sample.waterDepth > 0.2) return 'water';
  if (sample.hasSettlement) return 'settlement';
  if (sample.hasRoad) return 'road';
  if (sample.slope >= 0.78) return 'cliff';
  if (sample.elevation >= 0.82 && sample.moisture <= 0.35) return 'alpine';
  if (sample.elevation >= 0.64 && sample.slope >= 0.42) return 'ridge';
  if (sample.waterDistance <= 8) return 'shore';
  if (sample.canopy >= 0.65) return 'forest';
  if (sample.canopy >= 0.28) return 'ecotone';
  return 'lowland';
};

const weightsFor = (sample, band) => {
  const shore = clamp01(1 - sample.waterDistance / 18);
  const alpine = clamp01((sample.elevation - 0.58) * 2.6);
  const cliff = clamp01((sample.slope - 0.46) * 2.2);
  const forest = clamp01(sample.canopy * (1 - cliff) * (0.6 + sample.moisture * 0.4));
  const wet = clamp01(sample.moisture * 0.74 + shore * 0.26);
  const rock = clamp01(cliff * 0.72 + alpine * 0.34 + (1 - sample.moisture) * 0.08);
  const scree = clamp01(rock * 0.78 + alpine * 0.18);
  const snow = clamp01(alpine * (0.35 + (1 - sample.moisture) * 0.55));
  const grass = clamp01((1 - rock) * (1 - snow) * (0.44 + sample.moisture * 0.56));
  const soil = clamp01((1 - grass) * (1 - rock) * (0.68 + sample.moisture * 0.25));
  const mud = clamp01(wet * (1 - rock) * 0.68);
  const sand = clamp01(shore * (1 - cliff) * (1 - sample.moisture) * 0.62);
  const foam = clamp01(shore * sample.waterCoverage * 1.4);
  const sum = grass + soil + mud + sand + rock + scree + snow;
  const normalize = (value) => (sum ? value / sum : 0);
  return {
    grass: round(normalize(grass)),
    soil: round(normalize(soil)),
    mud: round(normalize(mud)),
    sand: round(normalize(sand)),
    rock: round(normalize(rock)),
    scree: round(normalize(scree)),
    snow: round(normalize(snow)),
    wetEdge: round(wet),
    foam: round(foam),
    forest: round(forest),
    band,
  };
};

const riskFor = (sample, band) => ({
  seam: sample.tileBoundaryDistance < 2 && sample.textureRepeatRisk > 0.6,
  rectangularWater: sample.waterCoverage > 0.55 && sample.waterDistance > 12,
  waterMoire: sample.waterCoverage > 0.2 && sample.waterDepth > 0 && sample.textureRepeatRisk > 0.52,
  flatSurface: sample.slope < 0.12 && sample.roughness < 0.32 && sample.textureRepeatRisk > 0.5,
  blackSky: sample.skyLuminance < 0.08 || sample.ambient < 0.08,
  floatingAsset: sample.hasAsset && !sample.isCollider,
  interpenetratingAsset: sample.hasAsset && sample.isCollider && sample.slope > 0.92 && band !== 'cliff',
});

const placementFor = (sample, band, weights) => {
  const blocked = sample.waterCoverage > 0.08
    || sample.waterDepth > 0.08
    || band === 'cliff'
    || band === 'road'
    || band === 'settlement'
    || band === 'alpine'
    || !sample.hasAsset
    || !sample.isCanonical
    || !sample.isRendered
    || !sample.isCollider;
  const habitat = sample.biome === 'taiga' ? 'conifer' : sample.biome === 'alpine' ? 'subalpine' : 'mixed';
  const density = blocked ? 0 : round(clamp01((weights.forest + weights.grass) * (1 - sample.slope) * (0.45 + sample.moisture * 0.55)));
  const variantSeed = `${sample.id}:${sample.biome}:${band}`;
  return {
    eligible: !blocked,
    blockedReason: blocked ? (
      sample.waterCoverage > 0.08 || sample.waterDepth > 0.08 ? 'water' :
        band === 'cliff' ? 'steep-cliff' :
          band === 'road' ? 'road-clearance' :
            band === 'settlement' ? 'settlement-clearance' :
              band === 'alpine' ? 'permanent-snow' :
                !sample.hasAsset ? 'asset-not-ready' :
                  !sample.isCanonical || !sample.isRendered || !sample.isCollider ? 'ground-not-ready' : 'blocked'
    ) : null,
    habitat,
    density,
    yawPhase: round(hash01(variantSeed)),
    scalePhase: round(0.86 + hash01(`${variantSeed}:scale`) * 0.28),
    lod: density > 0.6 ? 'near' : density > 0.22 ? 'mid' : 'far',
    instancingGroup: density > 0 ? `${habitat}:${band}` : null,
  };
};

const parityFor = (sample) => ({
  canonical: sample.isCanonical,
  rendered: sample.isRendered,
  collider: sample.isCollider,
  sameCoordinate: sample.isCanonical && sample.isRendered && sample.isCollider,
  confidence: round((Number(sample.isCanonical) + Number(sample.isRendered) + Number(sample.isCollider)) / 3),
});

export const buildEnvironmentSurfaceFieldV49 = (input = {}) => {
  const samples = Array.isArray(input.samples) ? input.samples.map(normalizeSample) : [];
  const rows = samples.map((sample) => {
    const band = classifyBand(sample);
    const weights = weightsFor(sample, band);
    const risks = riskFor(sample, band);
    return {
      id: sample.id,
      position: sample.position,
      band,
      weights,
      risks,
      parity: parityFor(sample),
      placement: placementFor(sample, band, weights),
      antiTiling: {
        phase: round(hash01(`${sample.position.x}:${sample.position.z}`)),
        worldSpace: true,
        distanceFade: round(clamp01(1 - sample.waterDistance / 240)),
      },
      atmosphere: {
        skyLuminance: sample.skyLuminance,
        ambient: sample.ambient,
        fogNear: round(clamp(18 + sample.elevation * 40, 12, 72)),
        fogFar: round(clamp(220 + sample.elevation * 220, 180, 760)),
      },
    };
  });
  const riskCounts = rows.reduce((accumulator, row) => {
    Object.entries(row.risks).forEach(([key, value]) => {
      accumulator[key] = (accumulator[key] ?? 0) + Number(Boolean(value));
    });
    return accumulator;
  }, {});
  const summary = {
    sampleCount: rows.length,
    eligiblePlacements: rows.filter((row) => row.placement.eligible).length,
    blockedPlacements: rows.filter((row) => !row.placement.eligible).length,
    bands: rows.reduce((accumulator, row) => {
      accumulator[row.band] = (accumulator[row.band] ?? 0) + 1;
      return accumulator;
    }, {}),
    riskCounts,
    visibleFailureTargets: {
      seam: 0,
      rectangularWater: 0,
      waterMoire: 0,
      flatSurface: 0,
      blackSky: 0,
      floatingAsset: 0,
      interpenetratingAsset: 0,
    },
  };
  const payload = {
    version: 'v49',
    acceptanceCamera: {
      width: 1536,
      height: 1024,
      projection: 'orthographic',
      fov: 90,
      views: ['full-world', 'far', 'near-center', 'near-northwest'],
      deterministicSeed: String(input.seed ?? 'aapw-environment-v49'),
    },
    rows,
    summary,
  };
  return deepFreeze({ ...payload, digest: digest(payload) });
};

export const applyEnvironmentSurfaceFieldV49 = (target, field) => {
  if (!target || !field) return target;
  target.environmentSurfaceFieldV49 = field;
  return target;
};

export default buildEnvironmentSurfaceFieldV49;
