/**
 * Procedural villages around kingdom seats.
 *
 * Grounding rule: a rigid structure is never positioned from a single centre-height sample. Every
 * house samples its rotated footprint (centre, corners and edge mid-points). The wall body extends
 * from the lowest sampled terrain point to a flat top above the highest sampled point, so downhill
 * corners cannot hover while uphill corners remain safely embedded in the terrain. Stairs and field
 * walls are grounded from their own footprints as well.
 *
 * One procedural house in every canonical hamlet is also an asset-upgrade site. The cheap instanced
 * house remains visible until a real repository GLB has loaded, passed the shared material contract,
 * passed footprint-aware world placement, produced a manifest and attached successfully. Only then
 * is the matching primitive instance hidden. Missing/LFS-unavailable assets therefore fail closed:
 * no magenta AssetLoader placeholder and no invisible collision hole are ever shipped.
 * @module world/villages
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import { analyzeMaterialSurfaces } from '../materials/MaterialAssignmentCore.js';
import { placeWorldAsset, WORLD_SURFACE_POLICY_PRESETS } from './WorldAssetPlacementPipeline.js';
import { isPlaceablePosition } from './vegetation.js';
import { createStoneMaterial, createRoofMaterial } from './materials.js';

const VILLAGE_OUTER_RADIUS_METERS = 210;
const HAMLET_DISTANCE_MIN_METERS = 115;
const HAMLET_DISTANCE_MAX_METERS = 155;
const HAMLET_RADIUS_METERS = 38;
const MIN_HOUSE_SPACING_METERS = 11;
const MAX_ATTEMPTS_PER_BUILDING = 12;
const GROUND_EMBED_EPSILON_METERS = 0.08;
const STOOP_STEP_COUNT = 3;
const STOOP_STEP_RISE_METERS = 0.18;
const STOOP_STEP_RUN_METERS = 0.34;
const STOOP_WIDTH_METERS = 1.6;
const ARCHITECTURE_TEXTURE_SIZE = 256;
const SURFACE_SLOPE_SAMPLE_METERS = 1.5;

const HOUSE_TYPES = [
	{ id: 'cottage', weight: 0.55, width: 5.2, depth: 4.4, wallHeight: 2.5, roofHeight: 2.2 },
	{ id: 'longhouse', weight: 0.3, width: 8.6, depth: 4.8, wallHeight: 2.7, roofHeight: 2.4 },
	{ id: 'twostory', weight: 0.15, width: 5.6, depth: 5.0, wallHeight: 4.6, roofHeight: 2.6 },
];

const WALL_COLOR = new THREE.Color(0xbdae91);
const STONE_WALL_COLOR = new THREE.Color(0x8d8878);
const THATCH_COLOR = new THREE.Color(0x9c7b42);

/**
 * Canonical, bounded architecture families. These are existing repository assets under Git LFS;
 * they are deliberately residential only, so this visual pass does not invent a second vendor,
 * blacksmith, tavern or stable interaction system beside the established RPG owner.
 *
 * `proceduralWallHex` / `proceduralRoofHex` intentionally tint the cheap instanced fabric too. A
 * single hydrated landmark should not be the only geographic cue in a ten-house hamlet: the North,
 * coast, arid south, mountains and volcanic east must still read differently before/without GLB
 * hydration, without multiplying draw calls or replacing the shared procedural PBR maps.
 */
