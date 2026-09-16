/**
 * Kingdom-seat settlement placement and real-castle rendering.
 *
 * Seat coordinates, flatten pads and collider-facing footprints remain canonical. Imported castle
 * GLBs may keep meaningful authored PBR surfaces; geometry-only surfaces fall back to deterministic
 * procedural masonry so a wooden gate/drawbridge or authored roof is not flattened into one stone
 * material merely because it belongs to a castle model.
 * @module world/settlements
 */

import * as THREE from 'three';
import { createStoneMaterial, createRoofMaterial, disposeCastleMaterial, prepareImportedGeometryForTexturing } from './materials.js';
import { applyValyriaCastleWeathering, VALYRIA_CASTLE_WEATHERING_POLICY } from './valyriaCastleWeathering.js';

export const KINGDOM_SEATS = Object.freeze([
	Object.freeze({ id: 'umit', name: 'Ümit Targeryan', house: 'Targeryan', color: '#c8430a', mapX: 3885, mapY: 5370 }),
	Object.freeze({ id: 'berkalp', name: 'Berkalp Stark', house: 'Stark', color: '#8faabb', mapX: 1525, mapY: 1750 }),
	Object.freeze({ id: 'ziya', name: 'Ziya Tyrell', house: 'Tyrell', color: '#4a9c30', mapX: 1185, mapY: 4040 }),
	Object.freeze({ id: 'berk', name: 'Berk Tyrell', house: 'Tyrell', color: '#20c8a0', mapX: 1095, mapY: 4040 }),
	Object.freeze({ id: 'olena', name: 'Olena Tyrell', house: 'Tyrell', color: '#c8386a', mapX: 1145, mapY: 3990 }),
	Object.freeze({ id: 'cersei', name: 'Cersei Lannister', house: 'Lannister', color: '#c8960a', mapX: 1750, mapY: 3580 }),
	Object.freeze({ id: 'stannis', name: 'Stannis Baratheon', house: 'Baratheon', color: '#e8b050', mapX: 2100, mapY: 3270 }),
	Object.freeze({ id: 'doran', name: 'Doran Martell', house: 'Martell', color: '#e06090', mapX: 1610, mapY: 4560 }),
	Object.freeze({ id: 'balon', name: 'Balon Greyjoy', house: 'Greyjoy', color: '#888888', mapX: 920, mapY: 2900 }),
	Object.freeze({ id: 'robin', name: 'Robin Arryn', house: 'Arryn', color: '#4a88c8', mapX: 1850, mapY: 2790 }),
	Object.freeze({ id: 'jon', name: 'Jon Snow', house: 'Stark', color: '#5a78aa', mapX: 1650, mapY: 1060 }),
	Object.freeze({ id: 'twin', name: 'Twin Lannister', house: 'Lannister', color: '#d4a060', mapX: 1050, mapY: 3360 }),
	Object.freeze({ id: 'Xaro', name: 'Xaro Xhoan Daxos', house: 'Qarth', color: '#d4a060', mapX: 6190, mapY: 5140 }),
	Object.freeze({ id: 'Night King', name: 'Night King', house: 'Night King', color: '#88bbdd', mapX: 1400, mapY: 300 }),
]);

const STONE_COLOR = new THREE.Color(0x8a8578);

