import * as THREE from 'three';

function hash2D(x, y, seed) {
	let value = Math.imul((x | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((y | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function refreshGeometry(geometry) {
	const position = geometry?.getAttribute?.('position');
	if (!position) return false;
	position.needsUpdate = true;
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return true;
}

function fractureWall(group, sections, seed) {
	const wall = group.getObjectByName('the-wall-natural-ice-cliff');
	const position = wall?.geometry?.getAttribute?.('position');
	if (!position) return 0;
	let moved = 0;
	for (let index = 0; index < sections.length; index += 1) {
		const section = sections[index];
		const base = section.baseVertex;
		const macro = hash2D(index, 7, seed + 6101) - 0.5;
		const shear = hash2D(index, 11, seed + 6203) - 0.5;
		const frontTop = base + 1;
		const backTop = base + 3;
		const frontBase = base;
		const backBase = base + 2;
		const crownOffset = macro * 9.0;
		const baseOffset = shear * 2.8;
		for (const [vertex, normalSign, amount] of [
			[frontTop, 1, crownOffset],
			[backTop, -1, crownOffset * 0.72],
			[frontBase, 1, baseOffset],
			[backBase, -1, baseOffset * 0.65],
		]) {
			position.setX(vertex, position.getX(vertex) + section.nx * amount * normalSign + section.tx * shear * 1.7);
			position.setZ(vertex, position.getZ(vertex) + section.nz * amount * normalSign + section.tz * shear * 1.7);
			moved += 1;
		}
		position.setY(frontTop, position.getY(frontTop) + (hash2D(index, 17, seed + 6301) - 0.5) * 6.5);
		position.setY(backTop, position.getY(backTop) + (hash2D(index, 19, seed + 6401) - 0.5) * 5.0);
	}
	refreshGeometry(wall.geometry);
	wall.userData.primaryGlacialBreakup = true;
	return moved;
}

function fractureCave(group, portal, rings, seed) {
	const cave = group.getObjectByName('ice-cave-shell');
	const position = cave?.geometry?.getAttribute?.('position');
	if (!position || !rings.length) return 0;
	const ringStride = Math.round(position.count / rings.length);
	let moved = 0;
	for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
		for (let step = 0; step < ringStride; step += 1) {
			const vertex = ringIndex * ringStride + step;
			const edgeRatio = Math.abs(step / Math.max(1, ringStride - 1) - 0.5) * 2;
			const warp = (hash2D(ringIndex * 37 + step, 23, seed + 6503) - 0.5) * (0.8 + edgeRatio * 0.9);
			const lift = (hash2D(ringIndex * 41 + step, 29, seed + 6607) - 0.5) * (0.55 + (1 - edgeRatio) * 1.15);
			position.setX(vertex, position.getX(vertex) + portal.tx * warp);
			position.setZ(vertex, position.getZ(vertex) + portal.tz * warp);
			position.setY(vertex, position.getY(vertex) + lift);
			moved += 1;
		}
	}
	refreshGeometry(cave.geometry);
	cave.userData.primaryGlacialBreakup = true;
	return moved;
}

function createInstanceField(name, role, geometry, material, transforms, seed, tintRange = null) {
	const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
	mesh.name = name;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.userData.iceLandmarkRole = role;
	const matrix = new THREE.Matrix4();
	const quaternion = new THREE.Quaternion();
	const tint = new THREE.Color();
	const lowTint = tintRange ? new THREE.Color(tintRange[0]) : null;
	const highTint = tintRange ? new THREE.Color(tintRange[1]) : null;
	for (let index = 0; index < transforms.length; index += 1) {
		const item = transforms[index];
		quaternion.setFromEuler(new THREE.Euler(item.rx || 0, item.ry || 0, item.rz || 0));
		matrix.compose(item.position, quaternion, item.scale);
		mesh.setMatrixAt(index, matrix);
		const shade = 0.82 + hash2D(index, role.length, seed + 7013) * 0.18;
		if (lowTint && highTint) tint.copy(lowTint).lerp(highTint, hash2D(index, 71, seed + 7069));
		else tint.setRGB(shade * 0.96, shade * 0.995, Math.min(1, shade * 1.04));
		mesh.setColorAt(index, tint);
	}
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	return mesh;
}

function createWallFracturePlates(group, sections, portal, seed) {
	const wall = group.getObjectByName('the-wall-natural-ice-cliff');
	if (!wall?.material) return 0;
	const material = wall.material.clone();
	material.vertexColors = false;
	material.color.set(0xd6dcda);
	material.roughness = Math.max(0.57, material.roughness || 0.57);
	material.transmission = Math.min(0.018, material.transmission || 0);
	material.clearcoat = Math.min(0.08, material.clearcoat || 0);
	material.needsUpdate = true;
	const transforms = [];
	for (let index = 3; index < sections.length - 3; index += 5) {
		const section = sections[index];
		if (Math.hypot(section.x - portal.centerX, section.z - portal.centerZ) < 62) continue;
		const side = hash2D(index, 5, seed + 7103) > 0.5 ? 1 : -1;
		const width = 16 + hash2D(index, 7, seed + 7207) * 24;
		const height = 22 + hash2D(index, 11, seed + 7307) * 35;
		const depth = 5 + hash2D(index, 13, seed + 7403) * 8;
		const elevation = 0.23 + hash2D(index, 17, seed + 7507) * 0.48;
		const faceOffset = section.thicknessMeters * 0.50 + depth * 0.25;
		transforms.push({
			position: new THREE.Vector3(section.x + section.nx * faceOffset * side, section.centerGround + section.heightMeters * elevation, section.z + section.nz * faceOffset * side),
			scale: new THREE.Vector3(width * 0.50, height * 0.50, depth * 0.50),
			rx: (hash2D(index, 19, seed + 7603) - 0.5) * 0.16,
			ry: -Math.atan2(section.tz, section.tx) + (hash2D(index, 23, seed + 7703) - 0.5) * 0.18,
			rz: (hash2D(index, 29, seed + 7801) - 0.5) * 0.13,
		});
	}
	if (!transforms.length) return 0;
	const plates = createInstanceField('ice-wall-macro-fracture-plates', 'wall-macro-fracture-plates', new THREE.DodecahedronGeometry(1, 0), material, transforms, seed + 7901);
	group.add(plates);
	return plates.count;
}

function createWallFlowRibs(group, sections, portal, seed) {
	const wall = group.getObjectByName('the-wall-natural-ice-cliff');
	if (!wall?.material) return 0;
	const material = wall.material.clone();
	material.vertexColors = false;
	material.color.set(0x91b6c2);
	material.roughness = 0.34;
	material.transmission = Math.max(0.035, material.transmission || 0);
	material.clearcoat = Math.max(0.12, material.clearcoat || 0);
	material.clearcoatRoughness = 0.26;
	material.needsUpdate = true;
	const transforms = [];
	for (let index = 2; index < sections.length - 2; index += 3) {
		const section = sections[index];
		if (Math.hypot(section.x - portal.centerX, section.z - portal.centerZ) < 46) continue;
		for (const side of [-1, 1]) {
			if (hash2D(index, side + 83, seed + 8707) < 0.38) continue;
			const height = section.heightMeters * (0.16 + hash2D(index, side + 89, seed + 8803) * 0.25);
			const width = 0.8 + hash2D(index, side + 97, seed + 8909) * 1.7;
			const depth = 0.65 + hash2D(index, side + 101, seed + 9001) * 1.0;
			const faceOffset = section.thicknessMeters * 0.5 + 0.8;
			const along = (hash2D(index, side + 103, seed + 9103) - 0.5) * 8;
			transforms.push({
				position: new THREE.Vector3(section.x + section.tx * along + section.nx * faceOffset * side, section.centerGround + height * 0.62 + section.heightMeters * 0.18, section.z + section.tz * along + section.nz * faceOffset * side),
				scale: new THREE.Vector3(width, height, depth),
				ry: -Math.atan2(section.tz, section.tx),
				rz: (hash2D(index, side + 107, seed + 9209) - 0.5) * 0.055,
			});
		}
	}
	if (!transforms.length) return 0;
	const ribs = createInstanceField('ice-wall-vertical-flow-ribs', 'wall-vertical-flow-ribs', new THREE.CapsuleGeometry(1, 2, 3, 6), material, transforms, seed + 9301, [0x6f9faf, 0xb8d0d5]);
	group.add(ribs);
	return ribs.count;
}

function createPortalShroud(group, portal, seed) {
	const wall = group.getObjectByName('the-wall-natural-ice-cliff');
	if (!wall?.material) return 0;
	const material = wall.material.clone();
	material.vertexColors = false;
	material.color.set(0xcbd5d4);
	material.roughness = 0.65;
	material.transmission = 0.015;
	material.clearcoat = 0.05;
	material.needsUpdate = true;
	const transforms = [];
	const openingHalfWidth = 7.8;
	for (const faceSign of [-1, 1]) {
		const normalOffset = portal.depth * 0.50 * faceSign;
		for (const side of [-1, 1]) {
			for (let level = 0; level < 3; level += 1) {
				const lateral = side * (openingHalfWidth + 3.0 + level * 0.55);
				transforms.push({
					position: new THREE.Vector3(portal.centerX + portal.tx * lateral + portal.nx * normalOffset, portal.groundY + 2.8 + level * 4.0, portal.centerZ + portal.tz * lateral + portal.nz * normalOffset),
					scale: new THREE.Vector3(3.2, 3.7, 2.7),
					ry: -Math.atan2(portal.tz, portal.tx) + side * 0.12,
					rz: side * (0.08 + level * 0.035),
				});
			}
		}
		for (let step = 1; step <= 5; step += 1) {
			const angle = Math.PI - (step / 6) * Math.PI;
			const lateral = Math.cos(angle) * openingHalfWidth;
			const height = 3.2 + Math.sin(angle) * 8.8 + 2.2;
			transforms.push({
				position: new THREE.Vector3(portal.centerX + portal.tx * lateral + portal.nx * normalOffset, portal.groundY + height, portal.centerZ + portal.tz * lateral + portal.nz * normalOffset),
				scale: new THREE.Vector3(2.6 + hash2D(step, faceSign + 43, seed + 8009) * 1.3, 2.3, 2.6),
				ry: -Math.atan2(portal.tz, portal.tx),
				rz: (hash2D(step, faceSign + 47, seed + 8101) - 0.5) * 0.35,
			});
		}
	}
	const shroud = createInstanceField('ice-cave-natural-portal-shroud', 'natural-fractured-portal-shroud', new THREE.DodecahedronGeometry(1, 0), material, transforms, seed + 8209);
	group.add(shroud);
	return shroud.count;
}

function createRibbonGeometry(rings, portal, widthMultiplier, yOffset, seed) {
	const positions = [];
	const colors = [];
	const indices = [];
	for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
		const ring = rings[ringIndex];
		const width = ring.halfWidth * widthMultiplier * (0.88 + hash2D(ringIndex, 59, seed + 8303) * 0.16);
		const y = ring.centerY + yOffset + (hash2D(ringIndex, 61, seed + 8401) - 0.5) * 0.08;
		for (const side of [-1, 1]) {
			positions.push(ring.centerX + portal.tx * width * side, y, ring.centerZ + portal.tz * width * side);
			const dirt = hash2D(ringIndex, side + 67, seed + 8501);
			colors.push(0.34 + dirt * 0.10, 0.43 + dirt * 0.08, 0.44 + dirt * 0.09);
		}
		if (ringIndex > 0) {
			const base = ringIndex * 2;
			indices.push(base - 2, base, base + 1, base - 2, base + 1, base - 1);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

function createCaveFloor(group, portal, rings, seed) {
	if (rings.length < 2) return 0;
	const floorMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xb0bab7, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
	const floor = new THREE.Mesh(createRibbonGeometry(rings, portal, 0.84, 0.06, seed), floorMaterial);
	floor.name = 'ice-cave-sediment-floor';
	floor.receiveShadow = true;
	floor.userData.iceLandmarkRole = 'cave-sediment-floor';
	group.add(floor);

	const wetMaterial = new THREE.MeshPhysicalMaterial({ color: 0x476f78, roughness: 0.30, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.22, transmission: 0.025, ior: 1.31, side: THREE.DoubleSide });
	const wet = new THREE.Mesh(createRibbonGeometry(rings, portal, 0.25, 0.105, seed + 8609), wetMaterial);
	wet.name = 'ice-cave-wet-melt-ribbon';
	wet.receiveShadow = true;
	wet.userData.iceLandmarkRole = 'cave-wet-melt-ribbon';
	group.add(wet);

	const cave = group.getObjectByName('ice-cave-shell');
	if (cave?.material) {
		cave.material.color.set(0xd5dddd);
		cave.material.roughness = Math.min(0.47, cave.material.roughness || 0.47);
		cave.material.transmission = Math.max(0.072, cave.material.transmission || 0);
		cave.material.attenuationColor.set(0x3f7f8d);
		cave.material.emissive.set(0x0b3139);
		cave.material.emissiveIntensity = 0.13;
		cave.material.needsUpdate = true;
	}
	return floor.geometry.index.count / 3 + wet.geometry.index.count / 3;
}

function createCaveIciclesAndDebris(group, portal, rings, seed) {
	if (rings.length < 4) return Object.freeze({ icicleCount: 0, debrisCount: 0 });
	const iceMaterial = new THREE.MeshPhysicalMaterial({ color: 0x9cc9d4, roughness: 0.24, metalness: 0, transmission: 0.13, thickness: 1.6, ior: 1.31, attenuationColor: 0x2e7386, attenuationDistance: 8, clearcoat: 0.18, clearcoatRoughness: 0.20 });
	const icicles = [];
	for (let ringIndex = 1; ringIndex < rings.length - 1; ringIndex += 2) {
		const ring = rings[ringIndex];
		const count = 1 + Math.floor(hash2D(ringIndex, 113, seed + 9403) * 3);
		for (let item = 0; item < count; item += 1) {
			const lateral = (hash2D(ringIndex * 13 + item, 127, seed + 9503) - 0.5) * ring.halfWidth * 1.35;
			const length = 1.0 + hash2D(ringIndex * 17 + item, 131, seed + 9601) * 3.6;
			icicles.push({
				position: new THREE.Vector3(ring.centerX + portal.tx * lateral, ring.centerY + ring.height * 0.82 - length * 0.5, ring.centerZ + portal.tz * lateral),
				scale: new THREE.Vector3(0.22 + length * 0.055, length, 0.22 + length * 0.055),
				rx: Math.PI,
				ry: -Math.atan2(portal.tz, portal.tx),
				rz: (hash2D(ringIndex, item + 137, seed + 9701) - 0.5) * 0.11,
			});
		}
	}
	const icicleMesh = createInstanceField('ice-cave-ceiling-icicles', 'cave-ceiling-icicles', new THREE.ConeGeometry(1, 1, 7, 1), iceMaterial, icicles, seed + 9803, [0x6fabbc, 0xcbe3e7]);
	group.add(icicleMesh);

	const debrisMaterial = new THREE.MeshStandardMaterial({ color: 0x4f5552, roughness: 0.94, metalness: 0 });
	const debris = [];
	for (let ringIndex = 1; ringIndex < rings.length - 1; ringIndex += 2) {
		const ring = rings[ringIndex];
		for (const side of [-1, 1]) {
			if (hash2D(ringIndex, side + 149, seed + 9901) < 0.34) continue;
			const lateral = side * ring.halfWidth * (0.60 + hash2D(ringIndex, side + 151, seed + 10007) * 0.22);
			const size = 0.25 + hash2D(ringIndex, side + 157, seed + 10103) * 0.85;
			debris.push({
				position: new THREE.Vector3(ring.centerX + portal.tx * lateral, ring.centerY + 0.16, ring.centerZ + portal.tz * lateral),
				scale: new THREE.Vector3(size * 1.25, size * 0.55, size),
				rx: hash2D(ringIndex, side + 163, seed + 10211) * 0.45,
				ry: hash2D(ringIndex, side + 167, seed + 10301) * Math.PI,
				rz: hash2D(ringIndex, side + 173, seed + 10427) * 0.35,
			});
		}
	}
	const debrisMesh = createInstanceField('ice-cave-sediment-debris', 'cave-sediment-debris', new THREE.DodecahedronGeometry(1, 0), debrisMaterial, debris, seed + 10501, [0x343a38, 0x69675d]);
	group.add(debrisMesh);
	return Object.freeze({ icicleCount: icicleMesh.count, debrisCount: debrisMesh.count });
}

function createCaveBlueCoreBreakup(group, portal, rings, seed) {
	if (rings.length < 6) return 0;
	const material = new THREE.MeshPhysicalMaterial({
		color: 0x2f8197,
		roughness: 0.19,
		metalness: 0,
		transmission: 0.24,
		thickness: 2.4,
		ior: 1.31,
		attenuationColor: 0x14576b,
		attenuationDistance: 6.5,
		clearcoat: 0.28,
		clearcoatRoughness: 0.18,
		emissive: 0x062f3b,
		emissiveIntensity: 0.16,
	});
	const transforms = [];
	for (let ringIndex = 3; ringIndex < rings.length - 2; ringIndex += 2) {
		const ring = rings[ringIndex];
		for (const side of [-1, 1]) {
			if (hash2D(ringIndex, side + 181, seed + 10601) < 0.26) continue;
			const lateral = side * ring.halfWidth * (0.73 + hash2D(ringIndex, side + 191, seed + 10709) * 0.16);
			const lift = ring.height * (0.18 + hash2D(ringIndex, side + 193, seed + 10831) * 0.42);
			const width = 0.55 + hash2D(ringIndex, side + 197, seed + 10939) * 1.15;
			const height = 2.2 + hash2D(ringIndex, side + 199, seed + 11003) * 4.6;
			const depth = 0.45 + hash2D(ringIndex, side + 211, seed + 11113) * 0.95;
			transforms.push({
				position: new THREE.Vector3(
					ring.centerX + portal.tx * lateral,
					ring.centerY + lift,
					ring.centerZ + portal.tz * lateral,
				),
				scale: new THREE.Vector3(width, height, depth),
				ry: -Math.atan2(portal.tz, portal.tx) + side * (0.18 + hash2D(ringIndex, 223, seed + 11239) * 0.18),
				rz: side * (0.08 + hash2D(ringIndex, 227, seed + 11329) * 0.18),
			});
		}
	}
	if (!transforms.length) return 0;
	const cores = createInstanceField(
		'ice-cave-dense-blue-core-slabs',
		'cave-dense-blue-core-slabs',
		new THREE.DodecahedronGeometry(1, 0),
		material,
		transforms,
		seed + 11443,
		[0x1d6378, 0x65b2c1],
	);
	group.add(cores);
	return cores.count;
}

export function applyIceLandmarkGeometryBreakup({ group, wallSections, portal, caveRings, seed }) {
	const wallVertexMoves = fractureWall(group, wallSections, seed);
	const caveVertexMoves = fractureCave(group, portal, caveRings, seed);
	const macroFracturePlateCount = createWallFracturePlates(group, wallSections, portal, seed);
	const wallFlowRibCount = createWallFlowRibs(group, wallSections, portal, seed);
	const portalShroudCount = createPortalShroud(group, portal, seed);
	const caveFloorTriangleCount = createCaveFloor(group, portal, caveRings, seed);
	const caveBreakup = createCaveIciclesAndDebris(group, portal, caveRings, seed);
	const caveBlueCoreCount = createCaveBlueCoreBreakup(group, portal, caveRings, seed);
	return Object.freeze({
		wallVertexMoves,
		caveVertexMoves,
		macroFracturePlateCount,
		wallFlowRibCount,
		portalShroudCount,
		caveFloorTriangleCount,
		caveIcicleCount: caveBreakup.icicleCount,
		caveDebrisCount: caveBreakup.debrisCount,
		caveBlueCoreCount,
		primaryMeshesFractured: wallVertexMoves > 0 && caveVertexMoves > 0,
		secondaryBreakupPresent: macroFracturePlateCount > 8 && wallFlowRibCount > 8 && portalShroudCount > 10 && caveFloorTriangleCount > 20 && caveBreakup.icicleCount > 4 && caveBlueCoreCount > 4,
	});
}
