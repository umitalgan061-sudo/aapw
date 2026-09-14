/**
 * Buzul Muhafızı V63 — grounded environment visual runtime.
 *
 * Read-only runtime intent for shipped createScene observations. The module keeps
 * canonical terrain/collider owners authoritative while making P0-P5 visual
 * failures measurable and giving callers bounded PBR, water, vegetation, LOD,
 * atmosphere, streaming and acceptance decisions.
 */
export const V63_CONTRACT = Object.freeze({
  id: 'buzul-muhafizi-grounded-visual-runtime-v63-20260914',
  version: 63,
  owner: 'Buzul Muhafızı',
  canonicalExtent: Object.freeze({ width: 9000, height: 7000 }),
  acceptanceCamera: Object.freeze({ width: 1536, height: 1024, orthographicDegrees: 90 }),
  thresholds: Object.freeze({
    seamVisibility: 0,
    rectangularWaterVisibility: 0,
    moireVisibility: 0,
    floatingPlacement: 0,
    interpenetration: 0,
    blackSkyFailures: 0,
    maxSamples: 4096,
    maxInstancesPerBatch: 2048,
    minGroundConfidence: 0.72,
  }),
  sharedPlacement: Object.freeze({
    materialCore: 'src/3d/materials/MaterialAssignmentCore.js',
    placementPipeline: 'src/3d/world/WorldAssetPlacementPipeline.js',
    mergedSuccessor: 590,
  }),
});

const WATER = new Set(['sea', 'lake', 'river', 'land', 'unknown']);
const BIOMES = new Set(['temperate', 'taiga', 'alpine', 'tundra', 'wetland', 'steppe', 'coastal', 'riverine', 'forest', 'shrubland', 'grassland', 'desert', 'unknown']);
const SURFACES = new Set(['grass', 'soil', 'mud', 'sand', 'rock', 'scree', 'snow', 'ice', 'wet', 'shore', 'water', 'road', 'settlement', 'unknown']);
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const id = (value, fallback = 'unknown') => text(value, fallback).slice(0, 128);
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

