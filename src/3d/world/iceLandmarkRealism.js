import * as THREE from 'three';
import { applyIceLandmarkGeometryBreakup } from './iceLandmarkGeometryBreakup.js';

const TEXTURE_WIDTH = 256;
const TEXTURE_HEIGHT = 512;

const GLACIER_PALETTE = Object.freeze({
	wall: Object.freeze({
		shadow: [68, 86, 94],
		dense: [104, 139, 149],
		crack: [24, 46, 58],
		frost: [205, 214, 214],
		snow: [235, 238, 236],
		debris: [103, 100, 92],
		wet: [63, 105, 113],
	}),
	cave: Object.freeze({
		shadow: [45, 74, 87],
		dense: [70, 129, 147],
		crack: [17, 38, 50],
		frost: [190, 205, 207],
		snow: [224, 230, 228],
		debris: [89, 89, 83],
		wet: [42, 105, 122],
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
	const palette = cave ? GLACIER_PALETTE.cave : GLACIER_PALETTE.wall;
	let crackCoverage = 0;
	let frostCoverage = 0;
	let wetCoverage = 0;
	let debrisCoverage = 0;
	let blueCoreCoverage = 0;

	for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
		for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
			const u = x / (TEXTURE_WIDTH - 1);
			const v = y / (TEXTURE_HEIGHT - 1);
			const macro = fbm2D(u * 4.1, v * 1.55, seed + 11);
			const meso = fbm2D(u * 13.5, v * 6.1, seed + 47);
			const micro = fbm2D(u * 48, v * 31, seed + 83);
			const fractureWarp = fbm2D(u * 7.1 + macro * 1.8, v * 3.2, seed + 103);
			const flowPhase = u * 15.5 + macro * 5.8 + fractureWarp * 4.1 + Math.sin(v * 7.1) * 0.42;
			const verticalDistance = Math.abs(Math.sin(flowPhase * Math.PI));
			const crossDistance = Math.abs(Math.sin((u * 5.1 - v * 1.75 + meso * 3.1 + fractureWarp * 1.3) * Math.PI));
			const verticalCrack = 1 - smoothstep(0.014, 0.064, verticalDistance);
			const crossCrack = (1 - smoothstep(0.015, 0.060, crossDistance)) * 0.48;
			const crack = clamp01(Math.max(verticalCrack, crossCrack) * (0.62 + micro * 0.52));
			const flowRidge = Math.pow(1 - verticalDistance, 2.9) * (0.24 + meso * 0.52);
			const frost = clamp01(0.18 + (meso - 0.42) * 0.50 + flowRidge * 0.24 + (cave ? 0.02 : v * 0.17));
			const snowCap = cave ? 0 : smoothstep(0.76, 0.985, v) * clamp01(0.55 + macro * 0.65);
			const baseDebris = cave
				? smoothstep(0.60, 0.92, meso) * (0.14 + (1 - v) * 0.25)
				: (1 - smoothstep(0.035, 0.23, v)) * clamp01(0.30 + macro * 0.84);
			const wet = clamp01((cave ? 0.22 : 0.045) + crack * 0.34 + (1 - frost) * meso * (cave ? 0.40 : 0.13));
			const denseIce = clamp01(0.22 + macro * 0.39 + meso * 0.20 - frost * 0.18 - snowCap * 0.42);
			const blueCore = clamp01(smoothstep(0.34, 0.64, denseIce) * (1 - frost * 0.82) * (0.50 + crack * 0.42));
			const dirtyBand = clamp01(baseDebris * (0.55 + meso * 0.45));

			let rgb = mixRgb(palette.shadow, palette.dense, denseIce);
			rgb = mixRgb(rgb, palette.crack, crack * 0.72);
			rgb = mixRgb(rgb, palette.dense, blueCore * (cave ? 0.62 : 0.36));
			rgb = mixRgb(rgb, palette.frost, frost * 0.70);
			rgb = mixRgb(rgb, palette.snow, snowCap * 0.94);
			rgb = mixRgb(rgb, palette.debris, dirtyBand * 0.64);
			rgb = mixRgb(rgb, palette.wet, wet * (cave ? 0.18 : 0.08));

			const signal = macro * 0.13 + meso * 0.10 + micro * 0.025 + flowRidge * 0.035
				- crack * 0.075 + frost * 0.035 + baseDebris * 0.055;
			scalar[y * TEXTURE_WIDTH + x] = signal;
			const index = (y * TEXTURE_WIDTH + x) * 4;
			colorBytes[index] = Math.round(rgb[0]);
			colorBytes[index + 1] = Math.round(rgb[1]);
			colorBytes[index + 2] = Math.round(rgb[2]);
			colorBytes[index + 3] = 255;

			const roughness = clamp01(0.53 + frost * 0.27 + snowCap * 0.20 + baseDebris * 0.18 + micro * 0.07
				- wet * 0.30 - blueCore * 0.12 - crack * 0.045);
			const roughByte = Math.round(roughness * 255);
			roughnessBytes[index] = roughByte;
			roughnessBytes[index + 1] = roughByte;
			roughnessBytes[index + 2] = roughByte;
			roughnessBytes[index + 3] = 255;
			crackCoverage += crack;
			frostCoverage += Math.max(frost, snowCap);
			wetCoverage += wet;
			debrisCoverage += baseDebris;
			blueCoreCoverage += blueCore;
		}
	}

	for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
		for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
			const left = scalar[y * TEXTURE_WIDTH + Math.max(0, x - 1)];
			const right = scalar[y * TEXTURE_WIDTH + Math.min(TEXTURE_WIDTH - 1, x + 1)];
			const down = scalar[Math.max(0, y - 1) * TEXTURE_WIDTH + x];
			const up = scalar[Math.min(TEXTURE_HEIGHT - 1, y + 1) * TEXTURE_WIDTH + x];
			const dx = (right - left) * (cave ? 2.4 : 2.7);
			const dy = (up - down) * (cave ? 2.2 : 2.5);
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
		texture.repeat.set(cave ? 0.56 : 0.30, cave ? 1 / 1.7 : 1 / 2.6);
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
			blueCoreCoverage: blueCoreCoverage / pixels,
		}),
	};
}

