import * as THREE from 'three';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import { normalizedMapToWorldXZ } from './worldReferenceMap.js';
import { enhanceIceLandmarkRealism } from './iceLandmarkRealism.js';

/**
 * Map-aligned high-north ice landmarks. Normalized map Y grows north -> south, so the wall sits
 * between the Lands of Always Winter and the inhabited North without inventing a second map axis.
 * Geometry is procedural/deterministic and uses real world metres; no terrain height is replaced.
 */
export const ICE_LANDMARK_POLICY = Object.freeze({
	id: 'owner-map-natural-ice-wall-cave-2026-08-24-v1',
	wall: Object.freeze({
		pathNormalized: Object.freeze([
			Object.freeze([0.070, 0.218]),
			Object.freeze([0.100, 0.213]),
			Object.freeze([0.132, 0.219]),
			Object.freeze([0.164, 0.214]),
			Object.freeze([0.196, 0.220]),
			Object.freeze([0.228, 0.216]),
			Object.freeze([0.260, 0.222]),
		]),
		maxSectionLengthMeters: 28,
		baseHeightMeters: 158,
		heightVariationMeters: 32,
		baseThicknessMeters: 31,
		thicknessVariationMeters: 9,
		textureRepeatMeters: 72,
	}),
	cave: Object.freeze({
		anchorNormalized: Object.freeze([0.171, 0.216]),
		openingHalfWidthMeters: 7.8,
		openingSideHeightMeters: 3.2,
		openingArchRiseMeters: 8.8,
		tunnelDepthMeters: 104,
		ringCount: 18,
		arcSegments: 16,
		chamberWidthMultiplier: 1.45,
		chamberHeightMultiplier: 1.32,
		icicleCount: 18,
	}),
	material: Object.freeze({
		ior: 1.31,
		wallTransmission: 0.055,
		caveTransmission: 0.12,
		attenuationDistanceMeters: 24,
		wallRoughness: 0.48,
		caveRoughness: 0.38,
	}),
});

