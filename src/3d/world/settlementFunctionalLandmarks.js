/**
 * Geography-aware functional settlement landmarks.
 *
 * This is a thin runtime extension of the existing `world/villages` builder. It does not own
 * quests, inventory, economy, NPCs, or a second settlement registry; it only turns the existing
 * deterministic hamlet centres into a small number of role-bearing buildings and records the
 * service metadata that the existing interaction/economy layer can consume.
 *
 * Every authored building follows the shared world contract in this order:
 *   load source asset -> inspect surfaces -> choose regional material recipe ->
 *   validate + ground through WorldAssetPlacementPipeline -> emit placement manifest -> attach.
 *
 * No EditorMaterialStudio or DOM code is imported here. Missing/LFS-only sources fail closed;
 * callers keep the already-rendered procedural village rather than inserting primitive stand-ins.
 *
 * @module world/settlementFunctionalLandmarks
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import { analyzeMaterialSurfaces } from '../materials/MaterialAssignmentCore.js';
import {
	placeWorldAsset,
	WORLD_SURFACE_POLICY_PRESETS,
} from './WorldAssetPlacementPipeline.js';
import { isPlaceablePosition } from './vegetation.js';

export const FUNCTIONAL_LANDMARK_TEXTURE_SIZE = 512;
export const FUNCTIONAL_LANDMARK_MAX_PER_HAMLET = 2;
export const FUNCTIONAL_LANDMARK_MIN_SPACING_METERS = 13;
export const FUNCTIONAL_LANDMARK_MIN_HOUSE_CLEARANCE_METERS = 10;
export const FUNCTIONAL_LANDMARK_MIN_CENTER_DISTANCE_METERS = 14;
export const FUNCTIONAL_LANDMARK_MAX_CENTER_DISTANCE_METERS = 32;
export const FUNCTIONAL_LANDMARK_MAX_SLOPE_DEGREES = 10;
export const FUNCTIONAL_LANDMARK_MAX_WATER_DEPTH_METERS = 0.02;
export const FUNCTIONAL_LANDMARK_ROAD_PREFERENCE_MAX_METERS = 26;
export const FUNCTIONAL_LANDMARK_SEARCH_ATTEMPTS = 18;
export const FUNCTIONAL_LANDMARK_ASSET_VERSION = 'functional-settlement-landmarks-2026-09-07-v1';

/**
 * Existing authored assets. These are source paths only; no source asset is modified or derived in
 * this module. Barn variants are deterministic alternatives, while the tavern shell reuses an
 * existing residential GLB because the repository currently exposes no dedicated tavern GLB.
 */
