/**
 * Run 191 corrective medieval-art V2 for canonical stone bridges.
 *
 * The Run191 crossing plan/checksum remains authoritative and unchanged. This versioned renderer
 * improves only visual legibility: warm ashlar masonry, visible mortar joints, textured arch
 * facades, stone piers/deck and parapets. It is still shadow-only and has no live scene import.
 * @module world/worldReferenceStoneBridgeMedievalArtV2
 */

import * as THREE from 'three';
import { STONE_BRIDGE_OWNER_POLICY } from './worldReferenceStoneBridgeShadow.js';

export const STONE_BRIDGE_MEDIEVAL_ART_V2 = Object.freeze({
	key: 'run191-medieval-stone-bridge-art-v2',
	textureSizePixels: 512,
	mortarPixels: 3,
	stoneRowPixels: 34,
	stoneBlockPixels: 68,
	archRingInnerRadius: 0.7,
	facadeOffsetMeters: 0.035,
	maxDrawCalls: 5,
});

function mix32(value) {
	let x = value >>> 0;
	x ^= x >>> 16;
	x = Math.imul(x, 0x7feb352d);
	x ^= x >>> 15;
	x = Math.imul(x, 0x846ca68b);
	x ^= x >>> 16;
	return x >>> 0;
}

function hash01(a, b, salt = 0) {
	return mix32(Math.imul(a + 4099, 0x9e3779b1) ^ Math.imul(b + 8191, 0x85ebca6b) ^ salt) / 4294967296;
}

function masonryColor(row, column) {
	const palette = ['#b49b75', '#c0a982', '#a88e69', '#c8b38c', '#9f8562', '#bda47b'];
	const index = Math.floor(hash01(row, column, 0x4d41534f) * palette.length) % palette.length;
	return palette[index];
}

/** Original deterministic ashlar masonry texture with strong mortar/readability contrast. */
export function createMedievalStoneMasonryTextureV2() {
	const size = STONE_BRIDGE_MEDIEVAL_ART_V2.textureSizePixels;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d');
	context.fillStyle = '#4b4237';
	context.fillRect(0, 0, size, size);
	const rowHeight = STONE_BRIDGE_MEDIEVAL_ART_V2.stoneRowPixels;
	const blockWidth = STONE_BRIDGE_MEDIEVAL_ART_V2.stoneBlockPixels;
	const mortar = STONE_BRIDGE_MEDIEVAL_ART_V2.mortarPixels;
	const rows = Math.ceil(size / rowHeight) + 1;
	for (let row = 0; row < rows; row += 1) {
		const offset = row % 2 === 0 ? 0 : -blockWidth * 0.5;
		for (let column = -1; column <= Math.ceil(size / blockWidth) + 1; column += 1) {
			const x = Math.round(column * blockWidth + offset);
			const y = Math.round(row * rowHeight);
			const jitter = Math.round((hash01(row, column, 0x4a495454) - 0.5) * 4);
			context.fillStyle = masonryColor(row, column);
			context.fillRect(x + mortar, y + mortar + jitter, blockWidth - mortar * 2, rowHeight - mortar * 2 - jitter);
			context.fillStyle = 'rgba(255,244,217,0.16)';
			context.fillRect(x + mortar + 2, y + mortar + jitter + 2, blockWidth - mortar * 2 - 4, 2);
			context.fillStyle = 'rgba(52,42,31,0.16)';
			context.fillRect(x + mortar + 2, y + rowHeight - mortar - 4, blockWidth - mortar * 2 - 4, 2);
			if (hash01(row, column, 0x4d4f5353) > 0.78) {
				context.fillStyle = 'rgba(72,88,52,0.18)';
				context.fillRect(x + mortar + 6, y + rowHeight - mortar - 8, Math.max(10, blockWidth * 0.55), 3);
			}
			for (let speck = 0; speck < 5; speck += 1) {
				const px = x + mortar + 4 + hash01(row * 17 + speck, column, 0x53504543) * (blockWidth - mortar * 2 - 8);
				const py = y + mortar + 4 + hash01(row, column * 19 + speck, 0x53504544) * (rowHeight - mortar * 2 - 8);
				context.fillStyle = hash01(row, column, speck) > 0.5 ? 'rgba(65,54,41,0.12)' : 'rgba(255,245,224,0.10)';
				context.fillRect(Math.round(px), Math.round(py), 2, 2);
			}
		}
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.name = 'run191-medieval-ashlar-masonry-v2';
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(2.5, 2.5);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function createArchRingShape() {
	const outerRadius = 1;
	const innerRadius = STONE_BRIDGE_MEDIEVAL_ART_V2.archRingInnerRadius;
	const segments = 32;
	const shape = new THREE.Shape();
	shape.moveTo(outerRadius, 0);
	for (let index = 0; index <= segments; index += 1) {
		const angle = index / segments * Math.PI;
		shape.lineTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius);
	}
	shape.lineTo(-innerRadius, 0);
	for (let index = segments; index >= 0; index -= 1) {
		const angle = index / segments * Math.PI;
		shape.lineTo(Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius);
	}
	shape.closePath();
	return shape;
}

function createArchBodyGeometry() {
	const geometry = new THREE.ExtrudeGeometry(createArchRingShape(), {
		depth: 1,
		steps: 1,
		bevelEnabled: false,
		curveSegments: 32,
	});
	geometry.translate(0, 0, -0.5);
	return geometry;
}

function createArchFacadeGeometry() {
	return new THREE.ShapeGeometry(createArchRingShape(), 32);
}

function compose(matrix, x, y, z, yawRadians, sx, sy, sz) {
	const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yawRadians, 0));
	matrix.compose(new THREE.Vector3(x, y, z), quaternion, new THREE.Vector3(sx, sy, sz));
}

