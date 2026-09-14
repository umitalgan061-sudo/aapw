/**
 * Environment Runtime Adoption V58
 *
 * Runtime-facing vertical slice for shipped createScene callers. This module
 * consumes caller-owned canonical observations and emits bounded material,
 * placement, water, atmosphere and performance intents. It never creates
 * geometry, invents geography, hydrates assets, imports editor DOM, or takes
 * scene ownership. Model-bearing callers must complete the merged #590
 * MaterialAssignmentCore + WorldAssetPlacementPipeline sequence first.
 */

export const ENVIRONMENT_RUNTIME_ADOPTION_V58_ID = 'environment-runtime-adoption-v58';

const LIMITS = Object.freeze({
  maxSamples: 4096,
  maxMaterials: 4096,
  maxInstancesPerClass: 512,
  maxTextureRepeat: 64,
  maxNearDistance: 120,
  maxFarDistance: 120000,
});

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max, fallback = min) => Math.min(max, Math.max(min, finite(value, fallback)));
const clamp01 = (value, fallback = 0) => clamp(value, 0, 1, fallback);
const bool = (value) => value === true;
const string = (value, fallback = 'unknown') => typeof value === 'string' ? value.trim().slice(0, 96) || fallback : fallback;
const round = (value, digits = 5) => {
  const p = 10 ** digits;
  return Math.round(finite(value) * p) / p;
};
const hash = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

function sampleContext(input = {}) {
  const s = input && typeof input === 'object' ? input : {};
  return {
    x: finite(s.x),
    y: finite(s.y),
    z: finite(s.z),
    canonicalHeight: finite(s.canonicalHeight, finite(s.y)),
    renderedHeight: finite(s.renderedHeight, finite(s.y)),
    colliderHeight: finite(s.colliderHeight, finite(s.y)),
    slope: clamp01(s.slope),
    moisture: clamp01(s.moisture),
    snow: clamp01(s.snow),
    waterDepth: clamp(s.waterDepth, 0, 10000),
    waterDistance: clamp(s.waterDistance, 0, 100000),
    biome: string(s.biome),
    surface: string(s.surface),
    assetReady: s.assetReady !== false,
    road: bool(s.road),
    settlement: bool(s.settlement),
    permanentSnow: bool(s.permanentSnow),
    steep: bool(s.steep),
    seam: bool(s.seam),
    rectangularWater: bool(s.rectangularWater),
    waterMoire: bool(s.waterMoire),
    blackSky: bool(s.blackSky),
    floating: bool(s.floating),
    interpenetrating: bool(s.interpenetrating),
    textureTiling: bool(s.textureTiling),
  };
}

function parity(s) {
  const renderedCanonical = Math.abs(s.renderedHeight - s.canonicalHeight);
  const colliderCanonical = Math.abs(s.colliderHeight - s.canonicalHeight);
  return {
    renderedCanonical: round(renderedCanonical),
    colliderCanonical: round(colliderCanonical),
    pass: renderedCanonical <= 0.08 && colliderCanonical <= 0.08,
  };
}

function surfaceWeights(s) {
  const water = clamp01(Math.min(1, s.waterDepth / 8));
  const wet = clamp01(1 - Math.min(1, s.waterDistance / 24)) * (0.25 + s.moisture * 0.75);
  const rock = clamp01(s.slope * 1.15 + (s.surface === 'rock' ? 0.35 : 0) + (s.surface === 'cliff' ? 0.4 : 0));
  const scree = clamp01(Math.max(0, s.slope - 0.38) * 1.25 + (s.surface === 'scree' ? 0.35 : 0));
  const snow = clamp01(s.snow * 0.92 + (s.permanentSnow ? 0.2 : 0));
  const mud = clamp01(s.moisture * 0.55 + wet * 0.45 - water * 0.25);
  const sand = clamp01((1 - s.moisture) * 0.25 + (s.biome === 'coast' ? 0.35 : 0) - snow * 0.2);
  const grass = clamp01(1 - Math.max(rock, scree, snow, water) * 0.88 - sand * 0.35);
  const soil = clamp01(1 - Math.max(grass, rock, scree, snow, water) * 0.7);
  const total = grass + soil + mud + sand + rock + scree + snow + wet + water;
  const normalize = (v) => round(v / Math.max(total, 0.0001));
  return {
    grass: normalize(grass),
    soil: normalize(soil),
    mud: normalize(mud),
    sand: normalize(sand),
    rock: normalize(rock),
    scree: normalize(scree),
    snow: normalize(snow),
    wet: normalize(wet),
    water: normalize(water),
  };
}