export const SETTLEMENT_FUNCTIONAL_ASSETS = Object.freeze({
	blacksmith: Object.freeze({
		role: 'blacksmith',
		label: 'Demirci',
		loader: 'gltf',
		assets: Object.freeze(['assets/models/settlements/blacksmith_bV52eTG1Aj.glb']),
		service: Object.freeze({ kind: 'smithing', action: 'smithing', vendor: true, questHub: false }),
		footprint: Object.freeze({ width: 9, depth: 9 }),
		material: Object.freeze({ base: 'stone', layers: [{ to: 0.18, palette: 'stone' }, { to: 0.58, palette: 'brick' }, { to: 0.73, palette: 'wood' }, { to: 1, palette: 'iron' }] }),
	}),
	barracks: Object.freeze({
		role: 'barracks',
		label: 'Kışla',
		loader: 'gltf',
		assets: Object.freeze(['assets/models/settlements/barracks_UXCOwRBSxx.glb']),
		service: Object.freeze({ kind: 'barracks', action: 'watch', vendor: false, questHub: true }),
		footprint: Object.freeze({ width: 13, depth: 10 }),
		material: Object.freeze({ base: 'stone', layers: [{ to: 0.28, palette: 'stone' }, { to: 0.68, palette: 'brick' }, { to: 0.78, palette: 'wood' }, { to: 1, palette: 'roof-tile' }] }),
	}),
	farm: Object.freeze({
		role: 'farm',
		label: 'Çiftlik ambarı',
		loader: 'gltf',
		assets: Object.freeze([
			'assets/models/settlements/barn_0QTh_KUZRYE.glb',
			'assets/models/settlements/barn_A6UkPq33aZ.glb',
			'assets/models/settlements/barn_dSsUaUlaxHk.glb',
			'assets/models/settlements/barn_vSqQNA7ez6.glb',
		]),
		service: Object.freeze({ kind: 'farm', action: 'farm', vendor: false, questHub: false }),
		footprint: Object.freeze({ width: 12, depth: 14 }),
		material: Object.freeze({ base: 'house', layers: [{ to: 0.16, palette: 'stone' }, { to: 0.63, palette: 'wood' }, { to: 0.78, palette: 'thatch' }, { to: 1, palette: 'wood' }] }),
	}),
	stable: Object.freeze({
		role: 'stable',
		label: 'Ahır ve seyislik',
		loader: 'gltf',
		assets: Object.freeze(['assets/models/settlements/big_barn_q1N3xn2SpC.glb', 'assets/models/settlements/barn_0QTh_KUZRYE.glb']),
		service: Object.freeze({ kind: 'stable', action: 'mount', vendor: true, questHub: false }),
		footprint: Object.freeze({ width: 13, depth: 15 }),
		material: Object.freeze({ base: 'house', layers: [{ to: 0.14, palette: 'stone' }, { to: 0.65, palette: 'wood' }, { to: 0.82, palette: 'thatch' }, { to: 1, palette: 'wood' }] }),
	}),
	tavern: Object.freeze({
		role: 'tavern',
		label: 'Taverna',
		loader: 'gltf',
		assets: Object.freeze(['assets/models/settlements/fantasy_house_dcPho4SUA3.glb', 'assets/models/settlements/small_wooden_house.glb']),
		service: Object.freeze({ kind: 'tavern', action: 'rest', vendor: true, questHub: true }),
		footprint: Object.freeze({ width: 10, depth: 9 }),
		material: Object.freeze({ base: 'house', layers: [{ to: 0.11, palette: 'stone' }, { to: 0.58, palette: 'house' }, { to: 0.7, palette: 'wood' }, { to: 1, palette: 'thatch' }] }),
	}),
	market: Object.freeze({
		role: 'market',
		label: 'Pazar',
		loader: 'fbx',
		assets: Object.freeze(['assets/models/fbx/Medieval_Market_.fbx', 'assets/models/fbx/Medieval_Market_Asset_Pack.fbx']),
		service: Object.freeze({ kind: 'market', action: 'trade', vendor: true, questHub: false }),
		footprint: Object.freeze({ width: 15, depth: 11 }),
		material: Object.freeze({ base: 'house', layers: [{ to: 0.1, palette: 'stone' }, { to: 0.52, palette: 'wood' }, { to: 0.78, palette: 'house' }, { to: 1, palette: 'roof-tile' }] }),
	}),
});

const REGION_ROLE_ORDER = Object.freeze({
	north: Object.freeze(['barracks', 'blacksmith']),
	fertile: Object.freeze(['market', 'farm']),
	maritime: Object.freeze(['tavern', 'market']),
	arid: Object.freeze(['market', 'stable']),
	mountain: Object.freeze(['blacksmith', 'stable']),
	temperate: Object.freeze(['tavern', 'market']),
	volcanic: Object.freeze(['blacksmith', 'barracks']),
});

const REGION_ROLE_ANCHORS = Object.freeze({
	barracks: 0,
	blacksmith: Math.PI * 0.78,
	farm: Math.PI * 1.86,
	stable: Math.PI * 1.42,
	tavern: Math.PI * 0.26,
	market: Math.PI * 1.02,
});

const REGION_DIRECTION_BIAS = Object.freeze({
	north: -0.12,
	fertile: 0.08,
	maritime: 0.18,
	arid: -0.08,
	mountain: 0.24,
	temperate: -0.18,
	volcanic: 0.31,
});

const ROLE_DISTANCE_BIAS = Object.freeze({
	barracks: 25,
	blacksmith: 28,
	farm: 31,
	stable: 30,
	tavern: 18,
	market: 21,
});

