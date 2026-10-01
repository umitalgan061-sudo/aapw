const isFiniteNumber = (value) => Number.isFinite(Number(value));
const numberOr = (value, fallback = 0) => (isFiniteNumber(value) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, numberOr(value, min)));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

const DEFAULT_CAMERAS = Object.freeze([
  Object.freeze({ id: 'full-world', kind: 'orthographic', width: 1536, height: 1024, degrees: 90 }),
  Object.freeze({ id: 'terrain-far', kind: 'orthographic', width: 1536, height: 1024, degrees: 90 }),
  Object.freeze({ id: 'terrain-near-center', kind: 'orthographic', width: 1536, height: 1024, degrees: 90 }),
  Object.freeze({ id: 'terrain-near-northwest', kind: 'orthographic', width: 1536, height: 1024, degrees: 90 }),
]);

const DEFAULT_TARGETS = Object.freeze({
  visibleGridOrSeam: 0,
  visibleRectangularWater: 0,
  visibleWaterMoire: 0,
  blackSkyFailure: 0,
  floatingOrInterpenetrating: 0,
  placeholderAsset: 0,
  materialMismatch: 0,
  colliderParityErrorMeters: 0.75,
});

function normalizePoint(point, index) {
  const source = point && typeof point === 'object' ? point : {};
  return {
    id: String(source.id ?? `sample-${index}`),
    x: finite(Number(source.x), 0),
    y: finite(Number(source.y), 0),
    z: finite(Number(source.z), 0),
    elevation: finite(Number(source.elevation), 0),
    slope: clamp(source.slope, 0, 90),
    moisture: clamp(source.moisture, 0, 1),
    waterDistance: Math.max(0, numberOr(source.waterDistance, 999999)),
    biome: String(source.biome ?? 'unknown'),
    canonicalHeight: finite(Number(source.canonicalHeight), finite(Number(source.elevation), 0)),
    renderedHeight: finite(Number(source.renderedHeight), finite(Number(source.elevation), 0)),
    colliderHeight: finite(Number(source.colliderHeight), finite(Number(source.elevation), 0)),
    seamDistance: Math.max(0, numberOr(source.seamDistance, 999999)),
    waterCoverage: clamp(source.waterCoverage, 0, 1),
    waterGradient: clamp(source.waterGradient, 0, 1),
    surfaceLuminance: clamp(source.surfaceLuminance, 0, 1),
    skyLuminance: clamp(source.skyLuminance, 0, 1),
    assetState: String(source.assetState ?? 'unknown'),
    assetRole: String(source.assetRole ?? 'environment'),
    roadDistance: Math.max(0, numberOr(source.roadDistance, 999999)),
    settlementDistance: Math.max(0, numberOr(source.settlementDistance, 999999)),
  };
}

function stableSort(samples) {
  return samples.slice().sort((a, b) => a.id.localeCompare(b.id));
}

function classifyBand(sample) {
  if (sample.waterCoverage >= 0.8 && sample.waterDistance <= 2) return 'water';
  if (sample.waterDistance <= 8) return 'wet-edge';
  if (sample.biome.includes('alpine') || sample.biome.includes('snow')) return 'alpine-snowline';
  if (sample.slope >= 42) return 'cliff-tal us'.replace(' ', '');
  if (sample.biome.includes('forest')) return 'forest-floor';
  if (sample.biome.includes('shrub')) return 'shrub-ecotone';
  return 'open-ground';
}

function materialWeights(sample) {
  const wet = clamp((12 - sample.waterDistance) / 12 + sample.moisture * 0.25, 0, 1);
  const steep = clamp((sample.slope - 18) / 55, 0, 1);
  const high = clamp((sample.elevation - 180) / 900, 0, 1);
  const snow = sample.biome.includes('snow') || sample.biome.includes('alpine') ? clamp(0.35 + high * 0.55, 0, 1) : 0;
  const rock = clamp(steep * 0.75 + snow * 0.25, 0, 1);
  const grass = clamp((1 - steep) * (1 - snow) * (0.45 + sample.moisture * 0.35), 0, 1);
  const mud = clamp(wet * sample.moisture * (1 - steep), 0, 1);
  const sand = sample.biome.includes('coast') || sample.biome.includes('desert') ? clamp(0.35 + wet * 0.15, 0, 1) : 0;
  const scree = clamp(steep * (0.25 + snow * 0.35), 0, 1);
  const soil = clamp(1 - Math.max(grass, rock, snow, sand), 0, 1);
  const foam = sample.waterCoverage > 0.15 && sample.waterGradient > 0.3 ? clamp(wet * sample.waterGradient, 0, 1) : 0;
  const raw = { grass, soil, mud, sand, rock, scree, snow, wetEdge: wet, foam };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value / total]));
}

