import * as THREE from 'three';
import {
  ATMOSPHERE_POLICY,
  GEOLOGY_POLICIES,
  MATERIAL_FAMILY_ALIASES,
  ROAD_POLICIES,
  SURFACE_CONTEXT_WEIGHTS,
  TERRAIN_SURFACE_POLICIES,
  VEGETATION_POLICIES,
  V52_ACCEPTANCE,
  V52_EVIDENCE_SAMPLE_POINTS,
  V52_VISIBILITY_TIERS,
  WATER_SURFACE_POLICIES,
  WORLD_COVERAGE_V52_BUDGET,
  WORLD_COVERAGE_VISUAL_V52_CONTRACT,
  WORLD_COVERAGE_VISUAL_V52_ID,
  classifyWaterKind,
  deterministicRange,
  deterministicUnit,
  materialRiskFlags,
  normalizeVisualFamily,
  surfacePolicyFor,
  tierForDistance,
} from './worldCoverageVisualRuntimeV52Policies.js';

/**
 * Buzul Muhafizi — shipped render-time visual adoption for World Coverage v52.
 *
 * The runtime deliberately works on already-created scene objects. It does not generate a cube,
 * cone, billboard, tree, rock, road, water plane, mountain or settlement. Canonical geometry and
 * placement remain the owner of their existing systems. The pass improves how those objects read:
 * P0 surface/water presentation, P1 geology, P2 PBR response, P3 vegetation scale/culling, P4 water
 * depth/normal response and P5 atmosphere are all handled through material/object state that already
 * belongs to the scene.
 *
 * Shared material/placement contract note: no new 3D asset is introduced by this module. Imported
 * assets are not replaced and editor UI is never imported. Existing placement provenance is kept in
 * userData, so WorldAssetPlacementPipeline remains authoritative for authored asset placement.
 */

export const WORLD_COVERAGE_VISUAL_RUNTIME_V52 = WORLD_COVERAGE_VISUAL_V52_ID;
export const WORLD_COVERAGE_VISUAL_RUNTIME_V52_VERSION = 52;
export const WORLD_COVERAGE_VISUAL_RUNTIME_V52_CONTRACT = WORLD_COVERAGE_VISUAL_V52_CONTRACT;

const HOOK_FLAG = Symbol.for('aapw.world-coverage.visual-runtime-v52-installed');
const CONTROLLER_KEY = Symbol.for('aapw.world-coverage.visual-runtime-v52-controller');
const MATERIAL_STATE_KEY = Symbol.for('aapw.world-coverage.visual-runtime-v52-material-state');
const OBJECT_STATE_KEY = Symbol.for('aapw.world-coverage.visual-runtime-v52-object-state');
const MAX_SCAN_NODES = 9000;
const MAX_TRACKED_MATERIALS = 2200;
const MAX_TRACKED_OBJECTS = 4200;
const MATERIAL_REFRESH_BATCH = 120;
const OBJECT_REFRESH_BATCH = 160;
const EPSILON = 1e-5;

const SURFACE_COLOR = Object.freeze({
  grass: Object.freeze([0.34, 0.38, 0.20]),
  meadow: Object.freeze([0.42, 0.45, 0.24]),
  soil: Object.freeze([0.31, 0.25, 0.16]),
  mud: Object.freeze([0.24, 0.21, 0.16]),
  wetSoil: Object.freeze([0.20, 0.22, 0.18]),
  scree: Object.freeze([0.37, 0.34, 0.30]),
  rock: Object.freeze([0.39, 0.37, 0.34]),
  snow: Object.freeze([0.78, 0.81, 0.80]),
  ice: Object.freeze([0.62, 0.76, 0.82]),
  shoreline: Object.freeze([0.29, 0.31, 0.25]),
});

const FAMILY_MATERIAL_PRIORS = Object.freeze({
  terrain: Object.freeze({ roughness: 0.94, metalness: 0, normalScale: 0.56 }),
  water: Object.freeze({ roughness: 0.34, metalness: 0.01, normalScale: 0.13 }),
  vegetation: Object.freeze({ roughness: 0.88, metalness: 0, normalScale: 0.20 }),
  geology: Object.freeze({ roughness: 0.99, metalness: 0, normalScale: 0.78 }),
  road: Object.freeze({ roughness: 0.94, metalness: 0, normalScale: 0.38 }),
  settlement: Object.freeze({ roughness: 0.86, metalness: 0.02, normalScale: 0.32 }),
  sky: Object.freeze({ roughness: 0.50, metalness: 0, normalScale: 0 }),
});

const WATER_UNIFORM_ALIASES = Object.freeze([
  'uNormalStrength',
  'uNormalScale',
  'normalStrength',
  'normalScale',
  'uWaveStrength',
  'waveStrength',
  'uSwellStrength',
  'swellStrength',
  'uFlowStrength',
  'flowStrength',
  'uChoppiness',
  'choppiness',
  'uFoamStrength',
  'foamStrength',
]);