function riskLedger(s) {
  return {
    seam: s.seam ? 1 : 0,
    rectangularWater: s.rectangularWater ? 1 : 0,
    waterMoire: s.waterMoire ? 1 : 0,
    blackSky: s.blackSky ? 1 : 0,
    floating: s.floating ? 1 : 0,
    interpenetrating: s.interpenetrating ? 1 : 0,
    textureTiling: s.textureTiling ? 1 : 0,
    parity: parity(s).pass ? 0 : 1,
  };
}

function terrainMaterialIntent(s, distance) {
  const near = distance <= 55;
  const weights = surfaceWeights(s);
  return {
    mode: 'biome-slope-moisture-height-water',
    weights,
    macroBreakup: round(clamp01(0.18 + s.slope * 0.32 + s.moisture * 0.18)),
    microRelief: round(clamp01(0.12 + (near ? 0.28 : 0.12) + weights.rock * 0.2)),
    worldSpaceAntiTiling: true,
    repeatScale: round(clamp(near ? 7.5 : 4.5, 1, LIMITS.maxTextureRepeat)),
    triplanarOrEquivalent: true,
    roughnessRange: [round(clamp(0.38 + weights.rock * 0.5, 0.2, 0.97)), round(clamp(0.9 - weights.wet * 0.2, 0.2, 0.97))],
    normalEnergy: round(clamp(0.25 + weights.rock * 0.55 + (near ? 0.18 : 0), 0.05, 1)),
    aoIntensity: round(clamp(0.32 + s.slope * 0.42, 0, 1)),
    snowlineBand: round(clamp01(s.snow * 0.8 + weights.rock * 0.15)),
    shorelineWetEdge: round(clamp01((1 - Math.min(1, s.waterDistance / 24)) * (0.35 + s.moisture * 0.65))),
  };
}

function waterIntent(s, distance) {
  const deep = clamp01(s.waterDepth / 24);
  const shallow = clamp01(1 - deep);
  const shore = clamp01(1 - Math.min(1, s.waterDistance / 18));
  return {
    class: s.waterDepth > 1 ? 'deep' : shore > 0 ? 'shore' : 'dry',
    deep: round(deep),
    shallow: round(shallow),
    shore: round(shore),
    wetEdge: round(clamp01(shore * (0.55 + s.moisture * 0.45))),
    foam: round(clamp01(shore * (0.18 + shallow * 0.46))),
    cyanSuppression: round(clamp01(0.62 + shore * 0.28)),
    antiMoire: true,
    linePatternSuppression: true,
    repeatScale: round(clamp(distance < 55 ? 3.5 : 2.5, 1, 12)),
  };
}

function vegetationIntent(s, distance) {
  const blocked = !s.assetReady || s.waterDepth > 0.15 || s.steep || s.permanentSnow || s.road || s.settlement || s.floating || s.interpenetrating;
  const habitat = /forest|woodland|taiga|meadow|marsh|coast/.test(s.biome) ? s.biome : 'open';
  const density = blocked ? 0 : clamp01(0.15 + (1 - s.slope) * 0.3 + s.moisture * 0.35 + (habitat === 'forest' ? 0.3 : 0));
  return {
    eligible: !blocked,
    blockedReasons: [
      !s.assetReady && 'asset-not-ready',
      s.waterDepth > 0.15 && 'water',
      s.steep && 'steep-cliff',
      s.permanentSnow && 'permanent-snow',
      s.road && 'road',
      s.settlement && 'settlement',
      s.floating && 'floating',
      s.interpenetrating && 'interpenetrating',
    ].filter(Boolean),
    habitat,
    density: round(density),
    cluster: density > 0.38 ? 'clustered' : density > 0.12 ? 'ecotone' : 'sparse',
    yawJitter: round(clamp(0.32 + density * 0.42, 0, 0.9)),
    scaleJitter: round(clamp(0.08 + density * 0.18, 0.04, 0.3)),
    lod: distance < 55 ? 'near' : distance < 240 ? 'mid' : 'far',
    instancing: true,
    maxInstances: Math.min(LIMITS.maxInstancesPerClass, Math.max(0, Math.round(16 + density * 220))),
  };
}

function atmosphereIntent(s, distance) {
  return {
    cameraRelativeSky: true,
    blackSkyGuard: !s.blackSky,
    fogDensity: round(clamp(0.0008 + distance / 1200000, 0.0006, 0.035)),
    exposure: round(clamp(0.96 + (s.snow ? 0.06 : 0) - (s.waterDepth > 0 ? 0.02 : 0), 0.72, 1.25)),
    distantPerspective: distance > 240,
    horizonReadable: !s.blackSky,
  };
}