export const VILLAGE_ARCHITECTURE_PROFILES = Object.freeze({
	north: Object.freeze({
		id: 'north', label: 'Kuzey ahşap yerleşimi', paletteId: 'house', proceduralWallHex: 0xb8b6ae, proceduralRoofHex: 0x59636d,
		assetUrl: 'assets/models/settlements/log_cabin_et0OmFeZVkb.glb',
		layers: Object.freeze([{ to: 0.16, palette: 'stone' }, { to: 0.72, palette: 'wood' }, { to: 1, palette: 'roof-tile' }]),
	}),
	fertile: Object.freeze({
		id: 'fertile', label: 'Verimli ova yerleşimi', paletteId: 'house', proceduralWallHex: 0xe2d3af, proceduralRoofHex: 0xa9874d,
		assetUrl: 'assets/models/settlements/fantasy_house_dcPho4SUA3.glb',
		layers: Object.freeze([{ to: 0.12, palette: 'stone' }, { to: 0.62, palette: 'plaster' }, { to: 0.7, palette: 'wood' }, { to: 1, palette: 'thatch' }]),
	}),
	maritime: Object.freeze({
		id: 'maritime', label: 'Rüzgârlı kıyı yerleşimi', paletteId: 'house', proceduralWallHex: 0xaeb8b8, proceduralRoofHex: 0x68757c,
		assetUrl: 'assets/models/settlements/cabin_shed_HTx7PZt6Zm.glb',
		layers: Object.freeze([{ to: 0.16, palette: 'rock' }, { to: 0.64, palette: 'house' }, { to: 0.72, palette: 'wood' }, { to: 1, palette: 'roof-tile' }]),
	}),
	arid: Object.freeze({
		id: 'arid', label: 'Kurak güney yerleşimi', paletteId: 'house', proceduralWallHex: 0xe0c39b, proceduralRoofHex: 0xb67852,
		assetUrl: 'assets/models/settlements/house_fdaqERLQCc.glb',
		layers: Object.freeze([{ to: 0.18, palette: 'stone' }, { to: 0.72, palette: 'plaster' }, { to: 0.79, palette: 'wood' }, { to: 1, palette: 'roof-tile' }]),
	}),
	mountain: Object.freeze({
		id: 'mountain', label: 'Dağ eteği yerleşimi', paletteId: 'brick', proceduralWallHex: 0xaaa59d, proceduralRoofHex: 0x515b61,
		assetUrl: 'assets/models/settlements/medium_house_4hI5fNvl6z.glb',
		layers: Object.freeze([{ to: 0.2, palette: 'rock' }, { to: 0.74, palette: 'brick' }, { to: 0.82, palette: 'wood' }, { to: 1, palette: 'roof-tile' }]),
	}),
	temperate: Object.freeze({
		id: 'temperate', label: 'Ilıman kır yerleşimi', paletteId: 'house', proceduralWallHex: 0xd1c3a7, proceduralRoofHex: 0x846849,
		assetUrl: 'assets/models/settlements/small_wooden_house.glb',
		layers: Object.freeze([{ to: 0.12, palette: 'stone' }, { to: 0.62, palette: 'house' }, { to: 0.7, palette: 'wood' }, { to: 1, palette: 'thatch' }]),
	}),
	volcanic: Object.freeze({
		id: 'volcanic', label: 'Volkanik taş yerleşimi', paletteId: 'brick', proceduralWallHex: 0x7f7770, proceduralRoofHex: 0x3f4146,
		assetUrl: 'assets/models/settlements/house_roqiHdrpgc.glb',
		layers: Object.freeze([{ to: 0.2, palette: 'rock' }, { to: 0.72, palette: 'brick' }, { to: 0.8, palette: 'iron' }, { to: 1, palette: 'roof-tile' }]),
	}),
});

const SEAT_ARCHITECTURE_REGION = Object.freeze({
	berkalp: 'north', jon: 'north', 'Night King': 'north',
	ziya: 'fertile', berk: 'fertile', olena: 'fertile',
	balon: 'maritime', stannis: 'maritime',
	doran: 'arid', Xaro: 'arid',
	robin: 'mountain', twin: 'temperate', cersei: 'temperate', umit: 'volcanic',
});

export function resolveVillageArchitectureProfile(seatId) {
	const regionId = SEAT_ARCHITECTURE_REGION[String(seatId ?? '')];
	return regionId ? VILLAGE_ARCHITECTURE_PROFILES[regionId] : null;
}

export function pickHouseTypeIndex(roll) {
	const total = HOUSE_TYPES.reduce((sum, type) => sum + type.weight, 0);
	let cumulative = 0;
	for (let i = 0; i < HOUSE_TYPES.length; i++) {
		cumulative += HOUSE_TYPES[i].weight / total;
		if (roll < cumulative) return i;
	}
	return HOUSE_TYPES.length - 1;
}

