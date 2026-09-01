/**
 * Render-only photoreal micro/macro PBR layer for canonical terrain.
 * Geography and collision remain owned by terrain.js + map/Pindex height data.
 * @module world/terrainMicroSurface
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS } from '../config.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
	const t = clamp01((value - a) / Math.max(1e-9, b - a));
	return t * t * (3 - 2 * t);
};

export const TERRAIN_MICRO_SURFACE_POLICY = Object.freeze({
	// Public id advances because the final render now preserves a bounded amount of the semantic
	// terrain palette after ecological/weathering remaps. Geography, height and hydrology stay untouched.
	id: 'terrain-micro-surface-world-uv-pbr-v8-semantic-palette-retention',
	textureSize: 256,
	detailRepeatMeters: 22,
	normalStrength: 0.92,
	normalSlopeGain: 4.80,
	roughnessBase: 0.93,
	roughnessMin: 0.52,
	roughnessMax: 0.99,
	uvChannel: 1,
	maxAnisotropy: 8,
	macroColorBreakup: true,
	worldSpaceMacroScaleMeters: Object.freeze([38, 92, 240, 620, 1450, 3200]),
	photorealDesaturation: true,
	naturalAlbedoRemap: true,
	semanticPaletteRetention: true,
	regionalMoistureVariation: true,
	elevationWeathering: true,
	fractureNormals: true,
	ecologicalMosaic: true,
	drainageBreakup: true,
	nonPeriodicRockWeathering: true,
	multiScaleAerialContrast: true,
	snowScourReadability: true,
	slopeAwareCliffWeathering: true,
	erosionRunnels: true,
	screeAprons: true,
	coastalDampness: true,
	coastalIntertidalBreakup: true,
	coastalSaltSprayWeathering: true,
	coastalRoughnessResponse: true,
	aspectWeathering: true,
	roughnessResponse: true,
	renderOnly: true,
});

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
	const pits = tileableFbm((u + 0.731) % 1, (v + 0.283) % 1, 0xb42d);
	const warpU = u + (broad - 0.5) * 0.086 + (pits - 0.5) * 0.031;
	const warpV = v + (grain - 0.5) * 0.066 - (pits - 0.5) * 0.024;
	const fractureA = Math.abs(Math.sin(Math.PI * 2 * (warpU * 7 + warpV * 3 + broad * 0.74)));
	const fractureB = Math.abs(Math.sin(Math.PI * 2 * (warpU * 2 - warpV * 11 + grain * 0.62 + 0.23)));
	const fractureC = Math.abs(Math.sin(Math.PI * 2 * (warpU * 13 + warpV * 9 + pits * 0.38 + 0.41)));
	const crackA = 1 - smoothstep(0.018, 0.110, fractureA);
	const crackB = 1 - smoothstep(0.016, 0.086, fractureB);
	const crackC = 1 - smoothstep(0.012, 0.055, fractureC);
	const fracture = Math.max(crackA, Math.max(crackB * 0.72, crackC * 0.38));
	return (broad - 0.5) * 0.42 + (grain - 0.5) * 0.25 + (pits - 0.5) * 0.13 - fracture * 0.24;
}

function buildTerrainDetailField(size) {
	const field = new Float32Array(size * size);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) field[y * size + x] = terrainDetailHeight(x / size, y / size);
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
			const grain = clamp01(0.43 + center * 0.34 + localRelief * 1.38);
			const recessPolish = smoothstep(-0.36, -0.11, center) * (1 - smoothstep(-0.10, 0.11, center));
			const roughness = clamp01(lerp(roughnessMin, roughnessMax, grain) - recessPolish * 0.11);
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

export function getSharedTerrainMicroSurfaceTextures() {
	if (sharedTerrainMicroSurface) return sharedTerrainMicroSurface;
	const size = TERRAIN_MICRO_SURFACE_POLICY.textureSize;
	const field = buildTerrainDetailField(size);
	const normalMap = configureTerrainDataTexture(
		new THREE.DataTexture(buildTerrainNormalData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-normal-v7-coastal-weathering',
	);
	const roughnessMap = configureTerrainDataTexture(
		new THREE.DataTexture(buildTerrainRoughnessData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-roughness-v7-coastal-weathering',
	);
	sharedTerrainMicroSurface = Object.freeze({ normalMap, roughnessMap });
	return sharedTerrainMicroSurface;
}

const TERRAIN_PHOTOREAL_SHADER_KEY = 'terrain-photoreal-world-surface-v8-semantic-palette-retention';
const WATER_LEVEL_GLSL = Number(WORLD_DEFAULTS.WATER_LEVEL_METERS).toFixed(3);

function installWorldSpaceColorBreakup(material) {
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying vec3 vTerrainPhotorealWorldPosition;\nvarying vec3 vTerrainPhotorealWorldNormal;',
			)
			.replace(
				'#include <beginnormal_vertex>',
				'#include <beginnormal_vertex>\nvTerrainPhotorealWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
			)
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\nvTerrainPhotorealWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
varying vec3 vTerrainPhotorealWorldPosition;
varying vec3 vTerrainPhotorealWorldNormal;
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
}
float terrainPhotoRidgeNoise(vec2 p) {
	float n = terrainPhotoFbm(p);
	return 1.0 - abs(n * 2.0 - 1.0);
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
float terrainPhotoVegetation = smoothstep(0.006, 0.095, terrainPhotoGreenLead) * (1.0 - smoothstep(0.63, 0.82, terrainPhotoLuma));
float terrainPhotoSnow = smoothstep(0.60, 0.84, terrainPhotoLuma) * (1.0 - smoothstep(0.08, 0.23, terrainPhotoChroma));
float terrainPhotoWarmGround = (1.0 - terrainPhotoSnow) * (1.0 - terrainPhotoVegetation)
	* smoothstep(-0.045, 0.095, terrainPhotoBase.r - terrainPhotoBase.b)
	* (1.0 - smoothstep(0.68, 0.86, terrainPhotoLuma));
float terrainPhotoRock = (1.0 - terrainPhotoVegetation) * (1.0 - terrainPhotoSnow) * (1.0 - smoothstep(0.16, 0.31, terrainPhotoChroma));

vec2 terrainPhotoXZ = vTerrainPhotorealWorldPosition.xz;
vec3 terrainPhotoWorldNormal = normalize(vTerrainPhotorealWorldNormal);
float terrainPhotoSlope = 1.0 - clamp(abs(terrainPhotoWorldNormal.y), 0.0, 1.0);
float terrainPhotoShoulder = smoothstep(0.055, 0.34, terrainPhotoSlope);
float terrainPhotoSteep = smoothstep(0.18, 0.58, terrainPhotoSlope);
float terrainPhotoCliff = smoothstep(0.30, 0.78, terrainPhotoSlope);
vec2 terrainPhotoHorizontalNormal = terrainPhotoWorldNormal.xz;
float terrainPhotoHorizontalLength = max(length(terrainPhotoHorizontalNormal), 0.0001);
float terrainPhotoAspect = dot(terrainPhotoHorizontalNormal / terrainPhotoHorizontalLength, normalize(vec2(0.71, -0.70))) * terrainPhotoShoulder;

float terrainPhotoWarpA = terrainPhotoFbm(terrainPhotoXZ / 1450.0 + vec2(9.4, -6.1));
float terrainPhotoWarpB = terrainPhotoFbm(terrainPhotoXZ / 1230.0 + vec2(-15.7, 4.8));
vec2 terrainPhotoWarpedXZ = terrainPhotoXZ + (vec2(terrainPhotoWarpA, terrainPhotoWarpB) - 0.5) * 520.0;
float terrainPhotoRegional = terrainPhotoFbm(terrainPhotoWarpedXZ / 3200.0 + vec2(11.7, -4.1));
float terrainPhotoBroad = terrainPhotoFbm(terrainPhotoWarpedXZ / 1450.0 + vec2(-5.9, 8.6));
float terrainPhotoMacro = terrainPhotoFbm(terrainPhotoWarpedXZ / 620.0 + vec2(-7.3, 14.9));
float terrainPhotoLandform = terrainPhotoFbm(terrainPhotoWarpedXZ / 240.0 + vec2(4.9, -11.7));
float terrainPhotoMeso = terrainPhotoFbm(terrainPhotoXZ / 92.0 + vec2(23.8, 3.6));
float terrainPhotoGrain = terrainPhotoNoise(terrainPhotoXZ / 38.0 + vec2(5.4, -18.2));
float terrainPhotoEco = terrainPhotoFbm(terrainPhotoWarpedXZ / 690.0 + vec2(2.8, 21.6));
float terrainPhotoDrainage = terrainPhotoFbm(terrainPhotoWarpedXZ / 260.0 + vec2(-17.4, 6.2));
float terrainPhotoElevation = smoothstep(45.0, 330.0, vTerrainPhotorealWorldPosition.y);
float terrainPhotoHighAlpine = smoothstep(180.0, 520.0, vTerrainPhotorealWorldPosition.y);
float terrainPhotoLowland = 1.0 - smoothstep(22.0, 120.0, vTerrainPhotorealWorldPosition.y);

// The previous coastal term covered almost every vertex from +2 m to +34 m above water uniformly,
// which read as a continuous green halo in full-world renders. Keep the authority height-based, but
// break the visual response into a narrow intertidal zone, a patchy spray reach and sparse salt crust.
float terrainPhotoCoastHeight = vTerrainPhotorealWorldPosition.y - ${WATER_LEVEL_GLSL};
float terrainPhotoCoastMacro = terrainPhotoFbm(terrainPhotoWarpedXZ / 430.0 + vec2(29.1, -12.4));
float terrainPhotoCoastMeso = terrainPhotoFbm(terrainPhotoWarpedXZ / 155.0 + vec2(-8.7, 31.2));
float terrainPhotoCoastFine = terrainPhotoNoise(terrainPhotoXZ / 47.0 + vec2(16.8, 5.3));
float terrainPhotoCoastalReach = (1.0 - smoothstep(1.2, 18.0, terrainPhotoCoastHeight)) * (1.0 - terrainPhotoSnow);
float terrainPhotoCoastalBand = terrainPhotoCoastalReach * mix(0.28, 1.0, smoothstep(0.34, 0.78, terrainPhotoCoastMacro));
float terrainPhotoTideEnvelope = 1.0 - smoothstep(0.25, 5.2, terrainPhotoCoastHeight);
float terrainPhotoTideStain = terrainPhotoTideEnvelope * (1.0 - terrainPhotoSnow)
	* smoothstep(0.42, 0.79, terrainPhotoCoastMeso * 0.66 + terrainPhotoCoastFine * 0.34);
float terrainPhotoSaltSpray = terrainPhotoCoastalReach * (1.0 - terrainPhotoTideEnvelope * 0.72)
	* smoothstep(0.61, 0.86, terrainPhotoCoastMeso)
	* smoothstep(0.46, 0.80, terrainPhotoCoastFine);
float terrainPhotoMoisture = clamp(
	0.51 + (0.5 - terrainPhotoRegional) * 0.55 + (0.5 - terrainPhotoBroad) * 0.62
	+ (0.5 - terrainPhotoMacro) * 0.30 + (0.5 - terrainPhotoDrainage) * terrainPhotoLowland * 0.28
	+ terrainPhotoCoastalBand * (0.055 + terrainPhotoCoastMeso * 0.075) + terrainPhotoTideStain * 0.16,
	0.0, 1.0
);
float terrainPhotoAlluvialField = terrainPhotoRidgeNoise(terrainPhotoWarpedXZ / 410.0 + vec2(6.7, -13.2));
float terrainPhotoAlluvialWash = (1.0 - terrainPhotoSnow) * terrainPhotoLowland
	* smoothstep(0.60, 0.86, 1.0 - terrainPhotoDrainage)
	* smoothstep(0.54, 0.82, terrainPhotoMoisture)
	* smoothstep(0.52, 0.80, terrainPhotoAlluvialField);
float terrainPhotoDryShoulder = (1.0 - terrainPhotoSnow) * terrainPhotoShoulder
	* smoothstep(0.56, 0.83, terrainPhotoAlluvialField)
	* smoothstep(0.48, 0.76, 1.0 - terrainPhotoMoisture)
	* (0.36 + terrainPhotoElevation * 0.64);

float terrainPhotoDesaturate = 0.12 + terrainPhotoVegetation * 0.28 + terrainPhotoRock * 0.11 + terrainPhotoWarmGround * 0.12;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(terrainPhotoLuma), terrainPhotoDesaturate);
float terrainPhotoValue = 0.875
	+ (terrainPhotoRegional - 0.5) * 0.28
	+ (terrainPhotoBroad - 0.5) * 0.22
	+ (terrainPhotoMacro - 0.5) * 0.17
	+ (terrainPhotoLandform - 0.5) * 0.11
	+ (terrainPhotoMeso - 0.5) * 0.060
	+ (terrainPhotoGrain - 0.5) * 0.022;
float terrainPhotoSlopeContrast = terrainPhotoShoulder * ((terrainPhotoLandform - 0.5) * 0.11 + terrainPhotoAspect * 0.045);
diffuseColor.rgb *= terrainPhotoValue + terrainPhotoSlopeContrast;

vec3 terrainPhotoWetOlive = vec3(0.050, 0.073, 0.038);
vec3 terrainPhotoNeutralOlive = vec3(0.126, 0.136, 0.076);
vec3 terrainPhotoDryOlive = vec3(0.232, 0.204, 0.128);
vec3 terrainPhotoOlive = mix(terrainPhotoDryOlive, terrainPhotoWetOlive, terrainPhotoMoisture);
terrainPhotoOlive = mix(terrainPhotoOlive, terrainPhotoNeutralOlive, 0.24);
float terrainPhotoVegRemap = terrainPhotoVegetation * (0.54 + abs(terrainPhotoMacro - 0.5) * 0.36);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoOlive, terrainPhotoVegRemap);
float terrainPhotoWetMeadow = terrainPhotoVegetation * terrainPhotoLowland
	* smoothstep(0.57, 0.82, terrainPhotoMoisture) * smoothstep(0.48, 0.73, 1.0 - terrainPhotoDrainage);
float terrainPhotoDryGrass = terrainPhotoVegetation * smoothstep(0.53, 0.81, 1.0 - terrainPhotoMoisture)
	* smoothstep(0.47, 0.76, terrainPhotoEco) * (0.48 + terrainPhotoElevation * 0.52);
float terrainPhotoSparseEarth = terrainPhotoVegetation * smoothstep(0.49, 0.78, 1.0 - terrainPhotoMoisture)
	* smoothstep(0.50, 0.79, 1.0 - terrainPhotoEco) * (0.38 + terrainPhotoElevation * 0.62);
float terrainPhotoHeathBreak = terrainPhotoVegetation * terrainPhotoElevation
	* smoothstep(0.50, 0.78, terrainPhotoBroad) * (0.62 + terrainPhotoMacro * 0.38);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.043, 0.064, 0.035), terrainPhotoWetMeadow * 0.34);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.257, 0.225, 0.141), terrainPhotoDryGrass * 0.38);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.235, 0.202, 0.153), terrainPhotoSparseEarth * 0.43);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.188, 0.174, 0.138), terrainPhotoHeathBreak * 0.31);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.082, 0.103, 0.079), terrainPhotoAlluvialWash * 0.29);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.292, 0.257, 0.178), terrainPhotoDryShoulder * 0.22);

float terrainPhotoCoastalWet = clamp(
	terrainPhotoTideStain * (0.60 + terrainPhotoMoisture * 0.40)
	+ terrainPhotoCoastalBand * smoothstep(0.62, 0.86, terrainPhotoMoisture) * 0.24,
	0.0, 1.0
) * (1.0 - terrainPhotoCliff * 0.42);
float terrainPhotoCoastalRockWet = max(terrainPhotoRock, terrainPhotoCliff * 0.72) * terrainPhotoTideStain;
vec3 terrainPhotoCoastalTone = vec3(0.088, 0.101, 0.091);
vec3 terrainPhotoWetRockTone = vec3(0.105, 0.112, 0.109);
vec3 terrainPhotoSaltTone = vec3(0.330, 0.333, 0.307);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoCoastalTone, terrainPhotoCoastalWet * 0.28);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoWetRockTone, terrainPhotoCoastalRockWet * 0.30);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoSaltTone, terrainPhotoSaltSpray * (0.08 + terrainPhotoRock * 0.10));

vec3 terrainPhotoDampEarth = vec3(0.122, 0.116, 0.103);
vec3 terrainPhotoNeutralEarth = vec3(0.218, 0.199, 0.162);
vec3 terrainPhotoDryEarth = vec3(0.315, 0.273, 0.205);
vec3 terrainPhotoEarth = mix(terrainPhotoDryEarth, terrainPhotoDampEarth, terrainPhotoMoisture);
terrainPhotoEarth = mix(terrainPhotoEarth, terrainPhotoNeutralEarth, 0.30);
float terrainPhotoEarthRemap = terrainPhotoWarmGround * (0.36 + terrainPhotoElevation * 0.15);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoEarth, terrainPhotoEarthRemap);
float terrainPhotoStonyPatch = (1.0 - terrainPhotoSnow) * smoothstep(0.61, 0.85, terrainPhotoMeso)
	* (0.18 + terrainPhotoElevation * 0.58) * (1.0 - terrainPhotoVegetation * 0.52);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.267, 0.260, 0.244), terrainPhotoStonyPatch * 0.29);

// Keep weathering dominant, but retain enough of the upstream semantic palette for meadow/heath/
// exposed-earth distinctions to survive at aerial scale. Snow, rock and wet coastal bands remain
// authoritative and are explicitly protected from this restrained colour-memory pass.
float terrainPhotoPaletteRetention = clamp(
	terrainPhotoVegetation * (0.115 + terrainPhotoChroma * 0.22) + terrainPhotoWarmGround * 0.085,
	0.0, 0.17
) * (1.0 - terrainPhotoSnow)
	* (1.0 - terrainPhotoRock * 0.62)
	* (1.0 - terrainPhotoCoastalWet * 0.72)
	* (1.0 - terrainPhotoTideStain * 0.55);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoBase, terrainPhotoPaletteRetention);

float terrainPhotoScreeBand = terrainPhotoHighAlpine * terrainPhotoShoulder * (1.0 - terrainPhotoCliff)
	* smoothstep(0.48, 0.78, terrainPhotoLandform) * (1.0 - terrainPhotoSnow * 0.72);
vec3 terrainPhotoScreeWarm = vec3(0.275, 0.259, 0.232);
vec3 terrainPhotoScreeCool = vec3(0.225, 0.240, 0.244);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(terrainPhotoScreeWarm, terrainPhotoScreeCool, terrainPhotoRegional), terrainPhotoScreeBand * 0.38);

float terrainPhotoGeoA = terrainPhotoFbm(vec2(
	terrainPhotoXZ.x * 0.0028 + vTerrainPhotorealWorldPosition.y * 0.013,
	terrainPhotoXZ.y * 0.0036 - vTerrainPhotorealWorldPosition.y * 0.009
) + vec2(terrainPhotoMacro * 2.2, terrainPhotoBroad * 1.7));
float terrainPhotoGeoB = terrainPhotoFbm(terrainPhotoWarpedXZ / 185.0 + vec2(terrainPhotoGeoA * 3.1, -terrainPhotoGeoA * 2.4));
float terrainPhotoStrata = smoothstep(0.34, 0.72, terrainPhotoGeoA * 0.58 + terrainPhotoGeoB * 0.42);
float terrainPhotoRunnelField = terrainPhotoRidgeNoise(vec2(
	terrainPhotoXZ.x / 105.0 + vTerrainPhotorealWorldPosition.y * 0.010,
	terrainPhotoXZ.y / 270.0 - vTerrainPhotorealWorldPosition.y * 0.004
) + vec2(terrainPhotoWarpA * 2.7, terrainPhotoWarpB * 1.9));
float terrainPhotoRunnel = terrainPhotoCliff * smoothstep(0.66, 0.90, terrainPhotoRunnelField)
	* (0.44 + terrainPhotoMoisture * 0.56);
vec3 terrainPhotoRockCool = vec3(0.242, 0.258, 0.264);
vec3 terrainPhotoRockWarm = vec3(0.304, 0.276, 0.247);
vec3 terrainPhotoRockDark = vec3(0.166, 0.176, 0.177);
vec3 terrainPhotoRockTone = mix(terrainPhotoRockCool, terrainPhotoRockWarm, terrainPhotoRegional);
terrainPhotoRockTone = mix(terrainPhotoRockTone, terrainPhotoRockDark, smoothstep(0.70, 0.93, terrainPhotoMoisture) * 0.35);
float terrainPhotoRockFace = max(terrainPhotoRock, terrainPhotoCliff * (1.0 - terrainPhotoVegetation * 0.48));
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoRockTone, terrainPhotoRockFace * (0.22 + terrainPhotoElevation * 0.18));
diffuseColor.rgb *= 1.0 + terrainPhotoRockFace * (terrainPhotoStrata - 0.5) * 0.16;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.105, 0.119, 0.120), terrainPhotoRunnel * 0.34);

vec3 terrainPhotoSnowCold = vec3(0.640, 0.688, 0.718);
vec3 terrainPhotoSnowSun = vec3(0.790, 0.802, 0.794);
vec3 terrainPhotoSnowBase = mix(terrainPhotoSnowCold, terrainPhotoSnowSun, terrainPhotoRegional * 0.62 + terrainPhotoBroad * 0.38);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoSnowBase, terrainPhotoSnow * 0.30);
float terrainPhotoSnowShadow = terrainPhotoSnow * smoothstep(0.46, 0.80, 1.0 - terrainPhotoLandform);
float terrainPhotoSnowDust = terrainPhotoSnow * smoothstep(0.67, 0.88, terrainPhotoBroad) * smoothstep(0.64, 0.86, terrainPhotoGrain);
float terrainPhotoSnowScour = terrainPhotoSnow * terrainPhotoHighAlpine * smoothstep(0.56, 0.82, terrainPhotoMacro);
float terrainPhotoSnowRockReveal = terrainPhotoSnow * terrainPhotoSteep
	* smoothstep(0.48, 0.78, terrainPhotoRidgeNoise(terrainPhotoWarpedXZ / 175.0 + vec2(13.1, -8.6)));
float terrainPhotoSnowDeposit = terrainPhotoSnow * (1.0 - terrainPhotoShoulder)
	* smoothstep(0.55, 0.82, 1.0 - terrainPhotoDrainage);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.475, 0.540, 0.578), terrainPhotoSnowShadow * 0.25);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.392, 0.390, 0.370), terrainPhotoSnowDust * 0.11);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.540, 0.580, 0.596), terrainPhotoSnowScour * 0.16);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoRockTone, terrainPhotoSnowRockReveal * 0.46);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.805, 0.820, 0.820), terrainPhotoSnowDeposit * 0.12);

vec3 terrainPhotoAspectCool = vec3(0.915, 0.955, 0.970);
vec3 terrainPhotoAspectWarm = vec3(1.035, 1.010, 0.965);
float terrainPhotoAspectAmount = terrainPhotoShoulder * (0.045 + terrainPhotoHighAlpine * 0.035);
diffuseColor.rgb *= mix(vec3(1.0), mix(terrainPhotoAspectCool, terrainPhotoAspectWarm, terrainPhotoAspect * 0.5 + 0.5), terrainPhotoAspectAmount);
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.010), vec3(0.845));`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				`#include <roughnessmap_fragment>
float terrainPhotoWetPolish = terrainPhotoCoastalWet * 0.085 + terrainPhotoTideStain * 0.095
	+ terrainPhotoCoastalRockWet * 0.055 + terrainPhotoRunnel * 0.10 + terrainPhotoAlluvialWash * 0.055;
float terrainPhotoRockPolish = terrainPhotoRockFace * terrainPhotoMoisture * 0.045;
float terrainPhotoSaltCrustRoughness = terrainPhotoSaltSpray * 0.065;
float terrainPhotoGranularRoughness = terrainPhotoScreeBand * 0.055 + terrainPhotoSnowDeposit * 0.025
	+ terrainPhotoDryShoulder * 0.045 + terrainPhotoSaltCrustRoughness;
roughnessFactor = clamp(
	roughnessFactor - terrainPhotoWetPolish - terrainPhotoRockPolish + terrainPhotoGranularRoughness,
	0.48,
	1.0
);`,
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
		semanticPaletteRetention: true,
		regionalMoistureVariation: true,
		elevationWeathering: true,
		fractureNormals: true,
		ecologicalMosaic: true,
		drainageBreakup: true,
		nonPeriodicRockWeathering: true,
		multiScaleAerialContrast: true,
		snowScourReadability: true,
		slopeAwareCliffWeathering: true,
		erosionRunnels: true,
		screeAprons: true,
		coastalDampness: true,
		coastalIntertidalBreakup: true,
		coastalSaltSprayWeathering: true,
		coastalRoughnessResponse: true,
		aspectWeathering: true,
		roughnessResponse: true,
		renderOnly: true,
	});
	material.needsUpdate = true;
	return material;
}
