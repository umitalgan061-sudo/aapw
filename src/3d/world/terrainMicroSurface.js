/**
 * Render-only photoreal micro/macro PBR layer for canonical terrain.
 *
 * Geography remains owned by terrain.js + map/Pindex height data. This module only changes how the
 * already-authored surface reflects light and how its colour reads at metre/kilometre scale. The
 * generated normal/roughness atlas uses metre-space uv1, while the shader colour breakup uses world
 * position, so neither chunk borders nor owner-map UV islands can restart the pattern.
 * @module world/terrainMicroSurface
 */

import * as THREE from 'three';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
	const t = clamp01((value - a) / Math.max(1e-9, b - a));
	return t * t * (3 - 2 * t);
};

/**
 * Surface realism policy. `detailRepeatMeters` deliberately stays below the 32 m regression ceiling:
 * this layer is grain/fracture scale, not a second geography signal. Macro colour variation is done
 * in the fragment shader directly from world metres and therefore never repeats at this tile period.
 */
export const TERRAIN_MICRO_SURFACE_POLICY = Object.freeze({
	id: 'terrain-micro-surface-world-uv-pbr-v4-natural-albedo',
	textureSize: 256,
	detailRepeatMeters: 24,
	normalStrength: 0.82,
	normalSlopeGain: 4.1,
	roughnessBase: 0.94,
	roughnessMin: 0.58,
	roughnessMax: 0.99,
	uvChannel: 1,
	maxAnisotropy: 8,
	macroColorBreakup: true,
	worldSpaceMacroScaleMeters: Object.freeze([145, 620, 2400]),
	photorealDesaturation: true,
	naturalAlbedoRemap: true,
	fractureNormals: true,
	renderOnly: true,
});

/** Stable metre-space UV for the render-only detail channel. Negative UV is valid with RepeatWrapping. */
export function terrainMicroUvAt(worldX, worldZ) {
	const repeatMeters = TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters;
	return Object.freeze({ u: worldX / repeatMeters, v: worldZ / repeatMeters });
}

