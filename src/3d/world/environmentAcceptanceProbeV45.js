const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finiteOr(value, 0)));
const positive = (value, fallback = 0) => Math.max(0, finiteOr(value, fallback));
const stable = (value) => JSON.stringify(value);
const hash = (value) => {
  let out = 2166136261;
  for (const char of value) out = Math.imul(out ^ char.charCodeAt(0), 16777619);
  return (out >>> 0).toString(16).padStart(8, '0');
};

export const ENVIRONMENT_ACCEPTANCE_PROBE_V45 = Object.freeze({
  id: 'environment-acceptance-probe-2026-09-10-v45',
  readOnly: true,
  deterministic: true,
  createsGeometry: false,
  inventsGeography: false,
  mutatesCanonicalState: false,
  importsEditorUi: false,
  sharedMaterialPlacementAuthority: 'merged-590',
  camera: Object.freeze({
    width: 1536,
    height: 1024,
    orthographic: true,
    degrees: 90,
    profiles: Object.freeze(['full-world', 'far', 'near-center', 'near-northwest'])
  })
});

const normalizeSample = (sample = {}) => Object.freeze({
  id: String(sample.id ?? 'sample'),
  x: finiteOr(sample.x), y: finiteOr(sample.y), z: finiteOr(sample.z),
  canonicalHeight: finiteOr(sample.canonicalHeight, finiteOr(sample.y)),
  renderedHeight: finiteOr(sample.renderedHeight, finiteOr(sample.y)),
  colliderHeight: finiteOr(sample.colliderHeight, finiteOr(sample.y)),
  slope: clamp01(sample.slope),
  elevation: clamp01(sample.elevation),
  moisture: clamp01(sample.moisture),
  waterDistance: positive(sample.waterDistance, 9999),
  waterDepth: positive(sample.waterDepth),
  waterCoverage: clamp01(sample.waterCoverage),
  biome: String(sample.biome ?? 'unknown'),
  surface: String(sample.surface ?? 'ground'),
  assetFamily: String(sample.assetFamily ?? 'none'),
  assetReady: sample.assetReady !== false,
  road: sample.road === true,
  settlement: sample.settlement === true,
  cliff: sample.cliff === true,
  permanentSnow: sample.permanentSnow === true,
  visibleSeam: sample.visibleSeam === true,
  visibleRectangularWater: sample.visibleRectangularWater === true,
  visibleWaterMoire: sample.visibleWaterMoire === true,
  visibleTextureTiling: sample.visibleTextureTiling === true,
  floatingOrInterpenetrating: sample.floatingOrInterpenetrating === true,
  blackSky: sample.blackSky === true,
  materialRoles: Array.isArray(sample.materialRoles) ? sample.materialRoles.map(String).slice(0, 12) : []
});

const surfaceWeights = (sample) => {
  const slope = sample.slope;
  const elevation = sample.elevation;
  const moisture = sample.moisture;
  const shore = sample.waterDistance < 18 ? clamp01((18 - sample.waterDistance) / 18) : 0;
  const alpine = clamp01((elevation - 0.66) / 0.34);
  const scree = clamp01((slope - 0.52) * 1.8) * (0.35 + 0.65 * elevation);
  const rock = clamp01((slope - 0.42) * 1.65) * (0.25 + 0.75 * elevation);
  const snow = clamp01((elevation - 0.78) / 0.22) * (0.65 + 0.35 * (1 - moisture));
  const grass = clamp01(1 - rock - scree - snow) * (0.72 + 0.28 * (1 - moisture));
  const soil = clamp01((1 - grass) * 0.62 + moisture * 0.38);
  const mud = clamp01(moisture * (0.35 + 0.65 * shore));
  const sand = clamp01(shore * (1 - moisture) * 0.72);
  const wetEdge = clamp01(shore * (1 - sample.waterDepth / 8));
  const foam = clamp01(shore * sample.waterCoverage * 0.55);
  const raw = { grass, soil, mud, sand, rock, scree, snow, wetEdge, foam };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
  return Object.freeze(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Number((value / total).toFixed(6))])));
};

const materialResponse = (sample, weights) => Object.freeze({
  macroBreakup: Number((0.22 + sample.elevation * 0.24 + sample.slope * 0.18 + sample.moisture * 0.16).toFixed(6)),
  microRelief: Number((0.12 + sample.slope * 0.22 + weights.rock * 0.2 + weights.scree * 0.24).toFixed(6)),
  roughness: Number((0.52 + weights.rock * 0.2 + weights.snow * 0.08 + weights.mud * 0.11).toFixed(6)),
  normalEnergy: Number((0.35 + sample.slope * 0.28 + weights.rock * 0.22 + weights.scree * 0.18).toFixed(6)),
  aoEnergy: Number((0.18 + weights.rock * 0.16 + weights.scree * 0.2 + sample.moisture * 0.08).toFixed(6)),
  antiTilingPhase: Object.freeze({
    x: Number((sample.x * 0.013 + sample.z * 0.007).toFixed(6)),
    y: Number((sample.z * 0.011 - sample.x * 0.005).toFixed(6))
  })
});

