import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import {
  autoAssignMaterials,
  analyzeMaterialSurfaces,
  createMaterialManifest,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';
import { attachPreparedWorldAsset, resolveWorldSurfacePlacement } from './WorldAssetPlacementPipeline.js';
import { WORLD_REFERENCE_MAP, REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from './worldReferenceMap.js';
import { worldXZToNormalizedReference } from './worldReferenceAlignment.js';

/**
 * Bounded, render-only ambient population around canonical settlement seats.
 * It does not replace NPC AI, factions, ecology or spawn systems; it only adds visual human life
 * and records geographic/material provenance. Existing authored maps are retained whenever present.
 */
export const GEOGRAPHIC_AMBIENT_POLICY = Object.freeze({
  id: 'geographic-ambient-characters-2026-09-07-v2',
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
  updateIntervalSeconds: 0.2,
  showDistanceMeters: 700,
  hideDistanceMeters: 920,
  scaleRange: Object.freeze([0.93, 1.07]),
});

export const AMBIENT_CHARACTER_ASSETS = Object.freeze({
  peasant: Object.freeze({
    id: 'peasant-girl', src: 'assets/models/characters/peasant_girl.fbx', paletteId: 'peasant',
    role: 'settlement-worker', allowedKinds: Object.freeze(['lush-grassland', 'temperate-coast', 'cold-grassland', 'marsh', 'jungle']),
  }),
  knight: Object.freeze({
    id: 'paladin-j-nordstrom', src: 'assets/models/characters/paladin_j_nordstrom.fbx', paletteId: 'knight',
    role: 'road-guard', allowedKinds: Object.freeze(['mountain', 'rocky-hills', 'cold-grassland', 'temperate-coast']),
  }),
  ranger: Object.freeze({
    id: 'erika-archer', src: 'assets/models/characters/erika_archer.fbx', paletteId: 'soldier',
    role: 'frontier-scout', allowedKinds: Object.freeze(['steppe', 'desert', 'arid', 'lush-grassland', 'rocky-hills', 'jungle', 'temperate-coast']),
  }),
});

const KIND_TO_ASSET = Object.freeze({
  snow: 'knight', 'cold-grassland': 'knight', mountain: 'knight', 'rocky-hills': 'knight',
  marsh: 'peasant', 'lush-grassland': 'peasant', 'temperate-coast': 'peasant', jungle: 'peasant',
  desert: 'ranger', arid: 'ranger', steppe: 'ranger',
});

const REGION_PALETTES = Object.freeze({
  snow: 'knight', 'cold-grassland': 'knight', mountain: 'knight', 'rocky-hills': 'knight',
  marsh: 'peasant', 'lush-grassland': 'peasant', 'temperate-coast': 'peasant', jungle: 'peasant',
  desert: 'soldier', arid: 'soldier', steppe: 'soldier',
});

const hash32 = (value) => {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
};
const hash01 = (value) => hash32(value) / 4294967295;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const distance2D = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));

function pointToSegmentDistance(point, a, b) {
  const px = finite(point?.x), pz = finite(point?.z), ax = finite(a?.x), az = finite(a?.z), bx = finite(b?.x), bz = finite(b?.z);
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
  if (len2 <= 1e-9) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

function nearestRoadDistance(x, z, roadEdges) {
  let best = Infinity;
  for (const edge of roadEdges || []) {
    const points = Array.isArray(edge?.points) ? edge.points : [];
    for (let index = 1; index < points.length; index += 1) best = Math.min(best, pointToSegmentDistance({ x, z }, points[index - 1], points[index]));
  }
  return Number.isFinite(best) ? best : Infinity;
}

function nearestSeatDistance(x, z, seats) {
  let best = Infinity;
  for (const seat of seats || []) best = Math.min(best, distance2D({ x, z }, seat));
  return Number.isFinite(best) ? best : Infinity;
}

export function geographicBiomeAtWorldXZ(worldX, worldZ, mapBounds, metersPerMapUnit) {
  const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
  let best = null;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(normalized.x, normalized.y, zone);
    if (influence > 0 && (!best || influence > best.influence)) best = { id: zone.id, kind: zone.kind, influence };
  }
  return best || { id: 'unclassified', kind: 'lush-grassland', influence: 0 };
}