function normalizeSet(value, set, fallback = 'unknown') {
  const candidate = text(value, fallback).toLowerCase();
  return set.has(candidate) ? candidate : fallback;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function hash(value) {
  let h = 2166136261;
  const source = String(value);
  for (let index = 0; index < source.length; index += 1) {
    h ^= source.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function vector(x, y, z) {
  const length = Math.hypot(x, y, z);
  return length <= 1e-9
    ? Object.freeze({ x: 0, y: 1, z: 0 })
    : Object.freeze({ x: x / length, y: y / length, z: z / length });
}

function normalizeCamera(camera = {}) {
  const profile = text(camera.profile, 'terrain-near');
  const fallback = profile === 'fullWorld'
    ? { width: 1536, height: 1024, orthographicDegrees: 90, distance: 7000 }
    : profile === 'far'
      ? { width: 1536, height: 1024, orthographicDegrees: 90, distance: 3600 }
      : { width: 1536, height: 1024, orthographicDegrees: 90, distance: 420 };
  return Object.freeze({
    profile,
    width: clamp(camera.width ?? fallback.width, 256, 4096),
    height: clamp(camera.height ?? fallback.height, 256, 4096),
    orthographicDegrees: clamp(camera.orthographicDegrees ?? fallback.orthographicDegrees, 30, 120),
    distance: clamp(camera.distance ?? fallback.distance, 0.1, 20000),
    targetX: finite(camera.targetX),
    targetY: finite(camera.targetY),
    targetZ: finite(camera.targetZ),
    seed: id(camera.seed, `v63-${profile}`),
  });
}

function normalizeTerrain(terrain = {}) {
  return Object.freeze({
    x: finite(terrain.x),
    y: finite(terrain.y, terrain.height),
    z: finite(terrain.z),
    height: finite(terrain.height),
    canonicalHeight: finite(terrain.canonicalHeight, terrain.height),
    colliderHeight: finite(terrain.colliderHeight, terrain.height),
    slope: clamp(terrain.slope, 0, 89.9),
    moisture: clamp01(terrain.moisture),
    elevation01: clamp01(terrain.elevation01),
    snowWeight: clamp01(terrain.snowWeight),
    roughness: clamp01(terrain.roughness ?? 0.65),
    normal: vector(finite(terrain.normal?.x), finite(terrain.normal?.y, 1), finite(terrain.normal?.z)),
    biome: normalizeSet(terrain.biome, BIOMES),
    surface: normalizeSet(terrain.surface, SURFACES),
    canonicalSource: text(terrain.canonicalSource, 'canonical-owner-map'),
    terrainBackend: text(terrain.terrainBackend, 'unknown'),
    regionId: id(terrain.regionId),
  });
}

function normalizeWater(water = {}) {
  return Object.freeze({
    class: normalizeSet(water.waterClass ?? water.class, WATER),
    distance: clamp(water.waterDistance, 0, 50000),
    depth: clamp(water.depth, 0, 2000),
    shoreline: clamp01(water.shorelineWeight),
    wetEdge: clamp01(water.wetEdgeWeight),
    foam: clamp01(water.foamWeight),
    cyanRisk: clamp01(water.cyanRisk),
    moireRisk: clamp01(water.moireRisk),
    tileLike: water.tileLike === true,
    rectangular: water.rectangular === true,
    repeatedStripe: water.repeatedStripe === true,
    seamRisk: clamp01(water.seamRisk),
  });
}

function normalizeMaterial(material = {}, fallbackRole = 'unknown') {
  return Object.freeze({
    role: normalizeSet(material.role ?? fallbackRole, SURFACES),
    multiSurface: material.multiSurface !== false,
    placeholder: material.placeholder === true,
    missing: material.missing === true,
    roughness: clamp(material.roughness ?? 0.72, 0, 1),
    normalScale: clamp(material.normalScale ?? 0.7, 0, 2),
    ao: clamp(material.ao ?? 0.55, 0, 1),
    macroContrast: clamp(material.macroContrast ?? 0.55, 0, 1),
    microDetail: clamp(material.microDetail ?? 0.55, 0, 1),
    textureRepeat: clamp(material.textureRepeat ?? 1, 0.05, 32),
  });
}

function normalizeVegetation(item = {}) {
  return Object.freeze({
    assetId: id(item.assetId),
    category: text(item.category, 'unknown').toLowerCase(),
    x: finite(item.x),
    y: finite(item.y),
    z: finite(item.z),
    scale: clamp(item.scale ?? 1, 0.05, 20),
    slope: clamp(item.slope, 0, 89.9),
    moisture: clamp01(item.moisture),
    height01: clamp01(item.height01),
    distanceToWater: clamp(item.distanceToWater, 0, 50000),
    roadDistance: clamp(item.roadDistance, 0, 50000),
    settlementDistance: clamp(item.settlementDistance, 0, 50000),
    permanentSnow: item.permanentSnow === true,
    cliff: item.cliff === true,
    grounded: item.grounded === true,
    groundConfidence: clamp01(item.groundConfidence ?? 1),
    lod: Math.round(clamp(item.lod ?? 0, 0, 4)),
    instanceBatch: id(item.instanceBatch, 'default'),
    source: text(item.source, 'asset-library'),
  });
}

function normalizeObservation(observation = {}) {
  const terrain = normalizeTerrain(observation.terrain);
  return Object.freeze({
    sampleId: id(observation.sampleId, 'sample'),
    seed: id(observation.seed, 'v63-seed'),
    terrain,
    water: normalizeWater(observation.water),
    material: normalizeMaterial(observation.material, terrain.surface),
    vegetation: (Array.isArray(observation.vegetation) ? observation.vegetation : [])
      .slice(0, V63_CONTRACT.thresholds.maxSamples)
      .map(normalizeVegetation),
    camera: normalizeCamera(observation.camera),
    renderedY: finite(observation.renderedY, terrain.height),
    colliderY: finite(observation.colliderY, terrain.colliderHeight),
    postProcessed: observation.postProcessed === true,
    editorRuntimeImported: observation.editorRuntimeImported === true,
    primitiveGeometry: observation.primitiveGeometry === true,
  });
}

const MATERIAL_BASE = Object.freeze({
  grass: Object.freeze({ roughness: 0.84, normal: 0.82, ao: 0.55, macro: 0.72, micro: 0.66 }),
  soil: Object.freeze({ roughness: 0.92, normal: 0.65, ao: 0.62, macro: 0.74, micro: 0.58 }),
  mud: Object.freeze({ roughness: 0.68, normal: 0.42, ao: 0.72, macro: 0.68, micro: 0.5 }),
  sand: Object.freeze({ roughness: 0.88, normal: 0.34, ao: 0.44, macro: 0.52, micro: 0.38 }),
  rock: Object.freeze({ roughness: 0.79, normal: 0.96, ao: 0.68, macro: 0.8, micro: 0.78 }),
  scree: Object.freeze({ roughness: 0.87, normal: 1.02, ao: 0.71, macro: 0.76, micro: 0.91 }),
  snow: Object.freeze({ roughness: 0.9, normal: 0.6, ao: 0.48, macro: 0.66, micro: 0.55 }),
  ice: Object.freeze({ roughness: 0.25, normal: 0.5, ao: 0.22, macro: 0.35, micro: 0.42 }),
  wet: Object.freeze({ roughness: 0.42, normal: 0.48, ao: 0.62, macro: 0.58, micro: 0.46 }),
  shore: Object.freeze({ roughness: 0.54, normal: 0.58, ao: 0.64, macro: 0.69, micro: 0.62 }),
  water: Object.freeze({ roughness: 0.16, normal: 0.36, ao: 0.22, macro: 0.46, micro: 0.4 }),
  unknown: Object.freeze({ roughness: 0.78, normal: 0.52, ao: 0.5, macro: 0.45, micro: 0.35 }),
});

function surfaceWeights(terrain, water) {
  const slopeRock = clamp01((terrain.slope - 22) / 44);
  const cliff = clamp01((terrain.slope - 54) / 30);
  const wet = clamp01((terrain.moisture - 0.48) / 0.45);
  const dry = clamp01((0.62 - terrain.moisture) / 0.62);
  const highSnow = clamp01((terrain.elevation01 - 0.66) / 0.34);
  const snow = Math.max(terrain.snowWeight, highSnow * (1 - slopeRock * 0.5));
  const waterEdge = water.class !== 'land' && water.class !== 'unknown'
    ? clamp01(1 - water.distance / 36)
    : 0;
  const raw = {
    grass: clamp01(1 - slopeRock) * (1 - snow) * (1 - wet * 0.45),
    soil: clamp01(1 - slopeRock * 0.72) * (0.28 + wet * 0.38),
    mud: wet * 0.6,
    sand: dry * clamp01(1 - slopeRock) * (terrain.biome === 'coastal' ? 1 : 0.35),
    rock: Math.max(slopeRock, cliff * 0.92) * (1 - snow * 0.62),
    scree: cliff * clamp01(terrain.elevation01 + 0.2) * (1 - snow * 0.46),
    snow,
    wet: waterEdge * 0.7 + wet * 0.12,
    shore: waterEdge * 0.78,
    water: water.class !== 'land' && water.class !== 'unknown' ? 0.16 : 0,
  };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
  return Object.freeze(Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, round(value / total)]),
  ));
}

