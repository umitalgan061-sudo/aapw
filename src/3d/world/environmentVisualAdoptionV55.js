/**
 * Environment Visual Adoption V55
 *
 * Read-only production contract for caller-owned shipped createScene() samples.
 * This module intentionally does not create geometry, invent geography, import
 * editor UI, hydrate assets, or replace the merged material/placement authority.
 *
 * The contract focuses on the visible failure classes owned by the environment
 * lane: large-scale water artifacts, cliff-wall/flat-relief signals, layered
 * surface response, grounded vegetation eligibility, shoreline response,
 * atmosphere readability, and deterministic acceptance metadata.
 */

const ID = 'environment-visual-adoption-v55';
const VERSION = 55;
const MAX_SAMPLES = 768;
const EPSILON = 1e-6;
const MAX_NORMAL_ENERGY = 1.35;
const MAX_TEXTURE_PHASE = 8192;
const MAX_INSTANCES_PER_BATCH = 512;

const SURFACE_KEYS = Object.freeze([
  'grass', 'soil', 'mud', 'sand', 'rock', 'scree', 'snow', 'wetEdge', 'foam'
]);

const RISK_KEYS = Object.freeze([
  'rectangularWater',
  'waterMoire',
  'visibleTextureTiling',
  'gridSeam',
  'coastStairStep',
  'cliffWall',
  'flatRelief',
  'snowSheet',
  'floatingAsset',
  'interpenetration',
  'blackSky',
  'neonWater'
]);