function replaceMaterialSurface(material, textures, { cave = false } = {}) {
	material.map = textures.colorMap;
	material.roughnessMap = textures.roughnessMap;
	material.normalMap = textures.normalMap;
	material.vertexColors = false;
	material.normalScale.set(cave ? 0.42 : 0.38, cave ? 0.52 : 0.48);
	material.color.set(cave ? 0xd0d8d7 : 0xe0e3e1);
	material.roughness = cave ? 0.48 : 0.60;
	material.clearcoat = cave ? 0.20 : 0.08;
	material.clearcoatRoughness = cave ? 0.38 : 0.52;
	material.transmission = cave ? 0.060 : 0.012;
	material.thickness = cave ? 4.8 : 3.2;
	material.attenuationColor.set(cave ? 0x467d8a : 0x708b8f);
	material.attenuationDistance = cave ? 14 : 31;
	material.emissive.set(cave ? 0x0b2d35 : 0x000000);
	material.emissiveIntensity = cave ? 0.10 : 0;
	material.userData.iceSurface = Object.freeze({
		...(material.userData.iceSurface || {}),
		realismVersion: 4,
		naturalReferencePalette: true,
		macroFractures: true,
		mesoStriations: true,
		microCrystalNormals: true,
		variableWetness: true,
		debrisAndFrost: true,
		textureResolution: textures.stats.resolution,
	});
	material.needsUpdate = true;
}

function cloneSolidMaterial(source, { cave = false } = {}) {
	const material = source.clone();
	material.vertexColors = false;
	material.color.set(cave ? 0xc1cecd : 0xd5dad7);
	material.roughness = cave ? 0.51 : 0.63;
	material.transmission *= 0.65;
	material.needsUpdate = true;
	return material;
}