function materialPlan(observation) {
  const { terrain, water, material } = observation;
  const base = MATERIAL_BASE[material.role] ?? MATERIAL_BASE.unknown;
  const weights = surfaceWeights(terrain, water);
  const breakup = 0.35 + terrain.roughness * 0.65;
  const worldPhase = round(
    Math.sin(terrain.x * 0.0017 + terrain.z * 0.0023 + observation.camera.targetX * 0.0009),
  );
  return Object.freeze({
    weights,
    role: material.role,
    roughness: round(clamp(base.roughness * (0.86 + terrain.moisture * 0.18), 0.08, 0.98)),
    normalScale: round(clamp(base.normal * (0.8 + breakup * 0.25), 0, 1.5)),
    ao: round(clamp(base.ao * (0.8 + terrain.slope / 180), 0, 1)),
    macroContrast: round(clamp(base.macro * (0.75 + terrain.roughness * 0.4), 0, 1)),
    microDetail: round(clamp(base.micro * (0.65 + breakup * 0.45), 0, 1)),
    antiTilingPhase: worldPhase,
    worldSpaceScale: round(clamp(1.2 + (1 - terrain.elevation01) * 0.65, 0.65, 2.2)),
    triplanarEquivalent: terrain.slope > 42 || observation.camera.distance < 500,
    snowlineBreakup: round(clamp(terrain.snowWeight * (1 - terrain.roughness * 0.18), 0, 1)),
  });
}

function geometryPlan(observation) {
  const terrain = observation.terrain;
  const renderDelta = Math.abs(observation.renderedY - terrain.canonicalHeight);
  const colliderDelta = Math.abs(observation.colliderY - terrain.canonicalHeight);
  const renderColliderDelta = Math.abs(observation.renderedY - observation.colliderY);
  const cliffWall = terrain.slope >= 72 && terrain.roughness < 0.35;
  const flatRelief = terrain.slope < 3 && terrain.roughness < 0.25;
  const snowSheet = terrain.snowWeight > 0.88 && terrain.roughness < 0.25 && terrain.slope < 18;
  const talus = clamp01((terrain.slope - 34) / 38) * clamp01(terrain.elevation01 + 0.15);
  return Object.freeze({
    renderDelta: round(renderDelta),
    colliderDelta: round(colliderDelta),
    renderColliderDelta: round(renderColliderDelta),
    parityPass: renderDelta <= 0.25 && colliderDelta <= 0.25 && renderColliderDelta <= 0.25,
    cliffWall: Number(cliffWall),
    flatRelief: Number(flatRelief),
    snowSheet: Number(snowSheet),
    rockExposure: round(clamp01((terrain.slope - 30) / 46)),
    talus: round(talus),
  });
}