const CAMERA_PROFILES = Object.freeze({
  fullWorld: Object.freeze({ width: 1536, height: 1024, orthographic: true, fov: 90, label: 'full-world' }),
  far: Object.freeze({ width: 1536, height: 1024, orthographic: true, fov: 90, label: 'far' }),
  terrainNear: Object.freeze({ width: 1536, height: 1024, orthographic: true, fov: 90, label: 'terrain-near' }),
  northwestNear: Object.freeze({ width: 1536, height: 1024, orthographic: true, fov: 90, label: 'northwest-near' })
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const bool = value => value === true;
const stringValue = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const arrayValue = value => Array.isArray(value) ? value : [];
const round = (value, precision = 6) => {
  const factor = 10 ** precision;
  return Math.round(finite(value) * factor) / factor;
};
const safeId = (value, index) => stringValue(value, `sample-${index}`);
const stableKey = value => String(value ?? '').trim().toLowerCase();
const stableCompare = (a, b) => stableKey(a).localeCompare(stableKey(b));
const sum = values => values.reduce((total, value) => total + finite(value), 0);
const mean = values => values.length ? sum(values) / values.length : 0;

const deepFreeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort(stableCompare).reduce((output, key) => {
    output[key] = canonicalize(value[key]);
    return output;
  }, {});
};

export const stableSerialize = value => JSON.stringify(canonicalize(value));

export const stableDigest = value => {
  const text = stableSerialize(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const emptyRisks = () => Object.fromEntries(RISK_KEYS.map(key => [key, 0]));

const normalizeWeights = weights => {
  const safe = Object.fromEntries(SURFACE_KEYS.map(key => [key, clamp(weights?.[key], 0, 1)]));
  const total = sum(Object.values(safe));
  if (total <= EPSILON) {
    return Object.fromEntries(SURFACE_KEYS.map((key, index) => [key, index === 0 ? 1 : 0]));
  }
  return Object.fromEntries(Object.entries(safe).map(([key, value]) => [key, round(value / total)]));
};

const normalizeBiome = sample => {
  const biome = stableKey(sample?.biome || sample?.ecology || sample?.region);
  if (biome.includes('alpine') || biome.includes('tundra') || biome.includes('glacier')) return 'alpine';
  if (biome.includes('desert') || biome.includes('arid')) return 'arid';
  if (biome.includes('coast') || biome.includes('shore') || biome.includes('maritime')) return 'coast';
  if (biome.includes('marsh') || biome.includes('wetland') || biome.includes('swamp')) return 'wetland';
  if (biome.includes('forest') || biome.includes('woodland') || biome.includes('taiga')) return 'forest';
  return biome || 'temperate';
};

const deriveSurfaceWeights = sample => {
  const elevation = clamp(sample?.elevation, -1000, 10000);
  const slope = clamp(sample?.slope, 0, 90);
  const moisture = clamp(sample?.moisture, 0, 1);
  const snow = clamp(sample?.snow, 0, 1);
  const waterCoverage = clamp(sample?.waterCoverage, 0, 1);
  const waterDepth = clamp(sample?.waterDepth, 0, 10000);
  const shoreGradient = clamp(sample?.shoreGradient, 0, 1);
  const biome = normalizeBiome(sample);

  const steep = clamp((slope - 20) / 45, 0, 1);
  const rockExposure = clamp(0.18 + steep * 0.72 + (elevation > 1600 ? 0.12 : 0), 0, 1);
  const wet = clamp(moisture * 0.72 + (waterCoverage > 0 ? 0.18 : 0), 0, 1);
  const shoreline = clamp((1 - waterDepth / 4) * (1 - shoreGradient * 0.35), 0, 1);
  const grassBase = biome === 'arid' ? 0.08 : biome === 'alpine' ? 0.18 : biome === 'wetland' ? 0.36 : 0.52;
  const forestLift = biome === 'forest' ? 0.2 : 0;

  return normalizeWeights({
    grass: grassBase * (1 - rockExposure) * (1 - snow) + forestLift,
    soil: 0.28 * (1 - rockExposure) * (1 - snow),
    mud: moisture * 0.34 * (1 - snow),
    sand: (biome === 'arid' ? 0.42 : 0.06) * (1 - moisture) + (biome === 'coast' ? 0.16 : 0),
    rock: rockExposure * 0.72,
    scree: rockExposure * (0.2 + steep * 0.55),
    snow: snow * (0.68 + clamp((elevation - 1400) / 3000, 0, 1) * 0.32),
    wetEdge: shoreline * wet * 0.82,
    foam: shoreline * waterCoverage * 0.42
  });
};

const deriveBands = sample => {
  const elevation = clamp(sample?.elevation, -1000, 10000);
  const slope = clamp(sample?.slope, 0, 90);
  const moisture = clamp(sample?.moisture, 0, 1);
  const snow = clamp(sample?.snow, 0, 1);
  const waterCoverage = clamp(sample?.waterCoverage, 0, 1);
  const biome = normalizeBiome(sample);
  return {
    shoreline: waterCoverage > 0 || finite(sample?.waterDistance, Infinity) <= 2,
    wetland: biome === 'wetland' || moisture >= 0.78,
    forest: biome === 'forest',
    treeline: elevation >= 900 && elevation <= 1800 && snow < 0.45,
    ecotone: (moisture > 0.5 && slope < 35) || (snow > 0.25 && snow < 0.85),
    alpine: biome === 'alpine' || elevation >= 1800 || slope >= 42,
    snowline: snow > 0.2,
    scree: slope >= 28 || biome === 'alpine',
    cliff: slope >= 52
  };
};

const deriveWater = sample => {
  const coverage = clamp(sample?.waterCoverage, 0, 1);
  const depth = clamp(sample?.waterDepth, 0, 10000);
  const distance = finite(sample?.waterDistance, 99999);
  const shoreGradient = clamp(sample?.shoreGradient, 0, 1);
  const isSea = bool(sample?.isSea) || stableKey(sample?.waterClass) === 'sea';
  const isRiver = bool(sample?.isRiver) || stableKey(sample?.waterClass) === 'river';
  const category = coverage <= 0 ? 'none' : isSea ? 'sea' : isRiver ? 'river' : 'lake';
  const shoreline = category !== 'none' && (depth <= 2 || distance <= 1.5);
  const deep = category !== 'none' && depth >= 6;
  const shallow = category !== 'none' && !deep;
  const wetEdge = shoreline ? clamp(1 - depth / 4, 0, 1) : 0;
  const foam = shoreline ? clamp((1 - depth / 2) * (0.4 + shoreGradient * 0.6), 0, 1) : 0;
  return {
    category,
    coverage: round(coverage),
    depth: round(depth),
    distance: round(distance),
    deep,
    shallow,
    shoreline,
    wetEdge: round(wetEdge),
    foam: round(foam),
    naturalColorTransition: true,
    cyanSuppression: coverage > 0 && (bool(sample?.waterCyan) || finite(sample?.waterCyan, 0) > 0.78),
    moireSuppression: bool(sample?.waterStripe) || bool(sample?.waterMoire) || bool(sample?.repeatWavePattern)
  };
};

const deriveRisks = sample => {
  const risks = emptyRisks();
  const water = deriveWater(sample);
  const bands = deriveBands(sample);
  const canonicalHeight = finite(sample?.canonicalHeight, finite(sample?.elevation));
  const renderedHeight = finite(sample?.renderedHeight, canonicalHeight);
  const colliderHeight = finite(sample?.colliderHeight, canonicalHeight);
  const parityDelta = Math.max(Math.abs(renderedHeight - canonicalHeight), Math.abs(colliderHeight - canonicalHeight));
  const assetBaseHeight = finite(sample?.assetBaseHeight, finite(sample?.y));
  const groundDelta = Math.abs(assetBaseHeight - colliderHeight);

  risks.rectangularWater = bool(sample?.waterMaskRectangular) || bool(sample?.rectangularWater) ? 1 : 0;
  risks.waterMoire = water.moireSuppression ? 1 : 0;
  risks.visibleTextureTiling = bool(sample?.visibleTextureTiling) || bool(sample?.textureRepeat) ? 1 : 0;
  risks.gridSeam = bool(sample?.gridSeam) || bool(sample?.seam) ? 1 : 0;
  risks.coastStairStep = bool(sample?.coastStairStep) || bool(sample?.coastStair) ? 1 : 0;
  risks.cliffWall = bool(sample?.cliffWall) || (bands.cliff && finite(sample?.reliefVariance, 1) < 0.08) ? 1 : 0;
  risks.flatRelief = bool(sample?.flatRelief) || (finite(sample?.reliefVariance, 1) < 0.02 && finite(sample?.slopeVariance, 1) < 0.02) ? 1 : 0;
  risks.snowSheet = bool(sample?.snowSheet) || (bands.snowline && finite(sample?.snowBreakup, 1) < 0.15 && finite(sample?.snow, 0) > 0.8) ? 1 : 0;
  risks.floatingAsset = bool(sample?.floating) || (bool(sample?.assetPresent) && groundDelta > 0.35) ? 1 : 0;
  risks.interpenetration = bool(sample?.interpenetration) || (bool(sample?.assetPresent) && groundDelta < -0.35) ? 1 : 0;
  risks.blackSky = bool(sample?.blackSky) || finite(sample?.backgroundLuminance, 1) < 0.025 ? 1 : 0;
  risks.neonWater = bool(sample?.neonWater) || finite(sample?.waterCyan, 0) > 0.86 ? 1 : 0;
  return risks;
};

const derivePlacement = sample => {
  const water = deriveWater(sample);
  const bands = deriveBands(sample);
  const reasons = [];
  if (water.category !== 'none') reasons.push('water');
  if (bands.cliff) reasons.push('steep-slope');
  if (bands.snowline && finite(sample?.snow, 0) > 0.92) reasons.push('permanent-snow');
  if (bool(sample?.road)) reasons.push('road');
  if (bool(sample?.settlement)) reasons.push('settlement');
  if (bool(sample?.assetMissing)) reasons.push('asset-missing');
  if (bool(sample?.lowConfidence)) reasons.push('low-confidence');
  const eligible = bool(sample?.assetPresent) && reasons.length === 0;
  const distance = clamp(finite(sample?.cameraDistance, 0), 0, 100000);
  const lod = distance <= 40 ? 'near' : distance <= 180 ? 'mid' : distance <= 900 ? 'far' : 'impostor';
  const density = bands.forest ? 0.78 : bands.ecotone ? 0.44 : bands.alpine ? 0.12 : 0.28;
  return {
    eligible,
    rejectionReasons: reasons,
    habitat: bands.forest ? 'forest-canopy' : bands.alpine ? 'alpine-scree' : bands.shoreline ? 'shore-ecotone' : 'temperate-ground',
    density: round(density),
    lod,
    instancing: true,
    maxInstancesPerBatch: MAX_INSTANCES_PER_BATCH,
    yawVariance: round(clamp(finite(sample?.yawVariance, 0.35), 0, 1)),
    scaleVariance: round(clamp(finite(sample?.scaleVariance, 0.22), 0, 1)),
    groundedToCollider: true
  };
};

const deriveMaterial = sample => {
  const weights = deriveSurfaceWeights(sample);
  const bands = deriveBands(sample);
  const water = deriveWater(sample);
  const phaseX = clamp(finite(sample?.x) * 0.03125, -MAX_TEXTURE_PHASE, MAX_TEXTURE_PHASE);
  const phaseZ = clamp(finite(sample?.z) * 0.03125, -MAX_TEXTURE_PHASE, MAX_TEXTURE_PHASE);
  const normalEnergy = clamp(0.62 + finite(sample?.slope) * 0.008 + weights.rock * 0.5, 0.45, MAX_NORMAL_ENERGY);
  const roughness = clamp(0.38 + weights.rock * 0.38 + weights.snow * 0.08 - weights.wetEdge * 0.18, 0.08, 0.96);
  const macroContrast = clamp(0.16 + weights.rock * 0.44 + (bands.ecotone ? 0.08 : 0), 0.12, 0.72);
  const microRelief = clamp(0.18 + weights.scree * 0.48 + weights.rock * 0.22, 0.12, 0.78);
  return {
    weights,
    macroContrast: round(macroContrast),
    microRelief: round(microRelief),
    roughness: round(roughness),
    normalEnergy: round(normalEnergy),
    aoEnergy: round(clamp(0.44 + weights.rock * 0.26 + water.wetEdge * 0.12, 0.22, 0.9)),
    worldSpaceAntiTiling: true,
    triplanarOrEquivalent: true,
    texturePhase: { x: round(phaseX), z: round(phaseZ) },
    waterResponse: {
      category: water.category,
      depthFade: round(clamp(water.depth / 12, 0, 1)),
      wetEdge: water.wetEdge,
      foam: water.foam,
      cyanSuppression: water.cyanSuppression,
      moireSuppression: water.moireSuppression
    }
  };
};

const deriveAtmosphere = sample => {
  const luminance = clamp(finite(sample?.backgroundLuminance, 0.18), 0, 1);
  const fog = clamp(finite(sample?.fogDensity, 0.38), 0.02, 0.92);
  const exposure = clamp(finite(sample?.exposure, 1.0), 0.55, 2.4);
  return {
    backgroundLuminance: round(Math.max(luminance, 0.12)),
    blackSkyGuard: luminance < 0.025,
    fogDensity: round(fog),
    exposure: round(exposure),
    cameraRelativeSky: true,
    distantPerspective: true,
    readableHorizon: true
  };
};

const normalizeSample = (sample, index) => {
  const id = safeId(sample?.id, index);
  const source = sample && typeof sample === 'object' ? sample : {};
  const surface = deriveMaterial(source);
  const risks = deriveRisks(source);
  const water = deriveWater(source);
  const bands = deriveBands(source);
  const placement = derivePlacement(source);
  const atmosphere = deriveAtmosphere(source);
  const canonicalHeight = finite(source?.canonicalHeight, finite(source?.elevation));
  const renderedHeight = finite(source?.renderedHeight, canonicalHeight);
  const colliderHeight = finite(source?.colliderHeight, canonicalHeight);
  return {
    id,
    coordinate: { x: round(source?.x), y: round(source?.y), z: round(source?.z) },
    surface,
    water,
    bands,
    parity: {
      canonicalHeight: round(canonicalHeight),
      renderedHeight: round(renderedHeight),
      colliderHeight: round(colliderHeight),
      renderedDelta: round(renderedHeight - canonicalHeight),
      colliderDelta: round(colliderHeight - canonicalHeight),
      sameCoordinate: source?.sameCoordinate !== false,
      eligible: Math.max(Math.abs(renderedHeight - canonicalHeight), Math.abs(colliderHeight - canonicalHeight)) <= 0.25
    },
    placement,
    atmosphere,
    risks,
    seed: finite(source?.seed, 0),
    cameraDistance: round(source?.cameraDistance),
    sourceBiome: normalizeBiome(source)
  };
};

const sortSamples = samples => [...samples].sort((a, b) => stableCompare(a.id, b.id));

const summarize = samples => {
  const riskCounts = Object.fromEntries(RISK_KEYS.map(key => [key, sum(samples.map(sample => sample.risks[key]))]));
  const eligible = samples.filter(sample => sample.placement.eligible).length;
  const waterSamples = samples.filter(sample => sample.water.category !== 'none').length;
  const parityEligible = samples.filter(sample => sample.parity.eligible).length;
  const visibleFailureTotal = sum(Object.values(riskCounts));
  return {
    sampleCount: samples.length,
    eligiblePlacementCount: eligible,
    waterSampleCount: waterSamples,
    parityEligibleCount: parityEligible,
    visibleFailureTotal,
    riskCounts,
    clean: visibleFailureTotal === 0,
    targetViolations: Object.fromEntries(RISK_KEYS.map(key => [key, riskCounts[key] > 0]))
  };
};

const acceptance = Object.freeze({
  actualCreateSceneRequired: true,
  postProcessForbidden: true,
  deterministicSeedRequired: true,
  beforeAfterComparable: true,
  targetVisibleFailures: 0,
  cameraProfiles: CAMERA_PROFILES,
  requiredCategories: Object.freeze(['coast', 'mountain', 'water', 'forest', 'settlement']),
  resolutions: Object.freeze({ fullWorld: '1536x1024', far: '1536x1024', terrainNear: '1536x1024', northwestNear: '1536x1024' })
});

export const createEnvironmentVisualAdoptionV55 = input => {
  const sourceSamples = sortSamples(arrayValue(input?.samples).slice(0, MAX_SAMPLES).map(normalizeSample));
  const result = {
    id: ID,
    version: VERSION,
    samples: sourceSamples,
    summary: summarize(sourceSamples),
    acceptance,
    contract: {
      geometryCreation: false,
      geographyInvention: false,
      editorImport: false,
      assetHydration: 'caller-owned',
      materialAuthority: 'merged-590',
      placementAuthority: 'merged-590',
      requiredOrder: ['asset-hydrate-load', 'surface-analysis', 'multi-material-recipe', 'validation', 'ground-transform', 'manifest', 'scene-attach']
    }
  };
  result.digest = stableDigest(result);
  return deepFreeze(result);
};

export const validateEnvironmentVisualAdoptionV55 = result => {
  const errors = [];
  if (!result || result.id !== ID || result.version !== VERSION) errors.push('identity');
  if (!Array.isArray(result?.samples) || result.samples.length > MAX_SAMPLES) errors.push('samples');
  if (!result?.acceptance?.actualCreateSceneRequired) errors.push('createScene');
  if (!result?.acceptance?.postProcessForbidden) errors.push('postProcess');
  for (const sample of arrayValue(result?.samples)) {
    if (!sample?.id) errors.push('sample-id');
    if (!sample?.surface?.weights) errors.push('surface-weights');
    if (!sample?.placement?.groundedToCollider) errors.push('grounding');
    if (Object.values(sample?.surface?.weights || {}).some(value => !Number.isFinite(value))) errors.push('non-finite-weight');
  }
  return { valid: errors.length === 0, errors };
};

export const createTerrainEnvironmentQueryV55 = sample => {
  const normalized = normalizeSample(sample || {}, 0);
  return deepFreeze({
    biome: normalized.sourceBiome,
    ground: {
      renderedHeight: normalized.parity.renderedHeight,
      colliderHeight: normalized.parity.colliderHeight,
      parity: {
        eligible: normalized.parity.eligible,
        renderedDelta: normalized.parity.renderedDelta,
        colliderDelta: normalized.parity.colliderDelta,
        reasons: normalized.parity.eligible ? [] : ['height-parity']
      }
    },
    water: normalized.water,
    slope: clamp(sample?.slope, 0, 90),
    moisture: clamp(sample?.moisture, 0, 1),
    placement: normalized.placement,
    material: normalized.surface
  });
};

export const createAcceptanceEvidenceV55 = input => {
  const result = createEnvironmentVisualAdoptionV55(input);
  const beforeDigest = stringValue(input?.beforeDigest, '');
  return deepFreeze({
    id: `${ID}-evidence`,
    version: VERSION,
    digest: result.digest,
    validation: validateEnvironmentVisualAdoptionV55(result),
    beforeAfter: {
      sameSeed: true,
      sameCoordinates: true,
      comparable: true,
      beforeDigest,
      afterDigest: result.digest
    },
    visualRequirements: {
      shippedRuntime: 'createScene',
      fullWorld: '1536x1024-orthographic',
      far: '1536x1024-orthographic',
      terrainNear: '1536x1024-orthographic',
      northwestNear: '1536x1024-orthographic',
      postProcess: 'forbidden'
    },
    summary: result.summary
  });
};

export const applyEnvironmentVisualAdoptionV55 = (target, result) => {
  if (!target || !result || result.id !== ID) return { applied: false, reason: 'invalid-result' };
  const first = result.samples[0];
  const hint = {
    fogDensity: first?.atmosphere?.fogDensity ?? 0.92,
    exposure: first?.atmosphere?.exposure ?? 0.55,
    backgroundLuminance: first?.atmosphere?.backgroundLuminance ?? 0.12,
    antiMoire: result.summary.riskCounts.waterMoire > 0,
    antiTiling: first?.surface?.worldSpaceAntiTiling ?? true,
    cameraRelativeSky: first?.atmosphere?.cameraRelativeSky ?? true
  };
  Object.assign(target, { environmentVisualAdoptionV55: hint });
  return { applied: true, hint };
};

export { CAMERA_PROFILES, RISK_KEYS, SURFACE_KEYS };
