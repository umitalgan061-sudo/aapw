/**
 * Buzul Muhafizi V64 - biome-aware environment dressing runtime.
 *
 * Read-only production intent for already-canonical terrain observations.
 * It turns geographic context into natural clustered dressing choices without
 * creating geometry, changing terrain/hydrology/collider state, or owning asset
 * loading. Model-bearing callers remain on the merged #590 shared placement core.
 */

export const V64_CONTRACT = Object.freeze({
  id: 'buzul-muhafizi-environment-dressing-runtime-v64-20260914',
  version: 64,
  owner: 'Buzul Muhafizi',
  canonicalExtent: Object.freeze({ width: 9000, height: 7000 }),
  acceptance: Object.freeze({ width: 1536, height: 1024, orthographicDegrees: 90 }),
  sharedPlacement: Object.freeze({
    materialCore: 'src/3d/materials/MaterialAssignmentCore.js',
    placementPipeline: 'src/3d/world/WorldAssetPlacementPipeline.js',
    successorPr: 590,
  }),
  limits: Object.freeze({
    maxSamples: 2048,
    maxDressing: 192,
    maxClusterRadiusMeters: 160,
    minGroundConfidence: 0.72,
    maxSlopeDegrees: 72,
  }),
});

const BIOMES = new Set([
  'temperate', 'forest', 'taiga', 'wetland', 'coastal', 'riverine',
  'steppe', 'grassland', 'shrubland', 'alpine', 'tundra', 'desert', 'unknown',
]);
const WATER = new Set(['sea', 'lake', 'river', 'land', 'unknown']);
const SURFACES = new Set(['grass', 'soil', 'mud', 'sand', 'rock', 'scree', 'snow', 'ice', 'wet', 'shore', 'water', 'road', 'settlement', 'unknown']);
const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const asText = (v, fallback) => typeof v === 'string' && v.trim() ? v.trim() : fallback;
const asId = (v, fallback = 'unknown') => asText(v, fallback).slice(0, 96);
const round = (v, p = 6) => {
  const factor = 10 ** p;
  return Math.round((Number.isFinite(v) ? v : 0) * factor) / factor;
};

function classify(value, set) {
  const normalized = asText(value, 'unknown').toLowerCase();
  return set.has(normalized) ? normalized : 'unknown';
}

