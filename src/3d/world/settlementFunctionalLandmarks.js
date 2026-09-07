/**
 * Thin runtime extension for existing villages: functional settlement services around canonical
 * hamlets. No second quest/economy/inventory framework and no terrain ownership.
 * Every source model is hydrated by the existing loader and passes the shared material/placement core
 * before scene attachment. Missing authored assets fail closed; no primitive service buildings are made.
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import { analyzeMaterialSurfaces } from '../materials/MaterialAssignmentCore.js';
import { placeWorldAsset, WORLD_SURFACE_POLICY_PRESETS } from './WorldAssetPlacementPipeline.js';

export const FUNCTIONAL_LANDMARK_VERSION = 'settlement-functional-landmarks-2026-09-07-v2';
export const FUNCTIONAL_LANDMARK_TEXTURE_SIZE = 512;
export const FUNCTIONAL_LANDMARK_MAX_PER_HAMLET = 2;
export const FUNCTIONAL_LANDMARK_MIN_SPACING_METERS = 14;
export const FUNCTIONAL_LANDMARK_MIN_HOUSE_CLEARANCE_METERS = 9;
export const FUNCTIONAL_LANDMARK_MIN_CENTER_DISTANCE_METERS = 15;
export const FUNCTIONAL_LANDMARK_MAX_CENTER_DISTANCE_METERS = 34;
export const FUNCTIONAL_LANDMARK_MAX_SLOPE_DEGREES = 10;
export const FUNCTIONAL_LANDMARK_MAX_WATER_DEPTH_METERS = 0.02;
export const FUNCTIONAL_LANDMARK_MAX_ROAD_DISTANCE_METERS = 30;

const ROLE_DEFS = Object.freeze({
  blacksmith: Object.freeze({
    label: 'Demirci',
    assets: Object.freeze(['assets/models/settlements/blacksmith_bV52eTG1Aj.glb']),
    service: Object.freeze({ kind: 'smithing', action: 'smithing', vendor: true, questHub: false }),
    footprint: Object.freeze({ width: 9, depth: 9 }),
    material: Object.freeze({ base: 'stone', layers: Object.freeze([
      Object.freeze({ to: 0.20, palette: 'stone' }), Object.freeze({ to: 0.58, palette: 'brick' }),
      Object.freeze({ to: 0.74, palette: 'wood' }), Object.freeze({ to: 1, palette: 'iron' }),
    ]) }),
  }),
  barracks: Object.freeze({
    label: 'Kışla',
    assets: Object.freeze(['assets/models/settlements/barracks_UXCOwRBSxx.glb']),
    service: Object.freeze({ kind: 'barracks', action: 'watch', vendor: false, questHub: true }),
    footprint: Object.freeze({ width: 13, depth: 10 }),
    material: Object.freeze({ base: 'stone', layers: Object.freeze([
      Object.freeze({ to: 0.30, palette: 'stone' }), Object.freeze({ to: 0.66, palette: 'brick' }),
      Object.freeze({ to: 0.79, palette: 'wood' }), Object.freeze({ to: 1, palette: 'roof-tile' }),
    ]) }),
  }),
  farm: Object.freeze({
    label: 'Çiftlik ambarı',
    assets: Object.freeze(['assets/models/settlements/barn_0QTh_KUZRYE.glb', 'assets/models/settlements/barn_A6UkPq33aZ.glb']),
    service: Object.freeze({ kind: 'farm', action: 'farm', vendor: false, questHub: false }),
    footprint: Object.freeze({ width: 12, depth: 14 }),
    material: Object.freeze({ base: 'wood', layers: Object.freeze([
      Object.freeze({ to: 0.16, palette: 'stone' }), Object.freeze({ to: 0.68, palette: 'wood' }),
      Object.freeze({ to: 0.82, palette: 'thatch' }), Object.freeze({ to: 1, palette: 'wood' }),
    ]) }),
  }),
  stable: Object.freeze({
    label: 'Ahır ve seyislik',
    assets: Object.freeze(['assets/models/settlements/big_barn_q1N3xn2SpC.glb', 'assets/models/settlements/barn_dSsUaUlaxHk.glb']),
    service: Object.freeze({ kind: 'stable', action: 'mount', vendor: true, questHub: false }),
    footprint: Object.freeze({ width: 14, depth: 15 }),
    material: Object.freeze({ base: 'wood', layers: Object.freeze([
      Object.freeze({ to: 0.14, palette: 'stone' }), Object.freeze({ to: 0.67, palette: 'wood' }),
      Object.freeze({ to: 0.84, palette: 'thatch' }), Object.freeze({ to: 1, palette: 'wood' }),
    ]) }),
  }),
  tavern: Object.freeze({
    label: 'Taverna',
    assets: Object.freeze(['assets/models/settlements/fantasy_house_dcPho4SUA3.glb', 'assets/models/settlements/small_wooden_house.glb']),
    service: Object.freeze({ kind: 'tavern', action: 'rest', vendor: true, questHub: true }),
    footprint: Object.freeze({ width: 11, depth: 10 }),
    material: Object.freeze({ base: 'house', layers: Object.freeze([
      Object.freeze({ to: 0.12, palette: 'stone' }), Object.freeze({ to: 0.58, palette: 'house' }),
      Object.freeze({ to: 0.72, palette: 'wood' }), Object.freeze({ to: 1, palette: 'thatch' }),
    ]) }),
  }),
  market: Object.freeze({
    label: 'Pazar',
    assets: Object.freeze(['assets/models/fbx/Medieval_Market_.fbx', 'assets/models/fbx/Medieval_Market_Asset_Pack.fbx']),
    service: Object.freeze({ kind: 'market', action: 'trade', vendor: true, questHub: false }),
    footprint: Object.freeze({ width: 15, depth: 11 }),
    material: Object.freeze({ base: 'house', layers: Object.freeze([
      Object.freeze({ to: 0.10, palette: 'stone' }), Object.freeze({ to: 0.52, palette: 'wood' }),
      Object.freeze({ to: 0.78, palette: 'house' }), Object.freeze({ to: 1, palette: 'roof-tile' }),
    ]) }),
  }),
});

const REGION_ROLES = Object.freeze({
  north: Object.freeze(['barracks', 'blacksmith']),
  fertile: Object.freeze(['market', 'farm']),
  maritime: Object.freeze(['tavern', 'market']),
  arid: Object.freeze(['market', 'stable']),
  mountain: Object.freeze(['blacksmith', 'stable']),
  temperate: Object.freeze(['tavern', 'market']),
  volcanic: Object.freeze(['blacksmith', 'barracks']),
});

const SEAT_REGIONS = Object.freeze({
  berkalp: 'north', jon: 'north', 'Night King': 'north',
  ziya: 'fertile', berk: 'fertile', olena: 'fertile',
  balon: 'maritime', stannis: 'maritime',
  doran: 'arid', Xaro: 'arid',
  robin: 'mountain', twin: 'temperate', cersei: 'temperate', umit: 'volcanic',
});

const ROLE_ANGLES = Object.freeze({ blacksmith: 2.35, barracks: 0.25, farm: 4.00, stable: 2.90, tavern: 0.75, market: 4.95 });
const ROLE_DISTANCES = Object.freeze({ blacksmith: 27, barracks: 28, farm: 31, stable: 32, tavern: 19, market: 21 });

function hash32(value) {
  let h = 2166136261;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed, key) {
  let state = hash32(`${seed}|${key}`) || 1;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distance(a, b) { return Math.hypot(Number(a?.x) - Number(b?.x), Number(a?.z) - Number(b?.z)); }

function roadDistance(x, z, roadEdges = []) {
  let nearest = Infinity;
  for (const edge of roadEdges) {
    const points = Array.isArray(edge?.points) ? edge.points : [];
    for (let i = 1; i < points.length; i += 1) {
      const ax = Number(points[i - 1]?.x), az = Number(points[i - 1]?.z);
      const bx = Number(points[i]?.x), bz = Number(points[i]?.z);
      const dx = bx - ax, dz = bz - az;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0;
      nearest = Math.min(nearest, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
  }
  return nearest;
}

function surfaceAt(sampleHeightMeters, seaLevelMeters, roadEdges, x, z) {
  const height = Number(sampleHeightMeters(x, z));
  if (!Number.isFinite(height)) return null;
  const delta = 1.5;
  const dx = (Number(sampleHeightMeters(x + delta, z)) - Number(sampleHeightMeters(x - delta, z))) / (delta * 2);
  const dz = (Number(sampleHeightMeters(x, z + delta)) - Number(sampleHeightMeters(x, z - delta))) / (delta * 2);
  return {
    height,
    slopeDegrees: Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI,
    waterDepth: Math.max(0, Number(seaLevelMeters) - height),
    roadDistanceMeters: roadDistance(x, z, roadEdges),
  };
}

function groupHousesBySeat(houses, seats) {
  const groups = new Map(seats.map((seat) => [seat.id, []]));
  for (const house of Array.isArray(houses) ? houses : []) {
    let nearestSeat = null;
    let nearest = Infinity;
    for (const seat of seats) {
      const d = distance(house, seat);
      if (d < nearest) { nearest = d; nearestSeat = seat; }
    }
    if (nearestSeat) groups.get(nearestSeat.id)?.push(house);
  }
  return groups;
}

function buildHamletCentres(houses, seats) {
  const groups = groupHousesBySeat(houses, seats);
  return seats.map((seat) => {
    const entries = groups.get(seat.id) || [];
    if (entries.length === 0) return { seatId: seat.id, regionId: SEAT_REGIONS[seat.id] || 'temperate', hamletIndex: 0, x: Number(seat.x), z: Number(seat.z) };
    const x = entries.reduce((sum, item) => sum + Number(item.x), 0) / entries.length;
    const z = entries.reduce((sum, item) => sum + Number(item.z), 0) / entries.length;
    return { seatId: seat.id, regionId: SEAT_REGIONS[seat.id] || 'temperate', hamletIndex: 0, x, z };
  });
}

function chooseAsset(role, seed, seatId) {
  const assets = ROLE_DEFS[role]?.assets || [];
  if (assets.length === 0) return null;
  return assets[hash32(`${seed}|${seatId}|${role}`) % assets.length];
}

function roleMaterialOptions(object, role) {
  const def = ROLE_DEFS[role];
  const analysis = analyzeMaterialSurfaces(object);
  if (analysis.meshCount === 1 && analysis.surfaceCount <= 1) {
    return { materialRecipe: { version: 1, mode: 'layers', basePaletteId: def.material.base, textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE, targetMeshIndex: 0, layers: def.material.layers.map((layer) => ({ ...layer })) } };
  }
  const surfaceOverrides = {};
  for (const surface of analysis.surfaces) {
    const slot = String(surface.slot || '').toLowerCase();
    if (slot.includes('window') || slot.includes('glass')) surfaceOverrides[surface.key] = 'glass';
    else if (slot.includes('door') || slot.includes('wood') || slot.includes('timber')) surfaceOverrides[surface.key] = 'wood';
    else if (slot.includes('metal') || slot.includes('iron')) surfaceOverrides[surface.key] = 'iron';
    else if (slot.includes('stone') || slot.includes('rock')) surfaceOverrides[surface.key] = 'stone';
    else if (slot.includes('roof') || slot.includes('thatch')) surfaceOverrides[surface.key] = def.material.layers[def.material.layers.length - 1].palette;
  }
  return Object.keys(surfaceOverrides).length
    ? { materialRecipe: { version: 1, mode: 'surface', basePaletteId: def.material.base, textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE, surfaceOverrides } }
    : { paletteId: def.material.base, textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE };
}

function fitModel(source, footprint, site) {
  const model = source.clone(true);
  const pivot = new THREE.Group();
  pivot.name = `functional-landmark-${site.seatId}-${site.role}`;
  pivot.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.x > 1e-5 && size.z > 1e-5 && size.y > 1e-5)) return null;
  const direct = Math.min(footprint.width / size.x, footprint.depth / size.z);
  const quarter = Math.min(footprint.width / size.z, footprint.depth / size.x);
  const quarterTurn = quarter > direct + 1e-9;
  const scale = quarterTurn ? quarter : direct;
  if (!(scale > 1e-6 && Number.isFinite(scale))) return null;
  if (quarterTurn) model.rotation.y += Math.PI / 2;
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  const centered = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  model.position.x -= centered.x;
  model.position.z -= centered.z;
  pivot.userData.footprintFit = Object.freeze({ scale, quarterTurn, width: footprint.width, depth: footprint.depth });
  return pivot;
}

export function planFunctionalSettlementLandmarks({ seats = [], houses = [], sampleHeightMeters, seaLevelMeters, roadEdges = [], seed = 0 } = {}) {
  const centres = buildHamletCentres(houses, seats);
  const plans = [];
  for (const centre of centres) {
    const roles = REGION_ROLES[centre.regionId] || REGION_ROLES.temperate;
    const random = rng(seed, centre.seatId);
    for (let roleIndex = 0; roleIndex < Math.min(roles.length, FUNCTIONAL_LANDMARK_MAX_PER_HAMLET); roleIndex += 1) {
      const role = roles[roleIndex];
      const angle = (ROLE_ANGLES[role] || 0) + (random() - 0.5) * 0.16;
      const radial = (ROLE_DISTANCES[role] || 24) + (random() - 0.5) * 3;
      const x = centre.x + Math.cos(angle) * radial;
      const z = centre.z + Math.sin(angle) * radial;
      const surface = surfaceAt(sampleHeightMeters, seaLevelMeters, roadEdges, x, z);
      if (!surface) continue;
      if (surface.slopeDegrees > FUNCTIONAL_LANDMARK_MAX_SLOPE_DEGREES) continue;
      if (surface.waterDepth > FUNCTIONAL_LANDMARK_MAX_WATER_DEPTH_METERS) continue;
      const selectedHouses = houses.filter((house) => house.seatId === centre.seatId || distance(house, centre) < 70);
      if (selectedHouses.some((house) => distance({ x, z }, house) - Number(house.radius || 0) < FUNCTIONAL_LANDMARK_MIN_HOUSE_CLEARANCE_METERS)) continue;
      if (plans.some((other) => other.seatId === centre.seatId && distance({ x, z }, other) < FUNCTIONAL_LANDMARK_MIN_SPACING_METERS)) continue;
      if ((role === 'market' || role === 'tavern') && Number.isFinite(surface.roadDistanceMeters) && surface.roadDistanceMeters > FUNCTIONAL_LANDMARK_MAX_ROAD_DISTANCE_METERS) continue;
      plans.push(Object.freeze({
        seatId: centre.seatId,
        regionId: centre.regionId,
        hamletIndex: centre.hamletIndex,
        role,
        roleIndex,
        x,
        z,
        angle,
        distanceFromCentre: radial,
        surface,
        assetUrl: chooseAsset(role, seed, centre.seatId),
        assetVersion: FUNCTIONAL_LANDMARK_VERSION,
        service: ROLE_DEFS[role].service,
        footprint: ROLE_DEFS[role].footprint,
      }));
    }
  }
  return Object.freeze(plans);
}

export function validateFunctionalLandmarkPlan(plans = []) {
  const errors = [];
  const perHamlet = new Map();
  for (const plan of plans) {
    if (!ROLE_DEFS[plan?.role]) errors.push(`unknown-role:${plan?.role}`);
    if (!Number.isFinite(plan?.x) || !Number.isFinite(plan?.z)) errors.push(`non-finite-position:${plan?.seatId}`);
    if (!(plan?.distanceFromCentre >= FUNCTIONAL_LANDMARK_MIN_CENTER_DISTANCE_METERS && plan?.distanceFromCentre <= FUNCTIONAL_LANDMARK_MAX_CENTER_DISTANCE_METERS)) errors.push(`centre-distance:${plan?.seatId}:${plan?.role}`);
    if (Number(plan?.surface?.slopeDegrees) > FUNCTIONAL_LANDMARK_MAX_SLOPE_DEGREES) errors.push(`slope:${plan?.seatId}:${plan?.role}`);
    if (Number(plan?.surface?.waterDepth) > FUNCTIONAL_LANDMARK_MAX_WATER_DEPTH_METERS) errors.push(`water:${plan?.seatId}:${plan?.role}`);
    if (plan?.assetVersion !== FUNCTIONAL_LANDMARK_VERSION) errors.push(`asset-version:${plan?.seatId}:${plan?.role}`);
    const key = `${plan?.seatId}|${plan?.hamletIndex}`;
    const group = perHamlet.get(key) || [];
    group.push(plan);
    perHamlet.set(key, group);
  }
  for (const [key, group] of perHamlet) {
    if (group.length > FUNCTIONAL_LANDMARK_MAX_PER_HAMLET) errors.push(`count:${key}`);
    for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) {
      if (distance(group[i], group[j]) < FUNCTIONAL_LANDMARK_MIN_SPACING_METERS) errors.push(`spacing:${key}`);
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), planCount: plans.length, hamletCount: perHamlet.size });
}

export async function placeFunctionalSettlementLandmarks({ assetLoader, villageGroup, seats = [], houses = [], sampleHeightMeters, seaLevelMeters, roadEdges = [], seed = 0 } = {}) {
  if (!assetLoader?.loadModel || !villageGroup || typeof sampleHeightMeters !== 'function') return Object.freeze({ ok: false, error: 'missing-context' });
  const plans = planFunctionalSettlementLandmarks({ seats, houses, sampleHeightMeters, seaLevelMeters, roadEdges, seed });
  const validation = validateFunctionalLandmarkPlan(plans);
  if (!validation.ok) return Object.freeze({ ok: false, ...validation, missingAssetCount: 0, placementFailureCount: 0, materialValidationFailureCount: 0, manifests: [] });
  const group = new THREE.Group();
  group.name = 'village-functional-landmarks';
  const sourceCache = new Map();
  const manifests = [];
  let missingAssetCount = 0, placementFailureCount = 0, materialValidationFailureCount = 0, placedCount = 0;
  for (const plan of plans) {
    const def = ROLE_DEFS[plan.role];
    const cacheKey = `${plan.role}|${plan.assetUrl}`;
    let source = sourceCache.get(cacheKey);
    if (!source) {
      source = plan.assetUrl.endsWith('.fbx')
        ? await assetLoader.loadFBXModel(plan.assetUrl, { fallbackSize: Math.max(def.footprint.width, def.footprint.depth), resourcePath: 'assets/models/fbx/' })
        : await assetLoader.loadModel(plan.assetUrl, { fallbackSize: Math.max(def.footprint.width, def.footprint.depth) });
      sourceCache.set(cacheKey, source);
    }
    if (source?.userData?.isPlaceholder === true) { missingAssetCount += 1; continue; }
    const object = fitModel(source, def.footprint, plan);
    if (!object) { placementFailureCount += 1; continue; }
    const placement = placeWorldAsset(group, object, {
      metadata: { id: `settlement-functional-${plan.seatId}-${plan.role}`, name: def.label, category: 'settlement', src: plan.assetUrl, service: def.service },
      ...roleMaterialOptions(object, plan.role),
      textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE,
      position: new THREE.Vector3(plan.x, 0, plan.z),
      rotation: new THREE.Euler(0, plan.angle + Math.PI, 0),
      surfaceQuery: (x, z) => surfaceAt(sampleHeightMeters, seaLevelMeters, roadEdges, x, z),
      placementPolicy: WORLD_SURFACE_POLICY_PRESETS.settlement,
      requireSurfaceContext: true,
      footprintGrounding: 'always',
      foundationInsetMeters: 0.06,
    });
    if (!placement.ok) {
      placementFailureCount += 1;
      if (placement.validation && placement.validation.ok === false) materialValidationFailureCount += 1;
      continue;
    }
    object.userData.settlementFunctionalId = `settlement-functional-${plan.seatId}-${plan.role}`;
    object.userData.settlementFunctionalRole = plan.role;
    object.userData.settlementFunctionalService = { ...def.service };
    manifests.push(Object.freeze({ id: object.userData.settlementFunctionalId, role: plan.role, seatId: plan.seatId, assetUrl: plan.assetUrl, textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE, surface: placement.surface, footprint: placement.footprint, manifest: placement.manifest }));
    placedCount += 1;
  }
  villageGroup.add(group);
  const evidence = Object.freeze({ ok: villageGroup.userData?.disposed !== true && missingAssetCount === 0 && placementFailureCount === 0 && materialValidationFailureCount === 0, version: FUNCTIONAL_LANDMARK_VERSION, planCount: plans.length, placedCount, missingAssetCount, placementFailureCount, materialValidationFailureCount, textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE, manifests: Object.freeze(manifests) });
  villageGroup.userData.villageFunctionalLandmarkPlans = plans;
  villageGroup.userData.villageFunctionalLandmarkEvidence = evidence;
  return evidence;
}

export const SETTLEMENT_FUNCTIONAL_ASSET_PATHS = Object.freeze([...new Set(Object.values(ROLE_DEFS).flatMap((def) => def.assets))]);
export const SETTLEMENT_FUNCTIONAL_ROLE_SERVICE_MATRIX = Object.freeze(Object.fromEntries(Object.entries(ROLE_DEFS).map(([role, def]) => [role, def.service])));
export function getFunctionalLandmarkService(role) { return ROLE_DEFS[role]?.service ? { ...ROLE_DEFS[role].service } : null; }
export function getFunctionalLandmarkFootprint(role) { return ROLE_DEFS[role]?.footprint ? { ...ROLE_DEFS[role].footprint } : null; }
export function getFunctionalLandmarkRegions() { return Object.freeze(Object.fromEntries(Object.entries(REGION_ROLES).map(([region, roles]) => [region, [...roles]]))); }
export function isKnownFunctionalLandmarkAsset(assetPath) { return SETTLEMENT_FUNCTIONAL_ASSET_PATHS.includes(String(assetPath ?? '')); }
