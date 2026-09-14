/**
 * Canonical-hydrology-derived surface response for world asset materials.
 *
 * This is a read-only bridge. It consumes only caller-supplied canonical water/depth/river/
 * waterfall observations. Missing observations stay neutral; no river, lake, shoreline or ocean
 * geometry is invented here. The result is written into the existing shared material response shape
 * so worldMaterialSurfaceFabric can render continuous wetness, salt, sediment, spray and cold-water
 * transitions without introducing another shader or placement authority.
 * @module world/hydrologySurfaceReality
 */

export const HYDROLOGY_SURFACE_REALITY_POLICY = Object.freeze({
  id: 'hydrology-surface-reality-2026-09-14-v1',
  revision: 'v1-canonical-observation-only',
  renderOnly: true,
  deterministic: true,
  readOnlyCanonicalInputs: true,
  inventsWaterGeometry: false,
  changesWaterHeight: false,
  changesShoreline: false,
  changesRiverPath: false,
  changesCollider: false,
  changesPlacement: false,
  neutralWhenCanonicalObservationMissing: true,
  continuousDistanceResponse: true,
  edgeBandResponse: true,
  riverSedimentResponse: true,
  waterfallSprayResponse: true,
  coldWaterResponse: true,
  saltAerosolResponse: true,
  profiles: Object.freeze([
    'neutral',
    'ocean-edge',
    'lake-edge',
    'river-edge',
    'waterfall-spray',
    'wet-ground',
    'cold-water',
    'frozen-edge',
  ]),
});

const clamp01 = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

const clamp = (value, lo, hi, fallback = lo) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

const lerp = (a, b, t) => a + (b - a) * t;

