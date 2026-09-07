import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import {
  analyzeMaterialSurfaces,
  buildRecommendedLayerRecipe,
  createMaterialManifest,
  restoreOriginalMaterials,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';
import {
  attachPreparedWorldAsset,
  prepareWorldAssetForPlacement,
  WORLD_SURFACE_POLICY_PRESETS,
} from './WorldAssetPlacementPipeline.js';
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from './worldReferenceMap.js';
import { terrainMapUvAt } from './terrain.js';

/**
 * Sparse, geography-aware dressing for the outside edge of canonical settlements.
 * It does not create a second settlement system, terrain system, vegetation system or NPC system.
 * Residential and functional landmark ownership remains in the settlement modules.
 */
export const GEOGRAPHIC_SETTLEMENT_PROP_POLICY = Object.freeze({
  id: 'settlement-fringe-geographic-props-2026-09-07-v1',
  canonicalMapAuthority: 'owner-world-map-2026-08-08',
  sourceAssetAuthority: 'repository-authored-props',
  placementAuthority: 'WorldAssetPlacementPipeline',
  materialAuthority: 'MaterialAssignmentCore',
  assetFirst: true,
  deterministic: true,
  ringMeters: Object.freeze({ min: 162, max: 204 }),
  spacingMeters: 13,
  maxSlopeDegrees: 22,
  minRoadDistanceMeters: 6,
  shorelineMarginMeters: 2,
});

export const GEOGRAPHIC_SETTLEMENT_PROP_ASSETS = Object.freeze({
  barrel: Object.freeze({
    id: 'settlement-prop-barrel',
    src: 'assets/models/props/barrel_zjCQP1TAci.glb',
    category: 'settlement-prop', scale: [0.82, 1.12], yaw: 0.34,
  }),
  crate: Object.freeze({
    id: 'settlement-prop-crate',
    src: 'assets/models/props/crate_3OEFd1AWfa.glb',
    category: 'settlement-prop', scale: [0.78, 1.08], yaw: 0.48,
  }),
  bench: Object.freeze({
    id: 'settlement-prop-stone-bench',
    src: 'assets/models/props/greek_stone_bench.glb',
    category: 'settlement-prop', scale: [0.82, 1.02], yaw: 0.12,
  }),
  bonfire: Object.freeze({
    id: 'settlement-prop-bonfire',
    src: 'assets/models/props/bonfire_Azj9hJwwwG.glb',
    category: 'settlement-prop', scale: [0.86, 1.10], yaw: 0.38,
  }),
  farmDirt: Object.freeze({
    id: 'settlement-prop-farm-dirt',
    src: 'assets/models/props/farm_dirt_8BQFbUMOeC.glb',
    category: 'settlement-prop-ground', scale: [0.90, 1.18], yaw: 0.08,
  }),
});

const ROLE_BY_BIOME = Object.freeze({
  snow: 'cold', 'cold-grassland': 'cold', marsh: 'fertile', mountain: 'mountain',
  'rocky-hills': 'mountain', 'lush-grassland': 'fertile', desert: 'arid',
  'temperate-coast': 'maritime', steppe: 'arid', arid: 'arid', jungle: 'jungle',
});

export const GEOGRAPHIC_SETTLEMENT_PROP_ROLES = Object.freeze({
  cold: Object.freeze({ max: 10, families: Object.freeze(['bonfire', 'barrel', 'crate']) }),
  fertile: Object.freeze({ max: 12, families: Object.freeze(['farmDirt', 'crate', 'barrel', 'bench']) }),
  maritime: Object.freeze({ max: 11, families: Object.freeze(['barrel', 'crate', 'bench']) }),
  mountain: Object.freeze({ max: 10, families: Object.freeze(['bench', 'barrel', 'crate', 'bonfire']) }),
  arid: Object.freeze({ max: 8, families: Object.freeze(['barrel', 'crate']) }),
  jungle: Object.freeze({ max: 8, families: Object.freeze(['crate', 'barrel']) }),
  temperate: Object.freeze({ max: 11, families: Object.freeze(['farmDirt', 'bench', 'barrel', 'crate']) }),
});

function clamp01(value) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function hash(value) {
  let h = 2166136261;
  for (const c of String(value ?? '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rand(seed, index) {
  let x = hash(`${seed}|${index}`);
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 0x100000000;
}
function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function pointOnAnnulus(seed, index, seat, minRadius, maxRadius) {
  const a = rand(seed, index * 2) * Math.PI * 2;
  const r = Math.sqrt(minRadius * minRadius + rand(seed, index * 2 + 1) * (maxRadius * maxRadius - minRadius * minRadius));
  return { x: seat.x + Math.cos(a) * r, z: seat.z + Math.sin(a) * r };
}
function segmentDistance(point, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz;
  if (l2 <= 1e-9) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.z - a.z) * abz) / l2));
  return Math.hypot(point.x - (a.x + abx * t), point.z - (a.z + abz * t));
}
function roadDistance(point, edges) {
  let nearest = Infinity;
  for (const edge of edges || []) {
    const points = Array.isArray(edge.points) ? edge.points : [];
    for (let i = 1; i < points.length; i += 1) nearest = Math.min(nearest, segmentDistance(point, points[i - 1], points[i]));
  }
  return Number.isFinite(nearest) ? nearest : 1e9;
}
function roleAtWorldXZ(x, z) {
  const map = terrainMapUvAt(x, z);
  const nx = clamp01(map.u), ny = clamp01(1 - map.v);
  let winner = null;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(nx, ny, zone);
    if (!winner || influence > winner.influence) winner = { zone, influence };
  }
  const kind = winner?.zone?.kind || 'temperate';
  return Object.freeze({
    roleId: ROLE_BY_BIOME[kind] || 'temperate',
    biomeId: winner?.zone?.id || null,
    biomeKind: kind,
    influence: winner?.influence || 0,
    map,
  });
}
function sampleSurface(x, z, sampleHeightMeters, seaLevelMeters, edges) {
  const h = Number(sampleHeightMeters(x, z));
  const step = 2.5;
  const e = Number(sampleHeightMeters(x + step, z));
  const w = Number(sampleHeightMeters(x - step, z));
  const n = Number(sampleHeightMeters(x, z - step));
  const s = Number(sampleHeightMeters(x, z + step));
  if (![h, e, w, n, s].every(Number.isFinite)) return null;
  const slopeDegrees = Math.atan(Math.hypot((e - w) / (2 * step), (s - n) / (2 * step))) * 180 / Math.PI;
  return Object.freeze({
    height: h,
    slopeDegrees,
    waterDepth: Math.max(0, Number(seaLevelMeters) - h),
    roadDistance: roadDistance({ x, z }, edges),
  });
}
function candidateOkay(candidate, seat, accepted, context, roleId) {
  if (!context || context.slopeDegrees > GEOGRAPHIC_SETTLEMENT_PROP_POLICY.maxSlopeDegrees) return false;
  if (context.waterDepth > 0.02 || context.height <= 2 + 0) return false;
  if (context.roadDistance < GEOGRAPHIC_SETTLEMENT_PROP_POLICY.minRoadDistanceMeters) return false;
  if (distance(candidate, seat) < GEOGRAPHIC_SETTLEMENT_PROP_POLICY.ringMeters.min) return false;
  if (distance(candidate, seat) > GEOGRAPHIC_SETTLEMENT_PROP_POLICY.ringMeters.max) return false;
  for (const other of accepted) if (distance(candidate, other) < GEOGRAPHIC_SETTLEMENT_PROP_POLICY.spacingMeters) return false;
  if (roleId === 'arid' && context.waterDepth > 0) return false;
  return true;
}
function pickFamily(roleId, seed, index, roadDist) {
  const families = GEOGRAPHIC_SETTLEMENT_PROP_ROLES[roleId]?.families || GEOGRAPHIC_SETTLEMENT_PROP_ROLES.temperate.families;
  const cargo = families.filter((family) => family === 'barrel' || family === 'crate');
  const choices = roadDist < 12 && cargo.length ? cargo : families;
  return choices[Math.floor(rand(seed, index + 17) * choices.length) % choices.length];
}
function cloneModel(model) {
  const clone = model?.clone?.(true);
  return clone && !clone.userData?.isPlaceholder ? clone : null;
}
function authoredPbrEvidence(object) {
  const analysis = analyzeMaterialSurfaces(object);
  for (const surface of analysis.surfaces) {
    const m = surface.material;
    if (!m) continue;
    if (['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'].some((key) => m[key]?.isTexture)) return true;
  }
  return false;
}
function materialRecipe(object, asset) {
  return buildRecommendedLayerRecipe(object, {
    metadata: { id: asset.id, name: asset.id, category: asset.category, src: asset.src },
    paletteId: asset.id.includes('bonfire') ? 'iron' : asset.id.includes('farm-dirt') ? 'earth' : 'wood',
    textureSize: 256,
    targetMeshIndex: 0,
  });
}
function roadAlignedYaw(point, edges, fallback) {
  let nearest = Infinity, yaw = null;
  for (const edge of edges || []) {
    const points = Array.isArray(edge.points) ? edge.points : [];
    for (let i = 1; i < points.length; i += 1) {
      const d = segmentDistance(point, points[i - 1], points[i]);
      if (d < nearest) {
        nearest = d;
        yaw = Math.atan2(points[i].z - points[i - 1].z, points[i].x - points[i - 1].x) + Math.PI / 2;
      }
    }
  }
  return Number.isFinite(yaw) ? yaw : fallback;
}
export function planGeographicSettlementProps({ seats = [], roadEdges = [], sampleHeightMeters, seaLevelMeters, isMobileClass = false, radiusMeters = Infinity }) {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  if (!Number.isFinite(Number(seaLevelMeters))) throw new TypeError('seaLevelMeters must be finite');
  const allPlans = [];
  for (let seatIndex = 0; seatIndex < seats.length; seatIndex += 1) {
    const seat = seats[seatIndex];
    if (!Number.isFinite(seat?.x) || !Number.isFinite(seat?.z)) continue;
    const role = roleAtWorldXZ(seat.x, seat.z).roleId;
    const profile = GEOGRAPHIC_SETTLEMENT_PROP_ROLES[role] || GEOGRAPHIC_SETTLEMENT_PROP_ROLES.temperate;
    const target = Math.min(profile.max, isMobileClass ? 5 : 12);
    const seed = hash(`${GEOGRAPHIC_SETTLEMENT_PROP_POLICY.id}|${seat.id || seatIndex}|${role}`);
    const placements = [];
    for (let attempt = 0; attempt < target * 8 && placements.length < target; attempt += 1) {
      const p = pointOnAnnulus(seed, attempt, seat, GEOGRAPHIC_SETTLEMENT_PROP_POLICY.ringMeters.min, GEOGRAPHIC_SETTLEMENT_PROP_POLICY.ringMeters.max);
      if (Math.hypot(p.x, p.z) > Number(radiusMeters) + 120) continue;
      const surface = sampleSurface(p.x, p.z, sampleHeightMeters, seaLevelMeters, roadEdges);
      if (!candidateOkay(p, seat, placements, surface, role)) continue;
      const family = pickFamily(role, `${seed}:${attempt}`, attempt, surface.roadDistance);
      placements.push(Object.freeze({
        seatId: seat.id || `seat-${seatIndex}`,
        seatIndex, candidateIndex: attempt, x: p.x, z: p.z,
        seatX: seat.x, seatZ: seat.z, distanceFromSeat: distance(p, seat), family,
        asset: GEOGRAPHIC_SETTLEMENT_PROP_ASSETS[family], roleId: role,
        ...surface, ...roleAtWorldXZ(p.x, p.z),
        yaw: roadAlignedYaw(p, roadEdges, rand(seed, attempt + 31) * Math.PI * 2),
      }));
    }
    allPlans.push(Object.freeze({ seatId: seat.id || `seat-${seatIndex}`, roleId: role, targetCount: target, placements: Object.freeze(placements) }));
  }
  return Object.freeze(allPlans);
}
export function validateGeographicSettlementPropPlan(plan) {
  const errors = [];
  for (const seat of plan || []) {
    let previous = null;
    for (const [index, p] of (seat.placements || []).entries()) {
      if (!GEOGRAPHIC_SETTLEMENT_PROP_ASSETS[p.family]) errors.push(`${seat.seatId}:${index}:family`);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) errors.push(`${seat.seatId}:${index}:coords`);
      if (p.distanceFromSeat < 162 || p.distanceFromSeat > 204) errors.push(`${seat.seatId}:${index}:ring`);
      if (p.slopeDegrees > 22) errors.push(`${seat.seatId}:${index}:slope`);
      if (p.waterDepth > 0.02) errors.push(`${seat.seatId}:${index}:water`);
      if (p.roadDistance < 6) errors.push(`${seat.seatId}:${index}:road`);
      if (previous && previous.family === p.family) errors.push(`${seat.seatId}:${index}:adjacent-repeat`);
      previous = p;
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}
export function summarizeGeographicSettlementPropPlan(plan) {
  const placements = (plan || []).flatMap((entry) => entry.placements || []);
  const families = [...new Set(placements.map((entry) => entry.family))].sort();
  let minPair = Infinity;
  for (let i = 0; i < placements.length; i += 1) for (let j = i + 1; j < placements.length; j += 1)
    if (placements[i].seatId === placements[j].seatId) minPair = Math.min(minPair, distance(placements[i], placements[j]));
  return Object.freeze({
    policyId: GEOGRAPHIC_SETTLEMENT_PROP_POLICY.id, placementCount: placements.length,
    familyCount: families.length, familyIds: families, seatCount: plan?.length || 0,
    minPairDistanceMeters: Number.isFinite(minPair) ? minPair : 0,
  });
}
export function worldPlacementPolicyForGeographicSettlementProps() {
  return Object.freeze({ ...WORLD_SURFACE_POLICY_PRESETS.waterside, maxSlopeDegrees: 22, maxWaterDepth: 0.02, minRoadDistance: 6 });
}
export async function createGeographicSettlementPropLayer({ scene, seats = [], roadEdges = [], sampleHeightMeters, seaLevelMeters, radiusMeters = Infinity, isMobileClass = false }) {
  if (!scene) throw new TypeError('scene is required');
  const group = new THREE.Group();
  group.name = 'geographic-settlement-props';
  const plan = planGeographicSettlementProps({ seats, roadEdges, sampleHeightMeters, seaLevelMeters, radiusMeters, isMobileClass });
  const loader = new AssetLoader();
  const cache = new Map();
  const hydrated = new Set();
  const failed = new Set();
  const query = (x, z) => sampleSurface(x, z, sampleHeightMeters, seaLevelMeters, roadEdges);
  for (const seat of plan) for (let index = 0; index < seat.placements.length; index += 1) {
    const placement = seat.placements[index], asset = placement.asset;
    let source = cache.get(asset.src);
    if (!source) {
      source = await loader.loadModel(asset.src, { fallbackColor: 0xff00ff, fallbackSize: 1 });
      if (!source || source.userData?.isPlaceholder) { failed.add(placement.family); continue; }
      cache.set(asset.src, source);
    }
    const object = cloneModel(source);
    if (!object) { failed.add(placement.family); continue; }
    object.position.set(placement.x, 0, placement.z);
    const scale = asset.scale[0] + (asset.scale[1] - asset.scale[0]) * rand(`${placement.seatId}|${placement.family}`, index);
    object.scale.setScalar(scale);
    object.rotation.y = placement.yaw;
    const authored = authoredPbrEvidence(object);
    const recipe = materialRecipe(object, asset);
    const prepared = prepareWorldAssetForPlacement(object, {
      metadata: { id: asset.id, name: asset.id, category: asset.category, src: asset.src },
      materialRecipe: recipe,
      surfaceQuery: query,
      placementPolicy: worldPlacementPolicyForGeographicSettlementProps(),
      requireSurfaceContext: true,
      snapToGround: true,
      footprintGrounding: 'auto',
      requireGeneratedTexture: true,
    });
    if (!prepared.ok) { failed.add(placement.family); continue; }
    if (authored) {
      restoreOriginalMaterials(object);
      object.userData.materialRecipe = Object.freeze({ version: 1, mode: 'preserve-authored', source: asset.src });
      const finalValidation = validateMaterialAssignment(object, { requireGeneratedTexture: false });
      if (!finalValidation.ok) { failed.add(placement.family); continue; }
      prepared.manifest = { ...prepared.manifest, ...createMaterialManifest(object, { metadata: { id: asset.id, name: asset.id, category: asset.category, src: asset.src }, placement: prepared.manifest.placement }), validation: finalValidation, authoredPbrPreserved: true };
      object.userData.worldPlacementManifest = prepared.manifest;
    }
    const attached = attachPreparedWorldAsset(group, prepared);
    if (!attached.ok) { failed.add(placement.family); continue; }
    hydrated.add(placement.family);
    object.userData.geographicSettlementProp = true;
    object.userData.geographicSettlementPropPolicyId = GEOGRAPHIC_SETTLEMENT_PROP_POLICY.id;
    object.userData.geographicSourceAsset = asset.src;
    object.userData.geographicSeatId = placement.seatId;
    object.userData.geographicRole = placement.roleId;
    object.userData.geographicBiomeId = placement.biomeId;
    object.userData.geographicPlacement = { x: placement.x, z: placement.z, distanceFromSeat: placement.distanceFromSeat, slopeDegrees: placement.slopeDegrees, roadDistance: placement.roadDistance };
    object.userData.geographicManifest = prepared.manifest;
  }
  group.userData.geographicSettlementProps = Object.freeze({ policyId: GEOGRAPHIC_SETTLEMENT_PROP_POLICY.id, placementCount: group.children.length, seatCount: plan.length, hydratedAssetFamilies: [...hydrated].sort(), failedAssetFamilies: [...failed].sort(), manifestCount: group.children.filter((child) => child.userData?.geographicManifest).length });
  scene.add(group);
  return Object.freeze({ ok: true, group, plan, hydratedAssetFamilies: [...hydrated].sort(), failedAssetFamilies: [...failed].sort(), stats: group.userData.geographicSettlementProps });
}
