import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import {
  autoAssignMaterials,
  analyzeMaterialSurfaces,
  createMaterialManifest,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';
import {
  attachPreparedWorldAsset,
  createSurfaceQuery,
  resolveWorldSurfacePlacement,
} from './WorldAssetPlacementPipeline.js';
import { WORLD_REFERENCE_MAP, REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from './worldReferenceMap.js';
import { worldXZToNormalizedReference } from './worldReferenceAlignment.js';

/**
 * Render-only ambient human population for the shipped world.
 *
 * This director deliberately does not invent NPC state, faction logic, combat, schedules or
 * another living-world framework. It consumes the already-shipped settlement/road/terrain
 * authorities and supplies a small visual population layer whose only persistent state is its
 * geographic/material provenance. Real Mixamo FBX assets are loaded once per family, cloned for
 * bounded instances, and routed through the shared MaterialAssignmentCore + WorldAssetPlacement
 * pipeline before attachment. Authored textures are preserved; generated layered materials are only
 * used for genuinely textureless source meshes.
 */

export const GEOGRAPHIC_AMBIENT_POLICY = Object.freeze({
  id: 'geographic-ambient-characters-2026-09-07-v1',
  sourceMapId: WORLD_REFERENCE_MAP.id,
  sourceMapSha256: WORLD_REFERENCE_MAP.sha256,
  placementRadiusMeters: Object.freeze({ min: 108, max: 238 }),
  minRoadDistanceMeters: 4,
  minSettlementDistanceMeters: 88,
  maxSettlementDistanceMeters: 260,
  maxSlopeDegrees: 24,
  maxWaterDepthMeters: 0.02,
  desktopBudget: 12,
  mobileBudget: 5,
  updateIntervalSeconds: 0.20,
  showDistanceMeters: 700,
  hideDistanceMeters: 920,
  scaleRange: Object.freeze([0.93, 1.07]),
});

export const AMBIENT_CHARACTER_ASSETS = Object.freeze({
  peasant: Object.freeze({
    id: 'peasant-girl',
    src: 'assets/models/characters/peasant_girl.fbx',
    paletteId: 'peasant',
    role: 'settlement-worker',
    allowedKinds: Object.freeze(['lush-grassland', 'temperate-coast', 'cold-grassland', 'marsh', 'jungle']),
    priority: 1,
  }),
  knight: Object.freeze({
    id: 'paladin-j-nordstrom',
    src: 'assets/models/characters/paladin_j_nordstrom.fbx',
    paletteId: 'knight',
    role: 'road-guard',
    allowedKinds: Object.freeze(['mountain', 'rocky-hills', 'cold-grassland', 'temperate-coast']),
    priority: 2,
  }),
  ranger: Object.freeze({
    id: 'erika-archer',
    src: 'assets/models/characters/erika_archer.fbx',
    paletteId: 'soldier',
    role: 'frontier-scout',
    allowedKinds: Object.freeze(['steppe', 'desert', 'arid', 'lush-grassland', 'rocky-hills', 'jungle', 'temperate-coast']),
    priority: 3,
  }),
});

const BIOME_PROFILE_ORDER = Object.freeze([
  ['snow', 'knight'],
  ['cold-grassland', 'knight'],
  ['mountain', 'knight'],
  ['rocky-hills', 'knight'],
  ['marsh', 'peasant'],
  ['lush-grassland', 'peasant'],
  ['temperate-coast', 'peasant'],
  ['jungle', 'peasant'],
  ['desert', 'ranger'],
  ['arid', 'ranger'],
  ['steppe', 'ranger'],
]);

const REGION_MATERIAL_VARIANTS = Object.freeze({
  snow: Object.freeze({ paletteId: 'knight', tintMode: 'cool', scaleBias: 1.02 }),
  'cold-grassland': Object.freeze({ paletteId: 'knight', tintMode: 'cool', scaleBias: 1.01 }),
  mountain: Object.freeze({ paletteId: 'knight', tintMode: 'slate', scaleBias: 1.00 }),
  'rocky-hills': Object.freeze({ paletteId: 'knight', tintMode: 'earth', scaleBias: 1.00 }),
  marsh: Object.freeze({ paletteId: 'peasant', tintMode: 'moss', scaleBias: 0.98 }),
  'lush-grassland': Object.freeze({ paletteId: 'peasant', tintMode: 'meadow', scaleBias: 1.00 }),
  'temperate-coast': Object.freeze({ paletteId: 'peasant', tintMode: 'salt', scaleBias: 0.99 }),
  jungle: Object.freeze({ paletteId: 'peasant', tintMode: 'humid', scaleBias: 0.97 }),
  desert: Object.freeze({ paletteId: 'soldier', tintMode: 'dust', scaleBias: 1.03 }),
  arid: Object.freeze({ paletteId: 'soldier', tintMode: 'dry', scaleBias: 1.02 }),
  steppe: Object.freeze({ paletteId: 'soldier', tintMode: 'sun', scaleBias: 1.01 }),
});

export function geographicBiomeAtWorldXZ(worldX, worldZ, mapBounds, metersPerMapUnit) {
  const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
  let best = null;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(normalized.x, normalized.y, zone);
    if (influence <= 0) continue;
    if (!best || influence > best.influence) best = { id: zone.id, kind: zone.kind, influence };
  }
  return best || { id: 'unclassified', kind: 'lush-grassland', influence: 0 };
}

export function chooseAmbientCharacterProfile(biomeKind, seed = 0) {
  const normalizedKind = String(biomeKind || '').toLowerCase();
  for (const [kind, key] of BIOME_PROFILE_ORDER) {
    if (normalizedKind === kind) return { key, ...AMBIENT_CHARACTER_ASSETS[key] };
  }
  const keys = Object.keys(AMBIENT_CHARACTER_ASSETS);
  const index = Math.abs(Number(seed) || 0) % keys.length;
  const key = keys[index];
  return { key, ...AMBIENT_CHARACTER_ASSETS[key] };
}

function hash32(value) {
  let h = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash01(value) {
  return hash32(value) / 4294967295;
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function distance2D(a, b) {
  const dx = finiteNumber(a?.x) - finiteNumber(b?.x);
  const dz = finiteNumber(a?.z) - finiteNumber(b?.z);
  return Math.hypot(dx, dz);
}

function pointToSegmentDistance(point, start, end) {
  const px = finiteNumber(point?.x);
  const pz = finiteNumber(point?.z);
  const ax = finiteNumber(start?.x);
  const az = finiteNumber(start?.z);
  const bx = finiteNumber(end?.x);
  const bz = finiteNumber(end?.z);
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-9) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function distanceToRoadEdges(x, z, roadEdges = []) {
  let best = Infinity;
  for (const edge of roadEdges || []) {
    const points = Array.isArray(edge?.points) ? edge.points : [];
    for (let index = 1; index < points.length; index += 1) {
      best = Math.min(best, pointToSegmentDistance({ x, z }, points[index - 1], points[index]));
    }
  }
  return Number.isFinite(best) ? best : Infinity;
}

function distanceToSettlements(x, z, seats = []) {
  let best = Infinity;
  for (const seat of seats || []) best = Math.min(best, distance2D({ x, z }, seat));
  return Number.isFinite(best) ? best : Infinity;
}

function slopeDegreesAt(sampleHeight, sampleHeightX, sampleHeightZ, sampleDistance = 1.5) {
  const dx = (sampleHeightX - sampleHeight) / sampleDistance;
  const dz = (sampleHeightZ - sampleHeight) / sampleDistance;
  return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
}

export function buildAmbientSurfaceQuery({
  groundCollider,
  roadEdges,
  settlementSeats,
  mapBounds,
  metersPerMapUnit,
  waterLevelMeters,
}) {
  if (!groundCollider || typeof groundCollider.getGroundHeight !== 'function') {
    throw new TypeError('geographic ambient director requires the canonical groundCollider sampler');
  }
  const safeGround = (x, z) => {
    const y = groundCollider.getGroundHeight(x, z);
    if (!Number.isFinite(y)) throw new TypeError('canonical ground height is non-finite');
    return y;
  };
  return (x, z) => {
    const height = safeGround(x, z);
    const sampleX = safeGround(x + 1.5, z);
    const sampleZ = safeGround(x, z + 1.5);
    const slope = slopeDegreesAt(height, sampleX, sampleZ);
    const biome = geographicBiomeAtWorldXZ(x, z, mapBounds, metersPerMapUnit);
    const roadDistance = distanceToRoadEdges(x, z, roadEdges);
    const settlementDistance = distanceToSettlements(x, z, settlementSeats);
    const waterDepth = Math.max(0, finiteNumber(waterLevelMeters) - height);
    return {
      height,
      slopeDegrees: slope,
      waterDepth,
      roadDistance: Number.isFinite(roadDistance) ? roadDistance : null,
      settlementDistance: Number.isFinite(settlementDistance) ? settlementDistance : null,
      biome: biome.kind,
      biomeId: biome.id,
      biomeInfluence: biome.influence,
      waterType: waterDepth > 0 ? 'sea-level' : null,
    };
  };
}

function profileForPlacement(biomeKind, seed) {
  const selected = chooseAmbientCharacterProfile(biomeKind, seed);
  const regional = REGION_MATERIAL_VARIANTS[biomeKind] || REGION_MATERIAL_VARIANTS['lush-grassland'];
  return Object.freeze({
    ...selected,
    regionalPaletteId: regional.paletteId,
    tintMode: regional.tintMode,
    scaleBias: regional.scaleBias,
  });
}

export function planGeographicAmbientPlacements({
  settlementSeats,
  surfaceQuery,
  seed,
  maxInstances,
  policy = GEOGRAPHIC_AMBIENT_POLICY,
}) {
  const seats = Array.isArray(settlementSeats) ? settlementSeats : [];
  const budget = Math.max(0, Math.floor(finiteNumber(maxInstances, policy.desktopBudget)));
  if (!surfaceQuery || typeof surfaceQuery !== 'function') throw new TypeError('surfaceQuery is required');
  const placements = [];
  const rejected = [];
  const candidateCountPerSeat = 8;

  for (let seatIndex = 0; seatIndex < seats.length && placements.length < budget; seatIndex += 1) {
    const seat = seats[seatIndex];
    if (!Number.isFinite(Number(seat?.x)) || !Number.isFinite(Number(seat?.z))) {
      rejected.push({ seatId: seat?.id || `seat-${seatIndex}`, reason: 'non-finite-seat' });
      continue;
    }
    const seatSeed = hash32(`${seed}|${seat.id || seatIndex}`);
    let seatAccepted = false;
    for (let candidateIndex = 0; candidateIndex < candidateCountPerSeat && !seatAccepted; candidateIndex += 1) {
      const candidateSeed = hash32(`${seatSeed}|${candidateIndex}`);
      const angle = hash01(`${candidateSeed}|angle`) * Math.PI * 2;
      const radius = policy.placementRadiusMeters.min
        + hash01(`${candidateSeed}|radius`) * (policy.placementRadiusMeters.max - policy.placementRadiusMeters.min);
      const x = Number(seat.x) + Math.cos(angle) * radius;
      const z = Number(seat.z) + Math.sin(angle) * radius;
      let sample;
      try {
        sample = surfaceQuery(x, z);
      } catch (error) {
        rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: `surface:${error?.message || 'throw'}` });
        continue;
      }
      if (!sample || !Number.isFinite(Number(sample.height))) {
        rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: 'non-finite-ground' });
        continue;
      }
      if (Number(sample.slopeDegrees) > policy.maxSlopeDegrees) {
        rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: 'slope' });
        continue;
      }
      if (Number(sample.waterDepth) > policy.maxWaterDepthMeters) {
        rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: 'water' });
        continue;
      }
      if (Number.isFinite(Number(sample.roadDistance)) && Number(sample.roadDistance) < policy.minRoadDistanceMeters) {
        rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: 'road' });
        continue;
      }
      const settlementDistance = Number(sample.settlementDistance);
      if (Number.isFinite(settlementDistance) && (settlementDistance < policy.minSettlementDistanceMeters || settlementDistance > policy.maxSettlementDistanceMeters)) {
        rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: 'settlement-distance' });
        continue;
      }
      const biome = sample.biome || 'lush-grassland';
      const profile = profileForPlacement(biome, candidateSeed);
      placements.push({
        id: `ambient-${seat.id || seatIndex}-${placements.length}`,
        seatId: seat.id || `seat-${seatIndex}`,
        x,
        z,
        y: Number(sample.height),
        angle,
        radius,
        biome,
        biomeId: sample.biomeId || null,
        role: profile.role,
        assetKey: profile.key,
        assetId: profile.id,
        modelUrl: profile.src,
        paletteId: profile.regionalPaletteId,
        tintMode: profile.tintMode,
        scale: policy.scaleRange[0] + hash01(`${candidateSeed}|scale`) * (policy.scaleRange[1] - policy.scaleRange[0]),
        groundSlopeDegrees: Number(sample.slopeDegrees),
        roadDistanceMeters: Number.isFinite(Number(sample.roadDistance)) ? Number(sample.roadDistance) : null,
        settlementDistanceMeters: Number.isFinite(settlementDistance) ? settlementDistance : null,
        biomeInfluence: finiteNumber(sample.biomeInfluence, 0),
      });
      seatAccepted = true;
    }
  }

  return Object.freeze({
    placements: Object.freeze(placements),
    rejected: Object.freeze(rejected),
    requested: budget,
    accepted: placements.length,
    coverage: seats.length ? placements.length / Math.min(seats.length, budget || seats.length) : 0,
  });
}

