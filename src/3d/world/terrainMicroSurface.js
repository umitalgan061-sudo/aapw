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
	id: 'terrain-micro-surface-world-uv-pbr-v3-photoreal',
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
			// Recesses are slightly smoother/darker-looking than frost/dust sitting on raised grains.
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
		'terrain-world-micro-normal-v3-photoreal',
	);
	const roughnessMap = configureTerrainDataTexture(
		new THREE.DataTexture(buildTerrainRoughnessData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-roughness-v3-photoreal',
	);
	sharedTerrainMicroSurface = Object.freeze({ normalMap, roughnessMap });
	return sharedTerrainMicroSurface;
}

const TERRAIN_PHOTOREAL_SHADER_KEY = 'terrain-photoreal-world-surface-v3';

function installWorldSpaceColorBreakup(material) {
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying vec3 vTerrainPhotorealWorldPosition;',
			)
			.replace(
				'#include <worldpos_vertex>',
				'#include <worldpos_vertex>\nvTerrainPhotorealWorldPosition = worldPosition.xyz;',
			);
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
float terrainPhotoVegetation = smoothstep(0.018, 0.145, terrainPhotoGreenLead) * (1.0 - smoothstep(0.72, 0.88, terrainPhotoLuma));
float terrainPhotoSnow = smoothstep(0.66, 0.88, terrainPhotoLuma) * (1.0 - smoothstep(0.10, 0.27, terrainPhotoChroma));
float terrainPhotoRock = (1.0 - terrainPhotoVegetation) * (1.0 - terrainPhotoSnow) * (1.0 - smoothstep(0.20, 0.34, terrainPhotoChroma));
vec2 terrainPhotoXZ = vTerrainPhotorealWorldPosition.xz;
float terrainPhotoBroad = terrainPhotoFbm(terrainPhotoXZ / 2400.0 + vec2(11.7, -4.1));
float terrainPhotoMacro = terrainPhotoFbm(terrainPhotoXZ / 620.0 + vec2(-7.3, 14.9));
float terrainPhotoMeso = terrainPhotoFbm(terrainPhotoXZ / 145.0 + vec2(23.8, 3.6));
float terrainPhotoGrain = terrainPhotoNoise(terrainPhotoXZ / 38.0 + vec2(5.4, -18.2));
// Real landscapes lose the game-like chroma of pure palette colours. Vegetation is reduced most;
// stone/soil keep restrained mineral warmth, while snow stays close to neutral.
float terrainPhotoDesaturate = 0.055 + terrainPhotoVegetation * 0.16 + terrainPhotoRock * 0.045;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(terrainPhotoLuma), terrainPhotoDesaturate);
// Multi-scale illumination-independent albedo breakup: broad geology/soil moisture, meso patches,
// then weak grain. The range is bounded so it cannot repaint authored geography.
float terrainPhotoValue = 0.965
	+ (terrainPhotoBroad - 0.5) * 0.105
	+ (terrainPhotoMacro - 0.5) * 0.085
	+ (terrainPhotoMeso - 0.5) * 0.045
	+ (terrainPhotoGrain - 0.5) * 0.018;
diffuseColor.rgb *= terrainPhotoValue;
// Vegetation alternates between damp dark olive and drier straw/earth without neon green fields.
float terrainPhotoDamp = terrainPhotoVegetation * smoothstep(0.58, 0.84, 1.0 - terrainPhotoBroad) * smoothstep(0.42, 0.78, terrainPhotoMacro);
float terrainPhotoDry = terrainPhotoVegetation * smoothstep(0.58, 0.84, terrainPhotoBroad) * smoothstep(0.48, 0.82, terrainPhotoMeso);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.165, 0.215, 0.135), terrainPhotoDamp * 0.115);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.355, 0.335, 0.235), terrainPhotoDry * 0.095);
// Low-chroma exposed rock gains broad mineral temperature shifts plus irregular stratification.
float terrainPhotoStrata = 0.5 + 0.5 * sin(
	vTerrainPhotorealWorldPosition.y * 0.205
	+ vTerrainPhotorealWorldPosition.x * 0.012
	- vTerrainPhotorealWorldPosition.z * 0.008
	+ terrainPhotoMacro * 3.4
);
vec3 terrainPhotoRockCool = vec3(0.365, 0.382, 0.390);
vec3 terrainPhotoRockWarm = vec3(0.405, 0.370, 0.330);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(terrainPhotoRockCool, terrainPhotoRockWarm, terrainPhotoBroad), terrainPhotoRock * 0.045);
diffuseColor.rgb *= 1.0 + terrainPhotoRock * (terrainPhotoStrata - 0.5) * 0.070;
// Snow is not printer white: wind-packed depressions carry blue-grey shadow and sparse windblown dirt.
float terrainPhotoSnowShadow = terrainPhotoSnow * smoothstep(0.54, 0.86, 1.0 - terrainPhotoMeso);
float terrainPhotoSnowDust = terrainPhotoSnow * smoothstep(0.79, 0.93, terrainPhotoBroad) * smoothstep(0.74, 0.92, terrainPhotoGrain);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.715, 0.765, 0.785), terrainPhotoSnowShadow * 0.050);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.585, 0.565, 0.520), terrainPhotoSnowDust * 0.035);
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.015), vec3(0.96));`,
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
		fractureNormals: true,
		renderOnly: true,
	});
	material.needsUpdate = true;
	return material;
}