export function buildAmbientSurfaceQuery({ groundCollider, roadEdges, settlementSeats, mapBounds, metersPerMapUnit, waterLevelMeters }) {
  if (!groundCollider || typeof groundCollider.getGroundHeight !== 'function') throw new TypeError('canonical groundCollider sampler required');
  const ground = (x, z) => {
    const height = groundCollider.getGroundHeight(x, z);
    if (!Number.isFinite(height)) throw new TypeError('canonical ground height is non-finite');
    return height;
  };
  return (x, z) => {
    const height = ground(x, z), x1 = ground(x + 1.5, z), z1 = ground(x, z + 1.5);
    const slopeDegrees = Math.atan(Math.hypot(x1 - height, z1 - height) / 1.5) * 180 / Math.PI;
    const biome = geographicBiomeAtWorldXZ(x, z, mapBounds, metersPerMapUnit);
    return {
      height, slopeDegrees, waterDepth: Math.max(0, finite(waterLevelMeters) - height),
      roadDistance: nearestRoadDistance(x, z, roadEdges), settlementDistance: nearestSeatDistance(x, z, settlementSeats),
      biome: biome.kind, biomeId: biome.id, biomeInfluence: biome.influence,
    };
  };
}

export function planGeographicAmbientPlacements({ settlementSeats, surfaceQuery, seed, maxInstances, policy = GEOGRAPHIC_AMBIENT_POLICY }) {
  const seats = Array.isArray(settlementSeats) ? settlementSeats : [];
  const budget = Math.max(0, Math.floor(finite(maxInstances, policy.desktopBudget)));
  if (typeof surfaceQuery !== 'function') throw new TypeError('surfaceQuery is required');
  const placements = [], rejected = [];
  for (let seatIndex = 0; seatIndex < seats.length && placements.length < budget; seatIndex += 1) {
    const seat = seats[seatIndex];
    if (!Number.isFinite(Number(seat?.x)) || !Number.isFinite(Number(seat?.z))) { rejected.push({ seatId: seat?.id || seatIndex, reason: 'non-finite-seat' }); continue; }
    const seatSeed = hash32(`${seed}|${seat.id || seatIndex}`);
    for (let candidateIndex = 0; candidateIndex < 8; candidateIndex += 1) {
      const candidateSeed = hash32(`${seatSeed}|${candidateIndex}`);
      const angle = hash01(`${candidateSeed}|a`) * Math.PI * 2;
      const radius = policy.placementRadiusMeters.min + hash01(`${candidateSeed}|r`) * (policy.placementRadiusMeters.max - policy.placementRadiusMeters.min);
      const x = Number(seat.x) + Math.cos(angle) * radius, z = Number(seat.z) + Math.sin(angle) * radius;
      let sample;
      try { sample = surfaceQuery(x, z); } catch (error) { rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: `surface:${error.message || 'throw'}` }); continue; }
      if (!sample || !Number.isFinite(Number(sample.height))) { rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: 'non-finite-ground' }); continue; }
      if (sample.slopeDegrees > policy.maxSlopeDegrees) { rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: 'slope' }); continue; }
      if (sample.waterDepth > policy.maxWaterDepthMeters) { rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: 'water' }); continue; }
      if (Number.isFinite(sample.roadDistance) && sample.roadDistance < policy.minRoadDistanceMeters) { rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: 'road' }); continue; }
      if (Number.isFinite(sample.settlementDistance) && (sample.settlementDistance < policy.minSettlementDistanceMeters || sample.settlementDistance > policy.maxSettlementDistanceMeters)) { rejected.push({ seatId: seat.id || seatIndex, candidateIndex, reason: 'settlement-distance' }); continue; }
      const key = KIND_TO_ASSET[sample.biome] || 'ranger';
      placements.push({
        id: `ambient-${seat.id || seatIndex}-${placements.length}`, seatId: seat.id || `seat-${seatIndex}`, x, z, y: sample.height,
        biome: sample.biome, biomeId: sample.biomeId || null, biomeInfluence: finite(sample.biomeInfluence),
        assetKey: key, assetId: AMBIENT_CHARACTER_ASSETS[key].id, modelUrl: AMBIENT_CHARACTER_ASSETS[key].src,
        role: AMBIENT_CHARACTER_ASSETS[key].role, paletteId: REGION_PALETTES[sample.biome] || AMBIENT_CHARACTER_ASSETS[key].paletteId,
        scale: policy.scaleRange[0] + hash01(`${candidateSeed}|s`) * (policy.scaleRange[1] - policy.scaleRange[0]),
        groundSlopeDegrees: sample.slopeDegrees, roadDistanceMeters: sample.roadDistance,
        settlementDistanceMeters: sample.settlementDistance,
      });
      break;
    }
  }
  return Object.freeze({ placements: Object.freeze(placements), rejected: Object.freeze(rejected), requested: budget, accepted: placements.length });
}

