/**
 * Environment Visual Adoption V56
 *
 * Runtime-facing, DOM-free observation contract for the shipped createScene path.
 * This module deliberately does not create geometry, invent geography, hydrate assets,
 * or replace the shared MaterialAssignmentCore / WorldAssetPlacementPipeline authority.
 *
 * The caller supplies canonical observations and owns all scene mutation. The output is
 * deterministic, deeply frozen, bounded, and suitable for full-world / far / near proof.
 */

export const ENVIRONMENT_VISUAL_ADOPTION_V56_ID = 'environment-visual-adoption-v56';
export const V56_CAMERA_PROFILES = Object.freeze({
  fullWorld: Object.freeze({ width: 1536, height: 1024, orthographic: true, yaw: 0, pitch: -1.0471975512, distance: 14000 }),
  far: Object.freeze({ width: 1536, height: 1024, orthographic: true, yaw: 0.22, pitch: -0.82, distance: 5200 }),
  terrainNear: Object.freeze({ width: 1536, height: 1024, orthographic: true, yaw: -0.31, pitch: -0.67, distance: 850 }),
  northwestNear: Object.freeze({ width: 1536, height: 1024, orthographic: true, yaw: 0.58, pitch: -0.72, distance: 920 }),
});

const LIMITS = Object.freeze({
  maxSamples: 4096,
  maxAssets: 2048,
  maxReasons: 24,
  maxString: 160,
});

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback = '') => typeof value === 'string' ? value.slice(0, LIMITS.maxString) : fallback;
const list = (value) => Array.isArray(value) ? value : [];
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stable(value[key]);
      return out;
    }, {});
  }
  if (typeof value === 'number') return round(value);
  return value;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function digest(value) {
  return hashString(JSON.stringify(stable(value)));
}

function normalizeVector(vector) {
  const source = vector && typeof vector === 'object' ? vector : {};
  return { x: round(finite(source.x)), y: round(finite(source.y)), z: round(finite(source.z)) };
}

function normalizeCamera(camera, fallback) {
  const source = camera && typeof camera === 'object' ? camera : {};
  return {
    width: clamp(source.width, 256, 4096),
    height: clamp(source.height, 256, 4096),
    orthographic: source.orthographic !== false,
    yaw: round(finite(source.yaw, fallback.yaw)),
    pitch: round(finite(source.pitch, fallback.pitch)),
    distance: clamp(source.distance, 1, 50000),
  };
}

function normalizeSurface(sample) {
  const source = sample && typeof sample === 'object' ? sample : {};
  const slope = clamp01(source.slope);
  const elevation = clamp01(source.elevation);
  const moisture = clamp01(source.moisture);
  const waterDistance = clamp(source.waterDistance, 0, 50000);
  const waterDepth = clamp(source.waterDepth, 0, 10000);
  const snow = clamp01(source.snow);
  const biome = text(source.biome, 'unknown').toLowerCase();
  const roadDistance = clamp(source.roadDistance, 0, 50000);
  const settlementDistance = clamp(source.settlementDistance, 0, 50000);
  const canonicalHeight = finite(source.canonicalHeight);
  const renderedHeight = finite(source.renderedHeight);
  const colliderHeight = finite(source.colliderHeight);
  const parityTolerance = clamp(source.parityTolerance, 0.001, 5);
  const parityDelta = Math.max(
    Math.abs(canonicalHeight - renderedHeight),
    Math.abs(canonicalHeight - colliderHeight),
    Math.abs(renderedHeight - colliderHeight),
  );
  const nearShore = waterDistance <= 8 || waterDepth > 0;
  const steep = slope >= 0.72;
  const alpine = snow >= 0.55 || biome.includes('alpine') || biome.includes('tundra');
  const grounded = source.grounded === true;
  const materialReady = source.materialReady !== false;
  const assetFamily = text(source.assetFamily, 'unknown').toLowerCase();
  const surfaceBand = steep ? 'cliff' : alpine ? 'alpine' : nearShore ? 'shore' : moisture > 0.64 ? 'wet-ground' : 'ground';
  return {
    id: text(source.id, 'sample'),
    position: normalizeVector(source.position),
    slope: round(slope),
    elevation: round(elevation),
    moisture: round(moisture),
    waterDistance: round(waterDistance),
    waterDepth: round(waterDepth),
    snow: round(snow),
    biome,
    roadDistance: round(roadDistance),
    settlementDistance: round(settlementDistance),
    canonicalHeight: round(canonicalHeight),
    renderedHeight: round(renderedHeight),
    colliderHeight: round(colliderHeight),
    parityTolerance: round(parityTolerance),
    parityDelta: round(parityDelta),
    nearShore,
    steep,
    alpine,
    grounded,
    materialReady,
    assetFamily,
    surfaceBand,
    rectangularWater: source.rectangularWater === true,
    seam: source.seam === true,
    stairStepCoast: source.stairStepCoast === true,
    moire: source.moire === true,
    visibleTextureTiling: source.visibleTextureTiling === true,
    blackSky: source.blackSky === true,
    floating: source.floating === true,
    interpenetrating: source.interpenetrating === true,
    cliffWall: source.cliffWall === true,
    flatRelief: source.flatRelief === true,
    snowSheet: source.snowSheet === true,
    assetPlaceholder: source.assetPlaceholder === true,
    materialMismatch: source.materialMismatch === true,
  };
}