function finite(value) {
	return Number.isFinite(Number(value));
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function wrapAngle(radians) {
	const twoPi = Math.PI * 2;
	let result = radians % twoPi;
	if (result < 0) result += twoPi;
	return result;
}

function stableHash(value) {
	const text = String(value ?? '');
	let hash = 2166136261;
	for (let i = 0; i < text.length; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function createDeterministicRoll(seed, token) {
	let state = (stableHash(`${seed}|${token}`) ^ 0x9e3779b9) >>> 0;
	return () => {
		state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) >>> 0;
		let output = state;
		output = Math.imul(output ^ (output >>> 7), 61 | output) ^ output;
		output = (output ^ (output >>> 14)) >>> 0;
		return output / 4294967296;
	};
}

export function resolveFunctionalLandmarkRoles(regionId) {
	const roles = REGION_ROLE_ORDER[String(regionId ?? '')];
	return roles ? [...roles] : [];
}

export function resolveFunctionalLandmarkRoleAsset(role, seed = 0, slotIndex = 0) {
	const definition = SETTLEMENT_FUNCTIONAL_ASSETS[String(role ?? '')];
	if (!definition?.assets?.length) return null;
	const roll = stableHash(`${seed}|${role}|${slotIndex}`);
	return definition.assets[roll % definition.assets.length];
}

export function buildFunctionalLandmarkMaterialOptions(object, role, regionId) {
	const definition = SETTLEMENT_FUNCTIONAL_ASSETS[String(role ?? '')];
	if (!definition) return null;
	const analysis = analyzeMaterialSurfaces(object);
	const layers = definition.material.layers.map((layer) => ({ ...layer }));
	if (analysis.meshCount === 1 && analysis.surfaceCount <= 1) {
		return {
			materialRecipe: {
				version: 1,
				mode: 'layers',
				basePaletteId: definition.material.base,
				textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE,
				targetMeshIndex: 0,
				layers,
			},
		};
	}
	const overrides = {};
	for (const surface of analysis.surfaces) {
		const slot = String(surface.slot ?? '').toLowerCase();
		let palette = null;
		if (slot.includes('window') || slot.includes('glass')) palette = 'glass';
		else if (slot.includes('metal') || slot.includes('iron') || slot.includes('hardware')) palette = role === 'blacksmith' || role === 'barracks' ? 'iron' : 'wood';
		else if (slot.includes('door') || slot.includes('timber') || slot.includes('wood')) palette = 'wood';
		else if (slot.includes('roof') || slot.includes('thatch')) palette = layers.at(-1)?.palette || 'roof-tile';
		else if (slot.includes('stone') || slot.includes('rock')) palette = 'stone';
		else if (slot.includes('brick') || slot.includes('plaster')) palette = regionId === 'mountain' || regionId === 'volcanic' ? 'brick' : definition.material.base;
		if (palette) overrides[surface.key] = palette;
	}
	if (Object.keys(overrides).length === 0) return { paletteId: definition.material.base, textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE };
	return {
		materialRecipe: {
			version: 1,
			mode: 'surface',
			basePaletteId: definition.material.base,
			textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE,
			surfaceOverrides: overrides,
		},
	};
}

function distance2D(a, b) {
	return Math.hypot(Number(a?.x) - Number(b?.x), Number(a?.z) - Number(b?.z));
}

function nearestHouseDistance(candidate, houses = []) {
	let nearest = Infinity;
	for (const house of houses) {
		const base = distance2D(candidate, house);
		const radius = Math.max(0, Number(house?.radius) || 0);
		nearest = Math.min(nearest, base - radius);
	}
	return nearest;
}

function nearestLandmarkDistance(candidate, landmarks = []) {
	return landmarks.reduce((nearest, landmark) => Math.min(nearest, distance2D(candidate, landmark)), Infinity);
}

function roadDistance(candidate, roadEdges = []) {
	let nearest = Infinity;
	for (const edge of Array.isArray(roadEdges) ? roadEdges : []) {
		const points = Array.isArray(edge?.points) ? edge.points : [];
		for (let index = 1; index < points.length; index += 1) {
			const ax = Number(points[index - 1]?.x);
			const az = Number(points[index - 1]?.z);
			const bx = Number(points[index]?.x);
			const bz = Number(points[index]?.z);
			if (![ax, az, bx, bz].every(Number.isFinite)) continue;
			const abx = bx - ax;
			const abz = bz - az;
			const lengthSquared = abx * abx + abz * abz;
			if (lengthSquared <= 1e-9) {
				nearest = Math.min(nearest, Math.hypot(Number(candidate.x) - ax, Number(candidate.z) - az));
				continue;
			}
			const t = clamp(((Number(candidate.x) - ax) * abx + (Number(candidate.z) - az) * abz) / lengthSquared, 0, 1);
			const projectionX = ax + abx * t;
			const projectionZ = az + abz * t;
			nearest = Math.min(nearest, Math.hypot(Number(candidate.x) - projectionX, Number(candidate.z) - projectionZ));
		}
	}
	return Number.isFinite(nearest) ? nearest : Infinity;
}

function makeCandidate(centre, role, angle, distance, attempt, sampleSurface, roadEdges) {
	const x = Number(centre.x) + Math.cos(angle) * distance;
	const z = Number(centre.z) + Math.sin(angle) * distance;
	const surface = typeof sampleSurface === 'function' ? sampleSurface(x, z) : null;
	return {
		x,
		z,
		role,
		angle,
		distanceFromCentre: distance,
		attempt,
		surface,
		roadDistanceMeters: roadDistance({ x, z }, roadEdges),
	};
}

function candidateAcceptable(candidate, role, houses, landmarks) {
	if (!finite(candidate.x) || !finite(candidate.z)) return false;
	const surface = candidate.surface;
	if (surface) {
		if (finite(surface.slopeDegrees) && Number(surface.slopeDegrees) > FUNCTIONAL_LANDMARK_MAX_SLOPE_DEGREES) return false;
		if (finite(surface.waterDepth) && Number(surface.waterDepth) > FUNCTIONAL_LANDMARK_MAX_WATER_DEPTH_METERS) return false;
	}
	if (nearestHouseDistance(candidate, houses) < FUNCTIONAL_LANDMARK_MIN_HOUSE_CLEARANCE_METERS) return false;
	if (nearestLandmarkDistance(candidate, landmarks) < FUNCTIONAL_LANDMARK_MIN_SPACING_METERS) return false;
	if (role === 'market' && finite(candidate.roadDistanceMeters) && candidate.roadDistanceMeters > FUNCTIONAL_LANDMARK_ROAD_PREFERENCE_MAX_METERS) return false;
	return true;
}

export function planFunctionalLandmarkSite({
	seatId,
	regionId,
	hamletIndex = 0,
	role,
	centre,
	houses = [],
	existingLandmarks = [],
	roadEdges = [],
	sampleSurface = null,
	seed = 0,
	roleIndex = 0,
} = {}) {
	if (!centre || !finite(centre.x) || !finite(centre.z)) return null;
	const definition = SETTLEMENT_FUNCTIONAL_ASSETS[String(role ?? '')];
	if (!definition) return null;
	const random = createDeterministicRoll(`${seed}|${seatId}|${regionId}|${hamletIndex}`, role);
	const anchor = REGION_ROLE_ANCHORS[role] ?? 0;
	const regionalBias = REGION_DIRECTION_BIAS[regionId] ?? 0;
	const radialBias = ROLE_DISTANCE_BIAS[role] ?? FUNCTIONAL_LANDMARK_MIN_CENTER_DISTANCE_METERS;
	const baseAngle = wrapAngle(anchor + regionalBias + roleIndex * Math.PI + (random() - 0.5) * 0.18);
	const centreBase = clamp(radialBias, FUNCTIONAL_LANDMARK_MIN_CENTER_DISTANCE_METERS, FUNCTIONAL_LANDMARK_MAX_CENTER_DISTANCE_METERS);
	const candidates = [];
	for (let attempt = 0; attempt < FUNCTIONAL_LANDMARK_SEARCH_ATTEMPTS; attempt += 1) {
		const ringOffset = attempt === 0 ? 0 : ((attempt + 1) % 4) * 0.16;
		const side = attempt % 2 === 0 ? 1 : -1;
		const angle = wrapAngle(baseAngle + ringOffset * side + (random() - 0.5) * 0.08);
		const distance = clamp(centreBase + (random() - 0.5) * 4 + (attempt > 8 ? (random() - 0.5) * 4 : 0), FUNCTIONAL_LANDMARK_MIN_CENTER_DISTANCE_METERS, FUNCTIONAL_LANDMARK_MAX_CENTER_DISTANCE_METERS);
		const candidate = makeCandidate(centre, role, angle, distance, attempt, sampleSurface, roadEdges);
		candidate.score = scoreFunctionalLandmarkCandidate(candidate, role);
		candidates.push(candidate);
		if (candidateAcceptable(candidate, role, houses, existingLandmarks)) return candidate;
	}
	const fallback = candidates
		.filter((candidate) => candidateAcceptable({ ...candidate, surface: null }, role, houses, existingLandmarks))
		.sort((a, b) => b.score - a.score)[0];
	return fallback ?? null;
}

export function scoreFunctionalLandmarkCandidate(candidate, role) {
	let score = 0;
	const road = Number(candidate?.roadDistanceMeters);
	if (Number.isFinite(road)) score += Math.max(0, 32 - road);
	const centreDistance = Number(candidate?.distanceFromCentre);
	if (Number.isFinite(centreDistance)) score -= Math.abs(centreDistance - (ROLE_DISTANCE_BIAS[role] ?? 24)) * 0.8;
	if (role === 'market') score += Number.isFinite(road) ? Math.max(0, 24 - road) * 2 : 0;
	if (role === 'tavern') score += Number.isFinite(road) ? Math.max(0, 20 - road) : 0;
	if (role === 'blacksmith' || role === 'barracks') score += Number.isFinite(road) ? Math.max(0, road - 6) * 0.3 : 0;
	if (role === 'farm' || role === 'stable') score += Number.isFinite(road) ? Math.min(road, 24) * 0.5 : 0;
	if (candidate?.surface && Number.isFinite(Number(candidate.surface.slopeDegrees))) score -= Number(candidate.surface.slopeDegrees) * 1.8;
	return score;
}

export function buildFunctionalLandmarkPlan({
	seatId,
	regionId,
	hamletIndex = 0,
	centre,
	houses = [],
	roadEdges = [],
	sampleSurface = null,
	seed = 0,
} = {}) {
	const roles = resolveFunctionalLandmarkRoles(regionId).slice(0, FUNCTIONAL_LANDMARK_MAX_PER_HAMLET);
	const planned = [];
	for (let roleIndex = 0; roleIndex < roles.length; roleIndex += 1) {
		const role = roles[roleIndex];
		const site = planFunctionalLandmarkSite({
			seatId,
			regionId,
			hamletIndex,
			role,
			centre,
			houses,
			existingLandmarks: planned,
			roadEdges,
			sampleSurface,
			seed,
			roleIndex,
		});
		if (!site) continue;
		const definition = SETTLEMENT_FUNCTIONAL_ASSETS[role];
		planned.push(Object.freeze({
			...site,
			seatId,
			regionId,
			hamletIndex,
			role,
			label: definition.label,
			roleIndex,
			assetVersion: FUNCTIONAL_LANDMARK_ASSET_VERSION,
			service: definition.service,
			footprint: definition.footprint,
			assetUrl: resolveFunctionalLandmarkRoleAsset(role, seed, roleIndex),
		}));
	}
	return Object.freeze(planned);
}

function normalizeAssetPivot(source, site) {
	if (!source) return null;
	const model = source.clone(true);
	const pivot = new THREE.Group();
	pivot.name = `settlement-functional-${site.seatId}-${site.role}`;
	pivot.userData.settlementFunctionalRole = site.role;
	pivot.userData.settlementFunctionalService = { ...site.service };
	pivot.userData.settlementFunctionalFootprint = { ...site.footprint };
	pivot.add(model);
	model.updateMatrixWorld(true);
	let box = new THREE.Box3().setFromObject(model);
	const sourceSize = box.getSize(new THREE.Vector3());
	if (![sourceSize.x, sourceSize.y, sourceSize.z].every((value) => Number.isFinite(value) && value > 1e-6)) return null;
	const targetWidth = Math.max(1, Number(site.footprint.width) || sourceSize.x);
	const targetDepth = Math.max(1, Number(site.footprint.depth) || sourceSize.z);
	const directScale = Math.min(targetWidth / sourceSize.x, targetDepth / sourceSize.z);
	const turnedScale = Math.min(targetWidth / sourceSize.z, targetDepth / sourceSize.x);
	const quarterTurn = turnedScale > directScale + 1e-9;
	const scale = quarterTurn ? turnedScale : directScale;
	if (!Number.isFinite(scale) || scale <= 1e-6) return null;
	if (quarterTurn) model.rotation.y += Math.PI / 2;
	model.scale.multiplyScalar(scale);
	model.updateMatrixWorld(true);
	box = new THREE.Box3().setFromObject(model);
	const centre = box.getCenter(new THREE.Vector3());
	model.position.x -= centre.x;
	model.position.z -= centre.z;
	pivot.userData.settlementFunctionalFit = Object.freeze({
		scale,
		quarterTurn,
		fittedWidth: (quarterTurn ? sourceSize.z : sourceSize.x) * scale,
		fittedDepth: (quarterTurn ? sourceSize.x : sourceSize.z) * scale,
		parcelCoverage: ((quarterTurn ? sourceSize.z : sourceSize.x) * scale * (quarterTurn ? sourceSize.x : sourceSize.z) * scale) / (targetWidth * targetDepth),
	});
	pivot.updateMatrixWorld(true);
	return pivot;
}

function makeSurfaceQuery(sampleHeightMeters, seaLevelMeters, roadEdges) {
	return (x, z) => {
		if (typeof sampleHeightMeters !== 'function') return null;
		const base = Number(sampleHeightMeters(x, z));
		if (!Number.isFinite(base)) return null;
		const delta = 1.5;
		const x0 = Number(sampleHeightMeters(x - delta, z));
		const x1 = Number(sampleHeightMeters(x + delta, z));
		const z0 = Number(sampleHeightMeters(x, z - delta));
		const z1 = Number(sampleHeightMeters(x, z + delta));
		const slopeX = Number.isFinite(x0) && Number.isFinite(x1) ? (x1 - x0) / (delta * 2) : 0;
		const slopeZ = Number.isFinite(z0) && Number.isFinite(z1) ? (z1 - z0) / (delta * 2) : 0;
		return {
			height: base,
			slopeDegrees: Math.atan(Math.hypot(slopeX, slopeZ)) * 180 / Math.PI,
			waterDepth: Math.max(0, Number(seaLevelMeters) - base),
			roadDistance: roadDistance({ x, z }, roadEdges),
		};
	};
}

function markFunctionalObjectMetadata(object, site, assetUrl) {
	object.userData.settlementFunctionalId = `${site.seatId}:${site.role}`;
	object.userData.settlementFunctionalRole = site.role;
	object.userData.settlementFunctionalLabel = site.label;
	object.userData.settlementFunctionalAssetUrl = assetUrl;
	object.userData.settlementFunctionalService = { ...site.service };
	object.userData.settlementFunctionalInteraction = Object.freeze({
		kind: 'settlement-service',
		siteId: `${site.seatId}-${site.role}`,
		serviceId: site.role,
		action: site.service.action,
	});
}

export async function placeFunctionalSettlementLandmarks({
	assetLoader,
	villageGroup,
	sampleHeightMeters,
	seaLevelMeters,
	roadEdges = [],
	seed = 0,
} = {}) {
	if (!assetLoader || !villageGroup || typeof sampleHeightMeters !== 'function') {
		return Object.freeze({ ok: false, error: 'missing-functional-landmark-context' });
	}
	const centres = Array.isArray(villageGroup.userData?.villageHamletCenters) ? villageGroup.userData.villageHamletCenters : [];
	const houses = Array.isArray(villageGroup.userData?.villageHouses) ? villageGroup.userData.villageHouses : [];
	const surfaceQuery = makeSurfaceQuery(sampleHeightMeters, seaLevelMeters, roadEdges);
	const landmarkGroup = new THREE.Group();
	landmarkGroup.name = 'village-functional-landmarks';
	const plans = [];
	for (const centre of centres) {
		const planned = buildFunctionalLandmarkPlan({
			seatId: centre.seatId,
			regionId: centre.regionId,
			hamletIndex: centre.hamletIndex,
			centre,
			houses: houses.filter((house) => house.seatId === centre.seatId),
			roadEdges,
			sampleSurface: surfaceQuery,
			seed,
		});
		plans.push(...planned);
	}
	const sourceCache = new Map();
	const manifests = [];
	let placedCount = 0;
	let missingAssetCount = 0;
	let placementFailureCount = 0;
	let materialValidationFailureCount = 0;
	for (const site of plans) {
		if (villageGroup.userData?.disposed === true) break;
		const definition = SETTLEMENT_FUNCTIONAL_ASSETS[site.role];
		const assetUrl = site.assetUrl;
		const cacheKey = `${definition.loader}:${assetUrl}`;
		let source = sourceCache.get(cacheKey);
		if (!source) {
			if (definition.loader === 'fbx') source = await assetLoader.loadFBXModel(assetUrl, { fallbackSize: Math.max(definition.footprint.width, definition.footprint.depth), resourcePath: 'assets/models/fbx/' });
			else source = await assetLoader.loadModel(assetUrl, { fallbackSize: Math.max(definition.footprint.width, definition.footprint.depth) });
			if (villageGroup.userData?.disposed === true) {
				AssetLoader.disposeObject3D(source);
				break;
			}
			sourceCache.set(cacheKey, source);
		}
		if (source?.userData?.isPlaceholder === true) {
			missingAssetCount += 1;
			continue;
		}
		const object = normalizeAssetPivot(source, site);
		if (!object) {
			placementFailureCount += 1;
			continue;
		}
		const placement = placeWorldAsset(landmarkGroup, object, {
			metadata: {
				id: `settlement-functional-${site.seatId}-${site.role}`,
				name: site.label,
				category: 'settlement',
				src: assetUrl,
				kind: site.role,
				service: site.service,
			},
			...buildFunctionalLandmarkMaterialOptions(object, site.role, site.regionId),
			textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE,
			position: new THREE.Vector3(site.x, 0, site.z),
			rotation: new THREE.Euler(0, wrapAngle(site.angle + Math.PI), 0),
			surfaceQuery,
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
		markFunctionalObjectMetadata(object, site, assetUrl);
		placedCount += 1;
		manifests.push(Object.freeze({
			id: `settlement-functional-${site.seatId}-${site.role}`,
			seatId: site.seatId,
			regionId: site.regionId,
			hamletIndex: site.hamletIndex,
			role: site.role,
			service: site.service,
			assetUrl,
			textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE,
			position: { x: site.x, y: object.position.y, z: site.z },
			rotationY: object.rotation.y,
			slopeDegrees: Number(site.surface?.slopeDegrees ?? 0),
			roadDistanceMeters: Number.isFinite(Number(site.roadDistanceMeters)) ? Number(site.roadDistanceMeters) : null,
			groundedFootprint: object.userData.worldPlacementFootprint || null,
			materialValidation: placement.validation,
			manifest: placement.manifest,
		}));
	}
	villageGroup.add(landmarkGroup);
	const evidence = Object.freeze({
		ok: villageGroup.userData?.disposed !== true && missingAssetCount === 0 && placementFailureCount === 0 && materialValidationFailureCount === 0,
		assetVersion: FUNCTIONAL_LANDMARK_ASSET_VERSION,
		requestedSiteCount: plans.length,
		placedCount,
		missingAssetCount,
		placementFailureCount,
		materialValidationFailureCount,
		textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE,
		roles: Object.freeze([...new Set(plans.map((plan) => plan.role))]),
		serviceCount: new Set(plans.map((plan) => plan.service?.kind)).size,
		manifests: Object.freeze(manifests),
	});
	villageGroup.userData.villageFunctionalLandmarkPlans = Object.freeze(plans);
	villageGroup.userData.villageFunctionalLandmarkEvidence = evidence;
	return evidence;
}

export function disposeFunctionalSettlementLandmarks(villageGroup) {
	if (!villageGroup) return;
	const group = villageGroup.getObjectByName('village-functional-landmarks');
	if (!group) return;
	AssetLoader.disposeObject3D(group);
	if (group.parent) group.parent.remove(group);
}

export function describeFunctionalLandmarkEvidence(evidence = {}) {
	return Object.freeze({
		ok: evidence.ok === true,
		requested: Number(evidence.requestedSiteCount) || 0,
		placed: Number(evidence.placedCount) || 0,
		missingAssets: Number(evidence.missingAssetCount) || 0,
		placementFailures: Number(evidence.placementFailureCount) || 0,
		materialFailures: Number(evidence.materialValidationFailureCount) || 0,
		textureSize: Number(evidence.textureSize) || FUNCTIONAL_LANDMARK_TEXTURE_SIZE,
		roles: Array.isArray(evidence.roles) ? [...evidence.roles] : [],
		serviceCount: Number(evidence.serviceCount) || 0,
	});
}

export function validateFunctionalLandmarkPlan(plan = [], { expectedPerHamlet = FUNCTIONAL_LANDMARK_MAX_PER_HAMLET } = {}) {
	const errors = [];
	const byHamlet = new Map();
	for (const site of Array.isArray(plan) ? plan : []) {
		const key = `${site?.seatId ?? ''}|${site?.hamletIndex ?? ''}`;
		const entries = byHamlet.get(key) || [];
		entries.push(site);
		byHamlet.set(key, entries);
		if (!SETTLEMENT_FUNCTIONAL_ASSETS[site?.role]) errors.push(`unknown-role:${site?.role}`);
		if (![site?.x, site?.z].every(finite)) errors.push(`non-finite-position:${key}`);
		if (Number(site?.distanceFromCentre) < FUNCTIONAL_LANDMARK_MIN_CENTER_DISTANCE_METERS || Number(site?.distanceFromCentre) > FUNCTIONAL_LANDMARK_MAX_CENTER_DISTANCE_METERS) errors.push(`centre-distance:${key}`);
		if (site?.service?.kind !== SETTLEMENT_FUNCTIONAL_ASSETS[site.role]?.service.kind) errors.push(`service-mismatch:${key}`);
		if (site?.assetVersion !== FUNCTIONAL_LANDMARK_ASSET_VERSION) errors.push(`asset-version:${key}`);
	}
	for (const [key, entries] of byHamlet) {
		if (entries.length > expectedPerHamlet) errors.push(`too-many-landmarks:${key}`);
		for (let i = 0; i < entries.length; i += 1) {
			for (let j = i + 1; j < entries.length; j += 1) {
				if (distance2D(entries[i], entries[j]) + 1e-9 < FUNCTIONAL_LANDMARK_MIN_SPACING_METERS) errors.push(`landmark-spacing:${key}`);
			}
		}
	}
	return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), hamletCount: byHamlet.size, siteCount: Array.isArray(plan) ? plan.length : 0 });
}

export const SETTLEMENT_FUNCTIONAL_ROLE_SERVICE_MATRIX = Object.freeze(
	Object.fromEntries(Object.entries(SETTLEMENT_FUNCTIONAL_ASSETS).map(([role, definition]) => [role, Object.freeze({ ...definition.service })])),
);

export const SETTLEMENT_FUNCTIONAL_ASSET_PATHS = Object.freeze(
	[...new Set(Object.values(SETTLEMENT_FUNCTIONAL_ASSETS).flatMap((definition) => definition.assets))],
);

export function isKnownSettlementFunctionalAsset(path) {
	return SETTLEMENT_FUNCTIONAL_ASSET_PATHS.includes(String(path ?? ''));
}

export function expectedFunctionalRolesForAllRegions() {
	return Object.freeze(Object.fromEntries(Object.entries(REGION_ROLE_ORDER).map(([region, roles]) => [region, [...roles]])));
}

export function getFunctionalLandmarkFootprint(role) {
	return SETTLEMENT_FUNCTIONAL_ASSETS[role]?.footprint ? { ...SETTLEMENT_FUNCTIONAL_ASSETS[role].footprint } : null;
}

export function getFunctionalLandmarkService(role) {
	return SETTLEMENT_FUNCTIONAL_ASSETS[role]?.service ? { ...SETTLEMENT_FUNCTIONAL_ASSETS[role].service } : null;
}

export function roleUsesRoadProximity(role) {
	return role === 'market' || role === 'tavern' || role === 'barracks';
}

export function roleShouldBeOutsideResidentialCore(role) {
	return role === 'farm' || role === 'stable' || role === 'blacksmith' || role === 'barracks';
}

export function roleShouldBeNearResidentialCore(role) {
	return role === 'market' || role === 'tavern';
}

export function roleHasTradeLoop(role) {
	return Boolean(SETTLEMENT_FUNCTIONAL_ASSETS[role]?.service.vendor);
}

export function roleHasQuestLoop(role) {
	return Boolean(SETTLEMENT_FUNCTIONAL_ASSETS[role]?.service.questHub);
}

export function roleHasCraftingLoop(role) {
	return role === 'blacksmith';
}

export function summarizeFunctionalRoles(plan = []) {
	const counts = {};
	for (const site of Array.isArray(plan) ? plan : []) counts[site.role] = (counts[site.role] || 0) + 1;
	return Object.freeze(counts);
}

export function sortFunctionalLandmarkPlans(plan = []) {
	return Object.freeze([...(Array.isArray(plan) ? plan : [])].sort((a, b) => {
		const seatCompare = String(a?.seatId ?? '').localeCompare(String(b?.seatId ?? ''));
		if (seatCompare !== 0) return seatCompare;
		const hamletCompare = Number(a?.hamletIndex) - Number(b?.hamletIndex);
		if (hamletCompare !== 0) return hamletCompare;
		const roleCompare = String(a?.role ?? '').localeCompare(String(b?.role ?? ''));
		if (roleCompare !== 0) return roleCompare;
		return Number(a?.roleIndex) - Number(b?.roleIndex);
	}));
}

export function createFunctionalLandmarkChecksum(plan = []) {
	let checksum = 0;
	for (const site of sortFunctionalLandmarkPlans(plan)) {
		const token = [site.seatId, site.regionId, site.hamletIndex, site.role, Number(site.x).toFixed(3), Number(site.z).toFixed(3), Number(site.angle).toFixed(6), Number(site.distanceFromCentre).toFixed(3)].join('|');
		checksum = (checksum ^ stableHash(token)) >>> 0;
	}
	return checksum.toString(16).padStart(8, '0');
}

export function createFunctionalLandmarkRuntimeSummary(villageGroup) {
	const evidence = villageGroup?.userData?.villageFunctionalLandmarkEvidence || {};
	const plans = villageGroup?.userData?.villageFunctionalLandmarkPlans || [];
	return Object.freeze({
		...describeFunctionalLandmarkEvidence(evidence),
		checksum: createFunctionalLandmarkChecksum(plans),
		roleCounts: summarizeFunctionalRoles(plans),
		assetCount: new Set(plans.map((site) => site.assetUrl)).size,
	});
}