function findTextureMaps(root) {
  const maps = [];
  analyzeMaterialSurfaces(root).surfaces.forEach((surface) => {
    const material = surface.material;
    for (const texture of [material?.map, material?.normalMap, material?.roughnessMap, material?.metalnessMap, material?.aoMap, material?.emissiveMap]) {
      const width = Number(texture?.image?.width), height = Number(texture?.image?.height);
      if (width > 0 && height > 0) maps.push({ width, height });
    }
  });
  return maps;
}

function preservesAuthoredMaterial(root) {
  return analyzeMaterialSurfaces(root).surfaces.some(({ material }) => Boolean(material?.map || material?.normalMap || material?.roughnessMap || material?.metalnessMap || material?.aoMap || material?.emissiveMap));
}

function dressTexturelessModel(root, profile, placement) {
  return autoAssignMaterials(root, {
    metadata: { id: profile.id, name: `${profile.role}-${placement.biome}`, category: 'ambient-character', src: profile.src },
    paletteId: profile.paletteId,
    textureSize: 256,
  });
}

function prepareAmbientModel(model, placement, profile, surfaceQuery) {
  const authored = preservesAuthoredMaterial(model);
  if (!authored) {
    const materialResult = dressTexturelessModel(model, profile, placement);
    if (!materialResult.ok) return { ok: false, error: `material:${materialResult.error || 'assignment-failed'}` };
  }
  const placementResult = resolveWorldSurfacePlacement(model, {
    metadata: { id: profile.id, name: profile.role, category: 'ambient-character', src: profile.src },
    position: { x: placement.x, y: placement.y, z: placement.z }, surfaceQuery,
    placementPolicy: {
      maxSlopeDegrees: GEOGRAPHIC_AMBIENT_POLICY.maxSlopeDegrees, maxWaterDepth: GEOGRAPHIC_AMBIENT_POLICY.maxWaterDepthMeters,
      minRoadDistance: GEOGRAPHIC_AMBIENT_POLICY.minRoadDistanceMeters, minSettlementDistance: GEOGRAPHIC_AMBIENT_POLICY.minSettlementDistanceMeters,
      maxSettlementDistance: GEOGRAPHIC_AMBIENT_POLICY.maxSettlementDistanceMeters, allowedBiomes: profile.allowedKinds,
    },
    requireSurfaceContext: true, snapToGround: true, footprintGrounding: 'auto', foundationInsetMeters: 0.01,
  });
  if (!placementResult.ok) return placementResult;
  const validation = validateMaterialAssignment(model, { requireGeneratedTexture: !authored });
  if (!validation.ok) return { ok: false, error: validation.errors.join(',') };
  const manifest = createMaterialManifest(model, {
    metadata: { id: profile.id, name: profile.role, category: 'ambient-character', src: profile.src },
    placement: {
      x: model.position.x, y: model.position.y, z: model.position.z, biome: placement.biome, seatId: placement.seatId,
      materialMode: authored ? 'preserve-authored-material' : 'layered-fallback', textureSizes: findTextureMaps(model),
    },
  });
  model.userData.worldPlacementSurface = placementResult.surface;
  model.userData.worldPlacementFootprint = placementResult.footprint || null;
  model.userData.worldPlacementPolicy = placementResult.placementPolicy;
  model.userData.worldPlacementManifest = manifest;
  model.userData.materialReadyForWorld = true;
  model.userData.geographicAmbientSourceMaterial = authored ? 'authored' : 'generated-layered';
  model.userData.geographicAmbientTextureSizes = findTextureMaps(model);
  return { ok: true, model, manifest };
}