export const CASTLE_MODEL_ASSIGNMENTS = Object.freeze([
	Object.freeze({ seatId: 'jon', assetId: 'castle_icebound_citadel_decimated', file: 'assets/models/settlements/castles/icebound_citadel_decimated.glb', stoneColorHex: 0xa9b7c4 }),
	Object.freeze({ seatId: 'umit', assetId: 'castle_walled_city_fortress_decimated', file: 'assets/models/settlements/castles/walled_city_fortress_decimated.glb', stoneColorHex: VALYRIA_CASTLE_WEATHERING_POLICY.baseStoneHex }),
	Object.freeze({ seatId: 'cersei', assetId: 'castle_fortress_of_the_crown_decimated', file: 'assets/models/settlements/castles/fortress_of_the_crown_decimated.glb', stoneColorHex: 0x9c9070 }),
	Object.freeze({ seatId: 'balon', assetId: 'castle_castle_on_a_rock_decimated', file: 'assets/models/settlements/castles/castle_on_a_rock_decimated.glb', stoneColorHex: 0x74787d }),
	Object.freeze({ seatId: 'ziya', assetId: 'castle_emerald_citadel_decimated', file: 'assets/models/settlements/castles/emerald_citadel_decimated.glb', stoneColorHex: 0x93917f }),
	Object.freeze({ seatId: 'berkalp', assetId: 'castle_greystone_castle_decimated', file: 'assets/models/settlements/castles/greystone_castle_decimated.glb', stoneColorHex: 0x84868a }),
	Object.freeze({ seatId: 'doran', assetId: 'castle_brickstone_citadel_decimated', file: 'assets/models/settlements/castles/brickstone_citadel_decimated.glb', stoneColorHex: 0xa8825e }),
	Object.freeze({ seatId: 'twin', assetId: 'castle_reference_gatehouse_decimated', file: 'assets/models/settlements/castles/gatehouse_reference_decimated.glb', stoneColorHex: 0x8a8578 }),
	Object.freeze({ seatId: 'berk', assetId: 'castle_emerald_citadel_decimated', file: 'assets/models/settlements/castles/emerald_citadel_decimated.glb', yawRadians: 2.1, footprintMeters: 40, stoneColorHex: 0x969483 }),
	Object.freeze({ seatId: 'olena', assetId: 'castle_emerald_citadel_decimated', file: 'assets/models/settlements/castles/emerald_citadel_decimated.glb', yawRadians: 4.0, footprintMeters: 42, stoneColorHex: 0x8e8c7b }),
	Object.freeze({ seatId: 'stannis', assetId: 'castle_fortress_of_the_crown_decimated', file: 'assets/models/settlements/castles/fortress_of_the_crown_decimated.glb', yawRadians: 1.2, footprintMeters: 48, stoneColorHex: 0x9a9483 }),
	Object.freeze({ seatId: 'robin', assetId: 'castle_castle_on_a_rock_decimated', file: 'assets/models/settlements/castles/castle_on_a_rock_decimated.glb', yawRadians: 3.4, footprintMeters: 44, stoneColorHex: 0x9aa0a6 }),
	Object.freeze({ seatId: 'Xaro', assetId: 'castle_walled_city_fortress_decimated', file: 'assets/models/settlements/castles/walled_city_fortress_decimated.glb', yawRadians: 0.8, footprintMeters: 50, stoneColorHex: 0xb09a72 }),
	Object.freeze({ seatId: 'Night King', assetId: 'castle_icebound_citadel_decimated', file: 'assets/models/settlements/castles/icebound_citadel_decimated.glb', yawRadians: 2.6, footprintMeters: 52, stoneColorHex: 0xb9cad9 }),
]);

const REAL_CASTLE_FOOTPRINT_METERS = 46;
const SETTLEMENT_FLATTEN_INNER_RADIUS_METERS = 38;
const SETTLEMENT_FLATTEN_OUTER_RADIUS_METERS = 210;

const AUTHORED_CASTLE_TEXTURE_KEYS = Object.freeze([
	'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap',
	'bumpMap', 'displacementMap', 'lightMap', 'clearcoatMap', 'clearcoatNormalMap',
	'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularColorMap',
	'specularIntensityMap', 'transmissionMap', 'thicknessMap',
]);
const AUTHORED_CASTLE_MATERIAL_NAME = /(?:pbr|wood|timber|plank|roof|tile|slate|metal|iron|door|gate|bridge|glass|banner|cloth)/i;

function hasAuthoredCastleSurface(material, geometryHadAuthoredUv) {
	if (!material || !geometryHadAuthoredUv) return false;
	if (AUTHORED_CASTLE_TEXTURE_KEYS.some((key) => material[key]?.isTexture)) return true;
	return AUTHORED_CASTLE_MATERIAL_NAME.test(`${material.name ?? ''} ${material.userData?.name ?? ''}`);
}

