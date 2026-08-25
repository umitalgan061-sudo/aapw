/**
 * Render-only photoreal micro/macro PBR layer for canonical terrain.
 * Geography and collision remain owned by terrain.js + map/Pindex height data.
 * @module world/terrainMicroSurface
 */

import * as THREE from 'three';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
	const t = clamp01((value - a) / Math.max(1e-9, b - a));
	return t * t * (3 - 2 * t);
};

export const TERRAIN_MICRO_SURFACE_POLICY = Object.freeze({
	id: 'terrain-micro-surface-world-uv-pbr-v6-regional-natural-albedo',
	textureSize: 256,
	detailRepeatMeters: 22,
	normalStrength: 0.88,
	normalSlopeGain: 4.5,
	roughnessBase: 0.93,
	roughnessMin: 0.54,
	roughnessMax: 0.99,
	uvChannel: 1,
	maxAnisotropy: 8,
	macroColorBreakup: true,
	worldSpaceMacroScaleMeters: Object.freeze([95, 360, 980, 2600]),
	photorealDesaturation: true,
	naturalAlbedoRemap: true,
	regionalMoistureVariation: true,
	elevationWeathering: true,
	fractureNormals: true,
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
	const warpU = u + (broad - 0.5) * 0.082 + (pits - 0.5) * 0.028;
	const warpV = v + (grain - 0.5) * 0.062 - (pits - 0.5) * 0.022;
	const fractureA = Math.abs(Math.sin(Math.PI * 2 * (warpU * 7 + warpV * 3 + broad * 0.74)));
	const fractureB = Math.abs(Math.sin(Math.PI * 2 * (warpU * 2 - warpV * 11 + grain * 0.62 + 0.23)));
	const fractureC = Math.abs(Math.sin(Math.PI * 2 * (warpU * 13 + warpV * 9 + pits * 0.38 + 0.41)));
	const crackA = 1 - smoothstep(0.018, 0.110, fractureA);
	const crackB = 1 - smoothstep(0.016, 0.086, fractureB);
	const crackC = 1 - smoothstep(0.012, 0.055, fractureC);
	const fracture = Math.max(crackA, Math.max(crackB * 0.72, crackC * 0.38));
	const granular = (grain - 0.5) * 0.24 + (pits - 0.5) * 0.12;
	const packed = (broad - 0.5) * 0.40;
	return packed + granular - fracture * 0.23;
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
			const grain = clamp01(0.45 + center * 0.34 + localRelief * 1.32);
			const recessPolish = smoothstep(-0.35, -0.10, center) * (1 - smoothstep(-0.10, 0.10, center));
			const roughness = clamp01(lerp(roughnessMin, roughnessMax, grain) - recessPolish * 0.10);
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
		'terrain-world-micro-normal-v6-regional-natural-albedo',
	);
	const roughnessMap = configureTerrainDataTexture(
		new THREE.DataTexture(buildTerrainRoughnessData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-roughness-v6-regional-natural-albedo',
	);
	sharedTerrainMicroSurface = Object.freeze({ normalMap, roughnessMap });
	return sharedTerrainMicroSurface;
}

const TERRAIN_PHOTOREAL_SHADER_KEY = 'terrain-photoreal-world-surface-v6-regional-natural-albedo';

function installWorldSpaceColorBreakup(material) {
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPhotorealWorldPosition;')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPhotorealWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
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
float terrainPhotoVegetation = smoothstep(0.008, 0.100, terrainPhotoGreenLead) * (1.0 - smoothstep(0.62, 0.82, terrainPhotoLuma));
float terrainPhotoSnow = smoothstep(0.60, 0.84, terrainPhotoLuma) * (1.0 - smoothstep(0.08, 0.23, terrainPhotoChroma));
float terrainPhotoWarmGround = (1.0 - terrainPhotoSnow) * (1.0 - terrainPhotoVegetation)
	* smoothstep(-0.045, 0.095, terrainPhotoBase.r - terrainPhotoBase.b)
	* (1.0 - smoothstep(0.68, 0.86, terrainPhotoLuma));
float terrainPhotoRock = (1.0 - terrainPhotoVegetation) * (1.0 - terrainPhotoSnow) * (1.0 - smoothstep(0.16, 0.31, terrainPhotoChroma));
vec2 terrainPhotoXZ = vTerrainPhotorealWorldPosition.xz;
float terrainPhotoRegional = terrainPhotoFbm(terrainPhotoXZ / 2600.0 + vec2(11.7, -4.1));
float terrainPhotoBroad = terrainPhotoFbm(terrainPhotoXZ / 980.0 + vec2(-5.9, 8.6));
float terrainPhotoMacro = terrainPhotoFbm(terrainPhotoXZ / 360.0 + vec2(-7.3, 14.9));
float terrainPhotoMeso = terrainPhotoFbm(terrainPhotoXZ / 95.0 + vec2(23.8, 3.6));
float terrainPhotoGrain = terrainPhotoNoise(terrainPhotoXZ / 31.0 + vec2(5.4, -18.2));
float terrainPhotoElevation = smoothstep(45.0, 330.0, vTerrainPhotorealWorldPosition.y);
float terrainPhotoLowland = 1.0 - smoothstep(22.0, 120.0, vTerrainPhotorealWorldPosition.y);
float terrainPhotoMoisture = clamp(
	0.53 + (0.5 - terrainPhotoRegional) * 0.52 + (0.5 - terrainPhotoBroad) * 0.60 + (0.5 - terrainPhotoMacro) * 0.34,
	0.0, 1.0
);
float terrainPhotoDesaturate = 0.11 + terrainPhotoVegetation * 0.34 + terrainPhotoRock * 0.10 + terrainPhotoWarmGround * 0.12;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(terrainPhotoLuma), terrainPhotoDesaturate);
float terrainPhotoValue = 0.865
	+ (terrainPhotoRegional - 0.5) * 0.16
	+ (terrainPhotoBroad - 0.5) * 0.13
	+ (terrainPhotoMacro - 0.5) * 0.085
	+ (terrainPhotoMeso - 0.5) * 0.045
	+ (terrainPhotoGrain - 0.5) * 0.018;
diffuseColor.rgb *= terrainPhotoValue;

// Vegetated ground uses subdued olive/brown families rather than game-green. Moist drainage bands,
// drier exposed shoulders and higher heathland all shift independently so no continent-sized patch
// can collapse to a single colour.
vec3 terrainPhotoWetOlive = vec3(0.055, 0.082, 0.043);
vec3 terrainPhotoNeutralOlive = vec3(0.135, 0.145, 0.083);
vec3 terrainPhotoDryOlive = vec3(0.235, 0.212, 0.130);
vec3 terrainPhotoOlive = mix(terrainPhotoDryOlive, terrainPhotoWetOlive, terrainPhotoMoisture);
terrainPhotoOlive = mix(terrainPhotoOlive, terrainPhotoNeutralOlive, 0.22);
float terrainPhotoVegRemap = terrainPhotoVegetation * (0.58 + abs(terrainPhotoMacro - 0.5) * 0.32);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoOlive, terrainPhotoVegRemap);
float terrainPhotoDamp = terrainPhotoVegetation * terrainPhotoLowland * smoothstep(0.56, 0.82, terrainPhotoMoisture);
float terrainPhotoDry = terrainPhotoVegetation * smoothstep(0.58, 0.84, 1.0 - terrainPhotoMoisture) * (0.55 + terrainPhotoElevation * 0.45);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.070, 0.038), terrainPhotoDamp * 0.28);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.285, 0.255, 0.166), terrainPhotoDry * 0.24);
float terrainPhotoHeathBreak = terrainPhotoVegetation * terrainPhotoElevation * smoothstep(0.54, 0.82, terrainPhotoBroad);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.205, 0.190, 0.145), terrainPhotoHeathBreak * 0.26);