function createInstancedDetail(name, role, geometry, material, transforms, seed = 0) {
	const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
	mesh.name = name;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.userData.iceLandmarkRole = role;
	const matrix = new THREE.Matrix4();
	const quaternion = new THREE.Quaternion();
	const tint = new THREE.Color();
	for (let index = 0; index < transforms.length; index += 1) {
		const transform = transforms[index];
		quaternion.setFromEuler(new THREE.Euler(transform.rx || 0, transform.ry || 0, transform.rz || 0));
		matrix.compose(transform.position, quaternion, transform.scale);
		mesh.setMatrixAt(index, matrix);
		const variation = 0.80 + hash2D(index, role.length, seed + 4513) * 0.22;
		tint.setRGB(variation, variation * (0.985 + hash2D(index, 3, seed + 4603) * 0.03), variation * (1.00 + hash2D(index, 7, seed + 4703) * 0.055));
		mesh.setColorAt(index, tint);
	}
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	return mesh;
}

function createWallDetails(sections, caveGapSegment, solidWallMaterial, seed) {
	const seracs = [];
	const talus = [];
	const cornices = [];
	for (let index = 1; index < sections.length - 1; index += 2) {
		if (Math.abs(index - caveGapSegment) <= 3) continue;
		const section = sections[index];
		const side = hash2D(index, 3, seed + 1103) > 0.5 ? 1 : -1;
		const tangentAngle = Math.atan2(section.tz, section.tx);
		if (index % 6 !== 3) {
			const seracHeight = 30 + hash2D(index, 5, seed + 1201) * 42;
			const seracWidth = 5.5 + hash2D(index, 7, seed + 1301) * 7.5;
			const seracDepth = 2.0 + hash2D(index, 11, seed + 1409) * 4.5;
			const faceOffset = section.thicknessMeters * 0.50 + seracDepth * 0.08;
			seracs.push({
				position: new THREE.Vector3(
					section.x + section.nx * faceOffset * side,
					section.centerGround + section.heightMeters * (0.20 + hash2D(index, 13, seed + 1511) * 0.46),
					section.z + section.nz * faceOffset * side,
				),
				scale: new THREE.Vector3(seracWidth * 0.50, seracHeight * 0.50, seracDepth * 0.50),
				rx: (hash2D(index, 17, seed + 1601) - 0.5) * 0.26,
				ry: -tangentAngle + (hash2D(index, 19, seed + 1709) - 0.5) * 0.22,
				rz: (hash2D(index, 23, seed + 1801) - 0.5) * 0.42,
			});
			if (index % 12 === 5) {
				seracs.push({
					position: new THREE.Vector3(
						section.x - section.nx * faceOffset * 0.92 * side,
						section.centerGround + section.heightMeters * (0.34 + hash2D(index, 61, seed + 1853) * 0.28),
						section.z - section.nz * faceOffset * 0.92 * side,
					),
					scale: new THREE.Vector3(seracWidth * 0.32, seracHeight * 0.44, seracDepth * 0.38),
					ry: -tangentAngle - (hash2D(index, 67, seed + 1867) - 0.5) * 0.22,
					rz: (hash2D(index, 71, seed + 1877) - 0.5) * 0.38,
				});
			}
		}
		if (index % 4 === 1) {
			const talusSize = 2.8 + hash2D(index, 29, seed + 1901) * 7.4;
			talus.push({
				position: new THREE.Vector3(
					section.x + section.nx * (section.thicknessMeters * 0.5 + talusSize * 0.5) * side,
					section.centerGround + talusSize * 0.48,
					section.z + section.nz * (section.thicknessMeters * 0.5 + talusSize * 0.5) * side,
				),
				scale: new THREE.Vector3(talusSize * 0.70, talusSize * 0.48, talusSize * 0.52),
				ry: tangentAngle + hash2D(index, 31, seed + 2003) * Math.PI,
				rx: hash2D(index, 37, seed + 2111) * 0.7,
				rz: hash2D(index, 41, seed + 2203) * 0.55,
			});
		}
		if (index % 6 === 1) {
			cornices.push({
				position: new THREE.Vector3(section.x, section.topY + 0.8, section.z),
				scale: new THREE.Vector3(4.5 + hash2D(index, 43, seed + 2309) * 6, 1.0 + hash2D(index, 47, seed + 2411) * 1.7, 3.0 + hash2D(index, 53, seed + 2503) * 5),
				ry: -tangentAngle,
				rz: (hash2D(index, 59, seed + 2609) - 0.5) * 0.16,
			});
		}
	}
	const seracGeometry = new THREE.OctahedronGeometry(1, 0);
	const talusGeometry = new THREE.IcosahedronGeometry(1, 0);
	const corniceGeometry = new THREE.IcosahedronGeometry(1, 1);
	const seracMaterial = solidWallMaterial.clone();
	seracMaterial.color.set(0xd7dedd);
	seracMaterial.roughness = Math.max(0.70, seracMaterial.roughness || 0.70);
	seracMaterial.transmission = Math.min(0.008, seracMaterial.transmission || 0);
	seracMaterial.clearcoat = Math.min(0.035, seracMaterial.clearcoat || 0);
	seracMaterial.clearcoatRoughness = Math.max(0.55, seracMaterial.clearcoatRoughness || 0.55);
	seracMaterial.needsUpdate = true;
	const snowMaterial = solidWallMaterial.clone();
	snowMaterial.color.set(0xe9ece9);
	snowMaterial.roughness = 0.91;
	snowMaterial.transmission = 0.003;
	snowMaterial.clearcoat = 0.015;
	return [
		createInstancedDetail('ice-wall-serac-buttresses', 'wall-serac-buttresses', seracGeometry, seracMaterial, seracs, seed + 5003),
		createInstancedDetail('ice-wall-basal-talus', 'wall-basal-talus', talusGeometry, solidWallMaterial, talus, seed + 5101),
		createInstancedDetail('ice-wall-snow-cornices', 'wall-snow-cornices', corniceGeometry, snowMaterial, cornices, seed + 5209),
	];
}