const waterResponse = (sample) => Object.freeze({
  class: sample.waterDepth > 4 ? 'deep' : sample.waterDepth > 0.12 ? 'shallow' : sample.waterCoverage > 0 ? 'shore' : 'dry',
  opacity: Number((0.22 + clamp01(sample.waterDepth / 8) * 0.58).toFixed(6)),
  roughness: Number((0.72 - clamp01(sample.waterDepth / 8) * 0.2).toFixed(6)),
  normalEnergy: Number((0.1 + clamp01(sample.waterCoverage) * 0.2).toFixed(6)),
  antiMoire: sample.visibleWaterMoire ? 'required' : 'clear',
  rectangularCoverage: sample.visibleRectangularWater ? 'blocked' : 'clear',
  shorelineIntegrity: sample.waterCoverage > 0 && sample.waterDistance > 0 ? 'observed' : 'not-applicable'
});

const vegetation = (sample, weights) => {
  const excluded = sample.waterCoverage > 0.2 || sample.cliff || sample.permanentSnow || sample.road || sample.settlement || !sample.assetReady || sample.floatingOrInterpenetrating;
  return Object.freeze({
    eligible: !excluded,
    reason: excluded ? (sample.waterCoverage > 0.2 ? 'water' : sample.cliff ? 'cliff' : sample.permanentSnow ? 'permanent-snow' : sample.road ? 'road' : sample.settlement ? 'settlement' : !sample.assetReady ? 'asset-not-ready' : 'invalid-grounding') : 'grounded',
    density: Number((excluded ? 0 : 0.25 + weights.grass * 0.7 + sample.moisture * 0.2).toFixed(6)),
    cluster: excluded ? 'none' : sample.biome === 'forest' ? 'forest-canopy' : sample.biome === 'alpine' ? 'alpine-ecotone' : 'grass-shrub',
    lod: excluded ? 'hidden' : sample.elevation > 0.72 ? 'near-medium' : 'near-far',
    instancing: excluded ? 'none' : sample.assetFamily === 'none' ? 'none' : 'preferred'
  });
};

const acceptance = (sample) => Object.freeze({
  visibleGridOrSeam: sample.visibleSeam ? 1 : 0,
  visibleRectangularWater: sample.visibleRectangularWater ? 1 : 0,
  obviousWaterMoire: sample.visibleWaterMoire ? 1 : 0,
  visibleTextureTiling: sample.visibleTextureTiling ? 1 : 0,
  floatingOrInterpenetrating: sample.floatingOrInterpenetrating ? 1 : 0,
  blackSkyFailure: sample.blackSky ? 1 : 0,
  renderColliderParity: Number(Math.abs(sample.renderedHeight - sample.colliderHeight).toFixed(6)),
  canonicalRenderParity: Number(Math.abs(sample.canonicalHeight - sample.renderedHeight).toFixed(6))
});

export const inspectEnvironmentSample = (input = {}) => {
  const sample = normalizeSample(input);
  const weights = surfaceWeights(sample);
  const result = {
    policy: ENVIRONMENT_ACCEPTANCE_PROBE_V45.id,
    sample,
    surfaces: weights,
    materials: materialResponse(sample, weights),
    water: waterResponse(sample),
    vegetation: vegetation(sample, weights),
    acceptance: acceptance(sample),
    provenance: Object.freeze({
      canonical: 'caller-owned',
      rendered: 'caller-owned',
      collider: 'caller-owned',
      assetPlacement: 'merged-590-contract-required'
    })
  };
  const digest = hash(stable(result));
  return Object.freeze({ ...result, digest });
};

export const inspectEnvironmentBatch = (samples = []) => {
  const rows = Array.isArray(samples) ? samples.slice(0, 256).map(inspectEnvironmentSample) : [];
  const summary = rows.reduce((acc, row) => {
    acc.total += 1;
    acc.seams += row.acceptance.visibleGridOrSeam;
    acc.rectangularWater += row.acceptance.visibleRectangularWater;
    acc.waterMoire += row.acceptance.obviousWaterMoire;
    acc.textureTiling += row.acceptance.visibleTextureTiling;
    acc.invalidGrounding += row.acceptance.floatingOrInterpenetrating;
    acc.blackSky += row.acceptance.blackSkyFailure;
    acc.vegetationEligible += row.vegetation.eligible ? 1 : 0;
    return acc;
  }, { total: 0, seams: 0, rectangularWater: 0, waterMoire: 0, textureTiling: 0, invalidGrounding: 0, blackSky: 0, vegetationEligible: 0 });
  const output = { policy: ENVIRONMENT_ACCEPTANCE_PROBE_V45.id, rows, summary };
  return Object.freeze({ ...output, digest: hash(stable(output)) });
};

export const applyEnvironmentObservation = (target, observation) => {
  if (!target || typeof target !== 'object') return target;
  if (!observation || typeof observation !== 'object') return target;
  target.environmentAcceptanceProbe = observation;
  return target;
};