function buildVillageGeometries() {
	const body = new THREE.BoxGeometry(1, 1, 1);
	body.translate(0, 0.5, 0);
	const roof = new THREE.ConeGeometry(0.72, 1, 4);
	roof.rotateY(Math.PI / 4);
	roof.translate(0, 0.5, 0);
	const step = new THREE.BoxGeometry(1, 1, 1);
	step.translate(0, 0.5, 0);
	const wall = new THREE.BoxGeometry(1, 1, 1);
	wall.translate(0, 0.5, 0);
	return { body, roof, step, wall };
}

function rotatedWorldPoint(x, z, yaw, localX, localZ) {
	const sin = Math.sin(yaw);
	const cos = Math.cos(yaw);
	return {
		x: x + localX * cos + localZ * sin,
		z: z - localX * sin + localZ * cos,
	};
}

/** Sample the complete support footprint instead of trusting one centre point. */
function sampleFootprintRange(sampleHeightMeters, x, z, width, depth, yaw) {
	const hx = width * 0.5;
	const hz = depth * 0.5;
	const offsets = [
		[0, 0], [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz],
		[-hx, 0], [hx, 0], [0, -hz], [0, hz],
	];
	let min = Infinity;
	let max = -Infinity;
	for (const [localX, localZ] of offsets) {
		const p = rotatedWorldPoint(x, z, yaw, localX, localZ);
		const h = sampleHeightMeters(p.x, p.z);
		if (h < min) min = h;
		if (h > max) max = h;
	}
	return { min, max };
}

function distancePointToSegment2D(px, pz, ax, az, bx, bz) {
	const abx = bx - ax;
	const abz = bz - az;
	const lengthSquared = abx * abx + abz * abz;
	if (lengthSquared <= 1e-9) return Math.hypot(px - ax, pz - az);
	const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lengthSquared));
	return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

function roadDistanceMeters(x, z, roadEdges = []) {
	let nearest = Infinity;
	for (const edge of roadEdges) {
		const points = Array.isArray(edge?.points) ? edge.points : [];
		for (let i = 1; i < points.length; i++) {
			nearest = Math.min(nearest, distancePointToSegment2D(x, z, points[i - 1].x, points[i - 1].z, points[i].x, points[i].z));
		}
	}
	return Number.isFinite(nearest) ? nearest : 1_000_000;
}

/** Adapter only: samples the existing ground API; it does not own or mutate terrain. */
function createVillageArchitectureSurfaceQuery(sampleHeightMeters, seaLevelMeters, roadEdges) {
	return (x, z) => {
		const height = sampleHeightMeters(x, z);
		const dx = (sampleHeightMeters(x + SURFACE_SLOPE_SAMPLE_METERS, z) - sampleHeightMeters(x - SURFACE_SLOPE_SAMPLE_METERS, z)) / (SURFACE_SLOPE_SAMPLE_METERS * 2);
		const dz = (sampleHeightMeters(x, z + SURFACE_SLOPE_SAMPLE_METERS) - sampleHeightMeters(x, z - SURFACE_SLOPE_SAMPLE_METERS)) / (SURFACE_SLOPE_SAMPLE_METERS * 2);
		return {
			height,
			slopeDegrees: Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI,
			waterDepth: Math.max(0, seaLevelMeters - height),
			roadDistance: roadDistanceMeters(x, z, roadEdges),
		};
	};
}

function regionalMaterialOptions(object, profile) {
	const analysis = analyzeMaterialSurfaces(object);
	if (analysis.meshCount === 1) {
		return {
			materialRecipe: {
				version: 1,
				mode: 'layers',
				basePaletteId: profile.paletteId,
				textureSize: ARCHITECTURE_TEXTURE_SIZE,
				targetMeshIndex: 0,
				layers: profile.layers.map((layer) => ({ ...layer })),
			},
		};
	}
	return { paletteId: profile.paletteId, textureSize: ARCHITECTURE_TEXTURE_SIZE };
}