function cloneAuthoredCastleMaterial(material) {
	const clone = material.clone();
	clone.userData = {
		...material.userData,
		castleMaterialSource: 'authored-pbr',
		authoredMapsPreserved: true,
	};
	clone.needsUpdate = true;
	return clone;
}

function disposeMaterialAndTextures(material, disposedTextures) {
	if (!material) return;
	for (const key of Object.keys(material)) {
		const value = material[key];
		if (value?.isTexture && !disposedTextures.has(value)) {
			disposedTextures.add(value);
			value.dispose();
		}
	}
	material.dispose();
}

export function computeSettlementFlattenPads({ sampleHeightMeters, seaLevelMeters, minGroundClearanceMeters, mapBounds, metersPerMapUnit }) {
	return KINGDOM_SEATS.map((seat) => {
		const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, mapBounds, metersPerMapUnit);
		return {
			x,
			z,
			innerRadiusMeters: SETTLEMENT_FLATTEN_INNER_RADIUS_METERS,
			outerRadiusMeters: SETTLEMENT_FLATTEN_OUTER_RADIUS_METERS,
			anchorHeightMeters: Math.max(sampleHeightMeters(x, z), seaLevelMeters + minGroundClearanceMeters),
		};
	});
}

export function mapToWorldXZ(mapX, mapY, mapBounds, metersPerMapUnit) {
	const centerMapX = (mapBounds.minX + mapBounds.maxX) / 2;
	const centerMapY = (mapBounds.minY + mapBounds.maxY) / 2;
	return {
		x: (mapX - centerMapX) * metersPerMapUnit,
		z: (mapY - centerMapY) * metersPerMapUnit,
	};
}

export function createSettlements({ sampleHeightMeters, seaLevelMeters, mapBounds, metersPerMapUnit, settlementConfig, seed }) {
	const {
		KEEP_WIDTH_METERS,
		KEEP_HEIGHT_METERS,
		KEEP_DEPTH_METERS,
		TOWER_RADIUS_TOP_METERS,
		TOWER_RADIUS_BOTTOM_METERS,
		TOWER_HEIGHT_METERS,
		TOWER_CORNER_OFFSET_METERS,
		ROOF_RADIUS_METERS,
		ROOF_HEIGHT_METERS,
		MIN_GROUND_CLEARANCE_METERS,
	} = settlementConfig;

	const realModelSeatIds = new Set(CASTLE_MODEL_ASSIGNMENTS.map((assignment) => assignment.seatId));
	const proceduralSeatCount = KINGDOM_SEATS.length - realModelSeatIds.size;
	const towerCount = proceduralSeatCount * 4;
	const keepGeometry = new THREE.BoxGeometry(KEEP_WIDTH_METERS, KEEP_HEIGHT_METERS, KEEP_DEPTH_METERS);
	const towerGeometry = new THREE.CylinderGeometry(TOWER_RADIUS_TOP_METERS, TOWER_RADIUS_BOTTOM_METERS, TOWER_HEIGHT_METERS, 8);
	const roofGeometry = new THREE.ConeGeometry(ROOF_RADIUS_METERS, ROOF_HEIGHT_METERS, 8);
	const stoneRepeat = Math.max(2, Math.round(KEEP_WIDTH_METERS / 11));
	const roofRepeat = Math.max(2, Math.round(ROOF_HEIGHT_METERS / 3));
	const stoneMaterial = createStoneMaterial({ seed, baseColor: STONE_COLOR, repeat: stoneRepeat });
	const roofMaterial = createRoofMaterial({ seed: seed + 1, repeat: roofRepeat });
	const keepMesh = new THREE.InstancedMesh(keepGeometry, stoneMaterial, proceduralSeatCount);
	const towerMesh = new THREE.InstancedMesh(towerGeometry, stoneMaterial, towerCount);
	const roofMesh = new THREE.InstancedMesh(roofGeometry, roofMaterial, towerCount);
	keepMesh.name = 'settlements-keeps';
	towerMesh.name = 'settlements-towers';
	roofMesh.name = 'settlements-roofs';

	const dummy = new THREE.Object3D();
	const roofColor = new THREE.Color();
	const seats = [];
	let keepIndex = 0;
	let towerIndex = 0;

	for (const seat of KINGDOM_SEATS) {
		const { x, z } = mapToWorldXZ(seat.mapX, seat.mapY, mapBounds, metersPerMapUnit);
		const groundY = Math.max(sampleHeightMeters(x, z), seaLevelMeters + MIN_GROUND_CLEARANCE_METERS);
		seats.push({ id: seat.id, name: seat.name, x, z, groundY });
		if (realModelSeatIds.has(seat.id)) continue;

		dummy.position.set(x, groundY + KEEP_HEIGHT_METERS / 2, z);
		dummy.updateMatrix();
		keepMesh.setMatrixAt(keepIndex++, dummy.matrix);
		roofColor.set(seat.color);
		for (const [dx, dz] of [
			[TOWER_CORNER_OFFSET_METERS, TOWER_CORNER_OFFSET_METERS],
			[TOWER_CORNER_OFFSET_METERS, -TOWER_CORNER_OFFSET_METERS],
			[-TOWER_CORNER_OFFSET_METERS, TOWER_CORNER_OFFSET_METERS],
			[-TOWER_CORNER_OFFSET_METERS, -TOWER_CORNER_OFFSET_METERS],
		]) {
			const towerX = x + dx;
			const towerZ = z + dz;
			dummy.position.set(towerX, groundY + TOWER_HEIGHT_METERS / 2, towerZ);
			dummy.updateMatrix();
			towerMesh.setMatrixAt(towerIndex, dummy.matrix);
			dummy.position.set(towerX, groundY + TOWER_HEIGHT_METERS + ROOF_HEIGHT_METERS / 2, towerZ);
			dummy.updateMatrix();
			roofMesh.setMatrixAt(towerIndex, dummy.matrix);
			roofMesh.setColorAt(towerIndex, roofColor);
			towerIndex += 1;
		}
	}

	keepMesh.instanceMatrix.needsUpdate = true;
	towerMesh.instanceMatrix.needsUpdate = true;
	roofMesh.instanceMatrix.needsUpdate = true;
	if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
	const group = new THREE.Group();
	group.name = 'settlements';
	group.add(keepMesh, towerMesh, roofMesh);
	return { group, seats };
}