function clamp01(value) {
	return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

function hash2D(x, y, seed) {
	let value = Math.imul((x | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((y | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function valueNoise2D(x, y, seed) {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const tx = smoothstep(0, 1, x - x0);
	const ty = smoothstep(0, 1, y - y0);
	const a = hash2D(x0, y0, seed);
	const b = hash2D(x0 + 1, y0, seed);
	const c = hash2D(x0, y0 + 1, seed);
	const d = hash2D(x0 + 1, y0 + 1, seed);
	const top = a + (b - a) * tx;
	const bottom = c + (d - c) * tx;
	return top + (bottom - top) * ty;
}

function fbm2D(x, y, seed) {
	let amplitude = 0.56;
	let frequency = 1;
	let total = 0;
	let weight = 0;
	for (let octave = 0; octave < 4; octave += 1) {
		total += valueNoise2D(x * frequency, y * frequency, seed + octave * 97) * amplitude;
		weight += amplitude;
		frequency *= 2.03;
		amplitude *= 0.48;
	}
	return total / weight;
}

function createIceSurfaceTextures(seed) {
	const width = 128;
	const height = 256;
	const scalar = new Float32Array(width * height);
	const colorBytes = new Uint8Array(width * height * 4);
	const roughnessBytes = new Uint8Array(width * height * 4);
	const normalBytes = new Uint8Array(width * height * 4);

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const u = x / (width - 1);
			const v = y / (height - 1);
			const broad = fbm2D(u * 5.5, v * 1.2, seed + 13);
			const fine = fbm2D(u * 18, v * 3.0, seed + 71);
			const flowPhase = u * 56 + broad * 5.2 + Math.sin(v * Math.PI * 2.2) * 0.7;
			const flow = 0.5 + 0.5 * Math.sin(flowPhase * Math.PI * 2);
			const vein = Math.pow(1 - Math.abs(flow * 2 - 1), 3.2);
			const diagonal = Math.abs(Math.sin((u * 12.0 + v * 3.8 + fine * 1.6) * Math.PI));
			const crack = 1 - smoothstep(0.018, 0.085, diagonal);
			const frost = clamp01(0.22 + vein * 0.42 + (fine - 0.5) * 0.34 + (1 - v) * 0.08);
			const depth = clamp01(0.34 + broad * 0.38 - crack * 0.22);
			const heightSignal = 0.45 + vein * 0.18 + (fine - 0.5) * 0.18 - crack * 0.16;
			scalar[y * width + x] = heightSignal;

			const index = (y * width + x) * 4;
			const deep = [53, 111, 126];
			const mid = [107, 167, 177];
			const frostRgb = [194, 219, 218];
			const midMix = clamp01(depth);
			const r0 = deep[0] + (mid[0] - deep[0]) * midMix;
			const g0 = deep[1] + (mid[1] - deep[1]) * midMix;
			const b0 = deep[2] + (mid[2] - deep[2]) * midMix;
			colorBytes[index] = Math.round(r0 + (frostRgb[0] - r0) * frost);
			colorBytes[index + 1] = Math.round(g0 + (frostRgb[1] - g0) * frost);
			colorBytes[index + 2] = Math.round(b0 + (frostRgb[2] - b0) * frost);
			colorBytes[index + 3] = 255;

			const roughness = clamp01(0.36 + frost * 0.28 + crack * 0.22 - vein * 0.08);
			const roughByte = Math.round(roughness * 255);
			roughnessBytes[index] = roughByte;
			roughnessBytes[index + 1] = roughByte;
			roughnessBytes[index + 2] = roughByte;
			roughnessBytes[index + 3] = 255;
		}
	}

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const left = scalar[y * width + Math.max(0, x - 1)];
			const right = scalar[y * width + Math.min(width - 1, x + 1)];
			const down = scalar[Math.max(0, y - 1) * width + x];
			const up = scalar[Math.min(height - 1, y + 1) * width + x];
			const dx = (right - left) * 2.4;
			const dy = (up - down) * 1.7;
			const length = Math.hypot(dx, dy, 1) || 1;
			const index = (y * width + x) * 4;
			normalBytes[index] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
			normalBytes[index + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
			normalBytes[index + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
			normalBytes[index + 3] = 255;
		}
	}

	const colorMap = new THREE.DataTexture(colorBytes, width, height, THREE.RGBAFormat);
	colorMap.colorSpace = THREE.SRGBColorSpace;
	const roughnessMap = new THREE.DataTexture(roughnessBytes, width, height, THREE.RGBAFormat);
	const normalMap = new THREE.DataTexture(normalBytes, width, height, THREE.RGBAFormat);
	for (const texture of [colorMap, roughnessMap, normalMap]) {
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.needsUpdate = true;
	}
	return { colorMap, roughnessMap, normalMap };
}

function createIceMaterial(textures, { cave = false } = {}) {
	const materialPolicy = ICE_LANDMARK_POLICY.material;
	const material = new THREE.MeshPhysicalMaterial({
		map: textures.colorMap,
		roughnessMap: textures.roughnessMap,
		normalMap: textures.normalMap,
		normalScale: new THREE.Vector2(0.72, 1.08),
		color: cave ? 0xb9e3df : 0xc8e7e3,
		roughness: cave ? materialPolicy.caveRoughness : materialPolicy.wallRoughness,
		metalness: 0,
		clearcoat: cave ? 0.34 : 0.23,
		clearcoatRoughness: cave ? 0.24 : 0.31,
		transmission: cave ? materialPolicy.caveTransmission : materialPolicy.wallTransmission,
		thickness: cave ? 3.6 : 2.4,
		ior: materialPolicy.ior,
		attenuationColor: new THREE.Color(cave ? 0x4a9aaa : 0x65a9b3),
		attenuationDistance: materialPolicy.attenuationDistanceMeters,
		vertexColors: true,
		side: THREE.DoubleSide,
	});
	if (cave) {
		material.emissive = new THREE.Color(0x0b2932);
		material.emissiveIntensity = 0.11;
	}
	material.userData.iceSurface = Object.freeze({
		policyId: ICE_LANDMARK_POLICY.id,
		mode: cave ? 'cave-subsurface' : 'wall-glacial-cliff',
		verticalFlowTexture: true,
		proceduralCracks: true,
		ior: materialPolicy.ior,
	});
	return material;
}

function normalizedPointToWorld(point) {
	return normalizedMapToWorldXZ(
		point[0],
		point[1],
		WORLD_SCALE.MAP_BOUNDS,
		WORLD_SCALE.METERS_PER_MAP_UNIT,
	);
}

function densifyWallPath() {
	const source = ICE_LANDMARK_POLICY.wall.pathNormalized.map(normalizedPointToWorld);
	const result = [];
	let cumulativeDistance = 0;
	for (let segment = 0; segment < source.length - 1; segment += 1) {
		const a = source[segment];
		const b = source[segment + 1];
		const length = Math.hypot(b.x - a.x, b.z - a.z);
		const steps = Math.max(1, Math.ceil(length / ICE_LANDMARK_POLICY.wall.maxSectionLengthMeters));
		for (let step = segment === 0 ? 0 : 1; step <= steps; step += 1) {
			const t = step / steps;
			const x = a.x + (b.x - a.x) * t;
			const z = a.z + (b.z - a.z) * t;
			if (result.length) {
				const previous = result[result.length - 1];
				cumulativeDistance += Math.hypot(x - previous.x, z - previous.z);
			}
			result.push({ x, z, distanceMeters: cumulativeDistance });
		}
	}
	return result;
}

function sectionFrame(path, index) {
	const previous = path[Math.max(0, index - 1)];
	const next = path[Math.min(path.length - 1, index + 1)];
	let tx = next.x - previous.x;
	let tz = next.z - previous.z;
	const length = Math.hypot(tx, tz) || 1;
	tx /= length;
	tz /= length;
	return { tx, tz, nx: -tz, nz: tx };
}

function createWallGeometry(path, sampleHeightMeters, caveGapSegment, seed) {
	const positions = [];
	const colors = [];
	const uvs = [];
	const indices = [];
	const sections = [];
	let minHeight = Infinity;
	let maxHeight = -Infinity;

	for (let index = 0; index < path.length; index += 1) {
		const point = path[index];
		const frame = sectionFrame(path, index);
		const broadNoise = valueNoise2D(index * 0.19, 1.7, seed + 101);
		const fineNoise = valueNoise2D(index * 0.53, 4.1, seed + 211);
		const heightMeters = ICE_LANDMARK_POLICY.wall.baseHeightMeters
			+ (broadNoise - 0.5) * ICE_LANDMARK_POLICY.wall.heightVariationMeters * 2
			+ (fineNoise - 0.5) * 8;
		const thicknessMeters = ICE_LANDMARK_POLICY.wall.baseThicknessMeters
			+ (valueNoise2D(index * 0.31, 8.3, seed + 307) - 0.5) * ICE_LANDMARK_POLICY.wall.thicknessVariationMeters * 2;
		const halfThickness = thicknessMeters * 0.5;
		const frontX = point.x + frame.nx * halfThickness;
		const frontZ = point.z + frame.nz * halfThickness;
		const backX = point.x - frame.nx * halfThickness;
		const backZ = point.z - frame.nz * halfThickness;
		const frontGround = Number(sampleHeightMeters(frontX, frontZ));
		const backGround = Number(sampleHeightMeters(backX, backZ));
		const centerGround = Number(sampleHeightMeters(point.x, point.z));
		if (![frontGround, backGround, centerGround].every(Number.isFinite)) {
			throw new TypeError('createIceLandmarks: sampleHeightMeters must return finite heights');
		}
		const crownNoise = (valueNoise2D(index * 0.41, 12.9, seed + 401) - 0.5) * 7;
		const topY = centerGround + heightMeters + crownNoise;
		minHeight = Math.min(minHeight, topY - centerGround);
		maxHeight = Math.max(maxHeight, topY - centerGround);
		const baseVertex = positions.length / 3;
		positions.push(
			frontX, frontGround - 1.5, frontZ,
			frontX, topY + (fineNoise - 0.5) * 4, frontZ,
			backX, backGround - 1.5, backZ,
			backX, topY - (fineNoise - 0.5) * 3, backZ,
		);
		const colorShift = 0.82 + broadNoise * 0.18;
		for (let vertex = 0; vertex < 4; vertex += 1) {
			colors.push(0.58 * colorShift, 0.82 * colorShift, 0.84 * colorShift);
		}
		const u = point.distanceMeters / ICE_LANDMARK_POLICY.wall.textureRepeatMeters;
		uvs.push(u, 0, u, 2.6, u + 0.12, 0, u + 0.12, 2.6);
		sections.push({
			...point,
			...frame,
			frontGround,
			backGround,
			centerGround,
			topY,
			heightMeters,
			thicknessMeters,
			baseVertex,
		});
	}

	for (let index = 0; index < sections.length - 1; index += 1) {
		if (index === caveGapSegment) continue;
		const a = sections[index].baseVertex;
		const b = sections[index + 1].baseVertex;
		indices.push(
			a, b, b + 1, a, b + 1, a + 1,
			a + 2, b + 3, b + 2, a + 2, a + 3, b + 3,
			a + 1, b + 1, b + 3, a + 1, b + 3, a + 3,
		);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	return { geometry, sections, minHeight, maxHeight };
}

function makePortalShape(width, height, openingHalfWidth, sideHeight, archRise) {
	const halfWidth = width * 0.5;
	const shape = new THREE.Shape();
	// The walk-through opening reaches the ground. A Shape hole touching the outer contour is
	// degenerate for Earcut and can drop the portal front/back caps. Trace one concave outer contour
	// around the arch instead: open at player height, manifold above and beside the entrance.
	shape.moveTo(-halfWidth, 0);
	shape.lineTo(-openingHalfWidth, 0);
	shape.lineTo(-openingHalfWidth, sideHeight);
	for (let step = 0; step <= 16; step += 1) {
		const angle = Math.PI - (step / 16) * Math.PI;
		shape.lineTo(
			Math.cos(angle) * openingHalfWidth,
			sideHeight + Math.sin(angle) * archRise,
		);
	}
	shape.lineTo(openingHalfWidth, 0);
	shape.lineTo(halfWidth, 0);
	shape.lineTo(halfWidth, height);
	shape.lineTo(-halfWidth, height);
	shape.closePath();
	return shape;
}

function createPortalMesh(leftSection, rightSection, material) {
	const cavePolicy = ICE_LANDMARK_POLICY.cave;
	const dx = rightSection.x - leftSection.x;
	const dz = rightSection.z - leftSection.z;
	const width = Math.hypot(dx, dz) + 9;
	const tx = dx / Math.max(width - 9, 1e-6);
	const tz = dz / Math.max(width - 9, 1e-6);
	const nx = -tz;
	const nz = tx;
	const centerX = (leftSection.x + rightSection.x) * 0.5;
	const centerZ = (leftSection.z + rightSection.z) * 0.5;
	const groundY = (leftSection.centerGround + rightSection.centerGround) * 0.5;
	const topY = Math.min(leftSection.topY, rightSection.topY);
	const depth = (leftSection.thicknessMeters + rightSection.thicknessMeters) * 0.5 + 4;
	const shape = makePortalShape(
		width,
		Math.max(35, topY - groundY),
		cavePolicy.openingHalfWidthMeters,
		cavePolicy.openingSideHeightMeters,
		cavePolicy.openingArchRiseMeters,
	);
	const geometry = new THREE.ExtrudeGeometry(shape, {
		depth,
		steps: 1,
		curveSegments: 16,
		bevelEnabled: true,
		bevelThickness: 0.8,
		bevelSize: 0.7,
		bevelSegments: 2,
	});
	geometry.computeVertexNormals();
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = 'ice-wall-cave-portal';
	mesh.position.set(centerX - nx * depth * 0.5, groundY, centerZ - nz * depth * 0.5);
	mesh.rotation.y = -Math.atan2(tz, tx);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.userData.iceLandmarkRole = 'arched-wall-portal';
	return { mesh, centerX, centerZ, groundY, tx, tz, nx, nz, depth, width };
}

function createCaveShell(portal, sampleHeightMeters, material) {
	const cavePolicy = ICE_LANDMARK_POLICY.cave;
	const positions = [];
	const colors = [];
	const uvs = [];
	const indices = [];
	const depthHalf = cavePolicy.tunnelDepthMeters * 0.5;
	const ringCount = cavePolicy.ringCount;
	const arcSegments = cavePolicy.arcSegments;
	const ringStride = arcSegments + 1;
	const ringMeta = [];

	for (let ring = 0; ring < ringCount; ring += 1) {
		const t = ring / (ringCount - 1);
		const depthOffset = -depthHalf + cavePolicy.tunnelDepthMeters * t;
		const centerX = portal.centerX + portal.nx * depthOffset;
		const centerZ = portal.centerZ + portal.nz * depthOffset;
		const groundY = Number(sampleHeightMeters(centerX, centerZ));
		const chamber = Math.pow(Math.sin(t * Math.PI), 1.7);
		const halfWidth = cavePolicy.openingHalfWidthMeters * (1 + chamber * (cavePolicy.chamberWidthMultiplier - 1));
		const height = (cavePolicy.openingSideHeightMeters + cavePolicy.openingArchRiseMeters)
			* (1 + chamber * (cavePolicy.chamberHeightMultiplier - 1));
		const centerY = groundY + 0.15;
		ringMeta.push({ centerX, centerY, centerZ, halfWidth, height, depthOffset });
		for (let step = 0; step <= arcSegments; step += 1) {
			const angle = (step / arcSegments) * Math.PI;
			const lateral = Math.cos(angle) * halfWidth;
			const y = centerY + Math.sin(angle) * height;
			positions.push(
				centerX + portal.tx * lateral,
				y,
				centerZ + portal.tz * lateral,
			);
			const iceDepth = 0.80 + 0.20 * chamber;
			colors.push(0.48 * iceDepth, 0.78 * iceDepth, 0.84 * iceDepth);
			uvs.push(t * 3.2, step / arcSegments * 1.7);
		}
	}

	for (let ring = 0; ring < ringCount - 1; ring += 1) {
		for (let step = 0; step < arcSegments; step += 1) {
			const a = ring * ringStride + step;
			const b = a + 1;
			const c = (ring + 1) * ringStride + step;
			const d = c + 1;
			indices.push(a, c, d, a, d, b);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = 'ice-cave-shell';
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.userData.iceLandmarkRole = 'walkable-ice-cave-shell';
	return { mesh, ringMeta };
}

function createCaveIcicles(portal, ringMeta, material, seed) {
	const count = ICE_LANDMARK_POLICY.cave.icicleCount;
	const geometry = new THREE.ConeGeometry(0.72, 4.8, 7, 1, false);
	const icicles = new THREE.InstancedMesh(geometry, material, count);
	icicles.name = 'ice-cave-icicles';
	icicles.castShadow = true;
	icicles.receiveShadow = true;
	const matrix = new THREE.Matrix4();
	const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
	for (let index = 0; index < count; index += 1) {
		const t = 0.24 + hash2D(index, 9, seed + 607) * 0.52;
		const ringIndex = Math.min(ringMeta.length - 1, Math.max(0, Math.round(t * (ringMeta.length - 1))));
		const ring = ringMeta[ringIndex];
		const lateralRatio = (hash2D(index, 13, seed + 701) - 0.5) * 1.15;
		const lateral = lateralRatio * ring.halfWidth;
		const normalized = Math.min(1, Math.abs(lateral) / Math.max(0.01, ring.halfWidth));
		const ceilingY = ring.centerY + ring.height * Math.sqrt(Math.max(0, 1 - normalized * normalized));
		const scale = 0.55 + hash2D(index, 17, seed + 809) * 1.05;
		const position = new THREE.Vector3(
			ring.centerX + portal.tx * lateral,
			ceilingY - 2.1 * scale,
			ring.centerZ + portal.tz * lateral,
		);
		matrix.compose(position, quaternion, new THREE.Vector3(scale, scale, scale));
		icicles.setMatrixAt(index, matrix);
	}
	icicles.instanceMatrix.needsUpdate = true;
	icicles.userData.iceLandmarkRole = 'cave-ceiling-icicles';
	return icicles;
}

function nearestPathIndex(path, worldPoint) {
	let bestIndex = 0;
	let bestDistance = Infinity;
	for (let index = 0; index < path.length; index += 1) {
		const distance = Math.hypot(path[index].x - worldPoint.x, path[index].z - worldPoint.z);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index;
		}
	}
	return Math.min(path.length - 2, Math.max(0, bestIndex));
}

function buildCollisionCircles(sections, caveGapSegment, portal, caveRings) {
	const blockers = [];
	for (let index = 0; index < sections.length; index += 1) {
		if (Math.abs(index - caveGapSegment) <= 2) continue;
		const section = sections[index];
		blockers.push({
			x: section.x,
			z: section.z,
			radius: Math.max(10, section.thicknessMeters * 0.52),
			kind: 'ice-wall',
		});
	}
	for (let ringIndex = 2; ringIndex < caveRings.length - 2; ringIndex += 2) {
		const ring = caveRings[ringIndex];
		const sideRadius = 3.4;
		const lateral = Math.max(5.8, ring.halfWidth - sideRadius * 0.65);
		for (const sign of [-1, 1]) {
			blockers.push({
				x: ring.centerX + portal.tx * lateral * sign,
				z: ring.centerZ + portal.tz * lateral * sign,
				radius: sideRadius,
				kind: 'ice-cave-wall',
			});
		}
	}
	return blockers;
}

/**
 * Creates the map-aligned Wall plus a walk-through ice cave. The caller owns adding `group` to the
 * scene and can feed `blockers` to physics' existing circle collider; no general physics engine is
 * introduced. `sampleHeightMeters` must be the same shared terrain/collider authority used by the
 * rest of the world.
 */
export function createIceLandmarks({
	sampleHeightMeters,
	seed = WORLD_DEFAULTS.WORLD_SEED,
} = {}) {
	if (typeof sampleHeightMeters !== 'function') {
		throw new TypeError('createIceLandmarks: sampleHeightMeters function is required');
	}
	const group = new THREE.Group();
	group.name = 'map-aligned-ice-landmarks';
	const textures = createIceSurfaceTextures(seed ^ 0x49434557); // ICEW
	const wallMaterial = createIceMaterial(textures, { cave: false });
	const caveMaterial = createIceMaterial(textures, { cave: true });
	const path = densifyWallPath();
	const caveAnchor = normalizedPointToWorld(ICE_LANDMARK_POLICY.cave.anchorNormalized);
	const caveGapSegment = nearestPathIndex(path, caveAnchor);
	const wallResult = createWallGeometry(path, sampleHeightMeters, caveGapSegment, seed);
	const wall = new THREE.Mesh(wallResult.geometry, wallMaterial);
	wall.name = 'the-wall-natural-ice-cliff';
	wall.castShadow = true;
	wall.receiveShadow = true;
	wall.userData.iceLandmarkRole = 'natural-ice-wall';
	group.add(wall);

	const leftSection = wallResult.sections[caveGapSegment];
	const rightSection = wallResult.sections[caveGapSegment + 1];
	const portal = createPortalMesh(leftSection, rightSection, wallMaterial);
	group.add(portal.mesh);
	const cave = createCaveShell(portal, sampleHeightMeters, caveMaterial);
	group.add(cave.mesh);
	const icicles = createCaveIcicles(portal, cave.ringMeta, caveMaterial, seed);
	group.add(icicles);
	const realism = enhanceIceLandmarkRealism({
		group,
		wallMaterial,
		caveMaterial,
		wallSections: wallResult.sections,
		caveGapSegment,
		portal,
		caveRings: cave.ringMeta,
		seed,
	});

	const blockers = buildCollisionCircles(wallResult.sections, caveGapSegment, portal, cave.ringMeta);
	const stats = Object.freeze({
		policyId: ICE_LANDMARK_POLICY.id,
		wallLengthMeters: Number(path.at(-1).distanceMeters.toFixed(1)),
		wallSectionCount: wallResult.sections.length,
		wallMinimumHeightMeters: Number(wallResult.minHeight.toFixed(1)),
		wallMaximumHeightMeters: Number(wallResult.maxHeight.toFixed(1)),
		wallTriangleCount: wallResult.geometry.index.count / 3,
		collisionCircleCount: blockers.length,
		realism: realism.stats,
		cave: Object.freeze({
			center: Object.freeze({ x: portal.centerX, y: portal.groundY, z: portal.centerZ }),
			openingWidthMeters: ICE_LANDMARK_POLICY.cave.openingHalfWidthMeters * 2,
			tunnelDepthMeters: ICE_LANDMARK_POLICY.cave.tunnelDepthMeters,
			ringCount: cave.ringMeta.length,
			icicleCount: ICE_LANDMARK_POLICY.cave.icicleCount,
			portalWidthMeters: Number(portal.width.toFixed(1)),
		}),
	});
	group.userData.iceLandmarkStats = stats;
	group.userData.glacialRealismStats = realism.stats;
	group.userData.collisionCircles = blockers;
	return Object.freeze({ group, blockers, stats });
}

export function disposeIceLandmarks(group) {
	if (!group) return;
	const geometries = new Set();
	const materials = new Set();
	const textures = new Set();
	group.traverse((object) => {
		if (object.geometry) geometries.add(object.geometry);
		const source = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
		for (const material of source) {
			materials.add(material);
			for (const key of ['map', 'roughnessMap', 'normalMap', 'alphaMap', 'emissiveMap']) {
				if (material[key]) textures.add(material[key]);
			}
		}
	});
	for (const geometry of geometries) geometry.dispose();
	for (const texture of textures) texture.dispose();
	for (const material of materials) material.dispose();
	group.clear();
	group.userData.disposed = true;
}