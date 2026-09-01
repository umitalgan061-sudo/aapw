import * as THREE from 'three';

function hash2D(x, y, seed) {
	let value = Math.imul((x | 0) ^ seed, 0x27d4eb2d)
		^ Math.imul((y | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function smoothNoise2D(x, z, scale, seed) {
	const fx = x / scale;
	const fz = z / scale;
	const ix = Math.floor(fx);
	const iz = Math.floor(fz);
	const tx = fx - ix;
	const tz = fz - iz;
	const ux = tx * tx * (3 - 2 * tx);
	const uz = tz * tz * (3 - 2 * tz);
	const a = hash2D(ix, iz, seed);
	const b = hash2D(ix + 1, iz, seed);
	const c = hash2D(ix, iz + 1, seed);
	const d = hash2D(ix + 1, iz + 1, seed);
	return THREE.MathUtils.lerp(
		THREE.MathUtils.lerp(a, b, ux),
		THREE.MathUtils.lerp(c, d, ux),
		uz,
	);
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

function createFacetedSlabGeometry(contour, {
	frontDepth = 0.24,
	backDepth = -0.14,
	frontCrown = 0.34,
} = {}) {
	const count = contour.length;
	const positions = [];
	const indices = [];
	for (const [x, y] of contour) positions.push(x, y, frontDepth);
	for (const [x, y] of contour) positions.push(x, y, backDepth);
	const frontCenter = positions.length / 3;
	positions.push(0, 0, frontCrown);
	const backCenter = positions.length / 3;
	positions.push(0, 0, backDepth * 0.92);
	for (let index = 0; index < count; index += 1) {
		const next = (index + 1) % count;
		indices.push(frontCenter, index, next);
		indices.push(backCenter, count + next, count + index);
		indices.push(index, count + index, count + next, index, count + next, next);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return geometry;
}

function createEmbeddedFracturePlateGeometry() {
	return createFacetedSlabGeometry([
		[-0.88, -0.60], [-0.38, -1.00], [0.32, -0.91], [0.91, -0.34],
		[0.76, 0.48], [0.18, 1.00], [-0.56, 0.78], [-1.00, 0.06],
	], { frontDepth: 0.20, backDepth: -0.16, frontCrown: 0.30 });
}

function createEmbeddedFlowRibGeometry() {
	return createFacetedSlabGeometry([
		[-0.42, -1.00], [0.36, -0.94], [0.55, -0.30], [0.38, 0.34],
		[0.12, 1.00], [-0.30, 0.66], [-0.52, 0.02],
	], { frontDepth: 0.13, backDepth: -0.10, frontCrown: 0.19 });
}

function installIceRoughnessFabric(material, seed) {
	const salt = (Math.abs(seed) % 4093) + 17;
	const prior = material.onBeforeCompile;
	material.onBeforeCompile = (shader, renderer) => {
		if (prior) prior.call(material, shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vIceWorldPosition;')
			.replace('#include <project_vertex>', '#include <project_vertex>\nvIceWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\nvarying vec3 vIceWorldPosition;\nfloat iceHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+${salt.toFixed(1)})*43758.5453123);}\nfloat iceNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(iceHash(i),iceHash(i+vec2(1.0,0.0)),f.x),mix(iceHash(i+vec2(0.0,1.0)),iceHash(i+vec2(1.0,1.0)),f.x),f.y);}`)
			.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nfloat iceRoughBroad=iceNoise(vIceWorldPosition.xz/118.0);\nfloat iceRoughMacro=iceNoise((vIceWorldPosition.xz+vIceWorldPosition.yy*0.19)/41.0);\nfloat iceRoughMeso=iceNoise((vIceWorldPosition.xz+vIceWorldPosition.yy*0.43)/10.5);\nfloat iceRoughBand=iceNoise(vec2(vIceWorldPosition.x*0.052+vIceWorldPosition.y*0.018,vIceWorldPosition.z*0.071-vIceWorldPosition.y*0.011));\nroughnessFactor=clamp(roughnessFactor*(0.69+iceRoughBroad*0.18+iceRoughMacro*0.25+iceRoughMeso*0.14+iceRoughBand*0.09),0.18,0.94);');
	};
	const priorKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${priorKey ? priorKey() : ''}|ice-rough-v3-${salt}`;
	material.needsUpdate = true;
}

function iceVertexFabric(mesh, seed, {
	low = 0xaebfc1,
	mid = 0xd2dddc,
	high = 0xf0f4f1,
	roughness = 0.58,
} = {}) {
	const position = mesh?.geometry?.getAttribute?.('position');
	if (!position || !mesh?.material) return 0;
	const lowColor = new THREE.Color(low);
	const midColor = new THREE.Color(mid);
	const highColor = new THREE.Color(high);
	const color = new THREE.Color();
	const worldPosition = new THREE.Vector3();
	const colors = new Float32Array(position.count * 3);
	mesh.updateMatrixWorld(true);
	let minY = Infinity;
	let maxY = -Infinity;
	for (let index = 0; index < position.count; index += 1) {
		worldPosition.set(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(mesh.matrixWorld);
		minY = Math.min(minY, worldPosition.y);
		maxY = Math.max(maxY, worldPosition.y);
	}
	const span = Math.max(1, maxY - minY);
	for (let index = 0; index < position.count; index += 1) {
		worldPosition.set(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(mesh.matrixWorld);
		const x = worldPosition.x;
		const y = worldPosition.y;
		const z = worldPosition.z;
		const macro = smoothNoise2D(x, z, 74, seed + 13001);
		const meso = smoothNoise2D(x + y * 0.24, z - y * 0.11, 21, seed + 13109);
		const micro = smoothNoise2D(x + y * 0.13, z, 6.5, seed + 13217);
		const height = (y - minY) / span;
		const weather = THREE.MathUtils.clamp(
			0.25 + macro * 0.33 + meso * 0.24 + micro * 0.06 + height * 0.12,
			0,
			1,
		);
		color.copy(lowColor).lerp(midColor, Math.min(1, weather * 1.12));
		if (weather > 0.61) color.lerp(highColor, ((weather - 0.61) / 0.39) * 0.58);
		const crevasse = Math.max(0, 0.40 - meso) * 0.13;
		color.multiplyScalar(1 - crevasse);
		colors[index * 3] = color.r;
		colors[index * 3 + 1] = color.g;
		colors[index * 3 + 2] = color.b;
	}
	mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	const material = mesh.material.clone();
	material.vertexColors = true;
	material.color.set(0xffffff);
	material.roughness = roughness;
	if (material.emissive) {
		material.emissive.set(0x183942);
		material.emissiveIntensity = Math.max(0.064, material.emissiveIntensity || 0);
	}
	installIceRoughnessFabric(material, seed + 13513);
	mesh.material = material;
	mesh.userData.worldSpaceGlacialAlbedoFabric = 'deterministic-smoothed-multiscale-v6-true-world-space';
	mesh.userData.worldSpaceGlacialRoughnessFabric = 'deterministic-shader-multiscale-v3-aerial';
	return position.count;
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
		for (const [vertex, sign, amount] of [
			[base + 1, 1, macro * 9],
			[base + 3, -1, macro * 6.5],
			[base, 1, shear * 2.8],
			[base + 2, -1, shear * 1.8],
		]) {
			position.setX(vertex, position.getX(vertex) + section.nx * amount * sign + section.tx * shear * 1.7);
			position.setZ(vertex, position.getZ(vertex) + section.nz * amount * sign + section.tz * shear * 1.7);
			moved += 1;
		}
		position.setY(base + 1, position.getY(base + 1) + (hash2D(index, 17, seed + 6301) - 0.5) * 6.5);
		position.setY(base + 3, position.getY(base + 3) + (hash2D(index, 19, seed + 6401) - 0.5) * 5);
	}
	refreshGeometry(wall.geometry);
	iceVertexFabric(wall, seed + 13331, {
		low: 0xc8d5d5,
		mid: 0xe1e9e7,
		high: 0xf5f8f5,
		roughness: 0.53,
	});
	if (wall.material?.emissive) {
		wall.material.emissive.set(0x214650);
		wall.material.emissiveIntensity = Math.max(0.095, wall.material.emissiveIntensity || 0);
		wall.material.needsUpdate = true;
	}
	wall.userData.primaryGlacialBreakup = true;
	return moved;
}

function fractureCave(group, portal, rings, seed) {
	const cave = group.getObjectByName('ice-cave-shell');
	const position = cave?.geometry?.getAttribute?.('position');
	if (!position || !rings.length) return 0;
	const stride = Math.round(position.count / rings.length);
	let moved = 0;
	for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
		for (let step = 0; step < stride; step += 1) {
			const vertex = ringIndex * stride + step;
			if (vertex >= position.count) continue;
			const edge = Math.abs(step / Math.max(1, stride - 1) - 0.5) * 2;
			const warp = (hash2D(ringIndex * 37 + step, 23, seed + 6503) - 0.5) * (0.8 + edge * 0.9);
			const lift = (hash2D(ringIndex * 41 + step, 29, seed + 6607) - 0.5) * (0.55 + (1 - edge) * 1.15);
			position.setX(vertex, position.getX(vertex) + portal.tx * warp);
			position.setZ(vertex, position.getZ(vertex) + portal.tz * warp);
			position.setY(vertex, position.getY(vertex) + lift);
			moved += 1;
		}
	}
	refreshGeometry(cave.geometry);
	iceVertexFabric(cave, seed + 13441, {
		low: 0xa4bec4,
		mid: 0xc8dcdd,
		high: 0xeaf2ef,
		roughness: 0.40,
	});
	cave.userData.primaryGlacialBreakup = true;
	return moved;
}

function field(name, role, geometry, material, transforms, seed, tints = null) {
	const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
	mesh.name = name;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.userData.iceLandmarkRole = role;
	const matrix = new THREE.Matrix4();
	const quaternion = new THREE.Quaternion();
	const color = new THREE.Color();
	const low = tints ? new THREE.Color(tints[0]) : null;
	const high = tints ? new THREE.Color(tints[1]) : null;
	for (let index = 0; index < transforms.length; index += 1) {
		const transform = transforms[index];
		quaternion.setFromEuler(new THREE.Euler(transform.rx || 0, transform.ry || 0, transform.rz || 0));
		matrix.compose(transform.position, quaternion, transform.scale);
		mesh.setMatrixAt(index, matrix);
		const shade = 0.82 + hash2D(index, role.length, seed + 7013) * 0.18;
		if (low && high) color.copy(low).lerp(high, hash2D(index, 71, seed + 7069));
		else color.setRGB(shade * 0.96, shade * 0.995, Math.min(1, shade * 1.04));
		mesh.setColorAt(index, color);
	}
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	return mesh;
}

function wallPlates(group, sections, portal, seed) {
	const wall = group.getObjectByName('the-wall-natural-ice-cliff');
	if (!wall?.material) return 0;
	const material = wall.material.clone();
	material.vertexColors = false;
	material.color.set(0xc4d0cf);
	material.roughness = Math.max(0.64, material.roughness || 0.64);
	material.transmission = Math.min(0.012, material.transmission || 0);
	material.clearcoat = Math.min(0.045, material.clearcoat || 0);
	installIceRoughnessFabric(material, seed + 7867);
	const transforms = [];
	for (let index = 3; index < sections.length - 3; index += 5) {
		const section = sections[index];
		if (Math.hypot(section.x - portal.centerX, section.z - portal.centerZ) < 62) continue;
		const side = hash2D(index, 5, seed + 7103) > 0.5 ? 1 : -1;
		const width = 7 + hash2D(index, 7, seed + 7207) * 11;
		const height = 22 + hash2D(index, 11, seed + 7307) * 30;
		const depth = 0.55 + hash2D(index, 13, seed + 7403) * 0.95;
		const elevation = 0.18 + hash2D(index, 17, seed + 7507) * 0.57;
		const offset = section.thicknessMeters * 0.5 + depth * 0.035;
		transforms.push({
			position: new THREE.Vector3(
				section.x + section.nx * offset * side,
				section.centerGround + section.heightMeters * elevation,
				section.z + section.nz * offset * side,
			),
			scale: new THREE.Vector3(width * 0.5, height * 0.5, depth),
			rx: (hash2D(index, 19, seed + 7603) - 0.5) * 0.12,
			ry: -Math.atan2(section.tz, section.tx) + (hash2D(index, 23, seed + 7703) - 0.5) * 0.16,
			rz: (hash2D(index, 29, seed + 7801) - 0.5) * 0.32,
		});
	}
	if (!transforms.length) return 0;
	const mesh = field(
		'ice-wall-macro-fracture-plates',
		'wall-macro-fracture-plates',
		createEmbeddedFracturePlateGeometry(),
		material,
		transforms,
		seed + 7901,
		[0x9fb5b8, 0xcbd6d5],
	);
	mesh.userData.breakupGeometry = 'embedded-irregular-glacial-slab-v13';
	mesh.userData.worldSpaceGlacialRoughnessFabric = 'deterministic-shader-multiscale-v3-aerial';
	group.add(mesh);
	return mesh.count;
}

function wallRibs(group, sections, portal, seed) {
	const wall = group.getObjectByName('the-wall-natural-ice-cliff');
	if (!wall?.material) return 0;
	const material = wall.material.clone();
	material.vertexColors = false;
	material.color.set(0xb5c9cb);
	material.roughness = 0.49;
	material.transmission = Math.max(0.016, material.transmission || 0);
	material.clearcoat = Math.max(0.065, material.clearcoat || 0);
	material.clearcoatRoughness = 0.36;
	installIceRoughnessFabric(material, seed + 9281);
	const transforms = [];
	for (let index = 2; index < sections.length - 2; index += 3) {
		const section = sections[index];
		if (Math.hypot(section.x - portal.centerX, section.z - portal.centerZ) < 46) continue;
		for (const side of [-1, 1]) {
			if (hash2D(index, side + 83, seed + 8707) < 0.38) continue;
			const height = section.heightMeters * (0.08 + hash2D(index, side + 89, seed + 8803) * 0.14);
			const width = 2.2 + hash2D(index, side + 97, seed + 8909) * 2.4;
			const depth = 0.4 + hash2D(index, side + 101, seed + 9001) * 0.55;
			const offset = section.thicknessMeters * 0.5 + depth * 0.075;
			const along = (hash2D(index, side + 103, seed + 9103) - 0.5) * 8;
			transforms.push({
				position: new THREE.Vector3(
					section.x + section.tx * along + section.nx * offset * side,
					section.centerGround + section.heightMeters * 0.2 + height * 0.5,
					section.z + section.tz * along + section.nz * offset * side,
				),
				scale: new THREE.Vector3(width * 0.5, height * 0.5, depth),
				rx: (hash2D(index, side + 109, seed + 9257) - 0.5) * 0.045,
				ry: -Math.atan2(section.tz, section.tx),
				rz: (hash2D(index, side + 107, seed + 9209) - 0.5) * 0.075,
			});
		}
	}
	if (!transforms.length) return 0;
	const mesh = field(
		'ice-wall-vertical-flow-ribs',
		'wall-vertical-flow-ribs',
		createEmbeddedFlowRibGeometry(),
		material,
		transforms,
		seed + 9301,
		[0x9bb5ba, 0xc9d7d7],
	);
	mesh.userData.breakupGeometry = 'embedded-tapered-glacial-flow-rib-v13';
	mesh.userData.worldSpaceGlacialRoughnessFabric = 'deterministic-shader-multiscale-v3-aerial';
	group.add(mesh);
	return mesh.count;
}

function portalShroud(group, portal, seed) {
	const wall = group.getObjectByName('the-wall-natural-ice-cliff');
	if (!wall?.material) return 0;
	const portalMesh = group.getObjectByName('ice-wall-cave-portal');
	if (portalMesh?.material) {
		iceVertexFabric(portalMesh, seed + 13331, {
			low: 0xc8d5d5,
			mid: 0xe1e9e7,
			high: 0xf5f8f5,
			roughness: 0.53,
		});
		if (portalMesh.material?.emissive) {
			portalMesh.material.emissive.set(0x214650);
			portalMesh.material.emissiveIntensity = Math.max(0.095, portalMesh.material.emissiveIntensity || 0);
		}
		portalMesh.material.needsUpdate = true;
		portalMesh.userData.portalMaterialBlend = 'wall-continuous-world-space-fabric-v14';
	}
	const material = wall.material.clone();
	material.vertexColors = false;
	material.color.set(0xc4d2d2);
	material.roughness = 0.60;
	material.transmission = 0.010;
	material.clearcoat = 0.035;
	material.clearcoatRoughness = 0.50;
	if (material.emissive) {
		material.emissive.set(0x1d4048);
		material.emissiveIntensity = Math.max(0.072, material.emissiveIntensity || 0);
	}
	installIceRoughnessFabric(material, seed + 12437);
	const transforms = [];
	const half = 7.8;
	const yaw = -Math.atan2(portal.tz, portal.tx);
	for (const face of [-1, 1]) {
		const normal = (portal.depth * 0.5 - 0.72) * face;
		for (const side of [-1, 1]) {
			for (let level = 0; level < 2; level += 1) {
				const lateral = side * (half + 0.10 + level * 0.14)
					+ (hash2D(level, side + 271, seed + 11677) - 0.5) * 0.06;
				const width = 0.10 + hash2D(level, side + 19, seed + 11701) * 0.06;
				const height = 0.24 + hash2D(level, side + 239, seed + 11807) * 0.12;
				transforms.push({
					position: new THREE.Vector3(
						portal.centerX + portal.tx * lateral + portal.nx * normal,
						portal.groundY + 2.05 + level * 3.12,
						portal.centerZ + portal.tz * lateral + portal.nz * normal,
					),
					scale: new THREE.Vector3(width, height, 0.055),
					rx: (hash2D(level, side + 251, seed + 11891) - 0.5) * 0.04,
					ry: yaw + side * 0.010,
					rz: side * (0.018 + level * 0.006) + (hash2D(level, side + 263, seed + 11921) - 0.5) * 0.04,
				});
			}
		}
		for (let step = 1; step <= 3; step += 1) {
			const angle = Math.PI - (step / 4) * Math.PI;
			const lateral = Math.cos(angle) * (half - 0.32)
				+ (hash2D(step, face + 23, seed + 11903) - 0.5) * 0.05;
			const height = 5.55 + Math.sin(angle) * 7.62;
			transforms.push({
				position: new THREE.Vector3(
					portal.centerX + portal.tx * lateral + portal.nx * normal,
					portal.groundY + height,
					portal.centerZ + portal.tz * lateral + portal.nz * normal,
				),
				scale: new THREE.Vector3(
					0.10 + hash2D(step, 271, seed + 12001) * 0.06,
					0.22 + hash2D(step, face + 277, seed + 12037) * 0.12,
					0.055,
				),
				rx: (hash2D(step, face + 281, seed + 12071) - 0.5) * 0.035,
				ry: yaw,
				rz: (hash2D(step, face + 29, seed + 12101) - 0.5) * 0.055,
			});
		}
	}
	const mesh = field(
		'ice-cave-natural-portal-shroud',
		'natural-fractured-portal-shroud',
		createEmbeddedFlowRibGeometry(),
		material,
		transforms,
		seed + 8209,
		[0xb8c9ca, 0xd8e2e0],
	);
	mesh.userData.portalShroudGeometry = 'wall-embedded-tapered-flow-ribs-v13';
	mesh.userData.worldSpaceGlacialRoughnessFabric = 'deterministic-shader-multiscale-v3-aerial';
	group.add(mesh);
	return mesh.count;
}

function ribbon(rings, portal, multiplier, yOffset, seed) {
	const positions = [];
	const colors = [];
	const indices = [];
	for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
		const ring = rings[ringIndex];
		const width = ring.halfWidth * multiplier * (0.88 + hash2D(ringIndex, 59, seed + 8303) * 0.16);
		const y = ring.centerY + yOffset + (hash2D(ringIndex, 61, seed + 8401) - 0.5) * 0.08;
		for (const side of [-1, 1]) {
			positions.push(
				ring.centerX + portal.tx * width * side,
				y,
				ring.centerZ + portal.tz * width * side,
			);
			const dirt = hash2D(ringIndex, side + 67, seed + 8501);
			colors.push(0.34 + dirt * 0.1, 0.43 + dirt * 0.08, 0.44 + dirt * 0.09);
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

function caveFloor(group, portal, rings, seed) {
	if (rings.length < 2) return 0;
	const floor = new THREE.Mesh(
		ribbon(rings, portal, 0.84, 0.06, seed),
		new THREE.MeshStandardMaterial({
			vertexColors: true,
			color: 0xb0bab7,
			roughness: 0.82,
			metalness: 0,
			side: THREE.DoubleSide,
		}),
	);
	floor.name = 'ice-cave-sediment-floor';
	floor.receiveShadow = true;
	floor.userData.iceLandmarkRole = 'cave-sediment-floor';
	group.add(floor);
	const wet = new THREE.Mesh(
		ribbon(rings, portal, 0.25, 0.105, seed + 8609),
		new THREE.MeshPhysicalMaterial({
			color: 0x476f78,
			roughness: 0.3,
			metalness: 0,
			clearcoat: 0.25,
			clearcoatRoughness: 0.22,
			transmission: 0.025,
			ior: 1.31,
			side: THREE.DoubleSide,
		}),
	);
	wet.name = 'ice-cave-wet-melt-ribbon';
	wet.receiveShadow = true;
	wet.userData.iceLandmarkRole = 'cave-wet-melt-ribbon';
	group.add(wet);
	const cave = group.getObjectByName('ice-cave-shell');
	if (cave?.material) {
		cave.material.color.set(cave.userData.worldSpaceGlacialAlbedoFabric ? 0xffffff : 0xd5dddd);
		cave.material.roughness = Math.min(0.47, cave.material.roughness || 0.47);
		cave.material.transmission = Math.max(0.072, cave.material.transmission || 0);
		cave.material.attenuationColor.set(0x3f7f8d);
		cave.material.emissive.set(0x0b3139);
		cave.material.emissiveIntensity = 0.13;
		cave.material.needsUpdate = true;
	}
	return floor.geometry.index.count / 3 + wet.geometry.index.count / 3;
}

function caveLights(group, portal, rings, seed) {
	if (rings.length < 8) return 0;
	const ringIds = [4, 8, 12, Math.min(rings.length - 3, 15)];
	let count = 0;
	for (let index = 0; index < ringIds.length; index += 1) {
		const ringIndex = Math.min(rings.length - 2, ringIds[index]);
		const ring = rings[ringIndex];
		if (!ring) continue;
		const lateral = (hash2D(ringIndex, 251, seed + 12101) - 0.5) * ring.halfWidth * 0.28;
		const lift = ring.height * (0.28 + hash2D(ringIndex, 257, seed + 12203) * 0.16);
		const light = new THREE.PointLight(
			index % 2 === 0 ? 0x46b9cf : 0x6bd0db,
			1.15 + hash2D(ringIndex, 263, seed + 12301) * 0.65,
			25 + hash2D(ringIndex, 269, seed + 12409) * 11,
			2,
		);
		light.name = `ice-cave-subsurface-light-${index + 1}`;
		light.position.set(
			ring.centerX + portal.tx * lateral,
			ring.centerY + lift,
			ring.centerZ + portal.tz * lateral,
		);
		light.userData.iceLandmarkRole = 'cave-cyan-subsurface-depth-light';
		light.userData.glacialDepthLayer = ringIndex;
		group.add(light);
		count += 1;
	}
	return count;
}

function caveBits(group, portal, rings, seed) {
	if (rings.length < 4) return Object.freeze({ icicleCount: 0, debrisCount: 0 });
	const iceMaterial = new THREE.MeshPhysicalMaterial({
		color: 0x9cc9d4,
		roughness: 0.24,
		metalness: 0,
		transmission: 0.13,
		thickness: 1.6,
		ior: 1.31,
		attenuationColor: 0x2e7386,
		attenuationDistance: 8,
		clearcoat: 0.18,
		clearcoatRoughness: 0.2,
	});
	const icicles = [];
	for (let ringIndex = 1; ringIndex < rings.length - 1; ringIndex += 2) {
		const ring = rings[ringIndex];
		const count = 1 + Math.floor(hash2D(ringIndex, 113, seed + 9403) * 3);
		for (let index = 0; index < count; index += 1) {
			const lateral = (hash2D(ringIndex * 13 + index, 127, seed + 9503) - 0.5) * ring.halfWidth * 1.35;
			const length = 1 + hash2D(ringIndex * 17 + index, 131, seed + 9601) * 3.6;
			icicles.push({
				position: new THREE.Vector3(
					ring.centerX + portal.tx * lateral,
					ring.centerY + ring.height * 0.82 - length * 0.5,
					ring.centerZ + portal.tz * lateral,
				),
				scale: new THREE.Vector3(0.22 + length * 0.055, length, 0.22 + length * 0.055),
				rx: Math.PI,
				ry: -Math.atan2(portal.tz, portal.tx),
				rz: (hash2D(ringIndex, index + 137, seed + 9701) - 0.5) * 0.11,
			});
		}
	}
	const icicleMesh = field(
		'ice-cave-ceiling-icicles',
		'cave-ceiling-icicles',
		new THREE.ConeGeometry(1, 1, 7, 1),
		iceMaterial,
		icicles,
		seed + 9803,
		[0x6fabbc, 0xcbe3e7],
	);
	group.add(icicleMesh);
	const debris = [];
	for (let ringIndex = 1; ringIndex < rings.length - 1; ringIndex += 2) {
		const ring = rings[ringIndex];
		for (const side of [-1, 1]) {
			if (hash2D(ringIndex, side + 149, seed + 9901) < 0.34) continue;
			const lateral = side * ring.halfWidth * (0.6 + hash2D(ringIndex, side + 151, seed + 10007) * 0.22);
			const size = 0.25 + hash2D(ringIndex, side + 157, seed + 10103) * 0.85;
			debris.push({
				position: new THREE.Vector3(
					ring.centerX + portal.tx * lateral,
					ring.centerY + 0.16,
					ring.centerZ + portal.tz * lateral,
				),
				scale: new THREE.Vector3(size * 1.25, size * 0.55, size),
				rx: hash2D(ringIndex, side + 163, seed + 10211) * 0.45,
				ry: hash2D(ringIndex, side + 167, seed + 10301) * Math.PI,
				rz: hash2D(ringIndex, side + 173, seed + 10427) * 0.35,
			});
		}
	}
	const debrisMesh = field(
		'ice-cave-sediment-debris',
		'cave-sediment-debris',
		new THREE.DodecahedronGeometry(1, 0),
		new THREE.MeshStandardMaterial({ color: 0x4f5552, roughness: 0.94, metalness: 0 }),
		debris,
		seed + 10501,
		[0x343a38, 0x69675d],
	);
	group.add(debrisMesh);
	return Object.freeze({ icicleCount: icicleMesh.count, debrisCount: debrisMesh.count });
}

function blueCore(group, portal, rings, seed) {
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
			transforms.push({
				position: new THREE.Vector3(
					ring.centerX + portal.tx * lateral,
					ring.centerY + lift,
					ring.centerZ + portal.tz * lateral,
				),
				scale: new THREE.Vector3(
					0.55 + hash2D(ringIndex, side + 197, seed + 10939) * 1.15,
					2.2 + hash2D(ringIndex, side + 199, seed + 11003) * 4.6,
					0.45 + hash2D(ringIndex, side + 211, seed + 11113) * 0.95,
				),
				ry: -Math.atan2(portal.tz, portal.tx) + side * (0.18 + hash2D(ringIndex, 223, seed + 11239) * 0.18),
				rz: side * (0.08 + hash2D(ringIndex, 227, seed + 11329) * 0.18),
			});
		}
	}
	if (!transforms.length) return 0;
	const mesh = field(
		'ice-cave-dense-blue-core-slabs',
		'cave-dense-blue-core-slabs',
		new THREE.OctahedronGeometry(1, 1),
		material,
		transforms,
		seed + 11443,
		[0x1d6378, 0x65b2c1],
	);
	group.add(mesh);
	return mesh.count;
}

export function applyIceLandmarkGeometryBreakup({ group, wallSections, portal, caveRings, seed }) {
	const wallVertexMoves = fractureWall(group, wallSections, seed);
	const caveVertexMoves = fractureCave(group, portal, caveRings, seed);
	const macroFracturePlateCount = wallPlates(group, wallSections, portal, seed);
	const wallFlowRibCount = wallRibs(group, wallSections, portal, seed);
	const portalShroudCount = portalShroud(group, portal, seed);
	const caveFloorTriangleCount = caveFloor(group, portal, caveRings, seed);
	const caveSubsurfaceLightCount = caveLights(group, portal, caveRings, seed);
	const bits = caveBits(group, portal, caveRings, seed);
	const caveBlueCoreCount = blueCore(group, portal, caveRings, seed);
	return Object.freeze({
		wallVertexMoves,
		caveVertexMoves,
		macroFracturePlateCount,
		wallFlowRibCount,
		portalShroudCount,
		caveFloorTriangleCount,
		caveSubsurfaceLightCount,
		caveIcicleCount: bits.icicleCount,
		caveDebrisCount: bits.debrisCount,
		caveBlueCoreCount,
		primaryMeshesFractured: wallVertexMoves > 0 && caveVertexMoves > 0,
		secondaryBreakupPresent: macroFracturePlateCount > 8
			&& wallFlowRibCount > 8
			&& portalShroudCount > 10
			&& caveFloorTriangleCount > 20
			&& caveSubsurfaceLightCount >= 3
			&& bits.icicleCount > 4
			&& caveBlueCoreCount > 4,
	});
}