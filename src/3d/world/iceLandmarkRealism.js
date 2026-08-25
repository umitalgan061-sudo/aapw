import * as THREE from 'three';

const TEXTURE_WIDTH = 256;
const TEXTURE_HEIGHT = 512;

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
	return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
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

function mixRgb(a, b, amount) {
	const t = clamp01(amount);
	return [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t,
	];
}

function createGlacialTextureSet(seed, { cave = false } = {}) {
	const scalar = new Float32Array(TEXTURE_WIDTH * TEXTURE_HEIGHT);
	const colorBytes = new Uint8Array(TEXTURE_WIDTH * TEXTURE_HEIGHT * 4);
	const roughnessBytes = new Uint8Array(TEXTURE_WIDTH * TEXTURE_HEIGHT * 4);
	const normalBytes = new Uint8Array(TEXTURE_WIDTH * TEXTURE_HEIGHT * 4);
	let crackCoverage = 0;
	let frostCoverage = 0;
	let wetCoverage = 0;
	let debrisCoverage = 0;

	for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
		for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
			const u = x / (TEXTURE_WIDTH - 1);
			const v = y / (TEXTURE_HEIGHT - 1);
			const macro = fbm2D(u * 4.1, v * 1.55, seed + 11);
			const meso = fbm2D(u * 13.5, v * 6.1, seed + 47);
			const micro = fbm2D(u * 48, v * 31, seed + 83);
			const flowPhase = u * 29 + macro * 4.8 + Math.sin(v * 11.5) * 0.55;
			const verticalDistance = Math.abs(Math.sin(flowPhase * Math.PI));
			const crossDistance = Math.abs(Math.sin((u * 8.3 - v * 2.65 + meso * 2.2) * Math.PI));
			const verticalCrack = 1 - smoothstep(0.018, 0.085, verticalDistance);
			const crossCrack = (1 - smoothstep(0.018, 0.075, crossDistance)) * 0.58;
			const crack = clamp01(Math.max(verticalCrack, crossCrack) * (0.72 + micro * 0.54));
			const flowRidge = Math.pow(1 - verticalDistance, 2.4) * (0.35 + meso * 0.65);
			const frost = clamp01(0.17 + (meso - 0.42) * 0.52 + flowRidge * 0.34 + (cave ? 0.02 : v * 0.16));
			const snowCap = cave ? 0 : smoothstep(0.76, 0.985, v) * clamp01(0.58 + macro * 0.62);
			const baseDebris = cave
				? smoothstep(0.58, 0.92, meso) * (0.16 + (1 - v) * 0.26)
				: (1 - smoothstep(0.035, 0.23, v)) * clamp01(0.32 + macro * 0.82);
			const wet = clamp01((cave ? 0.24 : 0.06) + crack * 0.44 + (1 - frost) * meso * (cave ? 0.46 : 0.18));
			const denseIce = clamp01(0.30 + macro * 0.44 + meso * 0.22 - frost * 0.16 - snowCap * 0.4);

			let rgb = mixRgb([48, 82, 94], [105, 143, 150], denseIce);
			rgb = mixRgb(rgb, [27, 62, 77], crack * 0.86);
			rgb = mixRgb(rgb, [183, 199, 198], frost * 0.72);
			rgb = mixRgb(rgb, [224, 230, 226], snowCap * 0.92);
			rgb = mixRgb(rgb, cave ? [84, 91, 88] : [95, 99, 94], baseDebris * 0.58);
			if (cave) rgb = mixRgb(rgb, [49, 105, 119], wet * 0.22);

			const signal = macro * 0.17 + meso * 0.18 + micro * 0.055 + flowRidge * 0.13
				- crack * 0.31 + frost * 0.05 + baseDebris * 0.09;
			scalar[y * TEXTURE_WIDTH + x] = signal;
			const index = (y * TEXTURE_WIDTH + x) * 4;
			colorBytes[index] = Math.round(rgb[0]);
			colorBytes[index + 1] = Math.round(rgb[1]);
			colorBytes[index + 2] = Math.round(rgb[2]);
			colorBytes[index + 3] = 255;

			const roughness = clamp01(0.48 + frost * 0.28 + snowCap * 0.18 + baseDebris * 0.16 + micro * 0.07 - wet * 0.35 - crack * 0.08);
			const roughByte = Math.round(roughness * 255);
			roughnessBytes[index] = roughByte;
			roughnessBytes[index + 1] = roughByte;
			roughnessBytes[index + 2] = roughByte;
			roughnessBytes[index + 3] = 255;
			crackCoverage += crack;
			frostCoverage += Math.max(frost, snowCap);
			wetCoverage += wet;
			debrisCoverage += baseDebris;
		}
	}

	for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
		for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
			const left = scalar[y * TEXTURE_WIDTH + Math.max(0, x - 1)];
			const right = scalar[y * TEXTURE_WIDTH + Math.min(TEXTURE_WIDTH - 1, x + 1)];
			const down = scalar[Math.max(0, y - 1) * TEXTURE_WIDTH + x];
			const up = scalar[Math.min(TEXTURE_HEIGHT - 1, y + 1) * TEXTURE_WIDTH + x];
			const dx = (right - left) * (cave ? 4.0 : 4.8);
			const dy = (up - down) * (cave ? 3.4 : 4.1);
			const length = Math.hypot(dx, dy, 1) || 1;
			const index = (y * TEXTURE_WIDTH + x) * 4;
			normalBytes[index] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
			normalBytes[index + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
			normalBytes[index + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
			normalBytes[index + 3] = 255;
		}
	}

	const colorMap = new THREE.DataTexture(colorBytes, TEXTURE_WIDTH, TEXTURE_HEIGHT, THREE.RGBAFormat);
	colorMap.colorSpace = THREE.SRGBColorSpace;
	const roughnessMap = new THREE.DataTexture(roughnessBytes, TEXTURE_WIDTH, TEXTURE_HEIGHT, THREE.RGBAFormat);
	const normalMap = new THREE.DataTexture(normalBytes, TEXTURE_WIDTH, TEXTURE_HEIGHT, THREE.RGBAFormat);
	for (const texture of [colorMap, roughnessMap, normalMap]) {
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.ClampToEdgeWrapping;
		texture.repeat.set(1, cave ? 1 / 1.7 : 1 / 2.6);
		texture.anisotropy = 4;
		texture.needsUpdate = true;
	}
	const pixels = TEXTURE_WIDTH * TEXTURE_HEIGHT;
	return {
		colorMap,
		roughnessMap,
		normalMap,
		stats: Object.freeze({
			resolution: `${TEXTURE_WIDTH}x${TEXTURE_HEIGHT}`,
			crackCoverage: crackCoverage / pixels,
			frostCoverage: frostCoverage / pixels,
			wetCoverage: wetCoverage / pixels,
			debrisCoverage: debrisCoverage / pixels,
		}),
	};
}