function hash2D(ix, iy, seed) {
	let value = Math.imul((ix | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((iy | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 0x100000000;
}

function tileableValueNoise(u, v, cells, seed) {
	const gx = u * cells;
	const gy = v * cells;
	const x0 = Math.floor(gx);
	const y0 = Math.floor(gy);
	const tx0 = gx - x0;
	const ty0 = gy - y0;
	const tx = tx0 * tx0 * (3 - 2 * tx0);
	const ty = ty0 * ty0 * (3 - 2 * ty0);
	const wrap = (value) => ((value % cells) + cells) % cells;
	const a = hash2D(wrap(x0), wrap(y0), seed);
	const b = hash2D(wrap(x0 + 1), wrap(y0), seed);
	const c = hash2D(wrap(x0), wrap(y0 + 1), seed);
	const d = hash2D(wrap(x0 + 1), wrap(y0 + 1), seed);
	return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function tileableFbm(u, v, seed) {
	let total = 0;
	let weight = 0;
	let amplitude = 0.52;
	for (let octave = 0; octave < 5; octave += 1) {
		const cells = 4 * (1 << octave);
		total += tileableValueNoise(u, v, cells, seed + octave * 131) * amplitude;
		weight += amplitude;
		amplitude *= 0.49;
	}
	return total / weight;
}

function terrainDetailHeight(u, v) {
	const broad = tileableFbm(u, v, 0x51a7);
	const grain = tileableFbm((u + 0.173) % 1, (v + 0.619) % 1, 0x91e3);
	const warpU = u + (broad - 0.5) * 0.075;
	const warpV = v + (grain - 0.5) * 0.055;
	const fractureA = Math.abs(Math.sin(Math.PI * 2 * (warpU * 7 + warpV * 3 + broad * 0.74)));
	const fractureB = Math.abs(Math.sin(Math.PI * 2 * (warpU * 2 - warpV * 11 + grain * 0.62 + 0.23)));
	const crackA = 1 - smoothstep(0.018, 0.105, fractureA);
	const crackB = 1 - smoothstep(0.016, 0.082, fractureB);
	const fracture = Math.max(crackA, crackB * 0.72);
	const granular = (grain - 0.5) * 0.26;
	const packed = (broad - 0.5) * 0.43;
	return packed + granular - fracture * 0.22;
}

function buildTerrainDetailField(size) {
	const field = new Float32Array(size * size);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			field[y * size + x] = terrainDetailHeight(x / size, y / size);
		}
	}
	return field;
}

function wrappedTerrainDetailSample(field, size, x, y) {
	return field[((y + size) % size) * size + ((x + size) % size)];
}

function buildTerrainNormalData(field, size) {
	const data = new Uint8Array(size * size * 4);
	const gain = TERRAIN_MICRO_SURFACE_POLICY.normalSlopeGain;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const dx = (wrappedTerrainDetailSample(field, size, x + 1, y) - wrappedTerrainDetailSample(field, size, x - 1, y)) * gain;
			const dy = (wrappedTerrainDetailSample(field, size, x, y + 1) - wrappedTerrainDetailSample(field, size, x, y - 1)) * gain;
			const inverseLength = 1 / Math.hypot(dx, dy, 1);
			const offset = (y * size + x) * 4;
			data[offset] = Math.round((-dx * inverseLength * 0.5 + 0.5) * 255);
			data[offset + 1] = Math.round((-dy * inverseLength * 0.5 + 0.5) * 255);
			data[offset + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
			data[offset + 3] = 255;
		}
	}
	return data;
}

function buildTerrainRoughnessData(field, size) {
	const data = new Uint8Array(size * size * 4);
	const { roughnessMin, roughnessMax } = TERRAIN_MICRO_SURFACE_POLICY;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const center = wrappedTerrainDetailSample(field, size, x, y);
			const dx = Math.abs(wrappedTerrainDetailSample(field, size, x + 1, y) - wrappedTerrainDetailSample(field, size, x - 1, y));
			const dy = Math.abs(wrappedTerrainDetailSample(field, size, x, y + 1) - wrappedTerrainDetailSample(field, size, x, y - 1));
			const localRelief = Math.hypot(dx, dy);
			const grain = clamp01(0.48 + center * 0.36 + localRelief * 1.25);
			const recessPolish = smoothstep(-0.34, -0.08, center) * (1 - smoothstep(-0.08, 0.12, center));
			const roughness = clamp01(lerp(roughnessMin, roughnessMax, grain) - recessPolish * 0.075);
			const encoded = Math.round(roughness * 255);
			const offset = (y * size + x) * 4;
			data[offset] = encoded;
			data[offset + 1] = encoded;
			data[offset + 2] = encoded;
			data[offset + 3] = 255;
		}
	}
	return data;
}

function configureTerrainDataTexture(texture, name) {
	texture.name = name;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(1, 1);
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = true;
	texture.anisotropy = TERRAIN_MICRO_SURFACE_POLICY.maxAnisotropy;
	texture.colorSpace = THREE.NoColorSpace;
	texture.channel = TERRAIN_MICRO_SURFACE_POLICY.uvChannel;
	texture.userData = {
		...texture.userData,
		terrainMicroSurfacePolicy: TERRAIN_MICRO_SURFACE_POLICY.id,
		worldSpaceRepeatMeters: TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters,
	};
	texture.needsUpdate = true;
	return texture;
}

let sharedTerrainMicroSurface = null;