function surfaceWeights(sample) {
  const { slope, elevation, moisture, waterDistance, waterDepth, snow, nearShore } = sample;
  const alpine = sample.alpine ? 1 : 0;
  const rock = clamp01(slope * 1.3 + alpine * 0.25);
  const scree = clamp01(rock * 0.72 + (1 - moisture) * 0.15);
  const grass = clamp01((1 - slope) * (1 - alpine * 0.82) * (0.48 + moisture * 0.52));
  const soil = clamp01((1 - slope * 0.55) * (0.24 + (1 - moisture) * 0.76));
  const mud = clamp01((1 - slope) * moisture * (waterDistance < 18 ? 1 : 0.55));
  const sand = clamp01(nearShore && waterDepth < 0.35 ? 0.72 + (1 - moisture) * 0.2 : 0.02);
  const wetEdge = clamp01(nearShore ? Math.max(0, 1 - waterDistance / 12) * (0.65 + moisture * 0.35) : 0);
  const foam = clamp01(waterDepth > 0 ? Math.max(0, 1 - waterDepth / 2.5) : 0);
  const snowWeight = clamp01(snow * (0.76 + elevation * 0.24));
  const values = { grass, soil, mud, sand, rock, scree, snow: snowWeight, wetEdge, foam };
  const total = Object.values(values).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, round(value / total)]));
}

function riskFlags(sample) {
  return {
    rectangularWater: sample.rectangularWater,
    seam: sample.seam,
    stairStepCoast: sample.stairStepCoast,
    moire: sample.moire,
    visibleTextureTiling: sample.visibleTextureTiling,
    blackSky: sample.blackSky,
    floating: sample.floating,
    interpenetrating: sample.interpenetrating,
    cliffWall: sample.cliffWall,
    flatRelief: sample.flatRelief,
    snowSheet: sample.snowSheet,
    parityFailure: sample.parityDelta > sample.parityTolerance,
    assetPlaceholder: sample.assetPlaceholder,
    materialMismatch: sample.materialMismatch,
  };
}