function replaceMaterialSurface(material, textures, { cave = false } = {}) {
	material.map = textures.colorMap;
	material.roughnessMap = textures.roughnessMap;
	material.normalMap = textures.normalMap;
	material.normalScale.set(cave ? 1.16 : 1.34, cave ? 1.32 : 1.48);
	material.color.set(cave ? 0xc7d7d5 : 0xd4dfdc);
	material.roughness = cave ? 0.43 : 0.54;
	material.clearcoat = cave ? 0.27 : 0.13;
	material.clearcoatRoughness = cave ? 0.31 : 0.45;
	material.transmission = cave ? 0.085 : 0.022;
	material.thickness = cave ? 4.4 : 3.0;
	material.attenuationColor.set(cave ? 0x3d8797 : 0x5b9299);
	material.attenuationDistance = cave ? 17 : 28;
	material.emissive.set(cave ? 0x071a20 : 0x000000);
	material.emissiveIntensity = cave ? 0.065 : 0;
	material.userData.iceSurface = Object.freeze({
		...(material.userData.iceSurface || {}),
		realismVersion: 2,
		macroFractures: true,
		mesoStriations: true,
		microCrystalNormals: true,
		variableWetness: true,
		debrisAndFrost: true,
		textureResolution: textures.stats.resolution,
	});
	material.needsUpdate = true;
}