function axisData(bridge) {
	const dx = bridge.endX - bridge.startX;
	const dz = bridge.endZ - bridge.startZ;
	const length = Math.hypot(dx, dz) || 1;
	return { ax: dx / length, az: dz / length, sx: -dz / length, sz: dx / length };
}

function alongPosition(bridge, alongMeters, axis) {
	return {
		x: bridge.startX + axis.ax * alongMeters,
		z: bridge.startZ + axis.az * alongMeters,
	};
}

/**
 * Versioned art renderer for an already-qualified Run191 bridge list. Five batched submissions:
 * deck, arch body, textured arch facades, piers and parapets.
 */
export function createCanonicalStoneBridgeMedievalArtV2({ bridges } = {}) {
	if (!Array.isArray(bridges)) throw new TypeError('bridges must be an array');
	const masonryTexture = createMedievalStoneMasonryTextureV2();
	const masonryMaterial = new THREE.MeshStandardMaterial({
		map: masonryTexture,
		color: 0xffffff,
		roughness: 0.95,
		metalness: 0,
		emissive: 0x241b13,
		emissiveIntensity: 0.13,
	});
	const facadeMaterial = new THREE.MeshStandardMaterial({
		map: masonryTexture,
		color: 0xffffff,
		roughness: 0.92,
		metalness: 0,
		emissive: 0x2b2117,
		emissiveIntensity: 0.18,
		side: THREE.DoubleSide,
	});
	const bodyMaterial = new THREE.MeshStandardMaterial({
		color: 0xa48b68,
		roughness: 0.98,
		metalness: 0,
		emissive: 0x241b13,
		emissiveIntensity: 0.1,
	});
	const deckGeometry = new THREE.BoxGeometry(1, 1, 1);
	const archBodyGeometry = createArchBodyGeometry();
	const archFacadeGeometry = createArchFacadeGeometry();
	const pierGeometry = new THREE.BoxGeometry(1, 1, 1);
	const parapetGeometry = new THREE.BoxGeometry(1, 1, 1);
	const totalArches = bridges.reduce((sum, bridge) => sum + bridge.archCount, 0);
	const totalPiers = bridges.reduce((sum, bridge) => sum + bridge.archCount + 1, 0);
	const deckMesh = new THREE.InstancedMesh(deckGeometry, masonryMaterial, Math.max(1, bridges.length));
	const archBodyMesh = new THREE.InstancedMesh(archBodyGeometry, bodyMaterial, Math.max(1, totalArches));
	const archFacadeMesh = new THREE.InstancedMesh(archFacadeGeometry, facadeMaterial, Math.max(1, totalArches * 2));
	const pierMesh = new THREE.InstancedMesh(pierGeometry, masonryMaterial, Math.max(1, totalPiers));
	const parapetMesh = new THREE.InstancedMesh(parapetGeometry, masonryMaterial, Math.max(1, bridges.length * 2));
	deckMesh.count = bridges.length;
	archBodyMesh.count = totalArches;
	archFacadeMesh.count = totalArches * 2;
	pierMesh.count = totalPiers;
	parapetMesh.count = bridges.length * 2;
	deckMesh.name = 'run191-v2-stone-decks';
	archBodyMesh.name = 'run191-v2-arch-bodies';
	archFacadeMesh.name = 'run191-v2-textured-arch-facades';
	pierMesh.name = 'run191-v2-stone-piers';
	parapetMesh.name = 'run191-v2-stone-parapets';
	const matrix = new THREE.Matrix4();
	let archInstance = 0;
	let facadeInstance = 0;
	let pierInstance = 0;
	for (const bridge of bridges) {
		const axis = axisData(bridge);
		compose(matrix, bridge.centerX, bridge.deckY, bridge.centerZ, bridge.yawRadians,
			bridge.structuralSpanMeters, STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters, bridge.bridgeWidthMeters);
		deckMesh.setMatrixAt(bridges.indexOf(bridge), matrix);
		const deckBottomY = bridge.deckY - STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
		const archBaseY = deckBottomY - bridge.archRiseMeters;
		for (let archIndex = 0; archIndex < bridge.archCount; archIndex += 1) {
			const center = alongPosition(bridge, (archIndex + 0.5) * bridge.archSpanMeters, axis);
			compose(matrix, center.x, archBaseY, center.z, bridge.yawRadians,
				bridge.archSpanMeters * 0.5, bridge.archRiseMeters, bridge.bridgeWidthMeters);
			archBodyMesh.setMatrixAt(archInstance, matrix);
			archInstance += 1;
			for (const side of [-1, 1]) {
				const offset = bridge.bridgeWidthMeters * 0.5 + STONE_BRIDGE_MEDIEVAL_ART_V2.facadeOffsetMeters;
				compose(matrix,
					center.x + axis.sx * offset * side,
					archBaseY,
					center.z + axis.sz * offset * side,
					bridge.yawRadians,
					bridge.archSpanMeters * 0.5,
					bridge.archRiseMeters,
					1);
				archFacadeMesh.setMatrixAt(facadeInstance, matrix);
				facadeInstance += 1;
			}
		}
		for (let boundary = 0; boundary <= bridge.archCount; boundary += 1) {
			const center = alongPosition(bridge, boundary * bridge.archSpanMeters, axis);
			compose(matrix, center.x, archBaseY + bridge.archRiseMeters * 0.5, center.z, bridge.yawRadians,
				STONE_BRIDGE_OWNER_POLICY.pierWidthMeters, bridge.archRiseMeters, bridge.bridgeWidthMeters);
			pierMesh.setMatrixAt(pierInstance, matrix);
			pierInstance += 1;
		}
		const halfSide = bridge.bridgeWidthMeters * 0.5 - STONE_BRIDGE_OWNER_POLICY.parapetThicknessMeters * 0.5;
		for (const side of [-1, 1]) {
			const parapetIndex = bridges.indexOf(bridge) * 2 + (side > 0 ? 1 : 0);
			compose(matrix,
				bridge.centerX + axis.sx * halfSide * side,
				bridge.deckY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5 + STONE_BRIDGE_OWNER_POLICY.parapetHeightMeters * 0.5,
				bridge.centerZ + axis.sz * halfSide * side,
				bridge.yawRadians,
				bridge.structuralSpanMeters,
				STONE_BRIDGE_OWNER_POLICY.parapetHeightMeters,
				STONE_BRIDGE_OWNER_POLICY.parapetThicknessMeters);
			parapetMesh.setMatrixAt(parapetIndex, matrix);
		}
	}
	for (const mesh of [deckMesh, archBodyMesh, archFacadeMesh, pierMesh, parapetMesh]) {
		mesh.instanceMatrix.needsUpdate = true;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
	}
	const group = new THREE.Group();
	group.name = 'run191-canonical-stone-bridge-medieval-art-v2';
	group.add(deckMesh, archBodyMesh, archFacadeMesh, pierMesh, parapetMesh);
	group.userData.run191ArtV2 = Object.freeze({
		bridgeCount: bridges.length,
		totalArches,
		totalPiers,
		textureName: masonryTexture.name,
		expectedDrawCalls: STONE_BRIDGE_MEDIEVAL_ART_V2.maxDrawCalls,
	});
	return group;
}

export function disposeCanonicalStoneBridgeMedievalArtV2(group) {
	const geometries = new Set();
	const materials = new Set();
	const textures = new Set();
	for (const child of [...group.children]) {
		if (child.geometry) geometries.add(child.geometry);
		if (child.material) materials.add(child.material);
		group.remove(child);
	}
	for (const material of materials) if (material.map) textures.add(material.map);
	for (const geometry of geometries) geometry.dispose();
	for (const material of materials) material.dispose();
	for (const texture of textures) texture.dispose();
}