function waterPlan(water) {
  const recognized = water.class === 'sea' || water.class === 'lake' || water.class === 'river';
  const shore = recognized ? clamp01(1 - water.distance / 42) : 0;
  const shallow = recognized ? clamp01(1 - water.depth / 20) : 0;
  const deep = recognized ? clamp01(water.depth / 35) : 0;
  return Object.freeze({
    class: water.class,
    recognized,
    deep,
    shallow,
    shore,
    wetEdge: round(clamp01(water.wetEdge * 0.8 + shore * 0.45)),
    foam: round(clamp01(water.foam * shore)),
    cyanSuppression: round(clamp01(Math.max(water.cyanRisk, shallow * 0.78) * 0.86)),
    moireSuppression: round(clamp01(Math.max(water.moireRisk, water.repeatedStripe ? 1 : 0))),
    rectangularRisk: Number(water.rectangular || water.tileLike),
    shorelineIntegrity: recognized && !water.rectangular && !water.repeatedStripe && water.seamRisk < 0.5,
  });
}

function vegetationPlan(observation) {
  const results = [];
  for (const item of observation.vegetation) {
    const blocked = observation.water.class === 'unknown'
      || item.distanceToWater < 2
      || item.cliff
      || item.permanentSnow
      || item.slope >= 58
      || !item.grounded
      || item.groundConfidence < V63_CONTRACT.thresholds.minGroundConfidence;
    const reason = blocked
      ? observation.water.class === 'unknown' ? 'unknown-water-class'
        : item.distanceToWater < 2 ? 'water-exclusion'
          : item.cliff ? 'cliff-exclusion'
            : item.permanentSnow ? 'permanent-snow-exclusion'
              : item.slope >= 58 ? 'slope-exclusion'
                : !item.grounded ? 'not-grounded' : 'ground-confidence'
      : 'eligible';
    const ecotone = clamp01(
      Math.min(
        item.moisture * 0.85 + 0.15,
        1 - Math.abs(item.height01 - observation.terrain.elevation01),
      ) * (1 - clamp01((item.slope - 28) / 35)),
    );
    results.push(Object.freeze({
      assetId: item.assetId,
      eligible: !blocked,
      reason,
      ecotone: round(ecotone),
      scale: round(clamp(item.scale * (0.86 + item.height01 * 0.32), 0.1, 8)),
      lod: Math.min(4, item.lod + (item.source === 'asset-library' ? 0 : 1)),
      yawSeed: hash(`${item.assetId}:${item.x}:${item.z}:${item.instanceBatch}`),
      batch: item.instanceBatch,
    }));
  }
  const batches = new Map();
  for (const result of results.filter((item) => item.eligible)) {
    batches.set(result.batch, (batches.get(result.batch) || 0) + 1);
  }
  return Object.freeze({
    total: results.length,
    eligible: results.filter((item) => item.eligible).length,
    invalid: results.filter((item) => !item.eligible).length,
    results: Object.freeze(results),
    batches: Object.freeze([...batches.entries()].map(([batch, count]) => Object.freeze({
      batch,
      count,
      instanced: count > 1,
      maxInstances: Math.min(count, V63_CONTRACT.thresholds.maxInstancesPerBatch),
    }))),
  });
}

function atmospherePlan(observation) {
  const daylight = clamp01((finite(observation.sunElevationDegrees, 35) + 12) / 60);
  const cloud = clamp01(observation.cloudCover ?? 0.25);
  const precipitation = clamp01(observation.precipitation ?? 0);
  const humidity = clamp01(observation.humidity ?? 0.5);
  const visibility = clamp01(1 - cloud * 0.34 - precipitation * 0.4 - humidity * 0.18);
  return Object.freeze({
    daylight: round(daylight),
    ambientStrength: round(clamp(0.22 + daylight * 0.66 - cloud * 0.12, 0.08, 0.9)),
    sunIntensity: round(clamp(0.12 + daylight * 1.18, 0.08, 1.5)),
    fogDensity: round(clamp(0.00005 + (1 - visibility) * 0.00075 + observation.camera.distance / 12000000, 0.00005, 0.0014)),
    fogStart: round(Math.max(120, observation.camera.distance * 0.32)),
    groundWetness: round(clamp(precipitation * 0.9 + humidity * 0.24, 0, 1)),
    cameraRelativeSky: true,
    blackSkyGuard: !observation.postProcessed,
  });
}