const smoothstep = (a, b, x) => {
  if (a === b) return x >= b ? 1 : 0;
  const t = clamp01((Number(x) - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function finiteMeters(value, fallback = Infinity) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function finiteSigned(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeWaterType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  if (type === 'ocean' || type === 'sea' || type === 'marine') return 'ocean-edge';
  if (type === 'lake' || type === 'lacustrine') return 'lake-edge';
  if (type === 'river' || type === 'stream' || type === 'creek') return 'river-edge';
  if (type === 'waterfall' || type === 'cascade') return 'waterfall-spray';
  if (type === 'frozen' || type === 'ice') return 'frozen-edge';
  if (type === 'wet' || type === 'wet-ground') return 'wet-ground';
  return 'neutral';
}

const WATER_TYPE_WEIGHTS = Object.freeze({
  'ocean-edge': Object.freeze({ salt: 0.74, sediment: 0.16, spray: 0.78, wet: 0.72, cold: 0.18 }),
  'lake-edge': Object.freeze({ salt: 0.10, sediment: 0.48, spray: 0.18, wet: 0.76, cold: 0.30 }),
  'river-edge': Object.freeze({ salt: 0.04, sediment: 0.82, spray: 0.38, wet: 0.84, cold: 0.38 }),
  'waterfall-spray': Object.freeze({ salt: 0.04, sediment: 0.34, spray: 1.0, wet: 0.91, cold: 0.48 }),
  'frozen-edge': Object.freeze({ salt: 0.02, sediment: 0.08, spray: 0.02, wet: 0.48, cold: 0.96 }),
  'wet-ground': Object.freeze({ salt: 0.03, sediment: 0.56, spray: 0.06, wet: 0.90, cold: 0.42 }),
  neutral: Object.freeze({ salt: 0, sediment: 0, spray: 0, wet: 0, cold: 0 }),
});

const MATERIAL_RESPONSE_BY_WATER_TYPE = Object.freeze({
  stone: Object.freeze({ wet: 0.90, salt: 0.80, sediment: 0.78, spray: 0.72, cold: 0.82 }),
  wood: Object.freeze({ wet: 0.96, salt: 0.54, sediment: 0.32, spray: 0.64, cold: 0.62 }),
  plaster: Object.freeze({ wet: 1.0, salt: 0.94, sediment: 0.26, spray: 0.80, cold: 0.58 }),
  metal: Object.freeze({ wet: 0.76, salt: 0.98, sediment: 0.22, spray: 0.76, cold: 0.52 }),
  cloth: Object.freeze({ wet: 0.86, salt: 0.46, sediment: 0.36, spray: 0.60, cold: 0.70 }),
  vegetation: Object.freeze({ wet: 0.74, salt: 0.28, sediment: 0.22, spray: 0.48, cold: 0.86 }),
  soil: Object.freeze({ wet: 1.0, salt: 0.44, sediment: 0.94, spray: 0.40, cold: 0.74 }),
  snow: Object.freeze({ wet: 0.64, salt: 0.08, sediment: 0.14, spray: 0.18, cold: 1.0 }),
  generic: Object.freeze({ wet: 0.82, salt: 0.46, sediment: 0.46, spray: 0.54, cold: 0.70 }),
});

function normalizeProfileId(value) {
  const id = String(value ?? 'generic').trim().toLowerCase();
  return MATERIAL_RESPONSE_BY_WATER_TYPE[id] ? id : 'generic';
}

function distanceEnvelope(distanceMeters, startMeters, fullMeters) {
  const d = finiteMeters(distanceMeters);
  if (!Number.isFinite(d)) return 0;
  return smoothstep(fullMeters, startMeters, d);
}

function depthResponse(depthMeters, shallowMeters = 0.20, deepMeters = 12) {
  const depth = Math.max(0, finiteSigned(depthMeters));
  return smoothstep(shallowMeters, deepMeters, depth);
}

function signedDistanceBand(distanceMeters, inner, outer) {
  const d = finiteMeters(distanceMeters);
  if (!Number.isFinite(d)) return 0;
  if (d <= inner) return 1;
  return smoothstep(outer, inner, d);
}

function canonicalDistanceEvidence(surface = {}) {
  const candidates = [
    surface.distanceToWaterMeters,
    surface.waterDistanceMeters,
    surface.shoreDistanceMeters,
    surface.distanceToShoreMeters,
    surface.canonicalWaterDistanceMeters,
  ];
  const values = candidates.map(finiteMeters).filter(Number.isFinite);
  return values.length ? Math.min(...values) : Infinity;
}

function canonicalDepthEvidence(surface = {}) {
  const candidates = [
    surface.waterDepthMeters,
    surface.canonicalWaterDepthMeters,
    surface.depthMeters,
  ];
  const values = candidates.map((value) => Math.max(0, finiteSigned(value, NaN))).filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

function canonicalWaterType(surface = {}) {
  return normalizeWaterType(surface.canonicalWaterType ?? surface.waterType ?? surface.surfaceWaterType ?? surface.biomeWaterType);
}

function canonicalWetEvidence(surface = {}) {
  const direct = [surface.wetness, surface.wetEdge, surface.canonicalWetness, surface.shorelineWetness]
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .map(clamp01);
  return direct.length ? Math.max(...direct) : 0;
}

function canonicalRiverEvidence(surface = {}) {
  const direct = [surface.riverProximity, surface.canonicalRiverProximity, surface.distanceToRiverNormalized]
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .map(clamp01);
  return direct.length ? Math.max(...direct) : 0;
}

function canonicalSprayEvidence(surface = {}) {
  const direct = [surface.spray, surface.sprayExposure, surface.canonicalSpray]
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .map(clamp01);
  return direct.length ? Math.max(...direct) : 0;
}

function canonicalColdEvidence(surface = {}) {
  const direct = [surface.coldWater, surface.waterTemperatureColdness, surface.canonicalColdWater]
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .map(clamp01);
  return direct.length ? Math.max(...direct) : 0;
}

export function resolveHydrologySurfaceEvidence(surface = {}) {
  const waterType = canonicalWaterType(surface);
  const typeWeights = WATER_TYPE_WEIGHTS[waterType] || WATER_TYPE_WEIGHTS.neutral;
  const distanceMeters = canonicalDistanceEvidence(surface);
  const depthMeters = canonicalDepthEvidence(surface);
  const directWet = canonicalWetEvidence(surface);
  const directRiver = canonicalRiverEvidence(surface);
  const directSpray = canonicalSprayEvidence(surface);
  const directCold = canonicalColdEvidence(surface);
  const edge = distanceEnvelope(distanceMeters, 30, 180);
  const narrowEdge = distanceEnvelope(distanceMeters, 4, 42);
  const depth = depthResponse(depthMeters);
  const river = Math.max(directRiver, waterType === 'river-edge' ? narrowEdge : 0);
  const wet = clamp01(Math.max(directWet, edge * typeWeights.wet * (1 - depth * 0.22)));
  const spray = clamp01(Math.max(directSpray, narrowEdge * typeWeights.spray));
  const cold = clamp01(Math.max(directCold, typeWeights.cold * (waterType === 'frozen-edge' ? 1 : narrowEdge * 0.72)));
  const salt = clamp01(typeWeights.salt * (edge * 0.54 + spray * 0.46));
  const sediment = clamp01(typeWeights.sediment * (edge * 0.34 + river * 0.66));
  return Object.freeze({
    policyId: HYDROLOGY_SURFACE_REALITY_POLICY.id,
    waterType,
    observedCanonicalWater: waterType !== 'neutral' || Number.isFinite(distanceMeters) || depthMeters > 0 || directWet > 0 || directRiver > 0 || directSpray > 0 || directCold > 0,
    distanceMeters,
    depthMeters,
    edge,
    narrowEdge,
    depth,
    wet,
    river,
    spray,
    cold,
    salt,
    sediment,
    source: Object.freeze({
      directWet,
      directRiver,
      directSpray,
      directCold,
      canonicalDistance: Number.isFinite(distanceMeters),
      canonicalDepth: depthMeters > 0,
      canonicalWaterType: waterType !== 'neutral',
    }),
  });
}

function transitionWeight(value, start, full) {
  return smoothstep(start, full, clamp01(value));
}

function waterTypeProfile(evidence) {
  switch (evidence.waterType) {
    case 'ocean-edge': return 'ocean-edge';
    case 'lake-edge': return 'lake-edge';
    case 'river-edge': return 'river-edge';
    case 'waterfall-spray': return 'waterfall-spray';
    case 'frozen-edge': return 'frozen-edge';
    case 'wet-ground': return 'wet-ground';
    default: return evidence.observedCanonicalWater ? 'wet-ground' : 'neutral';
  }
}

function responseForProfile(materialProfile, evidence) {
  const profile = MATERIAL_RESPONSE_BY_WATER_TYPE[normalizeProfileId(materialProfile)];
  const wet = evidence.wet * profile.wet;
  const salt = evidence.salt * profile.salt;
  const sediment = evidence.sediment * profile.sediment;
  const spray = evidence.spray * profile.spray;
  const cold = evidence.cold * profile.cold;
  const glossing = wet * (materialProfile === 'metal' ? 0.34 : 0.14);
  const roughnessDelta = wet * (materialProfile === 'snow' ? 0.055 : -0.065)
    + salt * 0.055
    + sediment * 0.035
    + spray * 0.025
    + cold * 0.032;
  const normalGain = wet * 0.012 + sediment * 0.010 + cold * 0.008;
  const albedoShift = -(wet * 0.075 + salt * 0.028)
    + sediment * (materialProfile === 'soil' ? 0.052 : 0.018)
    + cold * 0.012;
  return Object.freeze({
    wet,
    salt,
    sediment,
    spray,
    cold,
    glossing,
    roughnessDelta,
    normalGain,
    albedoShift,
  });
}

function enrichFabric(existing, response, evidence, profile) {
  const source = existing && typeof existing === 'object' ? existing : {};
  const existingStrata = clamp01(source.strataStrength, 0);
  const existingGrain = clamp01(source.grainStrength, 0);
  const existingSediment = clamp01(source.sedimentStrength, 0);
  const existingStreak = clamp01(source.streakStrength, 0);
  const existingCrust = clamp01(source.crustStrength, 0);
  return Object.freeze({
    ...source,
    strataStrength: Math.max(existingStrata, response.sediment * 0.36),
    grainStrength: Math.max(existingGrain, response.sediment * 0.44 + response.wet * 0.08),
    sedimentStrength: Math.max(existingSediment, response.sediment),
    streakStrength: Math.max(existingStreak, response.spray * 0.72 + response.salt * 0.28),
    crustStrength: Math.max(existingCrust, profile === 'frozen-edge' ? response.cold * 0.92 : response.wet * 0.14),
    windSastrugi: Math.max(Number(source.windSastrugi) || 0, profile === 'frozen-edge' ? response.cold * 0.44 : 0),
    hydrologyWetness: response.wet,
    hydrologySalt: response.salt,
    hydrologySediment: response.sediment,
    hydrologySpray: response.spray,
    hydrologyCold: response.cold,
    waterDepthResponse: evidence.depth,
    waterEdgeResponse: evidence.edge,
    riverEdgeResponse: evidence.river,
  });
}

function enrichEnvironment(existing, response) {
  const source = existing && typeof existing === 'object' ? existing : {};
  return Object.freeze({
    ...source,
    wetEdge: Math.max(clamp01(source.wetEdge, 0), response.wet),
    salt: Math.max(clamp01(source.salt, 0), response.salt),
    sediment: Math.max(clamp01(source.sediment, 0), response.sediment),
    spray: Math.max(clamp01(source.spray, 0), response.spray),
    frost: Math.max(clamp01(source.frost, 0), response.cold),
    waterColdness: Math.max(clamp01(source.waterColdness, 0), response.cold),
  });
}

export function resolveHydrologyMaterialResponse({ materialProfile = 'generic', evidence = null } = {}) {
  const safeEvidence = evidence || resolveHydrologySurfaceEvidence({});
  const response = responseForProfile(materialProfile, safeEvidence);
  const profile = waterTypeProfile(safeEvidence);
  return Object.freeze({
    policyId: HYDROLOGY_SURFACE_REALITY_POLICY.id,
    profile,
    materialProfile: normalizeProfileId(materialProfile),
    observedCanonicalWater: safeEvidence.observedCanonicalWater,
    response,
    fabric: enrichFabric({}, response, safeEvidence, profile),
    environment: enrichEnvironment({}, response),
    diagnostics: Object.freeze({
      finite: [
        safeEvidence.edge,
        safeEvidence.river,
        safeEvidence.spray,
        safeEvidence.cold,
        safeEvidence.salt,
        safeEvidence.sediment,
        response.wet,
        response.roughnessDelta,
        response.normalGain,
        response.albedoShift,
      ].every(Number.isFinite),
      neutral: !safeEvidence.observedCanonicalWater && response.wet === 0 && response.salt === 0 && response.sediment === 0,
    }),
  });
}

function waterTypeFromDistance(surface, distance) {
  const explicit = canonicalWaterType(surface);
  if (explicit !== 'neutral') return explicit;
  if (!Number.isFinite(distance)) return 'neutral';
  if (surface?.river === true || surface?.isRiverEdge === true) return 'river-edge';
  return distance < 35 ? 'wet-ground' : 'neutral';
}

function addCanonicalPointDistance(points, x, z) {
  if (!Array.isArray(points) || !Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) return Infinity;
  let minimum = Infinity;
  for (const point of points) {
    const px = Number(point?.x);
    const pz = Number(point?.z);
    if (!Number.isFinite(px) || !Number.isFinite(pz)) continue;
    minimum = Math.min(minimum, Math.hypot(px - Number(x), pz - Number(z)));
  }
  return minimum;
}

export function deriveCanonicalRiverProximity({ x, z, riverPoints = [], existing = 0 } = {}) {
  const pointDistance = addCanonicalPointDistance(riverPoints, x, z);
  const explicit = clamp01(existing, 0);
  if (!Number.isFinite(pointDistance)) return explicit;
  return Math.max(explicit, distanceEnvelope(pointDistance, 4, 56));
}

export function deriveCanonicalWaterfallSpray({ x, z, waterfalls = [], existing = 0 } = {}) {
  const pointDistance = addCanonicalPointDistance(waterfalls, x, z);
  const explicit = clamp01(existing, 0);
  if (!Number.isFinite(pointDistance)) return explicit;
  return Math.max(explicit, distanceEnvelope(pointDistance, 3, 32));
}

export function mergeCanonicalHydrologyObservation(surface = {}, { x, z, riverPoints = [], waterfalls = [] } = {}) {
  const riverProximity = deriveCanonicalRiverProximity({ x, z, riverPoints, existing: surface.riverProximity });
  const spray = deriveCanonicalWaterfallSpray({ x, z, waterfalls, existing: surface.spray });
  const existingDistance = canonicalDistanceEvidence(surface);
  const waterType = waterTypeFromDistance({ ...surface, river: riverProximity > 0.01 }, existingDistance);
  return Object.freeze({
    ...surface,
    waterType,
    riverProximity,
    spray,
    canonicalRiverProximity: riverProximity,
    canonicalSpray: spray,
  });
}

function mutateSurfaceResponse(target, response) {
  target.userData ||= {};
  const existing = target.userData.worldAssetSurfaceResponse || {};
  target.userData.worldAssetSurfaceResponse = Object.freeze({
    ...existing,
    hydrologyPolicyId: HYDROLOGY_SURFACE_REALITY_POLICY.id,
    hydrology: response,
    environment: enrichEnvironment(existing.environment, response.response),
    fabric: enrichFabric(existing.fabric, response.response, resolveHydrologySurfaceEvidence(target.userData.worldPlacementSurface || {}), response.profile),
  });
}

/**
 * Apply hydrology response to a material-bearing object. This function is safe to call before or
 * after placement. When no canonical observation exists, it makes no visual hydrology change.
 */
export function enrichMaterialWithHydrologyReality(object, options = {}) {
  if (!object || typeof object !== 'object') return { ok: false, error: 'missing-object' };
  const position = object.position || {};
  const x = Number.isFinite(Number(options.worldX)) ? Number(options.worldX) : Number(position.x) || 0;
  const z = Number.isFinite(Number(options.worldZ)) ? Number(options.worldZ) : Number(position.z) || 0;
  const baseSurface = object.userData?.worldPlacementSurface || options.surface || {};
  const observedSurface = mergeCanonicalHydrologyObservation(baseSurface, {
    x,
    z,
    riverPoints: options.riverPoints || [],
    waterfalls: options.waterfalls || [],
  });
  const evidence = resolveHydrologySurfaceEvidence(observedSurface);
  const profile = options.materialProfile || object.userData?.worldAssetSurfaceReality?.profileId || 'generic';
  const response = resolveHydrologyMaterialResponse({ materialProfile: profile, evidence });
  if (!response.observedCanonicalWater) {
    object.userData ||= {};
    object.userData.worldHydrologySurfaceReality = Object.freeze({
      policyId: HYDROLOGY_SURFACE_REALITY_POLICY.id,
      observedCanonicalWater: false,
      profile: 'neutral',
      response,
    });
    return { ok: true, changed: false, response };
  }

  let materialCount = 0;
  const applyMaterial = (material) => {
    if (!material?.isMaterial) return;
    mutateSurfaceResponse(object, response);
    materialCount += 1;
  };
  object.traverse?.((child) => {
    if (!child?.isMesh && !child?.isInstancedMesh) return;
    const list = Array.isArray(child.material) ? child.material : [child.material];
    list.forEach(applyMaterial);
  });
  object.userData ||= {};
  object.userData.worldHydrologySurfaceReality = Object.freeze({
    policyId: HYDROLOGY_SURFACE_REALITY_POLICY.id,
    observedCanonicalWater: true,
    profile: response.profile,
    waterType: evidence.waterType,
    materialProfile: response.materialProfile,
    materialCount,
    evidence,
    response,
  });
  return { ok: true, changed: materialCount > 0, materialCount, response };
}

export function hydrologySurfaceRealityFingerprint(value) {
  if (!value) return '';
  const values = [
    value.policyId,
    value.profile,
    value.materialProfile,
    value.response?.response?.wet,
    value.response?.response?.salt,
    value.response?.response?.sediment,
    value.response?.response?.spray,
    value.response?.response?.cold,
    value.response?.response?.roughnessDelta,
    value.response?.response?.normalGain,
    value.response?.response?.albedoShift,
  ];
  return values.map((item) => typeof item === 'number' ? item.toFixed(8) : String(item)).join('|');
}

export function compareHydrologySurfaceReality(a, b) {
  const fingerprintA = hydrologySurfaceRealityFingerprint(a);
  const fingerprintB = hydrologySurfaceRealityFingerprint(b);
  return Object.freeze({ deterministic: fingerprintA === fingerprintB, fingerprintA, fingerprintB });
}

export function hydrologyTransitionWeights(surface = {}) {
  const evidence = resolveHydrologySurfaceEvidence(surface);
  return Object.freeze({
    wetEdge: transitionWeight(evidence.wet, 0.08, 0.72),
    deepWater: transitionWeight(evidence.depth, 0.18, 0.86),
    riverSediment: transitionWeight(evidence.river, 0.10, 0.74),
    waterfallSpray: transitionWeight(evidence.spray, 0.08, 0.78),
    coldWater: transitionWeight(evidence.cold, 0.18, 0.82),
    saltAerosol: transitionWeight(evidence.salt, 0.10, 0.76),
  });
}

export function classifyHydrologyMaterialProfile(profile) {
  const id = String(profile ?? '').toLowerCase();
  if (MATERIAL_RESPONSE_BY_WATER_TYPE[id]) return id;
  if (id.includes('rock') || id.includes('stone')) return 'stone';
  if (id.includes('wood') || id.includes('timber')) return 'wood';
  if (id.includes('metal') || id.includes('steel') || id.includes('iron')) return 'metal';
  if (id.includes('plaster') || id.includes('mortar')) return 'plaster';
  if (id.includes('cloth') || id.includes('fabric')) return 'cloth';
  if (id.includes('leaf') || id.includes('vegetation') || id.includes('tree')) return 'vegetation';
  if (id.includes('soil') || id.includes('mud') || id.includes('sand')) return 'soil';
  if (id.includes('snow') || id.includes('ice')) return 'snow';
  return 'generic';
}

export function hydrologyMaterialEnvelope(profile = 'generic') {
  const id = classifyHydrologyMaterialProfile(profile);
  const response = MATERIAL_RESPONSE_BY_WATER_TYPE[id];
  return Object.freeze({
    profileId: id,
    wetGain: response.wet,
    saltGain: response.salt,
    sedimentGain: response.sediment,
    sprayGain: response.spray,
    coldGain: response.cold,
  });
}

export function applyHydrologyScalarEnvelope(material, response = null) {
  if (!material || !response) return false;
  const r = response.response || response;
  if (Number.isFinite(material.roughness)) {
    material.roughness = clamp(material.roughness + r.roughnessDelta * 0.40, 0.12, 1, material.roughness);
  }
  if (material.color?.isColor) {
    const shift = clamp(1 + r.albedoShift * 0.30, 0.80, 1.12, 1);
    material.color.multiplyScalar(shift);
  }
  if (material.normalScale?.isVector2) {
    const gain = clamp(1 + r.normalGain, 0.82, 1.28, 1);
    material.normalScale.multiplyScalar(gain);
  }
  material.needsUpdate = true;
  return true;
}

export function validateHydrologySurfaceReality(value) {
  const errors = [];
  if (!value || typeof value !== 'object') errors.push('missing-response');
  const evidence = value?.evidence;
  const response = value?.response;
  const numbers = evidence
    ? [evidence.edge, evidence.narrowEdge, evidence.depth, evidence.wet, evidence.river, evidence.spray, evidence.cold, evidence.salt, evidence.sediment]
    : [];
  if (numbers.some((number) => !Number.isFinite(number))) errors.push('non-finite-evidence');
  const responseNumbers = response?.response
    ? [response.response.wet, response.response.salt, response.response.sediment, response.response.spray, response.response.cold, response.response.roughnessDelta, response.response.normalGain, response.response.albedoShift]
    : [];
  if (responseNumbers.some((number) => !Number.isFinite(number))) errors.push('non-finite-response');
  if (response?.diagnostics?.neutral && response?.observedCanonicalWater) errors.push('neutral-but-water-observed');
  return Object.freeze({ ok: errors.length === 0, errors, policyId: HYDROLOGY_SURFACE_REALITY_POLICY.id });
}

export function assertHydrologySurfaceRealityContract() {
  const coastal = resolveHydrologySurfaceEvidence({ distanceToWaterMeters: 14, waterType: 'ocean', wetEdge: 0.62 });
  const river = resolveHydrologySurfaceEvidence({ distanceToWaterMeters: 7, waterType: 'river', riverProximity: 0.91 });
  const fall = resolveHydrologySurfaceEvidence({ distanceToWaterMeters: 3, waterType: 'waterfall', spray: 0.88 });
  const frozen = resolveHydrologySurfaceEvidence({ distanceToWaterMeters: 6, waterType: 'frozen', coldWater: 0.98 });
  const neutral = resolveHydrologySurfaceEvidence({});
  const responses = [coastal, river, fall, frozen].map((evidence) => resolveHydrologyMaterialResponse({ materialProfile: 'stone', evidence }));
  for (const response of responses) {
    const check = validateHydrologySurfaceReality(response);
    if (!check.ok) throw new Error(`hydrology contract invalid: ${check.errors.join(',')}`);
  }
  if (neutral.observedCanonicalWater) throw new Error('hydrology neutral probe unexpectedly observed water');
  if (!(river.sediment > coastal.sediment)) throw new Error('river sediment response not stronger than coastal response');
  if (!(fall.spray >= river.spray)) throw new Error('waterfall spray response not stronger than river response');
  if (!(frozen.cold >= coastal.cold)) throw new Error('frozen cold-water response not stronger than coastal response');
  const first = responses.map(hydrologySurfaceRealityFingerprint);
  const second = [coastal, river, fall, frozen].map((evidence) => resolveHydrologyMaterialResponse({ materialProfile: 'stone', evidence })).map(hydrologySurfaceRealityFingerprint);
  if (!first.every((value, index) => value === second[index])) throw new Error('hydrology response is not deterministic');
  return Object.freeze({
    ok: true,
    policyId: HYDROLOGY_SURFACE_REALITY_POLICY.id,
    profiles: responses.map((response) => response.profile),
    fingerprints: first,
  });
}

export default Object.freeze({
  HYDROLOGY_SURFACE_REALITY_POLICY,
  resolveHydrologySurfaceEvidence,
  resolveHydrologyMaterialResponse,
  deriveCanonicalRiverProximity,
  deriveCanonicalWaterfallSpray,
  mergeCanonicalHydrologyObservation,
  enrichMaterialWithHydrologyReality,
  hydrologySurfaceRealityFingerprint,
  compareHydrologySurfaceReality,
  hydrologyTransitionWeights,
  classifyHydrologyMaterialProfile,
  hydrologyMaterialEnvelope,
  applyHydrologyScalarEnvelope,
  validateHydrologySurfaceReality,
  assertHydrologySurfaceRealityContract,
});