function placementDecision(sample) {
  const reasons = [];
  if (!sample.grounded) reasons.push('not-grounded');
  if (!sample.materialReady) reasons.push('material-not-ready');
  if (sample.waterDepth > 0.12 || (sample.nearShore && sample.waterDistance < 1.5)) reasons.push('water');
  if (sample.steep) reasons.push('steep-cliff');
  if (sample.alpine && sample.snow > 0.82) reasons.push('permanent-snow');
  if (sample.roadDistance < 1.5) reasons.push('road-clearance');
  if (sample.settlementDistance < 2.5) reasons.push('settlement-clearance');
  if (sample.floating) reasons.push('floating');
  if (sample.interpenetrating) reasons.push('interpenetrating');
  if (sample.assetPlaceholder) reasons.push('placeholder');
  return {
    eligible: reasons.length === 0,
    reasons: reasons.slice(0, LIMITS.maxReasons),
    habitat: sample.alpine ? 'alpine-ecotone' : sample.nearShore ? 'shore-ecotone' : sample.biome.includes('forest') ? 'forest-cluster' : 'open-ground',
    density: round(clamp01((1 - sample.slope) * (1 - sample.snow * 0.8) * (sample.nearShore ? 0.35 : 0.78))),
    yaw: round(((finite(sample.position.x) * 12.9898 + finite(sample.position.z) * 78.233) % 6.2831853072 + 6.2831853072) % 6.2831853072),
    scale: round(clamp(0.82 + (Math.abs(finite(sample.position.x) * 0.17 + finite(sample.position.z) * 0.11) % 0.46), 0.72, 1.28)),
    lod: sample.waterDistance < 20 ? 'near' : sample.waterDistance < 90 ? 'mid' : 'far',
    instancingGroup: `${sample.assetFamily}:${sample.surfaceBand}`,
  };
}

function normalizeAsset(asset) {
  const source = asset && typeof asset === 'object' ? asset : {};
  return {
    id: text(source.id, 'asset'),
    family: text(source.family, 'unknown').toLowerCase(),
    materialRoles: list(source.materialRoles).slice(0, 16).map((role) => text(role).toLowerCase()),
    sourceKind: text(source.sourceKind, 'imported'),
    lodReady: source.lodReady !== false,
    instancingReady: source.instancingReady !== false,
    placeholder: source.placeholder === true,
    hydrated: source.hydrated !== false,
  };
}

function normalizeWeather(weather) {
  const source = weather && typeof weather === 'object' ? weather : {};
  return {
    sunElevation: clamp(source.sunElevation, -1.57, 1.57),
    exposure: clamp(source.exposure, -4, 4),
    fogNear: clamp(source.fogNear, 0, 50000),
    fogFar: clamp(source.fogFar, 1, 100000),
    backgroundLuminance: clamp01(source.backgroundLuminance),
    windStrength: clamp01(source.windStrength),
    precipitation: clamp01(source.precipitation),
    cameraRelativeSky: source.cameraRelativeSky !== false,
  };
}

function countRisks(rows) {
  return rows.reduce((out, row) => {
    Object.entries(row.risks).forEach(([key, value]) => {
      if (value) out[key] = (out[key] || 0) + 1;
    });
    return out;
  }, {});
}

function acceptanceTargets(rows, weather) {
  const riskCounts = countRisks(rows);
  const visibleFailures = Object.values(riskCounts).reduce((sum, count) => sum + count, 0);
  return {
    visibleGridOrSeam: riskCounts.seam || 0,
    visibleRectangularWater: riskCounts.rectangularWater || 0,
    visibleWaterMoire: riskCounts.moire || 0,
    visibleTextureTiling: riskCounts.visibleTextureTiling || 0,
    visibleFloatingAssets: riskCounts.floating || 0,
    visibleInterpenetration: riskCounts.interpenetrating || 0,
    visibleBlackSky: riskCounts.blackSky || 0,
    visibleMaterialMismatch: riskCounts.materialMismatch || 0,
    visibleFailureTotal: visibleFailures,
    allVisibleFailureTargetsMet: visibleFailures === 0 && weather.backgroundLuminance >= 0.08 && weather.cameraRelativeSky,
  };
}