function createPortalFractureRim(portal, solidWallMaterial, seed) {
	const transforms = [];
	const openingHalfWidth = 7.8;
	const sideHeight = 3.2;
	const archRise = 8.8;
	const tangentAngle = Math.atan2(portal.tz, portal.tx);
	for (const faceSign of [-1, 1]) {
		const normalOffset = portal.depth * 0.485 * faceSign;
		for (const side of [-1, 1]) {
			for (let step = 0; step < 3; step += 1) {
				const y = 2.2 + step * 3.05 + hash2D(step, side + 5, seed + 3269) * 0.55;
				const lateral = side * (openingHalfWidth + 0.28 + hash2D(step, side + 7, seed + 3301) * 0.52);
				transforms.push({
					position: new THREE.Vector3(
						portal.centerX + portal.tx * lateral + portal.nx * normalOffset,
						portal.groundY + y,
						portal.centerZ + portal.tz * lateral + portal.nz * normalOffset,
					),
					scale: new THREE.Vector3(
						0.34 + hash2D(step, side + 11, seed + 3407) * 0.32,
						1.45 + hash2D(step, side + 13, seed + 3511) * 1.45,
						0.18 + hash2D(step, side + 17, seed + 3607) * 0.22,
					),
					ry: -tangentAngle + (hash2D(step, side + 19, seed + 3701) - 0.5) * 0.20,
					rz: side * (0.10 + hash2D(step, side + 23, seed + 3803) * 0.14),
				});
			}
		}
		for (let step = 1; step <= 3; step += 1) {
			const angle = Math.PI - (step / 4) * Math.PI;
			const lateral = Math.cos(angle) * openingHalfWidth;
			const y = sideHeight + Math.sin(angle) * archRise + 1.0;
			transforms.push({
				position: new THREE.Vector3(
					portal.centerX + portal.tx * lateral + portal.nx * normalOffset,
					portal.groundY + y,
					portal.centerZ + portal.tz * lateral + portal.nz * normalOffset,
				),
				scale: new THREE.Vector3(
					1.05 + hash2D(step, faceSign + 29, seed + 3907) * 0.72,
					0.32 + hash2D(step, faceSign + 31, seed + 4001) * 0.30,
					0.18 + hash2D(step, faceSign + 37, seed + 4103) * 0.20,
				),
				ry: -tangentAngle + (hash2D(step, faceSign + 41, seed + 4201) - 0.5) * 0.18,
				rz: (Math.PI * 0.5 - angle) + (hash2D(step, faceSign + 43, seed + 4303) - 0.5) * 0.16,
			});
		}
	}
	return createInstancedDetail(
		'ice-wall-portal-fracture-rim',
		'portal-fracture-rim',
		new THREE.IcosahedronGeometry(1, 1),
		solidWallMaterial,
		transforms,
		seed + 5303,
	);
}