function createInstancedDetail(name, role, geometry, material, transforms) {
	const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
	mesh.name = name;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.userData.iceLandmarkRole = role;
	const matrix = new THREE.Matrix4();
	const quaternion = new THREE.Quaternion();
	for (let index = 0; index < transforms.length; index += 1) {
		const transform = transforms[index];
		quaternion.setFromEuler(new THREE.Euler(transform.rx || 0, transform.ry || 0, transform.rz || 0));
		matrix.compose(transform.position, quaternion, transform.scale);
		mesh.setMatrixAt(index, matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;
	return mesh;
}

function createWallDetails(sections, caveGapSegment, wallMaterial, seed) {
	const seracs = [];
	const talus = [];
	const cornices = [];
	for (let index = 1; index < sections.length - 1; index += 2) {
		if (Math.abs(index - caveGapSegment) <= 3) continue;
		const section = sections[index];
		const side = hash2D(index, 3, seed + 1103) > 0.5 ? 1 : -1;
		const tangentAngle = Math.atan2(section.tz, section.tx);
		const seracHeight = 18 + hash2D(index, 5, seed + 1201) * 42;
		const seracWidth = 4.5 + hash2D(index, 7, seed + 1301) * 7.5;
		const seracDepth = 5 + hash2D(index, 11, seed + 1409) * 10;
		const faceOffset = section.thicknessMeters * 0.47 + seracDepth * 0.24;
		seracs.push({
			position: new THREE.Vector3(
				section.x + section.nx * faceOffset * side,
				section.centerGround + section.heightMeters * (0.22 + hash2D(index, 13, seed + 1511) * 0.42),
				section.z + section.nz * faceOffset * side,
			),
			scale: new THREE.Vector3(seracWidth, seracHeight, seracDepth),
			rx: (hash2D(index, 17, seed + 1601) - 0.5) * 0.18,
			ry: -tangentAngle + (hash2D(index, 19, seed + 1709) - 0.5) * 0.28,
			rz: (hash2D(index, 23, seed + 1801) - 0.5) * 0.12,
		});
		if (index % 4 === 1) {
			const talusScale = 2.2 + hash2D(index, 29, seed + 1901) * 5.8;
			talus.push({
				position: new THREE.Vector3(
					section.x + section.nx * (section.thicknessMeters * 0.5 + talusScale * 0.5) * side,
					section.centerGround + talusScale * 0.48,
					section.z + section.nz * (section.thicknessMeters * 0.5 + talusScale * 0.5) * side,
				),
				scale: new THREE.Vector3(talusScale * 1.35, talusScale * 0.9, talusScale),
				ry: tangentAngle + hash2D(index, 31, seed + 2003) * Math.PI,
				rx: hash2D(index, 37, seed + 2111) * 0.7,
				rz: hash2D(index, 41, seed + 2203) * 0.55,
			});
		}
		if (index % 6 === 1) {
			cornices.push({
				position: new THREE.Vector3(section.x, section.topY + 1.1, section.z),
				scale: new THREE.Vector3(7 + hash2D(index, 43, seed + 2309) * 10, 1.3 + hash2D(index, 47, seed + 2411) * 2.6, 5 + hash2D(index, 53, seed + 2503) * 8),
				ry: -tangentAngle,
				rz: (hash2D(index, 59, seed + 2609) - 0.5) * 0.12,
			});
		}
	}
	const seracGeometry = new THREE.IcosahedronGeometry(1, 1);
	const talusGeometry = new THREE.IcosahedronGeometry(1, 0);
	const corniceGeometry = new THREE.IcosahedronGeometry(1, 1);
	const snowMaterial = wallMaterial.clone();
	snowMaterial.color.set(0xe6ece8);
	snowMaterial.roughness = 0.86;
	snowMaterial.transmission = 0.008;
	snowMaterial.clearcoat = 0.04;
	return [
		createInstancedDetail('ice-wall-serac-buttresses', 'wall-serac-buttresses', seracGeometry, wallMaterial, seracs),
		createInstancedDetail('ice-wall-basal-talus', 'wall-basal-talus', talusGeometry, wallMaterial, talus),
		createInstancedDetail('ice-wall-snow-cornices', 'wall-snow-cornices', corniceGeometry, snowMaterial, cornices),
	];
}

function createCaveFractureRibs(portal, caveRings, caveMaterial, seed) {
	const transforms = [];
	for (let ringIndex = 2; ringIndex < caveRings.length - 2; ringIndex += 2) {
		const ring = caveRings[ringIndex];
		for (const side of [-1, 1]) {
			const lateral = ring.halfWidth * (0.78 + hash2D(ringIndex, side + 3, seed + 2707) * 0.15) * side;
			transforms.push({
				position: new THREE.Vector3(
					ring.centerX + portal.tx * lateral,
					ring.centerY + ring.height * (0.48 + hash2D(ringIndex, side + 7, seed + 2801) * 0.30),
					ring.centerZ + portal.tz * lateral,
				),
				scale: new THREE.Vector3(1.0 + hash2D(ringIndex, side + 11, seed + 2903) * 1.8, 2.4 + hash2D(ringIndex, side + 13, seed + 3001) * 4.8, 1.0 + hash2D(ringIndex, side + 17, seed + 3109) * 1.9),
				ry: -Math.atan2(portal.tz, portal.tx) + side * 0.34,
				rz: side * (0.20 + hash2D(ringIndex, side + 19, seed + 3203) * 0.24),
			});
		}
	}
	return createInstancedDetail(
		'ice-cave-fracture-ribs',
		'cave-fracture-ribs',
		new THREE.IcosahedronGeometry(1, 0),
		caveMaterial,
		transforms,
	);
}

export function enhanceIceLandmarkRealism({
	group,
	wallMaterial,
	caveMaterial,
	wallSections,
	caveGapSegment,
	portal,
	caveRings,
	seed,
}) {
	const oldTextures = new Set();
	for (const material of [wallMaterial, caveMaterial]) {
		for (const key of ['map', 'roughnessMap', 'normalMap']) {
			if (material[key]) oldTextures.add(material[key]);
		}
	}
	const wallTextures = createGlacialTextureSet(seed ^ 0x474c4143, { cave: false });
	const caveTextures = createGlacialTextureSet(seed ^ 0x43415645, { cave: true });
	replaceMaterialSurface(wallMaterial, wallTextures, { cave: false });
	replaceMaterialSurface(caveMaterial, caveTextures, { cave: true });
	for (const texture of oldTextures) texture.dispose();

	const wallDetails = createWallDetails(wallSections, caveGapSegment, wallMaterial, seed);
	const caveRibs = createCaveFractureRibs(portal, caveRings, caveMaterial, seed);
	for (const object of [...wallDetails, caveRibs]) group.add(object);
	return Object.freeze({
		stats: Object.freeze({
			version: 2,
			wallTexture: wallTextures.stats,
			caveTexture: caveTextures.stats,
			seracCount: wallDetails[0].count,
			talusCount: wallDetails[1].count,
			corniceCount: wallDetails[2].count,
			caveFractureRibCount: caveRibs.count,
		}),
	});
}