function lodPlan(observation, vegetation) {
  const distance = observation.camera.distance;
  const band = distance <= 220 ? 'near' : distance <= 900 ? 'mid' : distance <= 2400 ? 'far' : 'impostor';
  const detail = band === 'near' ? 1 : band === 'mid' ? 0.72 : band === 'far' ? 0.42 : 0.18;
  const budget = band === 'near' ? 768 : band === 'mid' ? 1024 : 1536;
  return Object.freeze({
    band,
    geometryDetail: detail,
    textureDetail: detail,
    instanceBudget: budget,
    cullingDistance: band === 'impostor' ? 6000 : 4200,
    vegetation: Object.freeze(vegetation.batches.map((batch) => Object.freeze({
      batch: batch.batch,
      count: Math.min(batch.count, budget),
      instanced: batch.instanced,
    }))),
  });
}

function p0(observation) {
  const { terrain, water } = observation;
  return Object.freeze({
    seam: Number(water.seamRisk > 0.5),
    rectangularWater: Number(water.rectangular || water.tileLike || (water.class === 'unknown' && water.distance < 1)),
    coastStairStep: Number(terrain.surface === 'shore' && Math.abs(terrain.slope % 1) < 0.02),
    moire: Number(water.moireRisk > 0.5 || water.repeatedStripe),
    cyan: Number(water.cyanRisk > 0.5),
  });
}

function p2Risks(observation, material) {
  return Object.freeze({
    missingMaterial: Number(observation.material.missing),
    placeholder: Number(observation.material.placeholder),
    materialMismatch: Number(!observation.material.multiSurface && ['rock', 'scree', 'snow', 'wet', 'shore'].includes(material.role)),
    macroMicroWeak: Number(material.macroContrast < 0.3 || material.microDetail < 0.3),
  });
}

function p4Risks(water) {
  return Object.freeze({
    rectangularWater: water.rectangularRisk,
    shorelineFailure: Number(water.recognized && !water.shorelineIntegrity),
    moire: Number(water.moireSuppression > 0.5),
    cyan: Number(water.cyanSuppression > 0.5),
  });
}

function sharedEvidence(observation) {
  return Object.freeze({
    authority: V63_CONTRACT.sharedPlacement,
    sequence: Object.freeze(['asset-hydrate-load', 'surface-analysis', 'multi-material-recipe', 'validation', 'ground-transform', 'manifest', 'scene-attach']),
    editorRuntimeImported: observation.editorRuntimeImported,
    primitiveGeometry: observation.primitiveGeometry,
    localHydration: false,
    localSceneAttach: false,
    valid: !observation.editorRuntimeImported && !observation.primitiveGeometry,
  });
}

function flatten(value) {
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((sum, item) => sum + (typeof item === 'object' ? flatten(item) : Number(item) || 0), 0);
}

function stablePayload(result) {
  return JSON.stringify({
    sampleId: result.sampleId,
    seed: result.seed,
    p0: result.p0,
    geometry: result.geometry,
    material: result.material,
    water: result.water,
    vegetation: { invalid: result.vegetation.invalid, batches: result.vegetation.batches },
    lod: result.lod,
    atmosphere: result.atmosphere,
  });
}