// Open ground is mineral soil, not yellow paint. Regional moisture gives damp brown-grey valleys and
// drier ochre shoulders while meso variation exposes scattered stone without changing geography.
vec3 terrainPhotoDampEarth = vec3(0.135, 0.128, 0.110);
vec3 terrainPhotoNeutralEarth = vec3(0.235, 0.215, 0.170);
vec3 terrainPhotoDryEarth = vec3(0.335, 0.292, 0.215);
vec3 terrainPhotoEarth = mix(terrainPhotoDryEarth, terrainPhotoDampEarth, terrainPhotoMoisture);
terrainPhotoEarth = mix(terrainPhotoEarth, terrainPhotoNeutralEarth, 0.28);
float terrainPhotoEarthRemap = terrainPhotoWarmGround * (0.34 + terrainPhotoElevation * 0.14);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoEarth, terrainPhotoEarthRemap);
float terrainPhotoStonyPatch = (1.0 - terrainPhotoSnow) * smoothstep(0.64, 0.87, terrainPhotoMeso)
	* (0.20 + terrainPhotoElevation * 0.55) * (1.0 - terrainPhotoVegetation * 0.58);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.285, 0.275, 0.255), terrainPhotoStonyPatch * 0.22);

// Exposed rock receives broad mineral temperature variation and warped stratification. This is
// deliberately stronger than the old 9% tint because the full-world proof showed flat pale bands.
float terrainPhotoStrata = 0.5 + 0.5 * sin(
	vTerrainPhotorealWorldPosition.y * 0.205
	+ vTerrainPhotorealWorldPosition.x * 0.012
	- vTerrainPhotorealWorldPosition.z * 0.008
	+ terrainPhotoMacro * 3.4
);
vec3 terrainPhotoRockCool = vec3(0.255, 0.270, 0.275);
vec3 terrainPhotoRockWarm = vec3(0.315, 0.285, 0.252);
vec3 terrainPhotoRockDark = vec3(0.185, 0.190, 0.188);
vec3 terrainPhotoRockTone = mix(terrainPhotoRockCool, terrainPhotoRockWarm, terrainPhotoRegional);
terrainPhotoRockTone = mix(terrainPhotoRockTone, terrainPhotoRockDark, smoothstep(0.72, 0.94, terrainPhotoMoisture) * 0.32);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoRockTone, terrainPhotoRock * (0.20 + terrainPhotoElevation * 0.08));
diffuseColor.rgb *= 1.0 + terrainPhotoRock * (terrainPhotoStrata - 0.5) * 0.12;

