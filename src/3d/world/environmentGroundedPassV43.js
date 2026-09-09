const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const round = (value, digits = 6) => Number(finite(value).toFixed(digits));
const bool = (value) => value === true;

const CAMERA_PROFILES = Object.freeze({
  fullWorld: Object.freeze({ width: 1536, height: 1024, orthographic: true, heading: 0, pitch: -90, distance: 1 }),
  far: Object.freeze({ width: 1536, height: 1024, orthographic: true, heading: 18, pitch: -62, distance: 0.72 }),
  nearCenter: Object.freeze({ width: 1536, height: 1024, orthographic: true, heading: 24, pitch: -38, distance: 0.18 }),
  nearNorthwest: Object.freeze({ width: 1536, height: 1024, orthographic: true, heading: 312, pitch: -36, distance: 0.16 }),
});

const DEFAULTS = Object.freeze({
  maxSurfaceSamples: 4096,
  maxAssetSamples: 2048,
  visibleRiskBudget: 0,
  maxTextureRepeat: 0.18,
  maxFramePressure: 0.82,
});

function normalizeVec3(value) {
  return {
    x: round(value?.x),
    y: round(value?.y),
    z: round(value?.z),
  };
}

function normalizeSample(sample = {}) {
  const canonicalHeight = finite(sample.canonicalHeight, finite(sample.height));
  const renderedHeight = finite(sample.renderedHeight, canonicalHeight);
  const colliderHeight = finite(sample.colliderHeight, canonicalHeight);
  const slope = clamp(sample.slope, 0, 90);
  const moisture = clamp(sample.moisture, 0, 1);
  const elevation = finite(sample.elevation, canonicalHeight);
  const waterDistance = Math.max(0, finite(sample.waterDistance, Infinity));
  const biome = String(sample.biome || 'unknown').toLowerCase();
  const location = normalizeVec3(sample.location || sample.position);
  const heightParity = Math.abs(renderedHeight - colliderHeight);
  const canonicalParity = Math.abs(renderedHeight - canonicalHeight);

  return Object.freeze({
    id: String(sample.id || `${location.x}:${location.y}:${location.z}`),
    biome,
    location,
    slope: round(slope),
    moisture: round(moisture),
    elevation: round(elevation),
    waterDistance: round(waterDistance),
    canonicalHeight: round(canonicalHeight),
    renderedHeight: round(renderedHeight),
    colliderHeight: round(colliderHeight),
    heightParity: round(heightParity),
    canonicalParity: round(canonicalParity),
    visibleSeam: bool(sample.visibleSeam),
    rectangularWater: bool(sample.rectangularWater),
    waterMoire: bool(sample.waterMoire),
    floating: bool(sample.floating),
    interpenetrating: bool(sample.interpenetrating),
    blackSky: bool(sample.blackSky),
  });
}

function classifySurface(sample) {
  const snow = sample.biome.includes('snow') || sample.elevation >= 720;
  const alpine = sample.biome.includes('alpine') || sample.slope >= 42;
  const wet = sample.waterDistance <= 10 || sample.moisture >= 0.78;
  const rock = alpine || sample.slope >= 32 || sample.biome.includes('rock') || sample.biome.includes('cliff');
  const mud = wet && sample.slope < 24;
  const grass = !snow && !rock && !mud;
  const scree = rock && sample.slope >= 38;
  const wetEdge = sample.waterDistance <= 4;
  return Object.freeze({ snow, alpine, wet, rock, mud, grass, scree, wetEdge });
}

function surfaceResponse(sample) {
  const c = classifySurface(sample);
  const snowline = clamp((sample.elevation - 620) / 160, 0, 1);
  const rockExposure = clamp((sample.slope - 18) / 36, 0, 1);
  const wetEdge = clamp((4 - sample.waterDistance) / 4, 0, 1);
  const macro = clamp(0.22 + sample.slope / 180 + sample.moisture * 0.2, 0.15, 0.9);
  const micro = clamp(0.18 + sample.slope / 240 + (1 - sample.moisture) * 0.12, 0.12, 0.72);
  const weights = {
    grass: c.grass ? 0.52 * (1 - snowline) : 0,
    soil: c.grass ? 0.18 + (1 - sample.moisture) * 0.16 : 0,
    mud: c.mud ? 0.24 + sample.moisture * 0.18 : 0,
    rock: c.rock ? 0.28 + rockExposure * 0.42 : 0.05,
    scree: c.scree ? 0.12 + rockExposure * 0.22 : 0,
    snow: c.snow ? 0.35 + snowline * 0.5 : snowline * 0.18,
    wetEdge: wetEdge * 0.32,
    foam: wetEdge * (sample.waterMoire || sample.rectangularWater ? 0 : 0.08),
  };
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  for (const key of Object.keys(weights)) weights[key] = round(weights[key] / total);
  return Object.freeze({
    weights: Object.freeze(weights),
    macroContrast: round(macro),
    microRelief: round(micro),
    rockExposure: round(rockExposure),
    snowline: round(snowline),
    wetEdge: round(wetEdge),
    antiTilingPhase: Object.freeze({ x: round((sample.location.x * 0.017) % 1), z: round((sample.location.z * 0.013) % 1) }),
  });
}