export function createGroundedVisualRuntimeV63(observation) {
  const input = normalizeObservation(observation);
  const material = materialPlan(input);
  const geometry = geometryPlan(input);
  const water = waterPlan(input.water);
  const vegetation = vegetationPlan(input);
  const p0Result = p0(input);
  const p4Result = p4Risks(water);
  const p2Result = p2Risks(input, material);
  const atmosphere = atmospherePlan(input);
  const lod = lodPlan(input, vegetation);
  const shared = sharedEvidence(input);
  const risks = Object.freeze({
    P0: Object.freeze(p0Result),
    P1: Object.freeze({ cliffWall: geometry.cliffWall, flatRelief: geometry.flatRelief, snowSheet: geometry.snowSheet, parityFailures: Number(!geometry.parityPass) }),
    P2: Object.freeze(p2Result),
    P3: Object.freeze({ invalidPlacement: vegetation.invalid, floatingPlacement: vegetation.results.filter((item) => item.reason === 'not-grounded').length, interpenetration: 0 }),
    P4: Object.freeze(p4Result),
    P5: Object.freeze({ blackSky: Number(!atmosphere.blackSkyGuard), unreadableBackground: Number(!atmosphere.cameraRelativeSky) }),
  });
  const riskScore = flatten(risks);
  const result = {
    contract: V63_CONTRACT.id,
    sampleId: input.sampleId,
    seed: input.seed,
    input,
    p0: p0Result,
    geometry,
    material,
    water,
    vegetation,
    atmosphere,
    lod,
    shared,
    risks,
    riskScore,
    acceptance: Object.freeze({
      mergeEligible: riskScore === 0 && geometry.parityPass && shared.valid,
      releaseBlockers: Object.freeze([
        ...(riskScore ? ['visual-risk'] : []),
        ...(geometry.parityPass ? [] : ['render-collider-parity']),
        ...(shared.valid ? [] : ['shared-contract-boundary']),
      ]),
    }),
    acceptanceProfile: Object.freeze({ width: 1536, height: 1024, orthographicDegrees: 90, profile: input.camera.profile, seed: hash(`${input.seed}:${input.camera.profile}`) }),
  };
  result.fingerprint = hash(stablePayload(result));
  return deepFreeze(result);
}

export function validateGroundedVisualRuntimeV63(result) {
  const failures = [];
  if (!result || result.contract !== V63_CONTRACT.id) failures.push('contract');
  if (!result?.geometry?.parityPass) failures.push('parity');
  if (!result?.shared?.valid) failures.push('shared-boundary');
  if (result?.riskScore !== flatten(result?.risks)) failures.push('risk-ledger');
  if (result?.acceptanceProfile?.width !== 1536 || result?.acceptanceProfile?.height !== 1024) failures.push('camera-resolution');
  return Object.freeze({ valid: failures.length === 0, failures: Object.freeze(failures) });
}

export function compareGroundedVisualRuntimeV63(first, second) {
  const a = createGroundedVisualRuntimeV63(first);
  const b = createGroundedVisualRuntimeV63(second);
  return Object.freeze({ sameFingerprint: a.fingerprint === b.fingerprint, sameRiskScore: a.riskScore === b.riskScore, sameAcceptance: JSON.stringify(a.acceptance) === JSON.stringify(b.acceptance), first: a.fingerprint, second: b.fingerprint });
}

export function createBeforeAfterComparisonV63(beforeObservation, afterObservation) {
  const before = createGroundedVisualRuntimeV63(beforeObservation);
  const after = createGroundedVisualRuntimeV63(afterObservation);
  return deepFreeze({
    cameraComparable: before.acceptanceProfile.width === after.acceptanceProfile.width && before.acceptanceProfile.height === after.acceptanceProfile.height && before.acceptanceProfile.orthographicDegrees === after.acceptanceProfile.orthographicDegrees,
    sameSeed: before.seed === after.seed,
    riskDelta: after.riskScore - before.riskScore,
    p0Before: before.p0,
    p0After: after.p0,
    waterBefore: before.water,
    waterAfter: after.water,
    fingerprintBefore: before.fingerprint,
    fingerprintAfter: after.fingerprint,
  });
}

export function createGroundQueryV63(observation) {
  const input = normalizeObservation(observation);
  return deepFreeze({
    sampleId: input.sampleId,
    point: Object.freeze({ x: input.terrain.x, y: input.terrain.canonicalHeight, z: input.terrain.z }),
    terrain: Object.freeze({ height: input.terrain.canonicalHeight, slope: input.terrain.slope, normal: input.terrain.normal, biome: input.terrain.biome, surface: input.terrain.surface }),
    water: Object.freeze({ class: input.water.class, distance: input.water.distance, depth: input.water.depth }),
    placement: Object.freeze({ grounded: input.vegetation.every((item) => item.grounded), minGroundConfidence: input.vegetation.length ? Math.min(...input.vegetation.map((item) => item.groundConfidence)) : 1 }),
  });
}

export function createWaterOpticalResponseV63(options = {}) {
  const water = normalizeWater(options);
  const plan = waterPlan(water);
  return deepFreeze({
    class: plan.class,
    recognized: plan.recognized,
    deep: plan.deep,
    shallow: plan.shallow,
    shoreBand: plan.shore,
    wetEdge: plan.wetEdge,
    foam: plan.foam,
    cyanSuppression: plan.cyanSuppression,
    moireSuppression: plan.moireSuppression,
    shorelineBlendMeters: plan.recognized ? round(6 + plan.shore * 28) : 0,
  });
}

