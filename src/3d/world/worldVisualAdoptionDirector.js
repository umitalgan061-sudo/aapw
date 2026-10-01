/**
 * World visual adoption director.
 *
 * This module is intentionally render-facing and side-effect free. It converts
 * caller-owned canonical samples into a bounded adoption plan for the shipped
 * scene without creating geography, geometry, placement systems or editor
 * dependencies. The caller remains authoritative for Terrain, Water, Collider,
 * Roads, Settlements, asset hydrate/load and scene attachment.
 *
 * @module worldVisualAdoptionDirector
 */

const SURFACES = Object.freeze([
  'grass', 'soil', 'mud', 'sand', 'rock', 'scree', 'snow', 'wetEdge', 'foam',
]);
const WATER_CLASSES = Object.freeze(['none', 'river', 'lake', 'sea']);
const PHASES = Object.freeze(['full', 'far', 'near']);
const MAX_NUMBER = 1e6;
const EPSILON = 1e-9;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}
function saturate(value) { return clamp(value, 0, 1); }
function positive(value, fallback = 0) { return Math.max(0, finite(value, fallback)); }
function asBool(value) { return value === true; }
function cleanText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = saturate((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) { return a + (b - a) * saturate(t); }
function hash2D(x, z, seed = 0) {
  let h = (Math.imul(Math.floor(finite(x) * 1000), 374761393)
    ^ Math.imul(Math.floor(finite(z) * 1000), 668265263)
    ^ Math.imul(Math.floor(finite(seed) * 1000), 1442695041)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function normalizeVector3(vector) {
  const x = finite(vector?.x);
  const y = finite(vector?.y);
  const z = finite(vector?.z);
  const length = Math.hypot(x, y, z);
  if (length <= EPSILON) return Object.freeze({ x: 0, y: 1, z: 0 });
  return Object.freeze({ x: x / length, y: y / length, z: z / length });
}
function normalizeWeights(raw) {
  const values = {};
  let sum = 0;
  for (const surface of SURFACES) {
    const value = positive(raw?.[surface]);
    values[surface] = value;
    sum += value;
  }
  if (sum <= EPSILON) {
    values.soil = 1;
    sum = 1;
  }
  for (const surface of SURFACES) values[surface] = values[surface] / sum;
  return values;
}
function dominantSurface(weights) {
  return SURFACES.reduce((best, surface) => (
    weights[surface] > weights[best] ? surface : best
  ), 'soil');
}
function stableRound(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
}
function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = clonePlain(value[key]);
    return output;
  }
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function normalizeWorldVisualSample(input = {}) {
  const phase = PHASES.includes(input.phase) ? input.phase : 'near';
  const waterClass = WATER_CLASSES.includes(input.waterClass) ? input.waterClass : 'none';
  const position = {
    x: finite(input.position?.x),
    y: finite(input.position?.y),
    z: finite(input.position?.z),
  };
  const height = finite(input.height, position.y);
  const slope = saturate(input.slope);
  const moisture = saturate(input.moisture);
  const temperature = clamp(input.temperature, -1, 1);
  const waterDistance = positive(input.waterDistance, MAX_NUMBER);
  const roadDistance = positive(input.roadDistance, MAX_NUMBER);
  const settlementDistance = positive(input.settlementDistance, MAX_NUMBER);
  const groundConfidence = saturate(input.groundConfidence);
  const snowCover = saturate(input.snowCover);
  const canopy = saturate(input.canopy);
  const skyLuminance = saturate(input.skyLuminance);
  const exposure = clamp(input.exposure, 0.25, 4);
  const normal = normalizeVector3(input.normal);
  return {
    id: cleanText(input.id, 'sample'),
    phase,
    waterClass,
    position,
    height,
    slope,
    moisture,
    temperature,
    waterDistance,
    roadDistance,
    settlementDistance,
    groundConfidence,
    snowCover,
    canopy,
    skyLuminance,
    exposure,
    normal,
    hasCanonicalHeight: asBool(input.hasCanonicalHeight),
    hasCanonicalWater: asBool(input.hasCanonicalWater),
    hasCanonicalBiome: asBool(input.hasCanonicalBiome),
    hasHydratedAsset: asBool(input.hasHydratedAsset),
    tileBoundaryDistance: positive(input.tileBoundaryDistance, MAX_NUMBER),
    tileSize: positive(input.tileSize, 500),
    textureRepeatRisk: saturate(input.textureRepeatRisk),
    moireRisk: saturate(input.moireRisk),
    blackSkyRisk: saturate(input.blackSkyRisk),
    frameTimeMs: positive(input.frameTimeMs, 16.7),
    drawCalls: Math.round(positive(input.drawCalls, 0)),
    textureMemoryMb: positive(input.textureMemoryMb, 0),
  };
}

export function deriveSurfaceWeights(sampleInput = {}) {
  const sample = normalizeWorldVisualSample(sampleInput);
  const slopeRock = smoothstep(0.32, 0.8, sample.slope);
  const alpine = smoothstep(0.45, 0.95, sample.height / 1000);
  const cold = smoothstep(0.1, -0.8, sample.temperature);
  const wet = saturate(sample.moisture * 0.75 + smoothstep(80, 0, sample.waterDistance) * 0.25);
  const roadSuppression = 1 - smoothstep(8, 18, sample.roadDistance);
  const settlementSuppression = 1 - smoothstep(12, 28, sample.settlementDistance);
  const openGround = saturate(1 - slopeRock * 0.6);
  const snow = saturate(sample.snowCover * 0.72 + cold * 0.2 + alpine * 0.16);
  const scree = saturate(slopeRock * 0.62 + snow * 0.22 + (1 - wet) * 0.08);
  const rock = saturate(slopeRock * 0.68 + alpine * 0.2 + (1 - sample.moisture) * 0.12);
  const wetEdge = saturate(smoothstep(24, 0, sample.waterDistance) * (0.4 + wet * 0.6));
  const foam = saturate(smoothstep(5, 0, sample.waterDistance) * 0.32 + sample.moireRisk * 0.05);
  const mud = saturate(wet * 0.5 + roadSuppression * 0.12 + settlementSuppression * 0.05);
  const sand = saturate((1 - slopeRock) * smoothstep(-0.2, 0.7, sample.temperature) * 0.18 + wetEdge * 0.12);
  const grass = saturate(openGround * (1 - snow) * (1 - wet * 0.35) * 0.72);
  const soil = saturate(openGround * (0.22 + sample.moisture * 0.24) + mud * 0.2);
  const weights = normalizeWeights({ grass, soil, mud, sand, rock, scree, snow, wetEdge, foam });
  return deepFreeze({
    weights,
    dominantSurface: dominantSurface(weights),
    context: deepFreeze({
      slopeBand: slopeRock > 0.7 ? 'cliff' : slopeRock > 0.35 ? 'slope' : 'lowland',
      moistureBand: wet > 0.65 ? 'wet' : wet > 0.3 ? 'mesic' : 'dry',
      alpine: alpine > 0.5,
      snowline: snow > 0.35,
    }),
  });
}

export function deriveAntiTiling(sampleInput = {}) {
  const sample = normalizeWorldVisualSample(sampleInput);
  const tileSize = Math.max(1, sample.tileSize);
  const hash = hash2D(sample.position.x / tileSize, sample.position.z / tileSize, sample.position.y);
  const angle = ((hash * Math.PI * 2) + Math.PI / 7) % (Math.PI * 2);
  const scaleA = lerp(0.72, 1.38, hash);
  const scaleB = lerp(0.84, 1.18, 1 - hash);
  const boundaryBlend = smoothstep(2, 18, sample.tileBoundaryDistance);
  const risk = saturate(sample.textureRepeatRisk * 0.55 + sample.moireRisk * 0.45);
  return deepFreeze({
    worldPhase: {
      x: stableRound((sample.position.x / tileSize) % 1),
      z: stableRound((sample.position.z / tileSize) % 1),
    },
    carrierRotationRadians: stableRound(angle),
    carrierScales: { a: stableRound(scaleA), b: stableRound(scaleB) },
    edgeBlend: stableRound(lerp(0.35, 1, boundaryBlend)),
    suppressRepeatedStripe: risk > 0.18,
    risk: stableRound(risk),
  });
}

export function deriveTerrainReliefHints(sampleInput = {}) {
  const sample = normalizeWorldVisualSample(sampleInput);
  const rockExposure = saturate(sample.slope * 0.62 + smoothstep(0.35, 0.85, sample.height / 1000) * 0.2);
  const talus = saturate(sample.slope * sample.moisture * 0.48 + rockExposure * 0.32);
  const microRelief = saturate(0.18 + sample.slope * 0.3 + (1 - sample.waterDistance / (sample.waterDistance + 40)) * 0.2);
  const snowline = saturate(sample.snowCover * 0.64 + (1 - sample.temperature) * 0.2 + rockExposure * 0.08);
  return deepFreeze({
    rockExposure: stableRound(rockExposure),
    talus: stableRound(talus),
    microRelief: stableRound(microRelief),
    snowline: stableRound(snowline),
    preserveCanonicalHeight: true,
    preserveCanonicalCollider: true,
  });
}

export function deriveVegetationHints(sampleInput = {}) {
  const sample = normalizeWorldVisualSample(sampleInput);
  const waterExclusion = sample.hasCanonicalWater || sample.waterClass !== 'none' || sample.waterDistance < 3;
  const slopeExclusion = sample.slope > 0.78;
  const snowExclusion = sample.snowCover > 0.86;
  const roadExclusion = sample.roadDistance < 10;
  const settlementExclusion = sample.settlementDistance < 90;
  const validGround = sample.groundConfidence >= 0.55 && sample.hasCanonicalHeight;
  const exclusionReasons = [];
  if (waterExclusion) exclusionReasons.push('water');
  if (slopeExclusion) exclusionReasons.push('steep-slope');
  if (snowExclusion) exclusionReasons.push('persistent-snow');
  if (roadExclusion) exclusionReasons.push('road-clearance');
  if (settlementExclusion) exclusionReasons.push('settlement-clearance');
  if (!validGround) exclusionReasons.push('low-ground-confidence');
  const baseDensity = saturate((1 - sample.slope) * (1 - sample.snowCover) * (0.35 + sample.canopy * 0.65));
  const clusterDensity = saturate(baseDensity * (0.65 + hash2D(sample.position.x, sample.position.z, 17) * 0.35));
  const phase = hash2D(sample.position.x * 0.5, sample.position.z * 0.5, 23);
  return deepFreeze({
    allowed: exclusionReasons.length === 0,
    exclusionReasons,
    density: stableRound(exclusionReasons.length === 0 ? clusterDensity : 0),
    clusterPhase: stableRound(phase),
    scaleRange: { min: 0.82, max: 1.24 },
    yawRangeRadians: { min: stableRound(-Math.PI), max: stableRound(Math.PI) },
    useInstancing: true,
    lod: sample.phase === 'near' ? 'lod0-lod1' : sample.phase === 'far' ? 'lod2' : 'lod1-lod2',
    preserveGroundTransform: true,
  });
}

export function deriveWaterHints(sampleInput = {}) {
  const sample = normalizeWorldVisualSample(sampleInput);
  const water = sample.waterClass !== 'none' || sample.hasCanonicalWater;
  const shore = smoothstep(36, 0, sample.waterDistance);
  const shallow = saturate(shore * 0.82 + (1 - sample.slope) * 0.1);
  const depth = saturate(1 - shallow);
  const moire = saturate(sample.moireRisk * 0.74 + sample.textureRepeatRisk * 0.26);
  return deepFreeze({
    category: water ? sample.waterClass : 'none',
    deepWeight: stableRound(water ? depth : 0),
    shallowWeight: stableRound(water ? shallow : 0),
    wetEdgeWeight: stableRound(water ? shore * 0.72 : 0),
    foamWeight: stableRound(water ? smoothstep(6, 0, sample.waterDistance) * 0.4 : 0),
    normalEnergy: stableRound(lerp(0.22, 1, sample.phase === 'near' ? 1 : sample.phase === 'far' ? 0.35 : 0.65)),
    roughness: stableRound(lerp(0.2, 0.72, shallow)),
    suppressMoiré: moire > 0.16,
    moireRisk: stableRound(moire),
    suppressRectangularCoverage: water && sample.waterDistance < 18 && sample.tileBoundaryDistance < 12,
    preserveCanonicalHydrology: true,
  });
}

export function deriveAtmosphereHints(sampleInput = {}) {
  const sample = normalizeWorldVisualSample(sampleInput);
  const blackSky = sample.blackSkyRisk > 0.2 || sample.skyLuminance < 0.08;
  const framePressure = saturate((sample.frameTimeMs - 16.7) / 16.7);
  const fogDensity = clamp(0.00035 + framePressure * 0.0009 + (1 - sample.skyLuminance) * 0.00025, 0.0001, 0.0025);
  const exposure = clamp(sample.exposure * (blackSky ? 1.18 : 1), 0.65, 1.85);
  return deepFreeze({
    cameraRelativeSky: true,
    blackSkyGuard: blackSky,
    backgroundLuminanceFloor: blackSky ? 0.12 : 0.08,
    fogDensity: stableRound(fogDensity, 7),
    fogNear: 40,
    fogFar: sample.phase === 'far' ? 5200 : 2400,
    exposure: stableRound(exposure),
    horizonLift: stableRound(blackSky ? 0.14 : 0.06),
    preserveSunAmbientBalance: true,
  });
}

export function buildWorldVisualAdoptionPlan(sampleInput = {}, options = {}) {
  const sample = normalizeWorldVisualSample(sampleInput);
  const surfaces = deriveSurfaceWeights(sample);
  const antiTiling = deriveAntiTiling(sample);
  const relief = deriveTerrainReliefHints(sample);
  const vegetation = deriveVegetationHints(sample);
  const water = deriveWaterHints(sample);
  const atmosphere = deriveAtmosphereHints(sample);
  const budget = {
    frameTimeMs: stableRound(sample.frameTimeMs, 3),
    drawCalls: sample.drawCalls,
    textureMemoryMb: stableRound(sample.textureMemoryMb, 2),
    pressure: stableRound(saturate((sample.frameTimeMs - 16.7) / 16.7 + sample.textureMemoryMb / 2048), 4),
  };
  const structuralRisk = {
    seam: sample.tileBoundaryDistance < 8 ? 'high' : sample.tileBoundaryDistance < 24 ? 'medium' : 'low',
    rectangularWater: water.suppressRectangularCoverage ? 'high' : 'low',
    moire: water.moireRisk > 0.2 ? 'high' : water.moireRisk > 0.08 ? 'medium' : 'low',
    blackSky: atmosphere.blackSkyGuard ? 'high' : 'low',
  };
  const quality = budget.pressure > 1.1 || Object.values(structuralRisk).includes('high') ? 'guarded' : budget.pressure > 0.7 ? 'reduced' : 'full';
  const plan = {
    contract: 'buzul-muhafizi.world-visual-adoption.v26',
    id: sample.id,
    phase: sample.phase,
    canonical: {
      height: sample.hasCanonicalHeight,
      water: sample.hasCanonicalWater,
      biome: sample.hasCanonicalBiome,
      colliderParityRequired: true,
      geographyMutation: false,
    },
    surfaces,
    antiTiling,
    relief,
    vegetation,
    water,
    atmosphere,
    quality,
    budget,
    structuralRisk,
    adoption: {
      attachToExistingMaterialsOnly: true,
      requireHydratedAssetForModelPlacement: true,
      requireMaterialAssignmentCore: true,
      requireWorldAssetPlacementPipeline: true,
      editorRuntimeImportForbidden: true,
      sceneAttachOwner: cleanText(options.sceneAttachOwner, 'caller'),
    },
  };
  return deepFreeze(clonePlain(plan));
}

export function buildWorldVisualAdoptionManifest(samples = [], options = {}) {
  const source = Array.isArray(samples) ? samples : [];
  const plans = source
    .map((sample) => buildWorldVisualAdoptionPlan(sample, options))
    .sort((a, b) => a.id.localeCompare(b.id));
  const summary = plans.reduce((acc, plan) => {
    acc.count += 1;
    acc.phases[plan.phase] += 1;
    acc.quality[plan.quality] += 1;
    acc.water[plan.water.category] += 1;
    acc.dominant[plan.surfaces.dominantSurface] = (acc.dominant[plan.surfaces.dominantSurface] || 0) + 1;
    if (plan.structuralRisk.seam === 'high') acc.highRisk.seam += 1;
    if (plan.structuralRisk.rectangularWater === 'high') acc.highRisk.rectangularWater += 1;
    if (plan.structuralRisk.moire === 'high') acc.highRisk.moire += 1;
    if (plan.structuralRisk.blackSky === 'high') acc.highRisk.blackSky += 1;
    return acc;
  }, {
    count: 0,
    phases: { full: 0, far: 0, near: 0 },
    quality: { full: 0, reduced: 0, guarded: 0 },
    water: { none: 0, river: 0, lake: 0, sea: 0 },
    dominant: {},
    highRisk: { seam: 0, rectangularWater: 0, moire: 0, blackSky: 0 },
  });
  return deepFreeze({
    contract: 'buzul-muhafizi.world-visual-adoption-manifest.v26',
    plans,
    summary,
    deterministic: true,
    canonicalMutation: false,
    generatedBy: cleanText(options.generatedBy, 'Buzul Muhafızı'),
  });
}

export function applyWorldVisualAdoptionHints(target = {}, planInput = {}) {
  if (!target || typeof target !== 'object') return false;
  const plan = buildWorldVisualAdoptionPlan(planInput);
  if (target.material && typeof target.material === 'object') {
    target.material.roughness = lerp(0.32, 0.9, plan.surfaces.weights.rock + plan.surfaces.weights.scree);
    target.material.metalness = 0;
    target.material.normalScale = plan.phase === 'near' ? 0.82 : plan.phase === 'far' ? 0.36 : 0.58;
    target.material.userData = {
      ...(target.material.userData || {}),
      worldVisualAdoption: plan.contract,
      dominantSurface: plan.surfaces.dominantSurface,
      antiTiling: plan.antiTiling,
    };
  }
  if (target.water && typeof target.water === 'object') {
    target.water.userData = {
      ...(target.water.userData || {}),
      worldVisualAdoption: plan.water,
    };
  }
  if (target.scene && typeof target.scene === 'object') {
    target.scene.userData = {
      ...(target.scene.userData || {}),
      worldVisualAdoption: plan.contract,
      blackSkyGuard: plan.atmosphere.blackSkyGuard,
      cameraRelativeSky: plan.atmosphere.cameraRelativeSky,
    };
  }
  return true;
}

export function stableWorldVisualAdoptionString(value) {
  return JSON.stringify(clonePlain(value));
}

export const WORLD_VISUAL_ADOPTION_SURFACES = SURFACES;
export const WORLD_VISUAL_ADOPTION_PHASES = PHASES;
export const WORLD_VISUAL_ADOPTION_WATER_CLASSES = WATER_CLASSES;