function structuralRisk(sample) {
  return {
    seam: sample.seamDistance < 2,
    rectangularWater: sample.waterCoverage > 0.95 && sample.waterGradient < 0.08,
    moire: sample.waterCoverage > 0.2 && sample.waterGradient < 0.18,
    blackSky: sample.skyLuminance < 0.04,
    flatSurface: sample.surfaceLuminance > 0.25 && sample.slope < 3,
    placeholder: sample.assetState === 'placeholder' || sample.assetRole === 'primitive',
    grounding: Math.abs(sample.renderedHeight - sample.canonicalHeight) > 0.75 || Math.abs(sample.colliderHeight - sample.canonicalHeight) > 0.75,
  };
}

function vegetationEligibility(sample) {
  const blocked = [];
  if (sample.waterCoverage > 0.35 || sample.waterDistance < 3) blocked.push('water');
  if (sample.slope > 48) blocked.push('cliff');
  if (sample.biome.includes('snow') && sample.elevation > 700) blocked.push('permanent-snow');
  if (sample.roadDistance < 4) blocked.push('road');
  if (sample.settlementDistance < 3) blocked.push('settlement-clearance');
  if (sample.assetState === 'floating' || sample.assetState === 'interpenetrating') blocked.push('invalid-grounding');
  const cluster = sample.biome.includes('forest') ? 'canopy' : sample.biome.includes('shrub') ? 'shrub' : 'grass';
  return { eligible: blocked.length === 0, blockedBy: blocked, cluster, density: blocked.length ? 0 : clamp((1 - sample.slope / 90) * (0.4 + sample.moisture * 0.6), 0, 1) };
}

function digest(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `env-v37-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

export function buildEnvironmentVisualEvidence(input = {}) {
  const options = input && typeof input === 'object' ? input : {};
  const points = stableSort(Array.isArray(options.samples) ? options.samples.map(normalizePoint) : []);
  const rows = points.map((sample) => {
    const risk = structuralRisk(sample);
    return {
      id: sample.id,
      band: classifyBand(sample),
      weights: materialWeights(sample),
      risk,
      vegetation: vegetationEligibility(sample),
      parity: {
        renderedDeltaMeters: Math.abs(sample.renderedHeight - sample.canonicalHeight),
        colliderDeltaMeters: Math.abs(sample.colliderHeight - sample.canonicalHeight),
      },
      antiTilingPhase: { x: Math.abs(sample.x % 257), z: Math.abs(sample.z % 257) },
    };
  });
  const counts = rows.reduce((acc, row) => {
    Object.entries(row.risk).forEach(([key, value]) => { if (value) acc[key] = (acc[key] || 0) + 1; });
    return acc;
  }, {});
  const visualTargets = { ...DEFAULT_TARGETS, ...(options.targets && typeof options.targets === 'object' ? options.targets : {}) };
  const summary = {
    sampleCount: rows.length,
    visibleGridOrSeam: counts.seam || 0,
    visibleRectangularWater: counts.rectangularWater || 0,
    visibleWaterMoire: counts.moire || 0,
    blackSkyFailure: counts.blackSky || 0,
    floatingOrInterpenetrating: points.filter((p) => p.assetState === 'floating' || p.assetState === 'interpenetrating').length,
    placeholderAsset: counts.placeholder || 0,
    materialMismatch: Number(options.materialMismatchCount) || 0,
    targetBreaches: [],
  };
  Object.entries(visualTargets).forEach(([key, target]) => {
    if (key in summary && Number(summary[key]) > Number(target)) summary.targetBreaches.push(key);
  });
  const result = {
    version: 'v37',
    cameras: DEFAULT_CAMERAS,
    targets: visualTargets,
    samples: rows,
    summary,
    beforeAfter: {
      comparable: true,
      coordinateSystem: 'canonical-world-space',
      seed: String(options.seed ?? 'environment-v37'),
    },
  };
  result.digest = digest(result);
  return deepFreeze(result);
}

export function serializeEnvironmentVisualEvidence(value) {
  return JSON.stringify(value ?? buildEnvironmentVisualEvidence());
}