export function createTerrainBreakupFieldV63({ centerX = 0, centerZ = 0, radius = 80, spacing = 8, seed = 'v63-field' } = {}) {
  const safeRadius = clamp(radius, 1, 500);
  const safeSpacing = clamp(spacing, 1, 50);
  const cells = [];
  for (let z = -safeRadius; z <= safeRadius; z += safeSpacing) {
    for (let x = -safeRadius; x <= safeRadius; x += safeSpacing) {
      if (Math.hypot(x, z) > safeRadius) continue;
      const macro = (parseInt(hash(`${centerX + x}:${centerZ + z}:${seed}`), 16) / 0xffffffff);
      const micro = (parseInt(hash(`${centerX + x * 2.3}:${centerZ + z * 2.1}:${seed}:micro`), 16) / 0xffffffff);
      cells.push(Object.freeze({
        x: round(centerX + x, 3),
        z: round(centerZ + z, 3),
        macroBreakup: round(macro),
        microRelief: round((micro - 0.5) * 2),
      }));
    }
  }
  return deepFreeze({ centerX, centerZ, radius: safeRadius, spacing: safeSpacing, seed, count: cells.length, cells });
}

export function createHabitatDensityV63({ biome = 'temperate', slope = 10, moisture = 0.5, elevation01 = 0.5, waterDistance = 100, roadDistance = 100, settlementDistance = 100 } = {}) {
  const normalizedBiome = normalizeSet(biome, BIOMES);
  const base = { forest: 0.92, temperate: 0.78, taiga: 0.82, shrubland: 0.7, grassland: 0.64, coastal: 0.48, wetland: 0.72, alpine: 0.3, tundra: 0.22, riverine: 0.58, steppe: 0.42, desert: 0.12, unknown: 0.35 }[normalizedBiome] ?? 0.35;
  const slopePenalty = clamp01((slope - 18) / 44);
  const moistureFit = clamp01(0.55 + moisture * 0.55);
  const altitudePenalty = clamp01((elevation01 - 0.9) / 0.1);
  const roadClearing = clamp01((18 - roadDistance) / 18);
  const settlementClearing = clamp01((28 - settlementDistance) / 28);
  const waterBoost = waterDistance < 36 ? clamp01(1 - waterDistance / 36) * 0.18 : 0;
  const density = base * (1 - slopePenalty * 0.72) * moistureFit * (1 - altitudePenalty * 0.65) * (1 - roadClearing * 0.6) * (1 - settlementClearing * 0.45) + waterBoost;
  return deepFreeze({ density: round(clamp(density, 0, 1)), canopy: round(clamp(density * (normalizedBiome === 'forest' ? 1.15 : 0.72), 0, 1)), shrub: round(clamp(density * (1.02 - elevation01 * 0.35), 0, 1)), groundDetail: round(clamp(0.34 + moisture * 0.34 + density * 0.4, 0, 1)), clearingRadius: round(2 + roadClearing * 20 + settlementClearing * 15) });
}

export function createStreamingPlanV63({ cameraDistance = 500, visibleChunks = 16, residentChunks = 36, vegetationInstances = 800, textureMemoryMb = 320, mobile = false } = {}) {
  const distance = clamp(cameraDistance, 1, 20000);
  const visible = clamp(visibleChunks, 1, 512);
  const resident = clamp(residentChunks, visible, 1024);
  const instanceCap = mobile ? 640 : 1536;
  const textureCap = mobile ? 512 : 768;
  return deepFreeze({
    lodBand: distance <= 220 ? 'near' : distance <= 900 ? 'mid' : distance <= 2400 ? 'far' : 'impostor',
    visibleChunks: visible,
    residentChunks: resident,
    cacheMargin: resident - visible,
    chunkCulling: true,
    frustumCulling: true,
    maxVegetationInstances: instanceCap,
    maxTextureMemoryMb: textureCap,
    overBudget: vegetationInstances > instanceCap || textureMemoryMb > textureCap,
    actions: Object.freeze([
      ...(vegetationInstances > instanceCap ? ['reduce-vegetation-batch'] : []),
      ...(textureMemoryMb > textureCap ? ['drop-distant-mips'] : []),
      ...(resident - visible < 4 ? ['increase-prefetch-margin'] : []),
    ]),
  });
}

