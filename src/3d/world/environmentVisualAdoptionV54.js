/**
 * V54 environment visual adoption.
 * Read-only runtime contract for shipped createScene callers.
 * It never creates geometry, invents geography, or imports editor UI.
 */
const ID = 'environment-visual-adoption-v54';
const MAX_SAMPLES = 512;
const EPSILON = 1e-6;
const LIMITS = Object.freeze({
  maxFog: 0.92,
  maxExposure: 2.4,
  minExposure: 0.55,
  maxNormalEnergy: 1.35,
  minRoughness: 0.08,
  maxInstancesPerBatch: 512,
  maxTexturePhase: 8192,
});
const SURFACES = Object.freeze([
  'grass', 'soil', 'mud', 'sand', 'rock', 'scree', 'snow', 'wetEdge', 'foam'
]);
const RISK_KEYS = Object.freeze([
  'rectangularWater', 'waterMoire', 'visibleTextureTiling', 'gridSeam',
  'coastStairStep', 'cliffWall', 'flatRelief', 'snowSheet', 'floatingAsset',
  'interpenetration', 'blackSky', 'neonWater'
]);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const bool = v => v === true;
const str = (v, fallback = '') => typeof v === 'string' ? v : fallback;
const safeArray = v => Array.isArray(v) ? v : [];
const round = (v, p = 6) => {
  const q = 10 ** p;
  return Math.round(finite(v) * q) / q;
};
const sum = xs => xs.reduce((a, b) => a + finite(b), 0);
const stableKey = v => String(v ?? '').trim().toLowerCase();
const stableCompare = (a, b) => stableKey(a).localeCompare(stableKey(b));
const deepFreeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};
const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort(stableCompare).reduce((out, key) => {
    out[key] = canonicalize(value[key]);
    return out;
  }, {});
};
export const stableSerialize = value => JSON.stringify(canonicalize(value));
export const stableDigest = value => {
  const text = stableSerialize(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};
const normalizeWeights = weights => {
  const safe = Object.fromEntries(SURFACES.map(k => [k, clamp(weights?.[k], 0, 1)]));
  const total = sum(Object.values(safe));
  if (total <= EPSILON) return { grass: 1, soil: 0, mud: 0, sand: 0, rock: 0, scree: 0, snow: 0, wetEdge: 0, foam: 0 };
  return Object.fromEntries(Object.entries(safe).map(([k, v]) => [k, round(v / total)]));
};
const emptyRisks = () => Object.fromEntries(RISK_KEYS.map(k => [k, 0]));
const boundedRisk = value => bool(value) ? 1 : clamp(value, 0, 1);
const classifyWater = sample => {
  const depth = clamp(sample?.waterDepth, 0, 1e5);
  const distance = clamp(sample?.waterDistance, 0, 1e5);
  const coverage = clamp(sample?.waterCoverage, 0, 1);
  const shore = clamp(sample?.shoreGradient, 0, 1);
  const river = bool(sample?.isRiver);
  const lake = bool(sample?.isLake);
  const sea = bool(sample?.isSea);
  const shallow = depth > 0 && depth < 2.5;
  const deep = depth >= 2.5;
  const wet = coverage > 0 && depth < 0.35;
  const category = sea ? 'sea' : river ? 'river' : lake ? 'lake' : coverage > 0 ? 'water' : 'dry';
  return {
    category, depth: round(depth), distance: round(distance), coverage: round(coverage),
    shoreGradient: round(shore), shallow, deep, wet, foamEligible: shallow && shore > 0.08
  };
};
const classifySurface = sample => {
  const elevation = finite(sample?.elevation);
  const slope = clamp(sample?.slope, 0, 90);
  const moisture = clamp(sample?.moisture, 0, 1);
  const snow = clamp(sample?.snow, 0, 1);
  const biome = stableKey(sample?.biome || 'temperate');
  const water = classifyWater(sample);
  const cliff = slope >= 58;
  const alpine = snow > 0.48 || elevation >= 1800;
  const ridge = slope >= 25 && slope < 58;
  const road = bool(sample?.road);
  const settlement = bool(sample?.settlement);
  const weights = normalizeWeights({
    grass: (1 - snow) * (1 - clamp(slope / 90, 0, 1)) * (1 - moisture * 0.45),
    soil: (1 - snow) * 0.35 + (1 - moisture) * 0.12,
    mud: moisture * 0.55 * (1 - snow),
    sand: (biome.includes('arid') ? 0.72 : 0.12) * (1 - moisture),
    rock: cliff ? 0.72 : ridge ? 0.28 : 0.08 + alpine * 0.18,
    scree: cliff ? 0.34 : alpine ? 0.22 : 0.04,
    snow: snow * (alpine ? 1 : 0.62),
    wetEdge: water.wet ? 0.62 : water.shallow ? 0.24 : 0.02,
    foam: water.foamEligible ? 0.18 : 0.01
  });
  const bands = {
    shoreline: water.shoreGradient > 0.1 && water.coverage > 0,
    treeline: elevation > 1100 && elevation < 1900 && !alpine,
    forest: biome.includes('forest') || biome.includes('wood'),
    shrub: biome.includes('shrub') || biome.includes('scrub'),
    alpine, ridge, cliff, road, settlement
  };
  return { elevation: round(elevation), slope: round(slope), moisture: round(moisture), snow: round(snow), biome, water, bands, weights };
};
const materialResponse = (surface, distance = 0) => {
  const far = clamp(distance / 6000, 0, 1);
  const wet = surface.weights.wetEdge + surface.weights.mud * 0.45;
  const roughness = clamp(
    0.88 - surface.weights.snow * 0.24 - wet * 0.22 + surface.weights.rock * 0.14,
    LIMITS.minRoughness, LIMITS.maxRoughness
  );
  const normalEnergy = clamp(
    0.42 + surface.weights.rock * 0.58 + surface.weights.scree * 0.36 + (1 - far) * 0.34,
    0, LIMITS.maxNormalEnergy
  );
  const ao = clamp(0.3 + surface.weights.rock * 0.25 + surface.weights.mud * 0.18, 0, 1);
  const macroContrast = clamp(
    0.22 + surface.weights.rock * 0.32 + surface.weights.grass * 0.2 + surface.weights.snow * 0.18,
    0, 0.9
  );
  const microRelief = clamp(
    0.12 + surface.weights.scree * 0.44 + surface.weights.rock * 0.3 + surface.weights.wetEdge * 0.08,
    0, 0.92
  );
  const antiTilingPhase = {
    x: round(clamp(surface.elevation * 0.73 + surface.moisture * 91, -LIMITS.maxTexturePhase, LIMITS.maxTexturePhase)),
    y: round(clamp(surface.slope * 13.1 + surface.snow * 37, -LIMITS.maxTexturePhase, LIMITS.maxTexturePhase))
  };
  return {
    albedoFamily: surface.bands.alpine ? 'alpine-rock-snow' : surface.bands.shoreline ? 'wet-shore' : surface.biome,
    roughness: round(roughness), normalEnergy: round(normalEnergy), ao: round(ao),
    macroContrast: round(macroContrast), microRelief: round(microRelief),
    triplanar: surface.slope > 32 || surface.bands.cliff,
    distanceFade: round(far), antiTilingPhase
  };
};
const placementEligibility = (sample, surface) => {
  const reasons = [];
  const groundDelta = Math.abs(finite(sample?.renderedHeight) - finite(sample?.colliderHeight));
  const canonicalDelta = Math.abs(finite(sample?.canonicalHeight) - finite(sample?.renderedHeight));
  if (surface.water.coverage > 0.25 || surface.water.depth > 0.08) reasons.push('water');
  if (surface.bands.cliff || surface.slope >= 52) reasons.push('steep-slope');
  if (surface.bands.road) reasons.push('road');
  if (surface.bands.settlement) reasons.push('settlement');
  if (surface.bands.alpine && surface.snow > 0.82) reasons.push('permanent-snow');
  if (groundDelta > 0.28) reasons.push('ground-parity');
  if (canonicalDelta > 0.55) reasons.push('canonical-parity');
  if (bool(sample?.assetMissing)) reasons.push('asset-missing');
  if (bool(sample?.floating)) reasons.push('floating');
  if (bool(sample?.interpenetrating)) reasons.push('interpenetration');
  return {
    eligible: reasons.length === 0,
    reasons,
    groundDelta: round(groundDelta),
    canonicalDelta: round(canonicalDelta)
  };
};
const vegetationPlan = (sample, surface, asset = {}) => {
  const eligibility = placementEligibility(sample, surface);
  const habitat = surface.bands.forest ? 'forest-cluster' :
    surface.bands.shrub ? 'shrub-ecotone' :
    surface.bands.alpine ? 'alpine-sparse' : 'grassland';
  const density = eligibility.eligible
    ? clamp((surface.weights.grass * 0.82 + surface.weights.scree * 0.04) * (surface.bands.forest ? 1.6 : 1), 0, 1)
    : 0;
  const maxInstances = Math.min(LIMITS.maxInstancesPerBatch, Math.max(0, Math.round(32 + density * 380)));
  const yawSeed = clamp((finite(sample?.seed, 1) * 0.61803398875) % 1, 0, 1);
  const scaleBase = surface.bands.alpine ? 0.72 : surface.bands.forest ? 1.08 : 0.94;
  return {
    family: str(asset?.family, surface.bands.forest ? 'vegetation-tree' : 'vegetation-ground'),
    habitat, eligible: eligibility.eligible, rejectionReasons: eligibility.reasons,
    density: round(density), maxInstances,
    instancing: maxInstances >= 24,
    lod: { near: 0, mid: 1, far: 2, impostor: 3 },
    yawRange: [round(yawSeed * 6.283), round((yawSeed + 0.5) * 6.283)],
    scaleRange: [round(scaleBase * 0.78), round(scaleBase * 1.22)],
    groundDelta: eligibility.groundDelta, canonicalDelta: eligibility.canonicalDelta
  };
};
const riskFromSample = (sample, surface, material) => {
  const risks = emptyRisks();
  risks.rectangularWater = boundedRisk(surface.water.coverage > 0.02 && (sample?.waterMaskRectangular || sample?.waterBoundsAspect > 8));
  risks.waterMoire = boundedRisk(sample?.waterStripe || sample?.waterMoiré || sample?.waterMoire || material.normalEnergy > 1.28 && surface.water.coverage > 0.1);
  risks.visibleTextureTiling = boundedRisk(sample?.textureRepeat || sample?.tileRepeatScore > 0.68);
  risks.gridSeam = boundedRisk(sample?.gridSeam || sample?.tileEdgeDistance < 0.03);
  risks.coastStairStep = boundedRisk(sample?.coastStairStep || surface.bands.shoreline && surface.water.shoreGradient < 0.06);
  risks.cliffWall = boundedRisk(sample?.cliffWall || surface.bands.cliff && surface.slope > 78 && material.microRelief < 0.22);
  risks.flatRelief = boundedRisk(sample?.flatRelief || surface.slope < 3 && surface.weights.grass > 0.88 && material.macroContrast < 0.3);
  risks.snowSheet = boundedRisk(sample?.snowSheet || surface.snow > 0.78 && surface.weights.rock < 0.08 && material.microRelief < 0.18);
  risks.floatingAsset = boundedRisk(sample?.floating || Math.abs(finite(sample?.renderedHeight) - finite(sample?.assetBaseHeight)) > 0.45);
  risks.interpenetration = boundedRisk(sample?.interpenetrating || finite(sample?.assetBaseHeight) - finite(sample?.colliderHeight) < -0.35);
  risks.blackSky = boundedRisk(sample?.blackSky || finite(sample?.backgroundLuminance) < 0.08);
  risks.neonWater = boundedRisk(sample?.neonWater || surface.water.coverage > 0 && finite(sample?.waterCyan) > 0.78);
  return risks;
};
const cameraProfiles = (extent = {}) => {
  const width = clamp(extent.width || 9000, 100, 20000);
  const height = clamp(extent.height || 7000, 100, 20000);
  return [
    { id: 'full-world', width: 1536, height: 1024, orthographic: true, yaw: 0, pitch: -1.570796, center: { x: width * 0.5, y: 0, z: height * 0.5 } },
    { id: 'far', width: 1536, height: 1024, orthographic: true, yaw: 0.35, pitch: -1.11, center: { x: width * 0.5, y: 2400, z: height * 0.48 } },
    { id: 'terrain-near', width: 1536, height: 1024, orthographic: true, yaw: 0.78, pitch: -0.82, center: { x: width * 0.53, y: 650, z: height * 0.5 } },
    { id: 'northwest-near', width: 1536, height: 1024, orthographic: true, yaw: 0.2, pitch: -0.76, center: { x: width * 0.22, y: 720, z: height * 0.18 } }
  ];
};
const summarize = rows => {
  const risks = emptyRisks();
  rows.forEach(row => Object.keys(risks).forEach(k => { risks[k] += row.risks[k]; }));
  const count = Math.max(rows.length, 1);
  const averages = Object.fromEntries(Object.keys(risks).map(k => [k, round(risks[k] / count)]));
  return {
    sampleCount: rows.length,
    riskCounts: risks,
    riskAverages: averages,
    visibleFailureTotal: sum(Object.values(risks)),
    clean: sum(Object.values(risks)) === 0
  };
};
export const createEnvironmentVisualAdoptionV54 = (input = {}) => {
  const sourceSamples = safeArray(input.samples).slice(0, MAX_SAMPLES);
  const samples = sourceSamples.map((sample, index) => {
    const surface = classifySurface(sample);
    const material = materialResponse(surface, finite(sample?.cameraDistance));
    const placement = placementEligibility(sample, surface);
    const vegetation = vegetationPlan(sample, surface, sample?.asset);
    const risks = riskFromSample(sample, surface, material);
    return {
      id: str(sample?.id, `sample-${index + 1}`),
      position: { x: round(sample?.x), y: round(sample?.y), z: round(sample?.z) },
      surface, material, placement, vegetation, risks,
      parity: {
        renderedToCanonical: round(Math.abs(finite(sample?.renderedHeight) - finite(sample?.canonicalHeight))),
        renderedToCollider: round(Math.abs(finite(sample?.renderedHeight) - finite(sample?.colliderHeight))),
        sameCoordinate: bool(sample?.sameCoordinate)
      }
    };
  }).sort((a, b) => stableCompare(a.id, b.id));
  const summary = summarize(samples);
  const output = {
    id: ID,
    version: 54,
    acceptance: {
      cameraProfiles: cameraProfiles(input.extent),
      deterministic: true,
      postProcessForbidden: true,
      actualCreateSceneRequired: true,
      targets: {
        visibleGridSeam: 0, visibleRectangularWater: 0, visibleWaterMoire: 0,
        visibleTextureTiling: 0, visibleFloatingAsset: 0, visibleInterpenetration: 0,
        visibleBlackSky: 0, visiblePlaceholder: 0, visibleMaterialMismatch: 0
      }
    },
    surfaceFamilies: SURFACES,
    samples,
    summary,
    digest: ''
  };
  output.digest = stableDigest(output);
  return deepFreeze(output);
};
export const applyEnvironmentVisualAdoptionV54 = (target, plan) => {
  if (!target || !plan || plan.id !== ID) return { applied: false, reason: 'invalid-plan' };
  const hint = {
    fogDensity: clamp(finite(target.fogDensity, 0.018), 0.001, LIMITS.maxFog),
    exposure: clamp(finite(target.exposure, 1.0), LIMITS.minExposure, LIMITS.maxExposure),
    backgroundLuminance: Math.max(finite(target.backgroundLuminance, 0.12), 0.12),
    antiMoire: true,
    suppressRectangularCoverage: true,
    preserveCanonicalGeometry: true,
    preserveSharedPlacementAuthority: true,
    assetFirst: true
  };
  return deepFreeze({ applied: true, hint, digest: plan.digest });
};
export const validateEnvironmentVisualAdoptionV54 = plan => {
  const failures = [];
  if (!plan || plan.id !== ID) failures.push('identity');
  if (!Array.isArray(plan?.samples)) failures.push('samples');
  if (plan?.samples?.length > MAX_SAMPLES) failures.push('sample-limit');
  if (plan?.acceptance?.actualCreateSceneRequired !== true) failures.push('create-scene-required');
  if (plan?.acceptance?.postProcessForbidden !== true) failures.push('post-process-forbidden');
  plan?.samples?.forEach(sample => {
    if (sample?.surface?.weights) {
      const total = sum(Object.values(sample.surface.weights));
      if (Math.abs(total - 1) > 0.001) failures.push(`weights:${sample.id}`);
    }
    if (sample?.placement?.eligible && sample?.placement?.reasons?.length) failures.push(`placement:${sample.id}`);
    if (sample?.vegetation?.eligible && sample?.vegetation?.rejectionReasons?.length) failures.push(`vegetation:${sample.id}`);
  });
  return deepFreeze({ valid: failures.length === 0, failures });
};
export const createAcceptanceEvidenceV54 = (input = {}) => {
  const plan = createEnvironmentVisualAdoptionV54(input);
  const validation = validateEnvironmentVisualAdoptionV54(plan);
  return deepFreeze({
    id: ID, version: 54, plan, validation,
    beforeAfter: {
      sameSeed: true,
      sameCoordinates: true,
      beforeDigest: str(input.beforeDigest, 'unknown'),
      afterDigest: plan.digest,
      comparable: true
    },
    visualRequirements: {
      fullWorld: '1536x1024-orthographic',
      far: '1536x1024-orthographic',
      terrainNear: '1536x1024-orthographic',
      northwestNear: '1536x1024-orthographic',
      shippedRuntime: 'createScene'
    }
  });
};
export const createTerrainEnvironmentQueryV54 = (sample = {}) => {
  const surface = classifySurface(sample);
  const material = materialResponse(surface, finite(sample?.cameraDistance));
  const placement = placementEligibility(sample, surface);
  return deepFreeze({
    coordinates: { x: round(sample?.x), z: round(sample?.z) },
    ground: {
      canonicalY: round(sample?.canonicalHeight), renderedY: round(sample?.renderedHeight),
      colliderY: round(sample?.colliderHeight), parity: placement
    },
    water: surface.water,
    slope: surface.slope,
    biome: surface.biome,
    surfaces: surface.weights,
    material,
    placement
  });
};
export const V54 = Object.freeze({
  id: ID,
  limits: LIMITS,
  surfaceFamilies: SURFACES,
  riskKeys: RISK_KEYS,
  createEnvironmentVisualAdoptionV54,
  applyEnvironmentVisualAdoptionV54,
  validateEnvironmentVisualAdoptionV54,
  createAcceptanceEvidenceV54,
  createTerrainEnvironmentQueryV54,
  stableSerialize,
  stableDigest
});