export async function createGeographicAmbientCharacterDirector({ assetLoader, scene, settlementSeats, roadEdges, groundCollider, mapBounds, metersPerMapUnit, waterLevelMeters, seed, maxInstances = GEOGRAPHIC_AMBIENT_POLICY.desktopBudget } = {}) {
  if (!assetLoader || typeof assetLoader.loadFBXModel !== 'function') throw new TypeError('assetLoader is required');
  if (!scene || typeof scene.add !== 'function') throw new TypeError('scene is required');
  const surfaceQuery = buildAmbientSurfaceQuery({ groundCollider, roadEdges, settlementSeats, mapBounds, metersPerMapUnit, waterLevelMeters });
  const plan = planGeographicAmbientPlacements({ settlementSeats, surfaceQuery, seed, maxInstances });
  const group = new THREE.Group();
  group.name = 'Geographic Ambient Characters';
  group.userData.policyId = GEOGRAPHIC_AMBIENT_POLICY.id;
  group.userData.sourceMapId = GEOGRAPHIC_AMBIENT_POLICY.sourceMapId;
  group.userData.sourceMapSha256 = GEOGRAPHIC_AMBIENT_POLICY.sourceMapSha256;

  const baseModels = new Map(), loadDiagnostics = [], accepted = [], rejected = [...plan.rejected];
  for (const key of [...new Set(plan.placements.map((entry) => entry.assetKey))]) {
    const profile = AMBIENT_CHARACTER_ASSETS[key];
    const model = await assetLoader.loadFBXModel(profile.src, { fallbackColor: 0xff00ff, fallbackSize: 1 });
    if (!model || model.userData?.isPlaceholder) { loadDiagnostics.push({ assetId: profile.id, src: profile.src, ok: false, reason: 'placeholder-or-missing' }); continue; }
    AssetLoader.correctMixamoFbxScale(model);
    const analysis = analyzeMaterialSurfaces(model);
    loadDiagnostics.push({ assetId: profile.id, src: profile.src, ok: true, meshCount: analysis.meshCount, surfaceCount: analysis.surfaceCount, textureSizes: findTextureMaps(model), authoredMaterial: preservesAuthoredMaterial(model) });
    baseModels.set(key, model);
  }

  for (const placement of plan.placements) {
    const source = baseModels.get(placement.assetKey);
    if (!source) { rejected.push({ id: placement.id, reason: 'asset-family-unavailable' }); continue; }
    const profile = AMBIENT_CHARACTER_ASSETS[placement.assetKey];
    const model = source.clone(true);
    model.scale.multiplyScalar(placement.scale);
    model.userData.geographicAmbientId = placement.id;
    const prepared = prepareAmbientModel(model, placement, profile, surfaceQuery);
    if (!prepared.ok) { rejected.push({ id: placement.id, reason: prepared.error || 'placement-failed' }); AssetLoader.disposeObject3D(model); continue; }
    const attached = attachPreparedWorldAsset(group, prepared);
    if (!attached.ok) { rejected.push({ id: placement.id, reason: attached.error || 'attach-failed' }); AssetLoader.disposeObject3D(model); continue; }
    accepted.push({ id: placement.id, seatId: placement.seatId, biome: placement.biome, biomeId: placement.biomeId, role: placement.role, assetId: placement.assetId, paletteId: placement.paletteId, materialMode: model.userData.geographicAmbientSourceMaterial, textureSizes: model.userData.geographicAmbientTextureSizes, position: { x: model.position.x, y: model.position.y, z: model.position.z }, groundSlopeDegrees: placement.groundSlopeDegrees, roadDistanceMeters: placement.roadDistanceMeters, settlementDistanceMeters: placement.settlementDistanceMeters, manifestValid: Boolean(model.userData.worldPlacementManifest?.validation?.ok), model });
  }
  for (const model of baseModels.values()) AssetLoader.disposeObject3D(model);
  scene.add(group);

  let accumulator = 0, visibleCount = accepted.length;
  const update = (cameraPosition, delta = 0) => {
    accumulator += Math.max(0, finite(delta));
    if (accumulator < GEOGRAPHIC_AMBIENT_POLICY.updateIntervalSeconds) return;
    accumulator = 0; visibleCount = 0;
    for (const entry of accepted) {
      const distance = distance2D(cameraPosition || { x: 0, z: 0 }, entry.model.position);
      if (entry.model.visible !== false && distance > GEOGRAPHIC_AMBIENT_POLICY.hideDistanceMeters) entry.model.visible = false;
      else if (entry.model.visible === false && distance < GEOGRAPHIC_AMBIENT_POLICY.showDistanceMeters) entry.model.visible = true;
      if (entry.model.visible) visibleCount += 1;
      entry.distanceMeters = distance;
    }
  };
  const getProofSnapshot = () => Object.freeze({
    policyId: GEOGRAPHIC_AMBIENT_POLICY.id, sourceMapId: GEOGRAPHIC_AMBIENT_POLICY.sourceMapId, sourceMapSha256: GEOGRAPHIC_AMBIENT_POLICY.sourceMapSha256,
    requested: plan.requested, accepted: accepted.length, rejected: rejected.length, visibleCount,
    assetLoads: loadDiagnostics.map((entry) => ({ ...entry })),
    placements: accepted.map(({ model, ...entry }) => ({ ...entry })),
    rejectionReasons: rejected.reduce((result, entry) => { const reason = entry.reason || 'unknown'; result[reason] = (result[reason] || 0) + 1; return result; }, {}),
  });
  const dispose = () => { accepted.forEach((entry) => AssetLoader.disposeObject3D(entry.model)); accepted.length = 0; if (group.parent) group.parent.remove(group); group.clear(); };
  return Object.freeze({ group, update, getProofSnapshot, dispose, policy: GEOGRAPHIC_AMBIENT_POLICY });
}