export async function spawnRealCastleModels({ assetLoader, seats, seed }) {
	const seatsById = new Map(seats.map((seat) => [seat.id, seat]));
	const group = new THREE.Group();
	group.name = 'settlements-real-castles';
	const box = new THREE.Box3();
	const size = new THREE.Vector3();
	const center = new THREE.Vector3();
	const loadedByFile = new Map();
	const measuredByFile = new Map();

	const loadOnce = (file) => {
		if (!loadedByFile.has(file)) {
			loadedByFile.set(file, assetLoader.loadModel(file, {
				fallbackColor: 0x8a8578,
				fallbackSize: REAL_CASTLE_FOOTPRINT_METERS,
			}));
		}
		return loadedByFile.get(file);
	};

	const placements = await Promise.all(CASTLE_MODEL_ASSIGNMENTS.map(async (assignment, index) => {
		const seat = seatsById.get(assignment.seatId);
		if (!seat) {
			console.warn(`[settlements] spawnRealCastleModels: no seat found for id "${assignment.seatId}", skipping.`);
			return null;
		}
		return { assignment, index, seat, original: await loadOnce(assignment.file) };
	}));

	const measurePristine = (file, original) => {
		if (!measuredByFile.has(file)) {
			box.setFromObject(original);
			box.getSize(size);
			box.getCenter(center);
			measuredByFile.set(file, {
				centerX: center.x,
				centerZ: center.z,
				minY: box.min.y,
				largest: Math.max(size.x, size.y, size.z) || 1,
			});
		}
		return measuredByFile.get(file);
	};

	for (const placement of placements) {
		if (!placement) continue;
		const { assignment, index, seat, original } = placement;
		const measured = measurePristine(assignment.file, original);
		const footprint = assignment.footprintMeters ?? REAL_CASTLE_FOOTPRINT_METERS;
		const scale = footprint / measured.largest;

		// Record which geometries really arrived with UVs before the fallback projection fills gaps.
		// An authored material is preserved only on these geometries, preventing default loader colours
		// on geometry-only AI exports from accidentally bypassing the deterministic masonry fallback.
		const authoredUvGeometries = new WeakSet();
		original.traverse((node) => {
			if (node.isMesh && node.geometry?.getAttribute?.('uv')) authoredUvGeometries.add(node.geometry);
		});
		const prepared = prepareImportedGeometryForTexturing(original, { modelScale: scale });
		const model = original.clone(true);
		const stoneRepeat = prepared.uvsGenerated > 0 ? 1 : Math.max(2, Math.round(footprint / 11));
		const stoneColor = assignment.stoneColorHex != null ? new THREE.Color(assignment.stoneColorHex) : STONE_COLOR;
		const stoneMaterial = createStoneMaterial({ seed: seed + 2 + index, baseColor: stoneColor, repeat: stoneRepeat });
		stoneMaterial.userData = { ...stoneMaterial.userData, castleMaterialSource: 'procedural-stone' };
		applyValyriaCastleWeathering(stoneMaterial, {
			seatId: assignment.seatId,
			groundY: seat.groundY,
			footprintMeters: footprint,
			seed: seed + 2 + index,
		});

		const authoredMaterialCache = new Map();
		let authoredMaterialSlots = 0;
		let proceduralStoneSlots = 0;
		model.traverse((node) => {
			if (!node.isMesh) return;
			const geometryHadAuthoredUv = authoredUvGeometries.has(node.geometry);
			const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
			const resolved = sourceMaterials.map((sourceMaterial) => {
				if (!hasAuthoredCastleSurface(sourceMaterial, geometryHadAuthoredUv)) {
					proceduralStoneSlots += 1;
					return stoneMaterial;
				}
				authoredMaterialSlots += 1;
				if (!authoredMaterialCache.has(sourceMaterial)) {
					authoredMaterialCache.set(sourceMaterial, cloneAuthoredCastleMaterial(sourceMaterial));
				}
				return authoredMaterialCache.get(sourceMaterial);
			});
			node.material = Array.isArray(node.material) ? resolved : resolved[0];
		});
		if (proceduralStoneSlots === 0) disposeCastleMaterial(stoneMaterial);

		model.scale.setScalar(scale);
		model.position.set(-measured.centerX * scale, -measured.minY * scale, -measured.centerZ * scale);
		const pivot = new THREE.Group();
		pivot.name = `castle-${seat.id}`;
		pivot.position.set(seat.x, seat.groundY, seat.z);
		pivot.rotation.y = assignment.yawRadians ?? 0;
		pivot.userData.kingdomSeatId = seat.id;
		pivot.userData.castleMaterialTreatment = Object.freeze({
			assetId: assignment.assetId,
			authoredMaterialSlots,
			proceduralStoneSlots,
			authoredMapsPreserved: authoredMaterialSlots > 0,
			generatedUvs: prepared.uvsGenerated,
			computedNormals: prepared.normalsComputed,
		});
		pivot.add(model);
		group.add(pivot);
	}
	return group;
}

export function disposeSettlements(group) {
	const disposedMaterials = new Set();
	for (const mesh of group.children) {
		mesh.geometry.dispose();
		if (!disposedMaterials.has(mesh.material)) {
			disposedMaterials.add(mesh.material);
			disposeCastleMaterial(mesh.material);
		}
	}
}

export function disposeRealCastleModels(group) {
	const disposedGeometries = new Set();
	const disposedMaterials = new Set();
	const disposedTextures = new Set();
	for (const model of group.children) {
		model.traverse((node) => {
			if (!node.isMesh) return;
			if (node.geometry && !disposedGeometries.has(node.geometry)) {
				disposedGeometries.add(node.geometry);
				node.geometry.dispose();
			}
			for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
				if (!material || disposedMaterials.has(material)) continue;
				disposedMaterials.add(material);
				disposeMaterialAndTextures(material, disposedTextures);
			}
		});
	}
}