/** Two app-lifetime maps shared by every chunk; canonical geometry is never displaced by them. */
export function getSharedTerrainMicroSurfaceTextures() {
	if (sharedTerrainMicroSurface) return sharedTerrainMicroSurface;
	const size = TERRAIN_MICRO_SURFACE_POLICY.textureSize;
	const field = buildTerrainDetailField(size);
	const normalMap = configureTerrainDataTexture(
		new THREE.DataTexture(buildTerrainNormalData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-normal-v4-natural-albedo',
	);
	const roughnessMap = configureTerrainDataTexture(
		new THREE.DataTexture(buildTerrainRoughnessData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-roughness-v4-natural-albedo',
	);
	sharedTerrainMicroSurface = Object.freeze({ normalMap, roughnessMap });
	return sharedTerrainMicroSurface;
}

const TERRAIN_PHOTOREAL_SHADER_KEY = 'terrain-photoreal-world-surface-v4-natural-albedo';

function installWorldSpaceColorBreakup(material) {
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPhotorealWorldPosition;')
			.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTerrainPhotorealWorldPosition = worldPosition.xyz;');
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
varying vec3 vTerrainPhotorealWorldPosition;
float terrainPhotoHash(vec2 p) {
	p = fract(p * vec2(0.1031, 0.1030));
	p += dot(p, p.yx + 33.33);
	return fract((p.x + p.y) * p.x);
}
float terrainPhotoNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = terrainPhotoHash(i);
	float b = terrainPhotoHash(i + vec2(1.0, 0.0));
	float c = terrainPhotoHash(i + vec2(0.0, 1.0));
	float d = terrainPhotoHash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float terrainPhotoFbm(vec2 p) {
	float value = 0.0;
	float amplitude = 0.55;
	for (int octave = 0; octave < 4; octave++) {
		value += terrainPhotoNoise(p) * amplitude;
		p = p * 2.03 + vec2(17.1, -9.7);
		amplitude *= 0.48;
	}
	return value / 1.06136;
}`,
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
vec3 terrainPhotoBase = diffuseColor.rgb;
float terrainPhotoMax = max(terrainPhotoBase.r, max(terrainPhotoBase.g, terrainPhotoBase.b));
float terrainPhotoMin = min(terrainPhotoBase.r, min(terrainPhotoBase.g, terrainPhotoBase.b));
float terrainPhotoChroma = terrainPhotoMax - terrainPhotoMin;
float terrainPhotoLuma = dot(terrainPhotoBase, vec3(0.2126, 0.7152, 0.0722));
float terrainPhotoGreenLead = terrainPhotoBase.g - max(terrainPhotoBase.r, terrainPhotoBase.b);
float terrainPhotoVegetation = smoothstep(0.012, 0.115, terrainPhotoGreenLead) * (1.0 - smoothstep(0.68, 0.84, terrainPhotoLuma));
float terrainPhotoSnow = smoothstep(0.64, 0.86, terrainPhotoLuma) * (1.0 - smoothstep(0.09, 0.25, terrainPhotoChroma));
float terrainPhotoWarmGround = (1.0 - terrainPhotoSnow) * (1.0 - terrainPhotoVegetation)
	* smoothstep(-0.035, 0.105, terrainPhotoBase.r - terrainPhotoBase.b)
	* (1.0 - smoothstep(0.72, 0.88, terrainPhotoLuma));
float terrainPhotoRock = (1.0 - terrainPhotoVegetation) * (1.0 - terrainPhotoSnow) * (1.0 - smoothstep(0.18, 0.33, terrainPhotoChroma));
vec2 terrainPhotoXZ = vTerrainPhotorealWorldPosition.xz;
float terrainPhotoBroad = terrainPhotoFbm(terrainPhotoXZ / 2400.0 + vec2(11.7, -4.1));
float terrainPhotoMacro = terrainPhotoFbm(terrainPhotoXZ / 620.0 + vec2(-7.3, 14.9));
float terrainPhotoMeso = terrainPhotoFbm(terrainPhotoXZ / 145.0 + vec2(23.8, 3.6));
float terrainPhotoGrain = terrainPhotoNoise(terrainPhotoXZ / 38.0 + vec2(5.4, -18.2));
float terrainPhotoDesaturate = 0.075 + terrainPhotoVegetation * 0.26 + terrainPhotoRock * 0.075 + terrainPhotoWarmGround * 0.08;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(terrainPhotoLuma), terrainPhotoDesaturate);
float terrainPhotoValue = 0.925
	+ (terrainPhotoBroad - 0.5) * 0.125
	+ (terrainPhotoMacro - 0.5) * 0.095
	+ (terrainPhotoMeso - 0.5) * 0.052
	+ (terrainPhotoGrain - 0.5) * 0.020;
diffuseColor.rgb *= terrainPhotoValue;
// Replace the high-saturation game-green family with subdued real-landscape olive. Broad moisture
// and dry exposure control the target, so kilometre-scale areas do not collapse to one green value.
float terrainPhotoMoisture = clamp(0.50 + (0.5 - terrainPhotoBroad) * 0.72 + (0.5 - terrainPhotoMacro) * 0.42, 0.0, 1.0);
vec3 terrainPhotoWetOlive = vec3(0.105, 0.145, 0.075);
vec3 terrainPhotoDryOlive = vec3(0.300, 0.275, 0.165);
vec3 terrainPhotoOlive = mix(terrainPhotoDryOlive, terrainPhotoWetOlive, terrainPhotoMoisture);
float terrainPhotoVegRemap = terrainPhotoVegetation * (0.34 + abs(terrainPhotoMacro - 0.5) * 0.28);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoOlive, terrainPhotoVegRemap);
float terrainPhotoDamp = terrainPhotoVegetation * smoothstep(0.58, 0.84, 1.0 - terrainPhotoBroad) * smoothstep(0.42, 0.78, terrainPhotoMacro);
float terrainPhotoDry = terrainPhotoVegetation * smoothstep(0.58, 0.84, terrainPhotoBroad) * smoothstep(0.48, 0.82, terrainPhotoMeso);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.090, 0.125, 0.065), terrainPhotoDamp * 0.16);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.325, 0.292, 0.190), terrainPhotoDry * 0.14);
// Yellow-beige open ground is similarly pulled toward mineral soil, with dry and damp macro patches.
vec3 terrainPhotoDampEarth = vec3(0.205, 0.195, 0.160);
vec3 terrainPhotoDryEarth = vec3(0.345, 0.310, 0.235);
vec3 terrainPhotoEarth = mix(terrainPhotoDampEarth, terrainPhotoDryEarth, terrainPhotoBroad);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoEarth, terrainPhotoWarmGround * 0.20);
// Low-chroma exposed rock gains broad mineral temperature shifts plus irregular stratification.
float terrainPhotoStrata = 0.5 + 0.5 * sin(
	vTerrainPhotorealWorldPosition.y * 0.205
	+ vTerrainPhotorealWorldPosition.x * 0.012
	- vTerrainPhotorealWorldPosition.z * 0.008
	+ terrainPhotoMacro * 3.4
);
vec3 terrainPhotoRockCool = vec3(0.320, 0.335, 0.340);
vec3 terrainPhotoRockWarm = vec3(0.365, 0.330, 0.292);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(terrainPhotoRockCool, terrainPhotoRockWarm, terrainPhotoBroad), terrainPhotoRock * 0.09);
diffuseColor.rgb *= 1.0 + terrainPhotoRock * (terrainPhotoStrata - 0.5) * 0.095;
// Snow remains bright but avoids featureless clipping: packed areas are blue-grey and exposed dirty
// grains retain the mineral dust visible in real alpine/glacial reference imagery.
vec3 terrainPhotoSnowBase = mix(vec3(0.735, 0.765, 0.775), vec3(0.825, 0.835, 0.830), terrainPhotoBroad);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoSnowBase, terrainPhotoSnow * 0.12);
float terrainPhotoSnowShadow = terrainPhotoSnow * smoothstep(0.54, 0.86, 1.0 - terrainPhotoMeso);
float terrainPhotoSnowDust = terrainPhotoSnow * smoothstep(0.76, 0.92, terrainPhotoBroad) * smoothstep(0.72, 0.91, terrainPhotoGrain);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.630, 0.680, 0.700), terrainPhotoSnowShadow * 0.075);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.500, 0.485, 0.445), terrainPhotoSnowDust * 0.050);
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.012), vec3(0.91));`,
			);
	};
	material.customProgramCacheKey = () => TERRAIN_PHOTOREAL_SHADER_KEY;
}

export function applyTerrainMicroSurface(material) {
	if (!material?.isMeshStandardMaterial) throw new TypeError('terrain micro-surface requires MeshStandardMaterial');
	const surface = getSharedTerrainMicroSurfaceTextures();
	material.normalMap = surface.normalMap;
	material.normalMapType = THREE.TangentSpaceNormalMap;
	material.normalScale.setScalar(TERRAIN_MICRO_SURFACE_POLICY.normalStrength);
	material.roughnessMap = surface.roughnessMap;
	material.roughness = TERRAIN_MICRO_SURFACE_POLICY.roughnessBase;
	installWorldSpaceColorBreakup(material);
	material.userData.terrainMicroSurface = Object.freeze({
		policyId: TERRAIN_MICRO_SURFACE_POLICY.id,
		detailRepeatMeters: TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters,
		uvChannel: TERRAIN_MICRO_SURFACE_POLICY.uvChannel,
		macroWorldSpaceColorBreakup: true,
		photorealDesaturation: true,
		naturalAlbedoRemap: true,
		fractureNormals: true,
		renderOnly: true,
	});
	material.needsUpdate = true;
	return material;
}