function createCaveFractureRibs(portal, caveRings, solidCaveMaterial, seed) {
	const transforms = [];
	for (let ringIndex = 2; ringIndex < caveRings.length - 2; ringIndex += 2) {
		const ring = caveRings[ringIndex];
		for (const side of [-1, 1]) {
			const lateral = ring.halfWidth * (0.79 + hash2D(ringIndex, side + 3, seed + 2707) * 0.13) * side;
			transforms.push({
				position: new THREE.Vector3(
					ring.centerX + portal.tx * lateral,
					ring.centerY + ring.height * (0.50 + hash2D(ringIndex, side + 7, seed + 2801) * 0.26),
					ring.centerZ + portal.tz * lateral,
				),
				scale: new THREE.Vector3(0.65 + hash2D(ringIndex, side + 11, seed + 2903) * 0.85, 1.4 + hash2D(ringIndex, side + 13, seed + 3001) * 2.6, 0.65 + hash2D(ringIndex, side + 17, seed + 3109) * 0.95),
				ry: -Math.atan2(portal.tz, portal.tx) + side * 0.34,
				rz: side * (0.20 + hash2D(ringIndex, side + 19, seed + 3203) * 0.24),
			});
		}
	}
	return createInstancedDetail(
		'ice-cave-fracture-ribs',
		'cave-fracture-ribs',
		new THREE.IcosahedronGeometry(1, 0),
		solidCaveMaterial,
		transforms,
		seed + 5407,
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

	const solidWallMaterial = cloneSolidMaterial(wallMaterial, { cave: false });
	const solidCaveMaterial = cloneSolidMaterial(caveMaterial, { cave: true });
	const portalMaterial = wallMaterial.clone();
	portalMaterial.color.set(0xf0f3f0);
	portalMaterial.roughness = 0.70;
	portalMaterial.clearcoat = 0.035;
	portalMaterial.clearcoatRoughness = 0.62;
	portalMaterial.transmission = 0.004;
	portalMaterial.emissive.set(0x29464d);
	portalMaterial.emissiveIntensity = 0.055;
	portalMaterial.needsUpdate = true;
	portal.mesh.material = portalMaterial;
	const icicles = group.getObjectByName('ice-cave-icicles');
	if (icicles) icicles.material = solidCaveMaterial;
	const wallDetails = createWallDetails(wallSections, caveGapSegment, solidWallMaterial, seed);
	const portalRim = createPortalFractureRim(portal, solidWallMaterial, seed);
	const caveRibs = createCaveFractureRibs(portal, caveRings, solidCaveMaterial, seed);
	for (const object of [...wallDetails, portalRim, caveRibs]) group.add(object);
	const geometryBreakup = applyIceLandmarkGeometryBreakup({
		group,
		wallSections,
		portal,
		caveRings,
		seed,
	});
	return Object.freeze({
		stats: Object.freeze({
			version: 4,
			wallTexture: wallTextures.stats,
			caveTexture: caveTextures.stats,
			seracCount: wallDetails[0].count,
			talusCount: wallDetails[1].count,
			corniceCount: wallDetails[2].count,
			portalFractureCount: portalRim.count,
			caveFractureRibCount: caveRibs.count,
			geometryBreakup,
		}),
	});
}