export function createParityDiagnosticsV63({ canonicalHeight = 0, renderedHeight = 0, colliderHeight = 0, canonicalX = 0, canonicalZ = 0, renderedX = 0, renderedZ = 0, colliderX = 0, colliderZ = 0, toleranceMeters = 0.25 } = {}) {
  const visualHeightDelta = Math.abs(renderedHeight - canonicalHeight);
  const colliderHeightDelta = Math.abs(colliderHeight - canonicalHeight);
  const visualPlanDelta = Math.hypot(renderedX - canonicalX, renderedZ - canonicalZ);
  const colliderPlanDelta = Math.hypot(colliderX - canonicalX, colliderZ - canonicalZ);
  return deepFreeze({
    visualHeightDelta: round(visualHeightDelta, 4),
    colliderHeightDelta: round(colliderHeightDelta, 4),
    visualPlanDelta: round(visualPlanDelta, 4),
    colliderPlanDelta: round(colliderPlanDelta, 4),
    visualPass: visualHeightDelta <= toleranceMeters && visualPlanDelta <= toleranceMeters,
    colliderPass: colliderHeightDelta <= toleranceMeters && colliderPlanDelta <= toleranceMeters,
    sameCoordinate: visualHeightDelta <= toleranceMeters && colliderHeightDelta <= toleranceMeters && visualPlanDelta <= toleranceMeters && colliderPlanDelta <= toleranceMeters,
  });
}

export function createNaturalTransformV63({ assetId = 'asset', x = 0, z = 0, seed = 'v63-transform', minScale = 0.82, maxScale = 1.18 } = {}) {
  const scaleSeed = parseInt(hash(`${seed}:${assetId}:${x}:${z}:scale`), 16) / 0xffffffff;
  const yawSeed = parseInt(hash(`${seed}:${assetId}:${x}:${z}:yaw`), 16) / 0xffffffff;
  const leanSeed = parseInt(hash(`${seed}:${assetId}:${x}:${z}:lean`), 16) / 0xffffffff;
  return deepFreeze({
    scale: round(minScale + (maxScale - minScale) * scaleSeed),
    yawRadians: round(yawSeed * Math.PI * 2),
    leanRadians: round((leanSeed - 0.5) * 0.12),
    deterministicKey: hash(`${assetId}:${x}:${z}:${seed}`),
  });
}

export function createShorelineBandProfileV63({ waterClass = 'sea', distance = 10, depth = 5, wetEdge = 0.6, foam = 0.2 } = {}) {
  const normalized = normalizeSet(waterClass, WATER);
  if (!['sea', 'lake', 'river'].includes(normalized)) return deepFreeze({ recognized: false, class: normalized, bands: Object.freeze([]), failure: 'unrecognized-hydrology' });
  const shore = clamp01(1 - distance / 36);
  const shallow = clamp01(1 - depth / 18);
  const labels = ['foam', 'wet', 'shallow', 'dry-transition'];
  const widths = normalized === 'river' ? [1.5, 4, 8, 15] : normalized === 'lake' ? [2, 5, 11, 22] : [2, 6, 14, 28];
  return deepFreeze({ recognized: true, class: normalized, bands: Object.freeze(widths.map((width, index) => Object.freeze({ label: labels[index], widthMeters: width, weight: round(clamp01(shore * (1 - index * 0.18) + shallow * 0.12 + wetEdge * 0.22 + foam * 0.18)) }))), deepWeight: round(clamp01(1 - shallow)), shallowWeight: round(shallow), antiHalo: round(clamp(0.45 + shore * 0.38, 0, 1)) });
}

export function getV63ContractSummary() {
  return deepFreeze({
    id: V63_CONTRACT.id,
    owner: V63_CONTRACT.owner,
    canonicalExtent: `${V63_CONTRACT.canonicalExtent.width}x${V63_CONTRACT.canonicalExtent.height}`,
    acceptanceResolution: `${V63_CONTRACT.acceptanceCamera.width}x${V63_CONTRACT.acceptanceCamera.height}`,
    orthographicDegrees: V63_CONTRACT.acceptanceCamera.orthographicDegrees,
    sharedPlacementAuthority: V63_CONTRACT.sharedPlacement,
    readOnly: true,
    domFree: true,
    createsGeometry: false,
    hydratesAssets: false,
    importsEditorUi: false,
  });
}

export const V63_WORLD_QUERY_API = Object.freeze({
  getGround: createGroundQueryV63,
  getRuntimePlan: createGroundedVisualRuntimeV63,
  compareBeforeAfter: createBeforeAfterComparisonV63,
  waterOptics: createWaterOpticalResponseV63,
  terrainBreakup: createTerrainBreakupFieldV63,
  habitatDensity: createHabitatDensityV63,
  streaming: createStreamingPlanV63,
  parity: createParityDiagnosticsV63,
  naturalTransform: createNaturalTransformV63,
  shorelineBands: createShorelineBandProfileV63,
});