function normalizedArchitecturePivot(source, site, profile) {
	const model = source.clone(true);
	const pivot = new THREE.Group();
	pivot.name = `village-landmark-${site.seatId}`;
	pivot.userData.architectureRegion = profile.id;
	pivot.add(model);
	model.updateMatrixWorld(true);
	let box = new THREE.Box3().setFromObject(model);
	const size = box.getSize(new THREE.Vector3());
	const horizontalSpan = Math.max(size.x, size.z);
	if (!Number.isFinite(horizontalSpan) || horizontalSpan <= 1e-6) return null;
	const scale = site.targetFootprintMeters / horizontalSpan;
	model.scale.multiplyScalar(scale);
	model.updateMatrixWorld(true);
	box = new THREE.Box3().setFromObject(model);
	const center = box.getCenter(new THREE.Vector3());
	model.position.x -= center.x;
	model.position.z -= center.z;
	pivot.updateMatrixWorld(true);
	return pivot;
}

function hidePrimitiveLandmark(villageGroup, site) {
	const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
	const body = villageGroup.getObjectByName('village-houses');
	const roof = villageGroup.getObjectByName('village-roofs');
	const steps = villageGroup.getObjectByName('village-steps');
	body?.setMatrixAt(site.houseIndex, hidden);
	roof?.setMatrixAt(site.houseIndex, hidden);
	for (let i = 0; i < site.stepCount; i++) steps?.setMatrixAt(site.stepStartIndex + i, hidden);
	if (body) body.instanceMatrix.needsUpdate = true;
	if (roof) roof.instanceMatrix.needsUpdate = true;
	if (steps) steps.instanceMatrix.needsUpdate = true;
}

/**
 * Loads one high-detail residential landmark for each canonical hamlet and sends every model through
 * the merged #590 material/placement core before hiding its matching primitive fallback.
 */
export async function upgradeVillageArchitectureAssets({
	assetLoader,
	villageGroup,
	sampleHeightMeters,
	seaLevelMeters,
	roadEdges = [],
} = {}) {
	if (!assetLoader?.loadModel || !villageGroup || typeof sampleHeightMeters !== 'function') {
		return { ok: false, error: 'missing-upgrade-context' };
	}
	const sites = (villageGroup.userData?.villageLandmarkSites || []).filter((site) => resolveVillageArchitectureProfile(site.seatId));
	const assetGroup = new THREE.Group();
	assetGroup.name = 'village-architectural-assets';
	villageGroup.add(assetGroup);
	const sourceCache = new Map();
	const manifests = [];
	let upgradedCount = 0;
	let missingAssetCount = 0;
	let placementFailureCount = 0;
	const surfaceQuery = createVillageArchitectureSurfaceQuery(sampleHeightMeters, seaLevelMeters, roadEdges);

	for (const site of sites) {
		if (villageGroup.userData?.disposed === true) break;
		const profile = resolveVillageArchitectureProfile(site.seatId);
		let source = sourceCache.get(profile.assetUrl);
		if (!source) {
			source = await assetLoader.loadModel(profile.assetUrl, { fallbackSize: site.targetFootprintMeters });
			if (villageGroup.userData?.disposed === true) {
				AssetLoader.disposeObject3D(source);
				break;
			}
			sourceCache.set(profile.assetUrl, source);
		}
		if (source?.userData?.isPlaceholder === true) {
			missingAssetCount++;
			continue;
		}
		const object = normalizedArchitecturePivot(source, site, profile);
		if (!object) {
			placementFailureCount++;
			continue;
		}
		const materialOptions = regionalMaterialOptions(object, profile);
		const prepared = placeWorldAsset(assetGroup, object, {
			metadata: {
				id: `village-${site.seatId}-${profile.id}`,
				name: profile.label,
				category: 'settlement',
				src: profile.assetUrl,
			},
			...materialOptions,
			textureSize: ARCHITECTURE_TEXTURE_SIZE,
			position: new THREE.Vector3(site.x, 0, site.z),
			rotation: new THREE.Euler(0, site.yaw, 0),
			surfaceQuery,
			placementPolicy: WORLD_SURFACE_POLICY_PRESETS.settlement,
			requireSurfaceContext: true,
			footprintGrounding: 'always',
			foundationInsetMeters: 0.06,
		});
		if (!prepared.ok) {
			placementFailureCount++;
			continue;
		}
		hidePrimitiveLandmark(villageGroup, site);
		upgradedCount++;
		manifests.push({
			seatId: site.seatId,
			region: profile.id,
			assetUrl: profile.assetUrl,
			textureSize: ARCHITECTURE_TEXTURE_SIZE,
			manifest: prepared.manifest,
		});
	}

	const disposed = villageGroup.userData?.disposed === true;
	const evidence = Object.freeze({
		ok: !disposed && missingAssetCount === 0 && placementFailureCount === 0,
		disposed,
		requestedSiteCount: sites.length,
		upgradedCount,
		missingAssetCount,
		placementFailureCount,
		textureSize: ARCHITECTURE_TEXTURE_SIZE,
		manifests: Object.freeze(manifests),
	});
	villageGroup.userData.villageArchitectureEvidence = evidence;
	return evidence;
}