// Snow remains bright enough to read as snow but no longer clips into featureless white. Wind-packed,
// dusty and blue-shadowed zones retain visible surface information at aerial and gameplay distance.
vec3 terrainPhotoSnowCold = vec3(0.665, 0.710, 0.735);
vec3 terrainPhotoSnowSun = vec3(0.805, 0.815, 0.805);
vec3 terrainPhotoSnowBase = mix(terrainPhotoSnowCold, terrainPhotoSnowSun, terrainPhotoRegional * 0.65 + terrainPhotoBroad * 0.35);
diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoSnowBase, terrainPhotoSnow * 0.24);
float terrainPhotoSnowShadow = terrainPhotoSnow * smoothstep(0.52, 0.84, 1.0 - terrainPhotoMeso);
float terrainPhotoSnowDust = terrainPhotoSnow * smoothstep(0.72, 0.90, terrainPhotoBroad) * smoothstep(0.68, 0.89, terrainPhotoGrain);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.535, 0.595, 0.625), terrainPhotoSnowShadow * 0.13);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.420, 0.410, 0.380), terrainPhotoSnowDust * 0.085);
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.010), vec3(0.86));`,
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
		regionalMoistureVariation: true,
		elevationWeathering: true,
		fractureNormals: true,
		renderOnly: true,
	});
	material.needsUpdate = true;
	return material;
}