export function buildEnvironmentVisualAdoptionV56(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const samples = list(source.samples).slice(0, LIMITS.maxSamples).map(normalizeSurface);
  const rows = samples.map((sample) => ({
    id: sample.id,
    position: sample.position,
    surfaceBand: sample.surfaceBand,
    weights: surfaceWeights(sample),
    risks: riskFlags(sample),
    placement: placementDecision(sample),
    parity: {
      canonicalToRendered: round(sample.renderedHeight - sample.canonicalHeight),
      canonicalToCollider: round(sample.colliderHeight - sample.canonicalHeight),
      renderedToCollider: round(sample.colliderHeight - sample.renderedHeight),
      withinTolerance: sample.parityDelta <= sample.parityTolerance,
    },
  }));
  const assets = list(source.assets).slice(0, LIMITS.maxAssets).map(normalizeAsset);
  const weather = normalizeWeather(source.weather);
  const cameras = Object.fromEntries(Object.entries(V56_CAMERA_PROFILES).map(([key, fallback]) => [
    key,
    normalizeCamera(source.cameras?.[key], fallback),
  ]));
  const eligiblePlacements = rows.filter((row) => row.placement.eligible).length;
  const acceptance = acceptanceTargets(rows, weather);
  const manifest = {
    id: ENVIRONMENT_VISUAL_ADOPTION_V56_ID,
    cameraProfiles: cameras,
    sampleCount: samples.length,
    assetCount: assets.length,
    acceptance,
    sharedMaterialPlacement: {
      required: true,
      sequence: ['asset-hydrate-load', 'surface-analysis', 'multi-material-recipe', 'validation', 'ground-transform', 'manifest', 'scene-attach'],
      authority: ['MaterialAssignmentCore.js', 'WorldAssetPlacementPipeline.js'],
      editorRuntimeImport: false,
      callerOwnsSceneAttach: true,
    },
    queryContract: { ground: true, collider: true, water: true, slope: true, biome: true, placement: true },
    weather,
    perf: {
      maxSamples: LIMITS.maxSamples,
      eligiblePlacements,
      instancingRecommended: assets.length > 24 || eligiblePlacements > 96,
      lodBands: ['near', 'mid', 'far'],
      cullingRequired: true,
    },
  };
  const payload = { version: 'v56', manifest, rows, assets, digest: '' };
  payload.digest = digest(payload);
  return freeze(payload);
}

export function applyEnvironmentVisualAdoptionV56(target, plan) {
  if (!target || typeof target !== 'object') return false;
  if (!plan || typeof plan !== 'object' || plan.version !== 'v56') return false;
  target.environmentVisualAdoption = plan;
  return true;
}

export function compareEnvironmentVisualAdoptionV56(before, after) {
  const left = before && typeof before === 'object' ? before : {};
  const right = after && typeof after === 'object' ? after : {};
  const beforeFailures = finite(left.manifest?.acceptance?.visibleFailureTotal);
  const afterFailures = finite(right.manifest?.acceptance?.visibleFailureTotal);
  return freeze({
    beforeFailures: round(beforeFailures),
    afterFailures: round(afterFailures),
    improvement: round(beforeFailures - afterFailures),
    improved: afterFailures < beforeFailures,
    digestChanged: text(left.digest) !== text(right.digest),
  });
}

export function validateEnvironmentVisualAdoptionV56(plan) {
  const failures = [];
  if (!plan || plan.version !== 'v56') failures.push('version');
  if (!plan?.manifest?.sharedMaterialPlacement?.required) failures.push('shared-material-placement');
  if (plan?.manifest?.sharedMaterialPlacement?.editorRuntimeImport) failures.push('editor-runtime-import');
  if (!plan?.manifest?.weather?.cameraRelativeSky) failures.push('camera-relative-sky');
  if (!Number.isFinite(plan?.manifest?.weather?.fogFar) || plan.manifest.weather.fogFar <= 0) failures.push('fog-order');
  if (!Number.isFinite(plan?.manifest?.weather?.backgroundLuminance)) failures.push('background-luminance');
  if (plan?.rows?.some((row) => row.placement?.reasons?.includes('placeholder'))) failures.push('placeholder-placement');
  return freeze({ ok: failures.length === 0, failures: failures.slice(0, LIMITS.maxReasons) });
}