function assetEligibility(asset = {}, sample) {
  const kind = String(asset.kind || 'unknown').toLowerCase();
  const isVegetation = kind.includes('tree') || kind.includes('shrub') || kind.includes('grass') || kind.includes('vegetation');
  const blocked = sample.rectangularWater || sample.floating || sample.interpenetrating || sample.slope >= 52 || sample.waterDistance < 2 || (sample.elevation >= 760 && isVegetation) || (sample.biome.includes('road') && isVegetation) || (sample.biome.includes('settlement') && isVegetation);
  const lod = sample.waterDistance < 8 ? 0 : sample.slope >= 38 ? 1 : 2;
  return Object.freeze({
    id: String(asset.id || 'asset'),
    kind,
    eligible: !blocked,
    reason: blocked ? 'grounding-or-context-blocked' : 'eligible',
    lod,
    instanceGroup: `${kind}:lod${lod}`,
    scale: round(clamp(asset.scale, 0.72, 1.28), 3),
    yaw: round((((finite(asset.yaw) % 360) + 360) % 360), 3),
  });
}

function normalizeObservation(observation = {}, options = {}) {
  const maxSurfaceSamples = clamp(options.maxSurfaceSamples ?? DEFAULTS.maxSurfaceSamples, 1, DEFAULTS.maxSurfaceSamples);
  const maxAssetSamples = clamp(options.maxAssetSamples ?? DEFAULTS.maxAssetSamples, 1, DEFAULTS.maxAssetSamples);
  const samples = Array.isArray(observation.samples) ? observation.samples.slice(0, maxSurfaceSamples).map(normalizeSample) : [];
  const assets = Array.isArray(observation.assets) ? observation.assets.slice(0, maxAssetSamples) : [];
  const surfaces = samples.map((sample) => Object.freeze({ sampleId: sample.id, surface: surfaceResponse(sample) }));
  const assetPlans = assets.map((asset, index) => assetEligibility(asset, samples[index % (samples.length || 1)] || normalizeSample({ id: `empty-${index}` })));
  const risks = {
    visibleSeam: samples.filter((sample) => sample.visibleSeam).length,
    rectangularWater: samples.filter((sample) => sample.rectangularWater).length,
    waterMoire: samples.filter((sample) => sample.waterMoire).length,
    floatingOrInterpenetrating: samples.filter((sample) => sample.floating || sample.interpenetrating).length,
    blackSky: samples.filter((sample) => sample.blackSky).length,
    parity: samples.filter((sample) => sample.heightParity > 0.05 || sample.canonicalParity > 0.05).length,
  };
  const accepted = Object.values(risks).every((value) => value <= (options.visibleRiskBudget ?? DEFAULTS.visibleRiskBudget));
  const framePressure = clamp(0.25 + assetPlans.filter((asset) => asset.eligible).length / Math.max(1, maxAssetSamples) + risks.parity * 0.01, 0, 1);
  const targetBreaches = {
    visibleRisks: !accepted,
    textureRepeat: surfaces.some(({ surface }) => surface.antiTilingPhase.x === 0 && surface.antiTilingPhase.z === 0),
    framePressure: framePressure > (options.maxFramePressure ?? DEFAULTS.maxFramePressure),
  };
  return Object.freeze({
    schema: 'environment-grounded-pass/v43',
    cameraProfiles: CAMERA_PROFILES,
    sampleCount: samples.length,
    assetCount: assetPlans.length,
    risks: Object.freeze(risks),
    targetBreaches: Object.freeze(targetBreaches),
    accepted,
    framePressure: round(framePressure),
    surfaces: Object.freeze(surfaces),
    assetPlans: Object.freeze(assetPlans),
  });
}

export function createEnvironmentGroundedPass(observation = {}, options = {}) {
  return normalizeObservation(observation, options);
}

export function applyEnvironmentGroundedPass(target = {}, observation = {}, options = {}) {
  const plan = createEnvironmentGroundedPass(observation, options);
  if (!target || typeof target !== 'object') return plan;
  target.environmentGroundedPass = plan;
  if (target.userData && typeof target.userData === 'object') target.userData.environmentGroundedPassDigest = stableSerialize(plan);
  return plan;
}

export function stableSerialize(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

export const ENVIRONMENT_GROUNDED_PASS_V43 = Object.freeze({
  schema: 'environment-grounded-pass/v43',
  cameraProfiles: CAMERA_PROFILES,
  defaults: DEFAULTS,
});