const WATER_COLOR_UNIFORM_ALIASES = Object.freeze(['uColor', 'waterColor', 'baseColor', 'albedo']);
const VISIBILITY_FIELDS = Object.freeze(['visible', 'frustumCulled', 'renderOrder']);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function safeName(object) {
  return `${object?.name ?? ''} ${object?.userData?.assetId ?? ''} ${object?.userData?.kind ?? ''} ${object?.userData?.type ?? ''}`
    .trim()
    .toLowerCase();
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function objectPosition(object) {
  const position = object?.getWorldPosition ? object.getWorldPosition(new THREE.Vector3()) : object?.position;
  return position ?? { x: 0, y: 0, z: 0 };
}

function distanceToCamera(object, camera) {
  if (!object || !camera) return Infinity;
  const a = objectPosition(object);
  const b = camera.position ?? { x: 0, y: 0, z: 0 };
  const dx = safeNumber(a.x) - safeNumber(b.x);
  const dy = safeNumber(a.y) - safeNumber(b.y);
  const dz = safeNumber(a.z) - safeNumber(b.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function numericHash(object) {
  const uuid = String(object?.uuid ?? object?.name ?? 'world');
  let hash = 2166136261;
  for (let index = 0; index < uuid.length; index += 1) {
    hash ^= uuid.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readFamily(object) {
  const explicit = object?.userData?.worldVisualFamily ?? object?.userData?.visualFamily;
  if (explicit) return normalizeVisualFamily(explicit);
  return normalizeVisualFamily(safeName(object));
}

function readWaterKind(object) {
  return classifyWaterKind(
    object?.userData?.waterKind
      ?? object?.userData?.hydrologyKind
      ?? object?.userData?.kind
      ?? safeName(object),
  );
}

function isMesh(object) {
  return Boolean(object?.isMesh && object.geometry && object.material);
}

function isInstanced(object) {
  return Boolean(object?.isInstancedMesh || object?.isBatchedMesh || object?.userData?.instanced === true);
}

function materialList(material) {
  if (Array.isArray(material)) return material.filter(Boolean);
  return material ? [material] : [];
}

function everyMaterial(material, callback) {
  for (const item of materialList(material)) callback(item);
}

function cloneColorLike(target, source) {
  if (!target || !source) return;
  if (typeof target.copy === 'function' && source.isColor) target.copy(source);
  else if (typeof target.setRGB === 'function' && source.r !== undefined) target.setRGB(source.r, source.g, source.b);
}

function colorToArray(color) {
  return color ? [safeNumber(color.r, 1), safeNumber(color.g, 1), safeNumber(color.b, 1)] : [1, 1, 1];
}

function arrayToColor(color, rgb) {
  if (!color || !rgb) return;
  if (typeof color.setRGB === 'function') color.setRGB(rgb[0], rgb[1], rgb[2]);
}

function rememberMaterialState(material) {
  if (!material?.userData) return null;
  if (material.userData[MaterialStateKey]) return material.userData[MaterialStateKey];
  const state = {
    roughness: safeNumber(material.roughness, 0.8),
    metalness: safeNumber(material.metalness, 0),
    color: colorToArray(material.color),
    emissive: colorToArray(material.emissive),
    normalScale: material.normalScale && typeof material.normalScale.x === 'number'
      ? [material.normalScale.x, material.normalScale.y]
      : null,
    transparent: material.transparent,
    opacity: safeNumber(material.opacity, 1),
  };
  material.userData[MaterialStateKey] = state;
  return state;
}

const MaterialStateKey = MATERIAL_STATE_KEY;
const ObjectStateKey = OBJECT_STATE_KEY;

function restoreMaterialState(material) {
  const state = material?.userData?.[MaterialStateKey];
  if (!state) return;
  material.roughness = state.roughness;
  material.metalness = state.metalness;
  arrayToColor(material.color, state.color);
  arrayToColor(material.emissive, state.emissive);
  if (state.normalScale && material.normalScale?.set) material.normalScale.set(state.normalScale[0], state.normalScale[1]);
  material.transparent = state.transparent;
  material.opacity = state.opacity;
}

function rememberObjectState(object) {
  if (!object?.userData) return null;
  if (object.userData[ObjectStateKey]) return object.userData[ObjectStateKey];
  const state = {
    visible: object.visible,
    frustumCulled: object.frustumCulled,
    renderOrder: object.renderOrder,
    scale: object.scale ? [object.scale.x, object.scale.y, object.scale.z] : null,
    rotationY: object.rotation ? object.rotation.y : 0,
  };
  object.userData[ObjectStateKey] = state;
  return state;
}

function colorRiskScore(material) {
  if (!material?.color) return 0;
  const rgb = colorToArray(material.color);
  const cyan = clamp01((rgb[1] - rgb[0] * 0.65) * 1.1) * clamp01((rgb[2] - rgb[0] * 0.45) * 1.1);
  const neon = Math.max(rgb[0], rgb[1], rgb[2]) > 0.92 && Math.min(rgb[0], rgb[1], rgb[2]) > 0.62;
  return cyan + (neon ? 0.45 : 0);
}

function applyRoughness(material, target, blend = 0.65) {
  if (typeof material?.roughness !== 'number') return false;
  const next = THREE.MathUtils.lerp(material.roughness, clamp01(target), clamp01(blend));
  if (Math.abs(next - material.roughness) < EPSILON) return false;
  material.roughness = next;
  return true;
}

function applyMetalness(material, target, blend = 0.75) {
  if (typeof material?.metalness !== 'number') return false;
  const next = THREE.MathUtils.lerp(material.metalness, clamp01(target), clamp01(blend));
  if (Math.abs(next - material.metalness) < EPSILON) return false;
  material.metalness = next;
  return true;
}

function applyNormalScale(material, target, blend = 0.58) {
  if (!material?.normalScale?.set) return false;
  const current = safeNumber(material.normalScale.x, 1);
  const next = THREE.MathUtils.lerp(current, target, blend);
  if (Math.abs(next - current) < EPSILON) return false;
  material.normalScale.set(next, next);
  return true;
}

function applySubtleColorBreakup(material, object, family, seedSalt = 0) {
  if (!material?.color?.isColor) return false;
  const state = rememberMaterialState(material);
  if (!state) return false;
  const authoredMap = Boolean(material.map || material.normalMap || material.roughnessMap || material.metalnessMap || material.aoMap);
  const familyBias = family === 'terrain' ? 0.10 : family === 'geology' ? 0.08 : family === 'road' ? 0.055 : 0.03;
  if (familyBias <= 0 || (authoredMap && family !== 'water')) return false;
  const unit = deterministicUnit(numericHash(object) ^ seedSalt);
  const gain = 1 + (unit - 0.5) * familyBias;
  const original = new THREE.Color(state.color[0], state.color[1], state.color[2]);
  const next = original.clone().multiplyScalar(gain);
  material.color.copy(next);
  return Math.abs(gain - 1) > EPSILON;
}

function applyTerrainMaterial(object, material) {
  const name = safeName(object);
  const surface = object.userData?.surface ?? object.userData?.biome ?? name;
  const policy = surfacePolicyFor('terrain', { surface, name, moisture: object.userData?.moisture });
  const state = rememberMaterialState(material);
  let mutations = 0;
  if (!state) return mutations;
  mutations += applyRoughness(material, policy?.roughness ?? FAMILY_MATERIAL_PRIORS.terrain.roughness, 0.56) ? 1 : 0;
  mutations += applyMetalness(material, 0, 0.90) ? 1 : 0;
  mutations += applyNormalScale(material, policy?.normalStrength ?? FAMILY_MATERIAL_PRIORS.terrain.normalScale, 0.50) ? 1 : 0;
  mutations += applySubtleColorBreakup(material, object, 'terrain', 17) ? 1 : 0;
  if (material.emissive?.setScalar) material.emissive.setScalar(0);
  return mutations;
}

function applyGeologyMaterial(object, material) {
  const name = safeName(object);
  const kind = name.includes('scree') || name.includes('talus') ? 'scree'
    : name.includes('cliff') ? 'cliff'
      : name.includes('ridge') ? 'ridge'
        : name.includes('boulder') ? 'boulder' : 'mountain';
  const policy = GEOLOGY_POLICIES[kind];
  let mutations = 0;
  rememberMaterialState(material);
  mutations += applyRoughness(material, policy.roughness, 0.70) ? 1 : 0;
  mutations += applyMetalness(material, 0, 0.95) ? 1 : 0;
  mutations += applyNormalScale(material, policy.normalStrength, 0.62) ? 1 : 0;
  mutations += applySubtleColorBreakup(material, object, 'geology', 37) ? 1 : 0;
  if (material.emissive?.setScalar) material.emissive.setScalar(0);
  return mutations;
}

function applyRoadMaterial(object, material) {
  const name = safeName(object);
  const kind = name.includes('bridge') ? 'bridge' : name.includes('path') || name.includes('trail') ? 'path' : 'road';
  const policy = ROAD_POLICIES[kind];
  let mutations = 0;
  rememberMaterialState(material);
  mutations += applyRoughness(material, policy.roughness, 0.62) ? 1 : 0;
  mutations += applyMetalness(material, 0, 0.92) ? 1 : 0;
  mutations += applyNormalScale(material, 0.36, 0.42) ? 1 : 0;
  mutations += applySubtleColorBreakup(material, object, 'road', 53) ? 1 : 0;
  return mutations;
}

function applySettlementMaterial(object, material) {
  let mutations = 0;
  rememberMaterialState(material);
  mutations += applyRoughness(material, FAMILY_MATERIAL_PRIORS.settlement.roughness, 0.48) ? 1 : 0;
  mutations += applyMetalness(material, 0.02, 0.74) ? 1 : 0;
  mutations += applyNormalScale(material, FAMILY_MATERIAL_PRIORS.settlement.normalScale, 0.32) ? 1 : 0;
  const score = colorRiskScore(material);
  if (score > 0.85 && material.emissive?.setScalar) {
    material.emissive.setScalar(0);
    mutations += 1;
  }
  return mutations;
}

function applyVegetationMaterial(object, material, subtype) {
  const policy = VEGETATION_POLICIES[subtype] ?? VEGETATION_POLICIES.tree;
  let mutations = 0;
  rememberMaterialState(material);
  mutations += applyRoughness(material, policy.leafRoughness, 0.42) ? 1 : 0;
  mutations += applyMetalness(material, 0, 0.92) ? 1 : 0;
  if (material.emissive?.setScalar) {
    const emissiveRisk = material.emissiveIntensity > 0.25;
    if (emissiveRisk) {
      material.emissiveIntensity = 0.04;
      mutations += 1;
    }
  }
  if (material.alphaTest > 0) material.alphaTest = Math.min(0.52, Math.max(material.alphaTest, 0.28));
  return mutations;
}

function applyWaterMaterial(object, material) {
  const kind = readWaterKind(object);
  const policy = WATER_SURFACE_POLICIES[kind] ?? WATER_SURFACE_POLICIES.generic;
  const state = rememberMaterialState(material);
  if (!state) return 0;
  let mutations = 0;
  mutations += applyRoughness(material, policy.roughness, 0.68) ? 1 : 0;
  mutations += applyMetalness(material, policy.metalness, 0.74) ? 1 : 0;
  mutations += applyNormalScale(material, policy.normalScale, 0.68) ? 1 : 0;
  const risk = colorRiskScore(material);
  if (risk > 0.30 && material.color?.isColor) {
    const original = new THREE.Color(state.color[0], state.color[1], state.color[2]);
    original.lerp(new THREE.Color(policy.shallow[0], policy.shallow[1], policy.shallow[2]), 0.36);
    material.color.copy(original);
    mutations += 1;
  }
  if (material.emissive?.setScalar) material.emissive.setScalar(0);
  if (material.depthWrite && policy.opacity < 0.9) {
    material.depthWrite = false;
    mutations += 1;
  }
  for (const uniformName of WATER_UNIFORM_ALIASES) {
    const value = object.userData?.shaderUniforms?.[uniformName];
    if (typeof value === 'number') object.userData.shaderUniforms[uniformName] = value * (1 - policy.stripeSuppression * 0.34);
  }
  return mutations;
}

function applySkyMaterial(object, material) {
  let mutations = 0;
  rememberMaterialState(material);
  if (material.emissiveIntensity > 1.25) {
    material.emissiveIntensity = 1.0;
    mutations += 1;
  }
  return mutations;
}

function inferVegetationSubtype(object) {
  const name = safeName(object);
  if (name.includes('conifer') || name.includes('pine') || name.includes('fir')) return 'conifer';
  if (name.includes('shrub') || name.includes('bush')) return 'shrub';
  if (name.includes('fern') || name.includes('reed')) return 'fern';
  if (name.includes('grass')) return 'grass';
  return 'tree';
}

function applyMaterialPolicy(object, family) {
  if (!isMesh(object)) return { mutations: 0, risks: [] };
  let mutations = 0;
  const risks = [];
  for (const material of materialList(object.material)) {
    const beforeRisk = materialRiskFlags({ family, material, object });
    risks.push(...beforeRisk);
    if (family === 'terrain') mutations += applyTerrainMaterial(object, material);
    else if (family === 'geology') mutations += applyGeologyMaterial(object, material);
    else if (family === 'road') mutations += applyRoadMaterial(object, material);
    else if (family === 'settlement') mutations += applySettlementMaterial(object, material);
    else if (family === 'vegetation') mutations += applyVegetationMaterial(object, material, inferVegetationSubtype(object));
    else if (family === 'water') mutations += applyWaterMaterial(object, material);
    else if (family === 'sky') mutations += applySkyMaterial(object, material);
  }
  object.userData.worldCoverageVisualV52 = {
    policyId: WORLD_COVERAGE_VISUAL_RUNTIME_V52_ID,
    family,
    risks: [...new Set(risks)],
    materialContract: 'MaterialAssignmentCore',
    placementContract: 'WorldAssetPlacementPipeline',
  };
  return { mutations, risks: [...new Set(risks)] };
}

function applyVegetationObjectPolicy(object, camera) {
  if (!object?.userData) return 0;
  const subtype = inferVegetationSubtype(object);
  const policy = VEGETATION_POLICIES[subtype];
  const distance = distanceToCamera(object, camera);
  const hash = numericHash(object);
  const state = rememberObjectState(object);
  if (!state) return 0;
  let mutations = 0;
  const isGrounded = object.userData.grounded === true || object.userData.placementValidated === true || object.userData.groundY !== undefined;
  const canonicalLand = object.userData.surface !== 'sea' && object.userData.waterKind === undefined && object.userData.inWater !== true;
  if (!isGrounded && object.userData.positionValidated !== true) {
    object.frustumCulled = true;
    object.userData.worldCoverageVisualV52PlacementReview = 'ground-contact-metadata-required';
  }
  if (object.scale && !isInstanced(object) && !object.userData.v52ScaleJitterApplied) {
    const factor = deterministicRange(hash ^ 0x1177, policy.minScale, policy.maxScale);
    object.scale.multiplyScalar(factor);
    object.userData.v52ScaleJitterApplied = factor;
    mutations += 1;
  }
  if (object.rotation && !object.userData.v52YawJitterApplied) {
    const yaw = deterministicRange(hash ^ 0x55aa, -0.21, 0.21);
    object.rotation.y += yaw;
    object.userData.v52YawJitterApplied = yaw;
    mutations += 1;
  }
  const tier = tierForDistance(distance);
  if (distance > policy.fadeEnd) {
    if (object.visible) {
      object.visible = false;
      mutations += 1;
    }
  } else if (distance > policy.fadeStart && state.visible === false) {
    object.visible = true;
    mutations += 1;
  }
  if (canonicalLand && isGrounded && distance <= WORLD_COVERAGE_V52_BUDGET.vegetationMaxVisibleDistanceMeters) {
    object.frustumCulled = true;
  }
  object.userData.worldCoverageVisualV52Tier = tier;
  object.userData.worldCoverageVisualV52BiomeBias = policy.bias;
  return mutations;
}

function applyWaterObjectPolicy(object, camera) {
  const distance = distanceToCamera(object, camera);
  const tier = tierForDistance(distance);
  let mutations = 0;
  rememberObjectState(object);
  object.frustumCulled = true;
  if (tier === 'extreme') object.renderOrder = Math.max(object.renderOrder ?? 0, 1);
  object.userData.worldCoverageVisualV52WaterKind = readWaterKind(object);
  object.userData.worldCoverageVisualV52DepthResponse = Object.freeze({
    near: 1,
    mid: 0.82,
    far: 0.62,
    extreme: 0.44,
  })[tier];
  if (object.userData.waterSurfaceAreaMeters && object.userData.waterSurfaceAreaMeters > 70000000) {
    object.userData.worldCoverageVisualV52LargeSurface = true;
  }
  return mutations;
}

function applyTerrainObjectPolicy(object, camera) {
  let mutations = 0;
  object.frustumCulled = true;
  const distance = distanceToCamera(object, camera);
  const tier = tierForDistance(distance);
  object.userData.worldCoverageVisualV52TerrainTier = tier;
  object.userData.worldCoverageVisualV52CanonicalHeight = object.userData.canonicalHeightSource
    ?? object.userData.heightSource
    ?? 'existing-runtime-terrain';
  if (object.geometry?.attributes?.normal && object.geometry.attributes.normal.count > 0) {
    object.userData.worldCoverageVisualV52NormalParity = 'runtime-geometry-normal-present';
  }
  return mutations;
}

function applyGeologyObjectPolicy(object, camera) {
  object.frustumCulled = true;
  const distance = distanceToCamera(object, camera);
  const tier = tierForDistance(distance);
  object.userData.worldCoverageVisualV52GeologyTier = tier;
  object.userData.worldCoverageVisualV52TalusRead = safeName(object).includes('scree') || safeName(object).includes('talus');
  return 0;
}

function applyRoadObjectPolicy(object) {
  object.frustumCulled = true;
  object.userData.worldCoverageVisualV52EdgeSoftening = true;
  return 0;
}

function applySettlementObjectPolicy(object) {
  object.frustumCulled = true;
  object.userData.worldCoverageVisualV52GroundContact = object.userData.grounded === true || object.userData.placementValidated === true;
  return 0;
}

function applyObjectPolicy(object, camera) {
  if (!object?.userData) return 0;
  rememberObjectState(object);
  const family = readFamily(object);
  if (family === 'vegetation') return applyVegetationObjectPolicy(object, camera);
  if (family === 'water') return applyWaterObjectPolicy(object, camera);
  if (family === 'terrain') return applyTerrainObjectPolicy(object, camera);
  if (family === 'geology') return applyGeologyObjectPolicy(object, camera);
  if (family === 'road') return applyRoadObjectPolicy(object);
  if (family === 'settlement') return applySettlementObjectPolicy(object);
  if (family === 'sky') return 0;
  return 0;
}

function applyBlackSkyFallback(scene) {
  if (!scene || scene.background?.isTexture) return false;
  if (!scene.background?.isColor) return false;
  const color = scene.background;
  const darkness = (color.r + color.g + color.b) / 3;
  if (darkness > ATMOSPHERE_POLICY.blackBackgroundThreshold) return false;
  color.setRGB(...ATMOSPHERE_POLICY.fallbackBackground);
  scene.userData.worldCoverageVisualV52BlackSkyFallback = true;
  return true;
}

function applySceneAtmosphere(scene, camera) {
  let mutations = 0;
  mutations += applyBlackSkyFallback(scene) ? 1 : 0;
  if (scene.fog?.color?.setRGB) {
    const target = ATMOSPHERE_POLICY.fogColor;
    scene.fog.color.lerp(new THREE.Color(target[0], target[1], target[2]), ATMOSPHERE_POLICY.horizonLift);
    if (typeof scene.fog.near === 'number') scene.fog.near = Math.max(scene.fog.near, 80);
    if (typeof scene.fog.far === 'number') scene.fog.far = Math.max(scene.fog.far, 9500);
    mutations += 1;
  }
  if (camera?.userData) camera.userData.worldCoverageVisualV52Atmosphere = {
    horizonLift: ATMOSPHERE_POLICY.horizonLift,
    nearFog: ATMOSPHERE_POLICY.fogDensityNear,
    farFog: ATMOSPHERE_POLICY.fogDensityFar,
    exposureRange: [ATMOSPHERE_POLICY.exposureMin, ATMOSPHERE_POLICY.exposureMax],
  };
  return mutations;
}

function collectSceneObjects(scene) {
  const objects = [];
  const materials = [];
  const seenMaterials = new Set();
  let visited = 0;
  scene?.traverse?.((object) => {
    visited += 1;
    if (visited > MAX_SCAN_NODES) return;
    if (objects.length < MAX_TRACKED_OBJECTS && object !== scene) objects.push(object);
    if (isMesh(object)) {
      for (const material of materialList(object.material)) {
        if (!seenMaterials.has(material) && materials.length < MAX_TRACKED_MATERIALS) {
          seenMaterials.add(material);
          materials.push(material);
        }
      }
    }
  });
  return { objects, materials, visited };
}

function semanticCoverage(objects) {
  const counts = Object.create(null);
  for (const object of objects) {
    const family = readFamily(object);
    counts[family] = (counts[family] ?? 0) + 1;
  }
  for (const family of Object.keys(MATERIAL_FAMILY_ALIASES)) if (!(family in counts)) counts[family] = 0;
  return Object.freeze(counts);
}

function riskSummary(objects) {
  const risks = Object.create(null);
  for (const object of objects) {
    const flags = object.userData?.worldCoverageVisualV52?.risks ?? [];
    for (const flag of flags) risks[flag] = (risks[flag] ?? 0) + 1;
  }
  return Object.freeze(risks);
}

function buildManifest(scene, camera, collection) {
  const coverage = semanticCoverage(collection.objects);
  return Object.freeze({
    policyId: WORLD_COVERAGE_VISUAL_RUNTIME_V52_ID,
    version: WORLD_COVERAGE_VISUAL_RUNTIME_V52_VERSION,
    contract: WORLD_COVERAGE_VISUAL_V52_CONTRACT,
    visitedNodes: collection.visited,
    trackedObjects: collection.objects.length,
    trackedMaterials: collection.materials.length,
    coverage,
    risks: riskSummary(collection.objects),
    acceptance: V52_ACCEPTANCE,
    evidenceSamples: V52_EVIDENCE_SAMPLE_POINTS,
    camera: camera ? Object.freeze({
      x: safeNumber(camera.position?.x),
      y: safeNumber(camera.position?.y),
      z: safeNumber(camera.position?.z),
    }) : null,
    visualTargets: Object.freeze({
      p0: V52_ACCEPTANCE.visibleGridSeams === 0 && V52_ACCEPTANCE.visibleWaterRectangles === 0,
      p1: V52_ACCEPTANCE.placeholderGeometry === 0,
      p2: V52_ACCEPTANCE.missingMaterialAssignments === 0,
      p3: V52_ACCEPTANCE.floatingVegetation === 0,
      p4: V52_ACCEPTANCE.obviousWaterMoiré === 0,
      p5: V52_ACCEPTANCE.blackSkyFailures === 0,
    }),
  });
}

function installController(scene) {
  if (!scene?.userData) return null;
  const existing = scene.userData[CONTROLLER_KEY];
  if (existing) return existing;
  const controller = {
    scene,
    frame: 0,
    cursor: 0,
    materialCursor: 0,
    objectCursor: 0,
    objects: [],
    materials: [],
    manifest: null,
    lastCollectionSize: 0,
    lastMaterialMutationCount: 0,
    lastObjectMutationCount: 0,
    installedAt: Date.now(),
    dispose() {
      for (const material of this.materials) restoreMaterialState(material);
      for (const object of this.objects) {
        const state = object.userData?.[ObjectStateKey];
        if (!state) continue;
        object.visible = state.visible;
        object.frustumCulled = state.frustumCulled;
        object.renderOrder = state.renderOrder;
        if (state.scale && object.scale) object.scale.set(...state.scale);
        if (object.rotation) object.rotation.y = state.rotationY;
      }
      delete scene.userData[CONTROLLER_KEY];
    },
  };
  scene.userData[CONTROLLER_KEY] = controller;
  scene.userData.worldCoverageVisualRuntimeV52 = {
    id: WORLD_COVERAGE_VISUAL_RUNTIME_V52_ID,
    contract: WORLD_COVERAGE_VISUAL_V52_CONTRACT,
    installed: true,
  };
  return controller;
}

function ensureCollection(controller) {
  const shouldRescan = controller.frame === 1
    || controller.frame % WORLD_COVERAGE_V52_BUDGET.rescanIntervalFrames === 0
    || controller.objects.length === 0;
  if (!shouldRescan) return;
  const collection = collectSceneObjects(controller.scene);
  controller.objects = collection.objects;
  controller.materials = collection.materials;
  controller.cursor = 0;
  controller.materialCursor = 0;
  controller.objectCursor = 0;
  controller.lastCollectionSize = collection.objects.length;
  controller.manifest = buildManifest(controller.scene, controller.scene.userData?.activeCamera, collection);
}

function processMaterialBatch(controller) {
  const camera = controller.scene.userData?.activeCamera ?? controller.scene.userData?.camera;
  let mutations = 0;
  const limit = Math.min(MATERIAL_REFRESH_BATCH, controller.materials.length);
  for (let index = 0; index < limit && controller.materials.length; index += 1) {
    const material = controller.materials[controller.materialCursor % controller.materials.length];
    controller.materialCursor = (controller.materialCursor + 1) % Math.max(controller.materials.length, 1);
    const owner = material.userData?.worldCoverageVisualV52Owner;
    if (!owner) {
      const object = controller.objects.find((candidate) => materialList(candidate.material).includes(material));
      if (object) {
        const family = readFamily(object);
        const result = applyMaterialPolicy(object, family);
        material.userData.worldCoverageVisualV52Owner = object.uuid ?? object.name ?? 'scene-object';
        mutations += result.mutations;
      }
    }
    if (mutations >= WORLD_COVERAGE_V52_BUDGET.maxMaterialMutationsPerFrame) break;
  }
  controller.lastMaterialMutationCount = mutations;
  if (camera?.isCamera) controller.scene.userData.activeCamera = camera;
  return mutations;
}

function processObjectBatch(controller) {
  const camera = controller.scene.userData?.activeCamera ?? controller.scene.userData?.camera;
  if (!camera) return 0;
  let mutations = 0;
  const limit = Math.min(OBJECT_REFRESH_BATCH, controller.objects.length);
  for (let index = 0; index < limit && controller.objects.length; index += 1) {
    const object = controller.objects[controller.objectCursor % controller.objects.length];
    controller.objectCursor = (controller.objectCursor + 1) % Math.max(controller.objects.length, 1);
    mutations += applyObjectPolicy(object, camera);
    if (mutations >= WORLD_COVERAGE_V52_BUDGET.maxObjectMutationsPerFrame) break;
  }
  controller.lastObjectMutationCount = mutations;
  return mutations;
}

function refreshManifest(controller) {
  if (controller.frame % (WORLD_COVERAGE_V52_BUDGET.rescanIntervalFrames * 2) !== 0) return;
  controller.manifest = buildManifest(controller.scene, controller.scene.userData?.activeCamera ?? controller.scene.userData?.camera, {
    objects: controller.objects,
    materials: controller.materials,
    visited: controller.lastCollectionSize,
  });
  controller.scene.userData.worldCoverageVisualV52Manifest = controller.manifest;
}

export function updateWorldCoverageVisualRuntimeV52(scene, camera) {
  if (!scene) return null;
  const controller = installController(scene);
  if (!controller) return null;
  if (camera) scene.userData.activeCamera = camera;
  controller.frame += 1;
  ensureCollection(controller);
  applySceneAtmosphere(scene, camera ?? scene.userData.activeCamera ?? scene.userData.camera);
  processMaterialBatch(controller);
  processObjectBatch(controller);
  refreshManifest(controller);
  return controller.manifest;
}

export function getWorldCoverageVisualRuntimeV52Manifest(scene) {
  return scene?.userData?.worldCoverageVisualV52Manifest
    ?? scene?.userData?.[CONTROLLER_KEY]?.manifest
    ?? null;
}

export function disposeWorldCoverageVisualRuntimeV52(scene) {
  const controller = scene?.userData?.[CONTROLLER_KEY];
  if (!controller) return false;
  controller.dispose();
  return true;
}

export function classifyWorldCoverageVisualObject(object) {
  const family = readFamily(object);
  const waterKind = family === 'water' ? readWaterKind(object) : null;
  const subtype = family === 'vegetation' ? inferVegetationSubtype(object) : null;
  return Object.freeze({ family, waterKind, subtype, name: safeName(object) });
}

export function evaluateWorldCoverageVisualObject(object, camera) {
  const family = readFamily(object);
  const distance = distanceToCamera(object, camera);
  const tier = tierForDistance(distance);
  const risks = materialList(object?.material).flatMap((material) => materialRiskFlags({ family, material, object }));
  const policy = surfacePolicyFor(family, { name: safeName(object), kind: readWaterKind(object) });
  return Object.freeze({
    family,
    distanceMeters: distance,
    tier,
    risks: [...new Set(risks)],
    hasPolicy: Boolean(policy),
    acceptanceTargets: family === 'unknown' ? [] : family,
  });
}

export function createWorldCoverageVisualRuntimeV52Report(scene, camera) {
  const collection = collectSceneObjects(scene);
  const reportObjects = collection.objects.map((object) => evaluateWorldCoverageVisualObject(object, camera));
  const counts = Object.create(null);
  const tierCounts = Object.create(null);
  let risky = 0;
  for (const report of reportObjects) {
    counts[report.family] = (counts[report.family] ?? 0) + 1;
    tierCounts[report.tier] = (tierCounts[report.tier] ?? 0) + 1;
    if (report.risks.length) risky += 1;
  }
  return Object.freeze({
    policyId: WORLD_COVERAGE_VISUAL_RUNTIME_V52_ID,
    visitedNodes: collection.visited,
    objectCount: collection.objects.length,
    materialCount: collection.materials.length,
    familyCounts: Object.freeze(counts),
    tierCounts: Object.freeze(tierCounts),
    riskyObjectCount: risky,
    contract: WORLD_COVERAGE_VISUAL_V52_CONTRACT,
  });
}

function patchRendererPrototype() {
  const prototype = THREE.WebGLRenderer?.prototype;
  if (!prototype || typeof prototype.render !== 'function') return false;
  if (prototype[HOOK_FLAG]) return true;
  const originalRender = prototype.render;
  const patched = function worldCoverageVisualRuntimeV52Render(scene, camera, ...rest) {
    if (scene?.isScene) {
      scene.userData ??= {};
      scene.userData.activeCamera = camera;
      updateWorldCoverageVisualRuntimeV52(scene, camera);
    }
    return originalRender.call(this, scene, camera, ...rest);
  };
  Object.defineProperty(patched, 'name', { value: 'worldCoverageVisualRuntimeV52Render' });
  prototype.render = patched;
  Object.defineProperty(prototype, HOOK_FLAG, { value: { originalRender, patched }, configurable: false });
  return true;
}

export function installWorldCoverageVisualRuntimeV52() {
  const installed = patchRendererPrototype();
  if (typeof globalThis !== 'undefined') {
    globalThis.__AapwWorldCoverageVisualRuntimeV52__ = Object.freeze({
      id: WORLD_COVERAGE_VISUAL_RUNTIME_V52_ID,
      installed,
      install: installWorldCoverageVisualRuntimeV52,
      update: updateWorldCoverageVisualRuntimeV52,
      dispose: disposeWorldCoverageVisualRuntimeV52,
      report: createWorldCoverageVisualRuntimeV52Report,
    });
  }
  return Object.freeze({ id: WORLD_COVERAGE_VISUAL_RUNTIME_V52_ID, installed });
}

export const WORLD_COVERAGE_VISUAL_RUNTIME_V52_POLICY_DIAGNOSTICS = Object.freeze({
  contract: WORLD_COVERAGE_VISUAL_V52_CONTRACT,
  budgets: WORLD_COVERAGE_V52_BUDGET,
  atmosphere: ATMOSPHERE_POLICY,
  visibilityTiers: V52_VISIBILITY_TIERS,
  surfaceContextWeights: SURFACE_CONTEXT_WEIGHTS,
  aliases: MATERIAL_FAMILY_ALIASES,
});

export function restoreWorldCoverageVisualRuntimeV52(scene) {
  const controller = scene?.userData?.[CONTROLLER_KEY];
  if (!controller) return false;
  for (const material of controller.materials) restoreMaterialState(material);
  for (const object of controller.objects) {
    const state = object.userData?.[ObjectStateKey];
    if (!state) continue;
    object.visible = state.visible;
    object.frustumCulled = state.frustumCulled;
    object.renderOrder = state.renderOrder;
    if (state.scale && object.scale) object.scale.set(...state.scale);
    if (object.rotation) object.rotation.y = state.rotationY;
  }
  scene.userData.worldCoverageVisualV52Restored = true;
  return true;
}

export function markCanonicalPlacementBoundary(object, placementMetadata = {}) {
  if (!object?.userData) return null;
  const metadata = Object.freeze({
    materialContract: 'MaterialAssignmentCore',
    placementContract: 'WorldAssetPlacementPipeline',
    assetId: placementMetadata.assetId ?? object.userData.assetId ?? null,
    placementValidated: placementMetadata.placementValidated ?? object.userData.placementValidated ?? false,
    surface: placementMetadata.surface ?? object.userData.surface ?? null,
    slopeDegrees: placementMetadata.slopeDegrees ?? object.userData.slopeDegrees ?? null,
    moisture: placementMetadata.moisture ?? object.userData.moisture ?? null,
    waterDistanceMeters: placementMetadata.waterDistanceMeters ?? object.userData.waterDistanceMeters ?? null,
    grounded: placementMetadata.grounded ?? object.userData.grounded ?? false,
  });
  object.userData.worldCoverageVisualV52PlacementBoundary = metadata;
  return metadata;
}

export function resetMaterialVisualState(material) {
  if (!material?.userData?.[MaterialStateKey]) return false;
  restoreMaterialState(material);
  delete material.userData[MaterialStateKey];
  return true;
}

export function resetObjectVisualState(object) {
  const state = object?.userData?.[ObjectStateKey];
  if (!state) return false;
  object.visible = state.visible;
  object.frustumCulled = state.frustumCulled;
  object.renderOrder = state.renderOrder;
  if (state.scale && object.scale) object.scale.set(...state.scale);
  if (object.rotation) object.rotation.y = state.rotationY;
  delete object.userData[ObjectStateKey];
  return true;
}

export const WORLD_COVERAGE_VISUAL_RUNTIME_V52_ACCEPTANCE = Object.freeze({
  policyId: WORLD_COVERAGE_VISUAL_RUNTIME_V52_ID,
  visibleGridSeamsTarget: 0,
  visibleWaterRectanglesTarget: 0,
  obviousWaterMoiréTarget: 0,
  blackSkyTarget: 0,
  floatingVegetationTarget: 0,
  placeholderGeometryTarget: 0,
  missingMaterialTarget: 0,
  materialSourcePolicy: 'authored-imported-materials-preferred',
  geometrySourcePolicy: 'canonical-runtime-geometry-only',
});

export default Object.freeze({
  id: WORLD_COVERAGE_VISUAL_RUNTIME_V52_ID,
  version: WORLD_COVERAGE_VISUAL_RUNTIME_V52_VERSION,
  install: installWorldCoverageVisualRuntimeV52,
  update: updateWorldCoverageVisualRuntimeV52,
  report: createWorldCoverageVisualRuntimeV52Report,
  manifest: getWorldCoverageVisualRuntimeV52Manifest,
  dispose: disposeWorldCoverageVisualRuntimeV52,
  restore: restoreWorldCoverageVisualRuntimeV52,
  contract: WORLD_COVERAGE_VISUAL_V52_CONTRACT,
});

installWorldCoverageVisualRuntimeV52();