function hasAuthoredTexture(material) {
  return Boolean(material?.map || material?.normalMap || material?.roughnessMap || material?.metalnessMap || material?.aoMap || material?.emissiveMap);
}

function hasAuthoredMaterialMaps(root) {
  const analysis = analyzeMaterialSurfaces(root);
  return analysis.surfaces.some((surface) => hasAuthoredTexture(surface.material));
}

function materialTextureSizes(root) {
  const sizes = [];
  const seen = new Set();
  analyzeMaterialSurfaces(root).surfaces.forEach((surface) => {
    const material = surface.material;
    for (const texture of [material?.map, material?.normalMap, material?.roughnessMap, material?.metalnessMap, material?.aoMap, material?.emissiveMap]) {
      const width = Number(texture?.image?.width);
      const height = Number(texture?.image?.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue;
      const key = `${width}x${height}:${texture.uuid || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sizes.push({ width, height });
    }
  });
  return sizes;
}

function applyRegionalFallbackMaterial(model, profile, placement) {
  return autoAssignMaterials(model, {
    metadata: {
      id: profile.id,
      name: `${profile.role}-${placement.biome}`,
      category: 'ambient-character',
      src: profile.src,
    },
    paletteId: profile.paletteId,
    textureSize: 256,
  });
}

function cloneModelForAmbient(baseModel, placement) {
  const clone = baseModel.clone(true);
  clone.userData ||= {};
  clone.userData.geographicAmbientId = placement.id;
  clone.userData.geographicAmbientSeatId = placement.seatId;
  clone.userData.geographicAmbientBiome = placement.biome;
  clone.userData.geographicAmbientTintMode = placement.tintMode;
  clone.scale.multiplyScalar(placement.scale);
  return clone;
}

function createPlacementPreparedRecord(model, placement, surfaceQuery, profile) {
  const authored = hasAuthoredMaterialMaps(model);
  if (!authored) {
    const result = applyRegionalFallbackMaterial(model, profile, placement);
    if (!result.ok) return { ok: false, error: `material:${result.error || 'assignment-failed'}` };
  }

  const policy = Object.freeze({
    maxSlopeDegrees: GEOGRAPHIC_AMBIENT_POLICY.maxSlopeDegrees,
    maxWaterDepth: GEOGRAPHIC_AMBIENT_POLICY.maxWaterDepthMeters,
    minRoadDistance: GEOGRAPHIC_AMBIENT_POLICY.minRoadDistanceMeters,
    minSettlementDistance: GEOGRAPHIC_AMBIENT_POLICY.minSettlementDistanceMeters,
    maxSettlementDistance: GEOGRAPHIC_AMBIENT_POLICY.maxSettlementDistanceMeters,
    allowedBiomes: profile.allowedKinds,
  });
  const surface = resolveWorldSurfacePlacement(model, {
    metadata: {
      id: profile.id,
      name: profile.role,
      category: 'ambient-character',
      src: profile.src,
    },
    position: { x: placement.x, y: placement.y, z: placement.z },
    surfaceQuery,
    placementPolicy: policy,
    requireSurfaceContext: true,
    snapToGround: true,
    footprintGrounding: 'auto',
    foundationInsetMeters: 0.01,
  });
  if (!surface.ok) return surface;
  const validation = validateMaterialAssignment(model, { requireGeneratedTexture: !authored });
  if (!validation.ok) return { ok: false, error: validation.errors.join(','), validation };
  const manifest = createMaterialManifest(model, {
    metadata: {
      id: profile.id,
      name: profile.role,
      category: 'ambient-character',
      src: profile.src,
    },
    placement: {
      x: model.position.x,
      y: model.position.y,
      z: model.position.z,
      biome: placement.biome,
      seatId: placement.seatId,
      mode: authored ? 'preserve-authored-material' : 'layered-fallback',
      textureSizes: materialTextureSizes(model),
    },
  });
  model.userData.worldPlacementSurface = surface.surface;
  model.userData.worldPlacementFootprint = surface.footprint || null;
  model.userData.worldPlacementPolicy = surface.placementPolicy;
  model.userData.worldPlacementManifest = manifest;
  model.userData.materialReadyForWorld = true;
  model.userData.geographicAmbientSourceMaterial = authored ? 'authored' : 'generated-layered';
  model.userData.geographicAmbientAssetUrl = profile.src;
  model.userData.geographicAmbientTextureSizes = materialTextureSizes(model);
  return { ok: true, model, manifest, authoredMaterial: authored, validation };
}

export async function createGeographicAmbientCharacterDirector({
  assetLoader,
  scene,
  settlementSeats,
  roadEdges,
  groundCollider,
  mapBounds,
  metersPerMapUnit,
  waterLevelMeters,
  seed,
  maxInstances = GEOGRAPHIC_AMBIENT_POLICY.desktopBudget,
} = {}) {
  if (!assetLoader || typeof assetLoader.loadFBXModel !== 'function') throw new TypeError('assetLoader is required');
  if (!scene || typeof scene.add !== 'function') throw new TypeError('scene is required');

  const surfaceQuery = buildAmbientSurfaceQuery({ groundCollider, roadEdges, settlementSeats, mapBounds, metersPerMapUnit, waterLevelMeters });
  const plan = planGeographicAmbientPlacements({ settlementSeats, surfaceQuery, seed, maxInstances });
  const group = new THREE.Group();
  group.name = 'Geographic Ambient Characters';
  group.userData.policyId = GEOGRAPHIC_AMBIENT_POLICY.id;
  group.userData.sourceMapId = GEOGRAPHIC_AMBIENT_POLICY.sourceMapId;
  group.userData.sourceMapSha256 = GEOGRAPHIC_AMBIENT_POLICY.sourceMapSha256;
  group.userData.placementManifestVersion = 1;

  const neededKeys = [...new Set(plan.placements.map((placement) => placement.assetKey))];
  const baseModels = new Map();
  const loadDiagnostics = [];
  for (const key of neededKeys) {
    const profile = AMBIENT_CHARACTER_ASSETS[key];
    if (!profile) continue;
    const model = await assetLoader.loadFBXModel(profile.src, { fallbackColor: 0xff00ff, fallbackSize: 1 });
    if (!model || model.userData?.isPlaceholder) {
      loadDiagnostics.push({ assetId: profile.id, src: profile.src, ok: false, reason: 'placeholder-or-missing' });
      continue;
    }
    AssetLoader.correctMixamoFbxScale(model);
    const authored = hasAuthoredMaterialMaps(model);
    loadDiagnostics.push({
      assetId: profile.id,
      src: profile.src,
      ok: true,
      sourceMaterialMode: authored ? 'authored' : 'generated-required',
      meshCount: analyzeMaterialSurfaces(model).meshCount,
      surfaceCount: analyzeMaterialSurfaces(model).surfaceCount,
      textureSizes: materialTextureSizes(model),
    });
    baseModels.set(key, model);
  }

  const accepted = [];
  const rejected = [...plan.rejected];
  for (const placement of plan.placements) {
    if (!baseModels.has(placement.assetKey)) {
      rejected.push({ id: placement.id, reason: 'asset-family-unavailable' });
      continue;
    }
    const profile = profileForPlacement(placement.biome, hash32(`${seed}|${placement.id}`));
    const model = cloneModelForAmbient(baseModels.get(placement.assetKey), placement);
    const prepared = createPlacementPreparedRecord(model, placement, surfaceQuery, profile);
    if (!prepared.ok) {
      rejected.push({ id: placement.id, reason: prepared.error || 'placement-failed' });
      AssetLoader.disposeObject3D(model);
      continue;
    }
    const attached = attachPreparedWorldAsset(group, prepared);
    if (!attached.ok) {
      rejected.push({ id: placement.id, reason: attached.error || 'attach-failed' });
      AssetLoader.disposeObject3D(model);
      continue;
    }
    accepted.push({
      id: placement.id,
      seatId: placement.seatId,
      biome: placement.biome,
      biomeId: placement.biomeId,
      role: placement.role,
      assetId: placement.assetId,
      paletteId: placement.paletteId,
      materialMode: model.userData.geographicAmbientSourceMaterial,
      textureSizes: model.userData.geographicAmbientTextureSizes,
      position: { x: model.position.x, y: model.position.y, z: model.position.z },
      groundSlopeDegrees: placement.groundSlopeDegrees,
      roadDistanceMeters: placement.roadDistanceMeters,
      settlementDistanceMeters: placement.settlementDistanceMeters,
      manifestValid: Boolean(model.userData.worldPlacementManifest?.validation?.ok),
      model,
    });
  }

  for (const model of baseModels.values()) AssetLoader.disposeObject3D(model);

  scene.add(group);
  const state = {
    group,
    accepted,
    rejected,
    loadDiagnostics,
    accumulator: 0,
    visible: true,
    disposed: false,
  };

  const update = (cameraPosition, delta = 0) => {
    if (state.disposed) return;
    state.accumulator += Math.max(0, finiteNumber(delta, 0));
    if (state.accumulator < GEOGRAPHIC_AMBIENT_POLICY.updateIntervalSeconds) return;
    state.accumulator = 0;
    const camera = cameraPosition || { x: 0, z: 0 };
    let visibleCount = 0;
    for (const entry of state.accepted) {
      const distance = distance2D(camera, entry.model.position);
      const wasVisible = entry.model.visible !== false;
      if (wasVisible && distance > GEOGRAPHIC_AMBIENT_POLICY.hideDistanceMeters) entry.model.visible = false;
      else if (!wasVisible && distance < GEOGRAPHIC_AMBIENT_POLICY.showDistanceMeters) entry.model.visible = true;
      if (entry.model.visible) visibleCount += 1;
      entry.distanceMeters = distance;
    }
    state.visibleCount = visibleCount;
  };

  const getProofSnapshot = () => Object.freeze({
    policyId: GEOGRAPHIC_AMBIENT_POLICY.id,
    sourceMapId: GEOGRAPHIC_AMBIENT_POLICY.sourceMapId,
    sourceMapSha256: GEOGRAPHIC_AMBIENT_POLICY.sourceMapSha256,
    requested: plan.requested,
    accepted: state.accepted.length,
    rejected: state.rejected.length,
    visibleCount: state.visibleCount ?? state.accepted.length,
    assetLoads: state.loadDiagnostics.map((item) => ({ ...item })),
    placements: state.accepted.map(({ model, ...placement }) => ({ ...placement })),
    rejectionReasons: state.rejected.reduce((accumulator, item) => {
      const reason = item.reason || 'unknown';
      accumulator[reason] = (accumulator[reason] || 0) + 1;
      return accumulator;
    }, {}),
  });

  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    state.accepted.forEach((entry) => AssetLoader.disposeObject3D(entry.model));
    state.accepted.length = 0;
    if (group.parent) group.parent.remove(group);
    group.clear();
  };

  return Object.freeze({
    group,
    update,
    getProofSnapshot,
    dispose,
    policy: GEOGRAPHIC_AMBIENT_POLICY,
  });
}