function hashString(value) {
  let h = 2166136261;
  const source = String(value);
  for (let i = 0; i < source.length; i += 1) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function seededUnit(seed, index, salt = '') {
  return Number.parseInt(hashString(`${seed}|${index}|${salt}`), 16) / 0xffffffff;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
  return value;
}

function normalizeTerrain(terrain = {}) {
  return Object.freeze({
    x: Number.isFinite(terrain.x) ? terrain.x : 0,
    y: Number.isFinite(terrain.y) ? terrain.y : Number.isFinite(terrain.height) ? terrain.height : 0,
    z: Number.isFinite(terrain.z) ? terrain.z : 0,
    height: Number.isFinite(terrain.height) ? terrain.height : 0,
    canonicalHeight: Number.isFinite(terrain.canonicalHeight) ? terrain.canonicalHeight : Number.isFinite(terrain.height) ? terrain.height : 0,
    colliderHeight: Number.isFinite(terrain.colliderHeight) ? terrain.colliderHeight : Number.isFinite(terrain.height) ? terrain.height : 0,
    slope: clamp(terrain.slope, 0, 89.9),
    moisture: clamp01(terrain.moisture),
    elevation01: clamp01(terrain.elevation01),
    snowWeight: clamp01(terrain.snowWeight),
    relief: clamp01(terrain.relief ?? terrain.localRelief ?? 0.45),
    curvature: clamp(terrain.curvature ?? 0, -1, 1),
    biome: classify(terrain.biome, BIOMES),
    surface: classify(terrain.surface, SURFACES),
    source: asText(terrain.canonicalSource, 'canonical-owner-map'),
    terrainBackend: asText(terrain.terrainBackend, 'unknown'),
    regionId: asId(terrain.regionId),
  });
}

function normalizeWater(water = {}) {
  return Object.freeze({
    class: classify(water.waterClass ?? water.class, WATER),
    distance: clamp(water.waterDistance ?? water.distance, 0, 50000),
    depth: clamp(water.depth, 0, 2000),
    shoreline: clamp01(water.shorelineWeight),
    wetEdge: clamp01(water.wetEdgeWeight),
    foam: clamp01(water.foamWeight),
    cyanRisk: clamp01(water.cyanRisk),
    moireRisk: clamp01(water.moireRisk),
    rectangular: water.rectangular === true,
    repeatedStripe: water.repeatedStripe === true,
    seamRisk: clamp01(water.seamRisk),
  });
}

function normalizeMaterial(material = {}) {
  return Object.freeze({
    role: classify(material.role, SURFACES),
    multiSurface: material.multiSurface !== false,
    placeholder: material.placeholder === true,
    missing: material.missing === true,
    roughness: clamp01(material.roughness ?? 0.75),
    macroContrast: clamp01(material.macroContrast ?? 0.55),
    microDetail: clamp01(material.microDetail ?? 0.55),
  });
}

function normalizeVegetation(point = {}) {
  return Object.freeze({
    assetId: asId(point.assetId),
    category: asText(point.category, 'unknown').toLowerCase(),
    x: Number.isFinite(point.x) ? point.x : 0,
    y: Number.isFinite(point.y) ? point.y : 0,
    z: Number.isFinite(point.z) ? point.z : 0,
    slope: clamp(point.slope, 0, 89.9),
    moisture: clamp01(point.moisture),
    height01: clamp01(point.height01),
    scale: clamp(point.scale ?? 1, 0.05, 20),
    grounded: point.grounded === true,
    groundConfidence: clamp01(point.groundConfidence ?? 1),
    distanceToWater: clamp(point.distanceToWater, 0, 50000),
    roadDistance: clamp(point.roadDistance, 0, 50000),
    settlementDistance: clamp(point.settlementDistance, 0, 50000),
    permanentSnow: point.permanentSnow === true,
    cliff: point.cliff === true,
    instanceBatch: asId(point.instanceBatch, 'default'),
  });
}

function normalizeObservation(observation = {}) {
  const terrain = normalizeTerrain(observation.terrain);
  return Object.freeze({
    sampleId: asId(observation.sampleId, 'sample'),
    seed: asId(observation.seed, 'v64-seed'),
    terrain,
    water: normalizeWater(observation.water),
    material: normalizeMaterial(observation.material),
    vegetation: (Array.isArray(observation.vegetation) ? observation.vegetation : [])
      .slice(0, V64_CONTRACT.limits.maxSamples)
      .map(normalizeVegetation),
    camera: Object.freeze({
      profile: asText(observation.camera?.profile, 'terrain-near'),
      width: clamp(observation.camera?.width ?? 1536, 256, 4096),
      height: clamp(observation.camera?.height ?? 1024, 256, 4096),
      orthographicDegrees: clamp(observation.camera?.orthographicDegrees ?? 90, 30, 120),
      distance: clamp(observation.camera?.distance ?? 420, 0.1, 20000),
      targetX: Number.isFinite(observation.camera?.targetX) ? observation.camera.targetX : terrain.x,
      targetY: Number.isFinite(observation.camera?.targetY) ? observation.camera.targetY : terrain.y,
      targetZ: Number.isFinite(observation.camera?.targetZ) ? observation.camera.targetZ : terrain.z,
      seed: asId(observation.camera?.seed, 'v64-camera'),
    }),
    renderedY: Number.isFinite(observation.renderedY) ? observation.renderedY : terrain.height,
    colliderY: Number.isFinite(observation.colliderY) ? observation.colliderY : terrain.colliderHeight,
    postProcessed: observation.postProcessed === true,
    editorRuntimeImported: observation.editorRuntimeImported === true,
    primitiveGeometry: observation.primitiveGeometry === true,
  });
}

function habitatProfile(terrain, water) {
  const wet = clamp01((terrain.moisture - 0.35) / 0.55);
  const dry = clamp01((0.72 - terrain.moisture) / 0.72);
  const cold = Math.max(terrain.snowWeight, terrain.elevation01 * 0.78);
  const rocky = clamp01((terrain.slope - 18) / 45);
  const shore = water.class !== 'land' && water.class !== 'unknown'
    ? clamp01(1 - water.distance / 80)
    : 0;

  const profile = {
    canopy: 0.34,
    shrub: 0.18,
    grass: 0.38,
    fern: 0.1,
    rock: 0.08,
    scree: 0,
    wetEdge: shore * 0.8,
    snowAccent: cold * 0.7,
  };

  if (terrain.biome === 'forest' || terrain.biome === 'taiga') {
    profile.canopy += 0.42;
    profile.shrub += 0.12;
    profile.fern += wet * 0.18;
  }
  if (terrain.biome === 'wetland' || terrain.biome === 'riverine') {
    profile.wetEdge += 0.24;
    profile.grass += wet * 0.14;
    profile.shrub += wet * 0.08;
  }
  if (terrain.biome === 'coastal') {
    profile.grass += 0.08;
    profile.shrub += dry * 0.1;
    profile.wetEdge += shore * 0.2;
  }
  if (terrain.biome === 'alpine' || terrain.biome === 'tundra') {
    profile.canopy *= 0.22;
    profile.grass *= 0.58;
    profile.shrub *= 0.72;
    profile.rock += rocky * 0.5;
    profile.scree += rocky * 0.65;
    profile.snowAccent += cold * 0.22;
  }
  if (terrain.biome === 'steppe' || terrain.biome === 'grassland') {
    profile.canopy *= 0.38;
    profile.grass += 0.28;
    profile.shrub += dry * 0.14;
  }
  if (terrain.biome === 'desert') {
    profile.canopy *= 0.04;
    profile.grass *= 0.12;
    profile.shrub *= 0.25;
    profile.rock += 0.2;
    profile.scree += rocky * 0.28;
  }

  const slopeSuppression = clamp01((terrain.slope - 38) / 32);
  profile.canopy *= 1 - slopeSuppression * 0.86;
  profile.grass *= 1 - slopeSuppression * 0.32;
  profile.shrub *= 1 - slopeSuppression * 0.54;
  profile.rock += slopeSuppression * 0.18;

  const total = Object.values(profile).reduce((sum, value) => sum + value, 0) || 1;
  return Object.freeze(Object.fromEntries(
    Object.entries(profile).map(([key, value]) => [key, round(Math.max(0, value) / total)]),
  ));
}

function surfaceTreatment(terrain, water, material) {
  const slopeRock = clamp01((terrain.slope - 20) / 48);
  const snow = Math.max(terrain.snowWeight, clamp01((terrain.elevation01 - 0.7) / 0.3));
  const shoreline = water.class !== 'land' && water.class !== 'unknown'
    ? clamp01(1 - water.distance / 32)
    : 0;
  const wet = clamp01(terrain.moisture * 0.78 + water.wetEdge * 0.36);
  const breakup = round(0.38 + terrain.relief * 0.36 + material.macroContrast * 0.26);
  return Object.freeze({
    grass: round((1 - slopeRock) * (1 - snow) * (1 - wet * 0.3)),
    soil: round((0.22 + terrain.moisture * 0.44) * (1 - slopeRock * 0.55)),
    mud: round(terrain.moisture * 0.46),
    rock: round(Math.max(slopeRock, terrain.curvature > 0.5 ? 0.2 : 0) * (1 - snow * 0.5)),
    scree: round(slopeRock * (0.35 + terrain.elevation01 * 0.65)),
    snow: round(snow * (0.7 + terrain.relief * 0.3)),
    wet: round(wet * 0.55),
    shore: round(shoreline * 0.8),
    breakup,
    antiTilingPhase: round(Math.sin(terrain.x * 0.0019 + terrain.z * 0.0027 + terrain.height * 0.00031)),
    normalEnergy: round(clamp(0.54 + material.microDetail * 0.4 + breakup * 0.16, 0.15, 1.25)),
  });
}

function waterTreatment(water) {
  if (water.class === 'land' || water.class === 'unknown') {
    return Object.freeze({ recognized: true, class: water.class, deep: 0, shallow: 0, shore: 0, wetEdge: 0, foam: 0, cyanSuppression: 1, moireSuppression: 1, rectangularRisk: water.rectangular ? 1 : 0 });
  }
  const shore = clamp01(1 - water.distance / 36);
  const shallow = clamp01(1 - water.depth / 14);
  const deep = 1 - shallow;
  return Object.freeze({
    recognized: true,
    class: water.class,
    deep: round(deep),
    shallow: round(shallow),
    shore: round(shore),
    wetEdge: round(Math.max(shore, water.wetEdge)),
    foam: round(clamp01(water.foam + shore * 0.24)),
    cyanSuppression: round(clamp01(0.32 + water.cyanRisk * 0.68)),
    moireSuppression: round(clamp01(0.26 + water.moireRisk * 0.74)),
    rectangularRisk: water.rectangular ? 1 : 0,
    stripeRisk: water.repeatedStripe ? 1 : 0,
    seamRisk: water.seamRisk,
  });
}

function placementEligibility(point, terrain, water, roads = {}, settlements = {}) {
  const reasons = [];
  if (!point.grounded || point.groundConfidence < V64_CONTRACT.limits.minGroundConfidence) reasons.push('ungrounded');
  if (point.slope > V64_CONTRACT.limits.maxSlopeDegrees || point.cliff) reasons.push('steep-cliff');
  if (point.permanentSnow && !['rock', 'scree', 'ice'].includes(point.category)) reasons.push('permanent-snow');
  const waterDistance = Number.isFinite(point.distanceToWater) ? point.distanceToWater : water.distance;
  if (water.class !== 'land' && water.class !== 'unknown' && waterDistance < 7) reasons.push('water-buffer');
  const roadDistance = Number.isFinite(point.roadDistance) ? point.roadDistance : roads.distance;
  if (Number.isFinite(roadDistance) && roadDistance < 3) reasons.push('road-buffer');
  const settlementDistance = Number.isFinite(point.settlementDistance) ? point.settlementDistance : settlements.distance;
  if (Number.isFinite(settlementDistance) && settlementDistance < 8) reasons.push('settlement-buffer');
  return Object.freeze({ eligible: reasons.length === 0, reasons });
}

function dressingCandidate(point, terrain, water, index, seed) {
  const habitat = habitatProfile(terrain, water);
  const category = point.category;
  const family = category === 'tree'
    ? (terrain.biome === 'taiga' || terrain.biome === 'alpine' ? 'conifer' : 'broadleaf')
    : category === 'shrub'
      ? 'shrub'
      : category === 'grass'
        ? 'grass'
        : category === 'fern'
          ? 'fern'
          : category === 'rock' || category === 'scree'
            ? category
            : 'ground-detail';
  const habitatWeight = habitat[
    category === 'tree' ? 'canopy' :
    category === 'shrub' ? 'shrub' :
    category === 'grass' ? 'grass' :
    category === 'fern' ? 'fern' :
    category === 'scree' ? 'scree' :
    category === 'rock' ? 'rock' : 'grass'
  ] ?? 0;
  const variance = 0.86 + seededUnit(seed, index, 'variance') * 0.28;
  const yaw = round((seededUnit(seed, index, 'yaw') * 2 - 1) * Math.PI);
  const scale = round(clamp((point.scale || 1) * variance, 0.55, 1.65));
  const eligibility = placementEligibility(point, terrain, water);
  return Object.freeze({
    assetId: point.assetId,
    family,
    category,
    habitatWeight: round(habitatWeight),
    eligible: eligibility.eligible,
    reasons: eligibility.reasons,
    transform: Object.freeze({
      x: round(point.x),
      y: round(point.y),
      z: round(point.z),
      yaw,
      scale,
    }),
    instanceBatch: point.instanceBatch,
    pbrRole: category === 'tree' ? 'bark-leaves' : category === 'rock' ? 'rock-moss' : category,
  });
}

function naturalCluster(point, index, seed, radius = 42) {
  const count = 2 + Math.floor(seededUnit(seed, index, 'count') * 4);
  const members = [];
  for (let memberIndex = 0; memberIndex < count; memberIndex += 1) {
    const angle = seededUnit(seed, index * 31 + memberIndex, 'angle') * Math.PI * 2;
    const distance = Math.sqrt(seededUnit(seed, index * 31 + memberIndex, 'distance')) * radius;
    members.push(Object.freeze({
      x: round(point.x + Math.cos(angle) * distance),
      z: round(point.z + Math.sin(angle) * distance),
      weight: round(0.68 + seededUnit(seed, index * 31 + memberIndex, 'weight') * 0.32),
    }));
  }
  return Object.freeze({
    anchor: Object.freeze({ x: round(point.x), z: round(point.z) }),
    radius: round(radius),
    members: Object.freeze(members),
  });
}

function lodFor(cameraDistance, category) {
  const bias = category === 'tree' ? 0 : category === 'shrub' ? 1 : 1;
  if (cameraDistance < 180) return Math.max(0, bias);
  if (cameraDistance < 700) return Math.max(1, bias + 1);
  if (cameraDistance < 1800) return Math.max(2, bias + 1);
  return 3;
}

function batchDressing(items, cameraDistance) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.family}|${item.instanceBatch}|lod${lodFor(cameraDistance, item.category)}`;
    const list = groups.get(key) ?? [];
    if (list.length < 2048) list.push(item);
    groups.set(key, list);
  }
  return Object.freeze([...groups.entries()].map(([key, list]) => Object.freeze({
    key,
    count: list.length,
    family: list[0]?.family ?? 'unknown',
    instanceBatch: list[0]?.instanceBatch ?? 'default',
    lod: lodFor(cameraDistance, list[0]?.category),
    instanced: list.length >= 2,
    assetCount: new Set(list.map((item) => item.assetId)).size,
  })));
}

function p0Risk(observation) {
  const water = observation.water;
  return Object.freeze({
    seam: water.seamRisk > 0.2 ? 1 : 0,
    rectangularWater: water.rectangular ? 1 : 0,
    moire: water.moireRisk > 0.2 || water.repeatedStripe ? 1 : 0,
    cyan: water.cyanRisk > 0.2 ? 1 : 0,
    postProcessed: observation.postProcessed ? 1 : 0,
  });
}

function parity(observation) {
  const canonicalRender = Math.abs(observation.renderedY - observation.terrain.canonicalHeight);
  const canonicalCollider = Math.abs(observation.colliderY - observation.terrain.canonicalHeight);
  const renderCollider = Math.abs(observation.renderedY - observation.colliderY);
  return Object.freeze({
    canonicalRenderMeters: round(canonicalRender),
    canonicalColliderMeters: round(canonicalCollider),
    renderColliderMeters: round(renderCollider),
    pass: canonicalRender <= 0.35 && canonicalCollider <= 0.35 && renderCollider <= 0.35,
  });
}

function p5(observation) {
  const camera = observation.camera;
  const lumaFloor = observation.backgroundLuminance;
  return Object.freeze({
    cameraRelative: camera.profile !== 'legacy-static',
    width: camera.width,
    height: camera.height,
    orthographicDegrees: camera.orthographicDegrees,
    readableBackground: !Number.isFinite(lumaFloor) || lumaFloor >= 0.08,
    blackSky: Number.isFinite(lumaFloor) && lumaFloor < 0.04 ? 1 : 0,
    fogRangeMeters: round(Math.max(160, camera.distance * 0.72)),
  });
}

export function normalizeV64Observation(observation) {
  return normalizeObservation(observation);
}

export function createEnvironmentDressingRuntimeV64(observation, options = {}) {
  const input = normalizeObservation(observation);
  const terrain = input.terrain;
  const water = input.water;
  const material = input.material;
  const p0 = p0Risk(input);
  const terrainSurface = surfaceTreatment(terrain, water, material);
  const waterSurface = waterTreatment(water);
  const geometry = parity(input);
  const profile = habitatProfile(terrain, water);
  const candidates = input.vegetation
    .map((point, index) => dressingCandidate(point, terrain, water, index, input.seed))
    .filter((item) => item.eligible);
  const maxDressing = Math.min(options.maxDressing ?? V64_CONTRACT.limits.maxDressing, V64_CONTRACT.limits.maxDressing);
  const selected = candidates.slice(0, maxDressing);
  const rejected = input.vegetation.length - selected.length;
  const clusters = selected.slice(0, 48).map((item, index) => naturalCluster(item.transform, index, input.seed, options.clusterRadiusMeters ?? 42));
  const batches = batchDressing(selected, input.camera.distance);
  const invalidAsset = input.vegetation.filter((point) => !point.assetId || point.assetId === 'unknown').length;
  const quality = {
    multiSurface: material.multiSurface ? 0 : 1,
    placeholder: material.placeholder ? 1 : 0,
    missingMaterial: material.missing ? 1 : 0,
    primitiveGeometry: input.primitiveGeometry ? 1 : 0,
    invalidPlacement: input.vegetation.length - selected.length,
  };
  const riskPenalty = Object.values(p0).reduce((sum, value) => sum + value, 0) +
    (geometry.pass ? 0 : 1) +
    Object.values(quality).reduce((sum, value) => sum + value, 0);
  const riskScore = round(riskPenalty / 10);
  const fingerprint = hashString(JSON.stringify({
    id: input.sampleId,
    terrain,
    water,
    material,
    profile,
    selected,
    batches,
    p0,
    geometry,
  }));

  return freezeDeep({
    contract: V64_CONTRACT.id,
    sampleId: input.sampleId,
    seed: input.seed,
    canonical: Object.freeze({
      extent: V64_CONTRACT.canonicalExtent,
      source: terrain.source,
      terrainBackend: terrain.terrainBackend,
      regionId: terrain.regionId,
    }),
    p0,
    p1: Object.freeze({
      parity: geometry,
      geology: Object.freeze({
        cliffWall: terrain.slope >= 72 ? 1 : 0,
        relief: round(terrain.relief),
        rockExposure: round(clamp01((terrain.slope - 24) / 52 + terrain.curvature * 0.18)),
        talus: round(clamp01((terrain.slope - 38) / 42) * (0.35 + terrain.elevation01 * 0.65)),
        snowSheet: terrain.snowWeight > 0.9 && terrain.relief < 0.15 ? 1 : 0,
      }),
    }),
    p2: Object.freeze({
      surfaces: terrainSurface,
      pbr: Object.freeze({
        roughness: round(clamp01(material.roughness * (0.88 + terrain.moisture * 0.16))),
        macroContrast: round(clamp01(material.macroContrast * (0.76 + terrain.relief * 0.48))),
        microDetail: round(clamp01(material.microDetail * (0.72 + terrain.relief * 0.38))),
      }),
    }),
    p3: Object.freeze({
      habitat: profile,
      eligibleCount: selected.length,
      rejectedCount: rejected,
      invalidAsset,
      dressing: selected,
      clusters,
      batches,
    }),
    p4: Object.freeze({ water: waterSurface }),
    p5: p5(input),
    quality: Object.freeze(quality),
    performance: Object.freeze({
      cameraDistance: input.camera.distance,
      dressingCount: selected.length,
      batchCount: batches.length,
      estimatedDrawCalls: Math.min(96, batches.length * 2 + 4),
      instancingRatio: selected.length > 0 ? round(batches.filter((item) => item.instanced).length / batches.length) : 0,
      lodFloor: selected.length > 0 ? Math.min(...selected.map((item) => lodFor(input.camera.distance, item.category))) : 0,
    }),
    riskScore,
    sharedPlacement: Object.freeze({
      sequence: Object.freeze([
        'asset-hydrate-load',
        'surface-analysis',
        'multi-material-recipe',
        'validateMaterialAssignment',
        'ground-transform',
        'placement-manifest',
        'scene-attach',
      ]),
      materialCore: V64_CONTRACT.sharedPlacement.materialCore,
      placementPipeline: V64_CONTRACT.sharedPlacement.placementPipeline,
      editorRuntimeImport: false,
    }),
    fingerprint,
  });
}

export function validateEnvironmentDressingRuntimeV64(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') errors.push('plan-not-object');
  if (plan?.contract !== V64_CONTRACT.id) errors.push('contract-mismatch');
  if (plan?.quality?.placeholder) errors.push('placeholder-material');
  if (plan?.quality?.missingMaterial) errors.push('missing-material');
  if (plan?.quality?.primitiveGeometry) errors.push('primitive-geometry');
  if ((plan?.p0?.seam ?? 0) !== 0) errors.push('seam-visible');
  if ((plan?.p0?.rectangularWater ?? 0) !== 0) errors.push('rectangular-water');
  if ((plan?.p0?.moire ?? 0) !== 0) errors.push('water-moire');
  if ((plan?.p0?.cyan ?? 0) !== 0) errors.push('cyan-water');
  if (plan?.p1?.parity?.pass !== true) errors.push('terrain-collider-parity');
  if (plan?.p5?.blackSky !== 0) errors.push('black-sky');
  if (plan?.sharedPlacement?.editorRuntimeImport) errors.push('editor-runtime-import');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function createV64AcceptanceProfiles(seed = 'v64-acceptance') {
  const profiles = [
    ['full-world', 7000],
    ['far', 3600],
    ['terrain-near-center', 420],
    ['terrain-near-northwest', 360],
  ];
  return Object.freeze(profiles.map(([profile, distance], index) => Object.freeze({
    sampleId: `${profile}-${index}`,
    seed,
    width: 1536,
    height: 1024,
    orthographicDegrees: 90,
    distance,
    comparable: true,
  })));
}

export function compareV64AcceptanceBeforeAfter(before, after) {
  const a = normalizeObservation(before);
  const b = normalizeObservation(after);
  return Object.freeze({
    sameSeed: a.seed === b.seed,
    sameCamera: JSON.stringify(a.camera) === JSON.stringify(b.camera),
    sameCoordinate: a.terrain.x === b.terrain.x && a.terrain.z === b.terrain.z,
    materialImprovement: round(
      (b.material.macroContrast + b.material.microDetail) -
      (a.material.macroContrast + a.material.microDetail),
    ),
    fingerprintBefore: hashString(JSON.stringify(a)),
    fingerprintAfter: hashString(JSON.stringify(b)),
  });
}

export function createV64WorldQueryCapabilities() {
  return Object.freeze({
    ground: Object.freeze(['height', 'normal', 'slope', 'canonicalSource', 'colliderParity']),
    water: Object.freeze(['class', 'depth', 'distance', 'shorelineWeight', 'wetEdgeWeight']),
    biome: Object.freeze(['biome', 'moisture', 'elevation01', 'snowWeight', 'relief']),
    placement: Object.freeze(['groundConfidence', 'waterBuffer', 'roadBuffer', 'settlementBuffer', 'eligible']),
    navigation: Object.freeze(['slope', 'grounded', 'cliff']),
  });
}

export function createV64EvidenceSummary(plan) {
  return freezeDeep({
    contract: plan.contract,
    cameraProfiles: createV64AcceptanceProfiles(plan.seed),
    targets: Object.freeze({
      visibleSeams: plan.p0.seam,
      rectangularWater: plan.p0.rectangularWater,
      moire: plan.p0.moire,
      missingAsset: plan.p3.invalidAsset,
      invalidPlacement: plan.p3.rejectedCount,
      blackSky: plan.p5.blackSky,
      parityPass: plan.p1.parity.pass,
      primitiveGeometry: plan.quality.primitiveGeometry,
    }),
    dressing: Object.freeze({
      eligible: plan.p3.eligibleCount,
      clusters: plan.p3.clusters.length,
      batches: plan.p3.batches.length,
      instancingRatio: plan.performance.instancingRatio,
    }),
    fingerprint: plan.fingerprint,
  });
}

export function getV64ContractSummary() {
  return Object.freeze({
    id: V64_CONTRACT.id,
    scope: 'biome-aware environment dressing + grounded visual quality',
    assets: 'caller-owned / asset-first',
    geometry: 'none created',
    canonicalMutation: false,
    sharedMaterialPlacement: V64_CONTRACT.sharedPlacement,
    acceptance: V64_CONTRACT.acceptance,
  });
}