function scheduleVillageArchitectureUpgrade({ villageGroup, sampleHeightMeters, seaLevelMeters, roadEdges }) {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	const sites = villageGroup.userData?.villageLandmarkSites || [];
	if (!sites.some((site) => resolveVillageArchitectureProfile(site.seatId))) return;
	const silentEvents = { emit() {} };
	const loader = new AssetLoader({ events: silentEvents });
	const promise = upgradeVillageArchitectureAssets({ assetLoader: loader, villageGroup, sampleHeightMeters, seaLevelMeters, roadEdges })
		.then((evidence) => {
			if (evidence.disposed) return evidence;
			console.info(
				`[villages] Regional architecture: ${evidence.upgradedCount}/${evidence.requestedSiteCount} real house(s), ` +
				`missing=${evidence.missingAssetCount}, placement-failed=${evidence.placementFailureCount}.`,
			);
			return evidence;
		})
		.catch((error) => {
			console.warn('[villages] Regional architecture upgrade failed; procedural houses remain visible.', error);
			return { ok: false, error: String(error?.message || error) };
		});
	villageGroup.userData.villageArchitecturePromise = promise;
}

export function createVillages({
	sampleHeightMeters,
	seaLevelMeters,
	seed,
	seats,
	roadEdges,
	radiusMeters,
	mulberry32,
	housesPerVillage = 10,
}) {
	const group = new THREE.Group();
	group.name = 'villages';
	const eligibleSeats = seats.filter((seat) => Math.hypot(seat.x, seat.z) + VILLAGE_OUTER_RADIUS_METERS <= radiusMeters);
	const maxHouses = eligibleSeats.length * housesPerVillage;
	const maxWalls = eligibleSeats.length * 14;
	if (maxHouses === 0) return { group, villageCount: 0, houseCount: 0, wallCount: 0, houses: [], landmarkSites: [] };

	const rng = mulberry32(seed ^ 0x56494c4c);
	const geometries = buildVillageGeometries();
	const wallMaterial = createStoneMaterial({ seed: seed + 41, baseColor: WALL_COLOR, repeat: 0.6 });
	const roofMaterial = createRoofMaterial({ seed: seed + 42, repeat: 3 });
	const stoneMaterial = createStoneMaterial({ seed: seed + 43, baseColor: STONE_WALL_COLOR, repeat: 0.8 });

	const bodyMesh = new THREE.InstancedMesh(geometries.body, wallMaterial, maxHouses);
	const roofMesh = new THREE.InstancedMesh(geometries.roof, roofMaterial, maxHouses);
	const stepMesh = new THREE.InstancedMesh(geometries.step, stoneMaterial, maxHouses * STOOP_STEP_COUNT);
	const wallMesh = new THREE.InstancedMesh(geometries.wall, stoneMaterial, maxWalls);
	bodyMesh.name = 'village-houses';
	roofMesh.name = 'village-roofs';
	stepMesh.name = 'village-steps';
	wallMesh.name = 'village-walls';
	for (const mesh of [bodyMesh, roofMesh, stepMesh, wallMesh]) {
		mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
	}

	const dummy = new THREE.Object3D();
	const wallTint = new THREE.Color();
	const roofTint = new THREE.Color();
	let houseCount = 0;
	let stepCount = 0;
	let wallCount = 0;
	let villageCount = 0;
	const houses = [];
	const landmarkSites = [];

	for (const seat of eligibleSeats) {
		const placedHere = [];
		let landmarkRecorded = false;
		const architectureProfile = resolveVillageArchitectureProfile(seat.id);
		const hamletBearing = rng() * Math.PI * 2;
		const hamletDistance = HAMLET_DISTANCE_MIN_METERS + rng() * (HAMLET_DISTANCE_MAX_METERS - HAMLET_DISTANCE_MIN_METERS);
		const hamletX = seat.x + Math.cos(hamletBearing) * hamletDistance;
		const hamletZ = seat.z + Math.sin(hamletBearing) * hamletDistance;

		for (let i = 0; i < housesPerVillage; i++) {
			for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_BUILDING; attempt++) {
				const spreadAngle = rng() * Math.PI * 2;
				const spreadRadius = HAMLET_RADIUS_METERS * Math.sqrt(rng());
				const x = hamletX + Math.cos(spreadAngle) * spreadRadius;
				const z = hamletZ + Math.sin(spreadAngle) * spreadRadius;
				if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;
				if (placedHere.some((other) => Math.hypot(x - other.x, z - other.z) < MIN_HOUSE_SPACING_METERS)) continue;

				const type = HOUSE_TYPES[pickHouseTypeIndex(rng())];
				const yaw = Math.atan2(hamletX - x, hamletZ - z) + (rng() - 0.5) * 0.5;
				const support = sampleFootprintRange(sampleHeightMeters, x, z, type.width, type.depth, yaw);
				const bodyBaseY = support.min - GROUND_EMBED_EPSILON_METERS;
				const bodyHeight = type.wallHeight + (support.max - support.min) + GROUND_EMBED_EPSILON_METERS;
				const wallTopY = support.max + type.wallHeight;
				const houseIndex = houseCount;
				const stepStartIndex = stepCount;

				dummy.position.set(x, bodyBaseY, z);
				dummy.rotation.set(0, yaw, 0);
				dummy.scale.set(type.width, bodyHeight, type.depth);
				dummy.updateMatrix();
				bodyMesh.setMatrixAt(houseCount, dummy.matrix);
				const materialVariation = rng() - 0.5;
				wallTint.setHex(architectureProfile?.proceduralWallHex ?? 0xffffff).offsetHSL(0, 0, materialVariation * 0.035);
				bodyMesh.setColorAt(houseCount, wallTint);

				dummy.position.set(x, wallTopY, z);
				dummy.rotation.set(0, yaw, 0);
				dummy.scale.set(type.width * 1.04, type.roofHeight, type.depth * 1.04);
				dummy.updateMatrix();
				roofMesh.setMatrixAt(houseCount, dummy.matrix);
				if (Number.isInteger(architectureProfile?.proceduralRoofHex)) roofTint.setHex(architectureProfile.proceduralRoofHex);
				else roofTint.copy(THATCH_COLOR);
				roofTint.offsetHSL(0, 0, materialVariation * 0.08);
				roofMesh.setColorAt(houseCount, roofTint);

				const frontX = Math.sin(yaw);
				const frontZ = Math.cos(yaw);
				for (let s = 0; s < STOOP_STEP_COUNT; s++) {
					const outward = type.depth / 2 + (STOOP_STEP_COUNT - s) * STOOP_STEP_RUN_METERS;
					const stepX = x + frontX * outward;
					const stepZ = z + frontZ * outward;
					const stepGroundY = sampleHeightMeters(stepX, stepZ) - GROUND_EMBED_EPSILON_METERS;
					dummy.position.set(stepX, stepGroundY, stepZ);
					dummy.rotation.set(0, yaw, 0);
					dummy.scale.set(STOOP_WIDTH_METERS, STOOP_STEP_RISE_METERS * (s + 1) + GROUND_EMBED_EPSILON_METERS, STOOP_STEP_RUN_METERS);
					dummy.updateMatrix();
					stepMesh.setMatrixAt(stepCount++, dummy.matrix);
				}

				placedHere.push({ x, z });
				houses.push({ x, z, radius: Math.hypot(type.width, type.depth) / 2 });
				if (!landmarkRecorded && architectureProfile) {
					landmarkSites.push({
						seatId: seat.id, x, z, yaw, houseIndex, stepStartIndex,
						stepCount: STOOP_STEP_COUNT,
						targetFootprintMeters: Math.max(type.width, type.depth),
						proceduralType: type.id,
					});
					landmarkRecorded = true;
				}
				houseCount++;
				break;
			}
		}

		if (placedHere.length === 0) continue;
		villageCount++;
		const ringOrder = [...placedHere].sort((p, q) =>
			Math.atan2(p.z - hamletZ, p.x - hamletX) - Math.atan2(q.z - hamletZ, q.x - hamletX));
		for (let i = 0; i < ringOrder.length && wallCount < maxWalls; i++) {
			const a = ringOrder[i];
			const b = ringOrder[(i + 1) % ringOrder.length];
			const span = Math.hypot(b.x - a.x, b.z - a.z);
			if (span > 26) continue;
			const midX = (a.x + b.x) / 2;
			const midZ = (a.z + b.z) / 2;
			if (!isPlaceablePosition(midX, midZ, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;
			const h0 = sampleHeightMeters(a.x, a.z);
			const h1 = sampleHeightMeters(midX, midZ);
			const h2 = sampleHeightMeters(b.x, b.z);
			const minGround = Math.min(h0, h1, h2) - GROUND_EMBED_EPSILON_METERS;
			const maxGround = Math.max(h0, h1, h2);
			dummy.position.set(midX, minGround, midZ);
			dummy.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
			dummy.scale.set(0.45, 0.95 + (maxGround - minGround), span * 0.6);
			dummy.updateMatrix();
			wallMesh.setMatrixAt(wallCount++, dummy.matrix);
		}
	}

	bodyMesh.count = houseCount;
	roofMesh.count = houseCount;
	stepMesh.count = stepCount;
	wallMesh.count = wallCount;
	for (const mesh of [bodyMesh, roofMesh, stepMesh, wallMesh]) mesh.instanceMatrix.needsUpdate = true;
	if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
	if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
	group.add(bodyMesh, roofMesh, stepMesh, wallMesh);
	group.userData.villageLandmarkSites = landmarkSites.map((site) => ({ ...site }));
	scheduleVillageArchitectureUpgrade({ villageGroup: group, sampleHeightMeters, seaLevelMeters, roadEdges });
	return { group, villageCount, houseCount, wallCount, houses, landmarkSites };
}

export function disposeVillages(group) {
	if (!group) return;
	group.userData.disposed = true;
	const disposedGeometries = new Set();
	const disposedMaterials = new Set();
	const disposedTextures = new Set();
	group.traverse((node) => {
		if (node.geometry && !disposedGeometries.has(node.geometry)) {
			disposedGeometries.add(node.geometry);
			node.geometry.dispose();
		}
		const materials = node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : [];
		for (const material of materials) {
			if (!material || disposedMaterials.has(material)) continue;
			disposedMaterials.add(material);
			const factoryGenerated = material.userData?.generatedByTextureFactory === true;
			const factoryCached = factoryGenerated && Boolean(material.userData?.cacheKey);
			// Factory-generated textures are cache-owned even when the layered wrapper material itself
			// is not cached. Village teardown may dispose that wrapper, but never shared cache textures.
			if (!factoryGenerated) {
				for (const key of ['map', 'roughnessMap', 'normalMap', 'metalnessMap']) {
					const texture = material[key];
					if (texture && !disposedTextures.has(texture)) {
						disposedTextures.add(texture);
						texture.dispose();
					}
				}
			}
			if (!factoryCached) material.dispose();
		}
	});
}