function performanceIntent(s, distance) {
  const near = distance <= 55;
  return {
    lod: near ? 'near' : distance <= 240 ? 'mid' : 'far',
    cull: distance > 120000,
    instancing: true,
    maxMaterialCount: LIMITS.maxMaterials,
    targetFrameMs: near ? 18 : distance <= 240 ? 16.7 : 14,
    textureMemoryClass: near ? 'high' : distance <= 240 ? 'medium' : 'low',
  };
}

function samplePlan(raw, options = {}) {
  const s = sampleContext(raw);
  const distance = clamp(options.cameraDistance, 0, LIMITS.maxFarDistance, 100);
  const risks = riskLedger(s);
  return {
    id: hash({ s, distance }),
    coordinate: { x: round(s.x), y: round(s.y), z: round(s.z) },
    parity: parity(s),
    risks,
    materials: terrainMaterialIntent(s, distance),
    water: waterIntent(s, distance),
    vegetation: vegetationIntent(s, distance),
    atmosphere: atmosphereIntent(s, distance),
    performance: performanceIntent(s, distance),
    provenance: { canonical: true, callerOwned: true, sceneMutation: false },
  };
}

function aggregate(plans) {
  const totals = plans.reduce((acc, p) => {
    for (const [key, value] of Object.entries(p.risks)) acc[key] = (acc[key] || 0) + value;
    return acc;
  }, {});
  return {
    sampleCount: plans.length,
    riskCounts: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v])),
    parityPassRate: round(plans.filter((p) => p.parity.pass).length / Math.max(1, plans.length)),
    vegetationEligibleRate: round(plans.filter((p) => p.vegetation.eligible).length / Math.max(1, plans.length)),
    waterMoireVisible: plans.filter((p) => p.risks.waterMoire > 0).length,
    rectangularWaterVisible: plans.filter((p) => p.risks.rectangularWater > 0).length,
    blackSkyVisible: plans.filter((p) => p.risks.blackSky > 0).length,
  };
}

export function buildEnvironmentRuntimeAdoptionV58(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const rawSamples = Array.isArray(source.samples) ? source.samples.slice(0, LIMITS.maxSamples) : [source];
  const cameraDistance = clamp(source.cameraDistance, 0, LIMITS.maxFarDistance, 100);
  const plans = rawSamples.map((raw) => samplePlan(raw, { cameraDistance }));
  const output = {
    id: ENVIRONMENT_RUNTIME_ADOPTION_V58_ID,
    camera: { width: 1536, height: 1024, orthographic: true, fov: 90, distance: round(cameraDistance) },
    plans,
    summary: aggregate(plans),
    sharedContract: {
      authority: ['MaterialAssignmentCore.js', 'WorldAssetPlacementPipeline.js'],
      sequence: ['asset-hydrate-load', 'surface-analysis', 'multi-material-recipe', 'validation', 'ground-transform', 'manifest', 'scene-attach'],
      editorRuntimeImport: false,
      geometryCreation: false,
      canonicalMutation: false,
    },
    acceptance: {
      beforeAfterComparable: true,
      deterministic: true,
      fullWorld: true,
      terrainNear: true,
      northwestNear: true,
      targets: {
        visibleSeam: 0,
        visibleRectangularWater: 0,
        visibleWaterMoire: 0,
        visibleBlackSky: 0,
        floatingAssets: 0,
        interpenetratingAssets: 0,
      },
    },
  };
  return deepFreeze(output);
}

export function stableEnvironmentRuntimeDigestV58(value) {
  const seen = new WeakSet();
  const normalize = (node) => {
    if (node && typeof node === 'object') {
      if (seen.has(node)) return '[cycle]';
      seen.add(node);
      if (Array.isArray(node)) return node.map(normalize);
      return Object.fromEntries(Object.keys(node).sort().map((key) => [key, normalize(node[key])]));
    }
    return node;
  };
  return hash(normalize(value));
}

export function applyEnvironmentRuntimeAdoptionV58(target, plan) {
  if (!target || typeof target !== 'object') return { applied: false, reason: 'missing-target' };
  if (!plan || typeof plan !== 'object') return { applied: false, reason: 'missing-plan' };
  target.environmentRuntimeAdoptionV58 = plan;
  return { applied: true, id: ENVIRONMENT_RUNTIME_ADOPTION_V58_ID, digest: stableEnvironmentRuntimeDigestV58(plan) };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export const ENVIRONMENT_RUNTIME_ADOPTION_V58_LIMITS = LIMITS;
