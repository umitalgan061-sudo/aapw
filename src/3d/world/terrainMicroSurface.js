/**
 * Render-only photoreal micro/macro terrain surface layer.
 *
 * Canonical owner-map height, water classification, shoreline masks and colliders are untouched.
 * This module owns only material response and deterministic world-space detail maps. The shader is
 * deliberately facies-driven: lowland soil, meadow, heath, alluvial deposits, stone lag, scree,
 * rock, intertidal wetting, salt spray and cryogenic grain receive separate bounded responses.
 *
 * @module world/terrainMicroSurface
 */

import * as THREE from 'three';
import { TERRAIN_FACIES_POLICY, TERRAIN_FACIES_NAMES, installTerrainSurfaceFacies } from './terrainSurfaceFacies.js';
import { TERRAIN_TRANSITION_POLICY, installTerrainTransitionField } from './terrainSurfaceTransitionField.js';
import { TERRAIN_ROCK_FABRIC_POLICY, installTerrainRockFabric } from './terrainSurfaceRockFabric.js';
import { TERRAIN_LOWINLAND_FABRIC_POLICY, installTerrainLowlandFabric } from './terrainSurfaceLowlandFabric.js';
import { TERRAIN_CRYOSPHERE_POLICY, installTerrainCryosphere } from './terrainSurfaceCryosphere.js';
import { WORLD_DEFAULTS } from '../config.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
	const t = clamp01((value - a) / Math.max(1e-9, b - a));
	return t * t * (3 - 2 * t);
};

export const TERRAIN_MICRO_SURFACE_POLICY = Object.freeze({
	id: 'terrain-micro-surface-world-uv-pbr-v7-coastal-weathering',
	textureSize: 256,
	detailRepeatMeters: 22,
	normalStrength: 0.98,
	normalSlopeGain: 5.15,
	roughnessBase: 0.91,
	roughnessMin: 0.48,
	roughnessMax: 0.99,
	uvChannel: 1,
	maxAnisotropy: 8,
	macroColorBreakup: true,
	worldSpaceMacroScaleMeters: Object.freeze([38, 92, 240, 620, 1450, 3200]),
	photorealDesaturation: true,
	naturalAlbedoRemap: true,
	regionalMoistureVariation: true,
	elevationWeathering: true,
	fractureNormals: true,
	ecologicalMosaic: true,
	drainageBreakup: true,
	nonPeriodicRockWeathering: true,
	multiScaleAerialContrast: true,
	aerialLowlandLithologyContrast: true,
	aerialDepositionalDomains: true,
	lowlandMesoNormalRecovery: true,
	lowlandGeomorphicRoughness: true,	lowlandNormalScaleMeters: Object.freeze([18, 54, 128, 260]),
	snowScourReadability: true,
	snowGranularAlbedo: true,
	snowMicroNormal: true,
	snowRoughnessVariation: true,	snowSurfaceScaleMeters: Object.freeze([2.6, 11, 34]),
	slopeAwareCliffWeathering: true,	erosionRunnels: true,
	screeAprons: true,
	coastalDampness: true,
	coastalIntertidalBreakup: true,
	coastalSaltSprayWeathering: true,
	coastalRoughnessResponse: true,
	aspectWeathering: true,
	roughnessResponse: true,	terrainSurfaceFaciesPolicyId: TERRAIN_FACIES_POLICY.id,
	terrainTransitionPolicyId: TERRAIN_TRANSITION_POLICY.id,
	terrainRockFabricPolicyId: TERRAIN_ROCK_FABRIC_POLICY.id,
	terrainLowlandFabricPolicyId: TERRAIN_LOWINLAND_FABRIC_POLICY.id,
	terrainCryospherePolicyId: TERRAIN_CRYOSPHERE_POLICY.id,
	renderOnly: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalColliderUnchanged: true,
	canonicalCoastlineUnchanged: true,
	newGeographyIntroduced: false,
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
	return (value >>> 0) / 4294967296;
}

function noise2D(x, y, seed) {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const ux = fx * fx * (3 - 2 * fx);
	const uy = fy * fy * (3 - 2 * fy);
	const a = hash2D(ix, iy, seed);
	const b = hash2D(ix + 1, iy, seed);
	const c = hash2D(ix, iy + 1, seed);
	const d = hash2D(ix + 1, iy + 1, seed);
	return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

function fbm2D(x, y, seed) {
	let total = 0;
	let weight = 0;
	let amplitude = 0.52;
	for (let octave = 0; octave < 5; octave += 1) {
		total += noise2D(x, y, seed + octave * 131) * amplitude;
		weight += amplitude;
		x = x * 2.03 + 17.1;
		y = y * 2.03 - 9.7;
		amplitude *= 0.49;
	}
	return total / weight;
}

function buildDetailField(size) {
	const field = new Float32Array(size * size);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const u = x / size;
			const v = y / size;
			const broad = fbm2D(u, v, 0x51a7);
			const grain = fbm2D(u + 0.173, v + 0.619, 0x91e3);
			const pits = fbm2D(u + 0.731, v + 0.283, 0xb42d);
			const fractures = (1 - smoothstep(0.10, 0.22, Math.abs(Math.sin((u * 9 + v * 5 + broad) * Math.PI * 2)))) * 0.16;
			field[y * size + x] = (broad - 0.5) * 0.46 + (grain - 0.5) * 0.28 + (pits - 0.5) * 0.12 - fractures;
		}
	}
	return field;
}

function wrappedSample(field, size, x, y) {
	return field[((y + size) % size) * size + ((x + size) % size)];
}

function buildNormalData(field, size) {
	const data = new Uint8Array(size * size * 4);
	const gain = TERRAIN_MICRO_SURFACE_POLICY.normalSlopeGain;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const dx = (wrappedSample(field, size, x + 1, y) - wrappedSample(field, size, x - 1, y)) * gain;
			const dy = (wrappedSample(field, size, x, y + 1) - wrappedSample(field, size, x, y - 1)) * gain;
			const inv = 1 / Math.hypot(dx, dy, 1);
			const offset = (y * size + x) * 4;
			data[offset] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
			data[offset + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
			data[offset + 2] = Math.round((inv * 0.5 + 0.5) * 255);
			data[offset + 3] = 255;
		}
	}
	return data;
}

function buildRoughnessData(field, size) {
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const center = wrappedSample(field, size, x, y);
			const dx = Math.abs(wrappedSample(field, size, x + 1, y) - wrappedSample(field, size, x - 1, y));
			const dy = Math.abs(wrappedSample(field, size, x, y + 1) - wrappedSample(field, size, x, y - 1));
			const relief = Math.hypot(dx, dy);
			const grain = clamp01(0.44 + center * 0.35 + relief * 1.45);
			const roughness = lerp(TERRAIN_MICRO_SURFACE_POLICY.roughnessMin, TERRAIN_MICRO_SURFACE_POLICY.roughnessMax, grain);
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

function configureDataTexture(texture, name) {
	texture.name = name;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
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
	const field = buildDetailField(size);
	const normalMap = configureDataTexture(
		new THREE.DataTexture(buildNormalData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-normal-v7-coastal-weathering',
	);
	const roughnessMap = configureDataTexture(
		new THREE.DataTexture(buildRoughnessData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-roughness-v7-coastal-weathering',
	);
	sharedTerrainMicroSurface = Object.freeze({ normalMap, roughnessMap });
	return sharedTerrainMicroSurface;
}

const TERRAIN_PHOTOREAL_SHADER_KEY = 'terrain-photoreal-world-surface-v7-coastal-weathering-facies-v1';
const WATER_LEVEL_GLSL = Number(WORLD_DEFAULTS.WATER_LEVEL_METERS).toFixed(3);

function installBaseTerrainShader(material) {
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPhotorealWorldPosition;\nvarying vec3 vTerrainPhotorealWorldNormal;')
			.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTerrainPhotorealWorldNormal=normalize(mat3(modelMatrix)*objectNormal);')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPhotorealWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vTerrainPhotorealWorldPosition;\nvarying vec3 vTerrainPhotorealWorldNormal;\nfloat terrainPhotoHash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}\nfloat terrainPhotoNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float a=terrainPhotoHash(i),b=terrainPhotoHash(i+vec2(1,0)),c=terrainPhotoHash(i+vec2(0,1)),d=terrainPhotoHash(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}\nfloat terrainPhotoFbm(vec2 p){float v=0.,w=0.,a=.55;for(int i=0;i<4;i++){v+=terrainPhotoNoise(p)*a;w+=a;p=p*2.03+vec2(17.1,-9.7);a*=.48;}return v/w;}\nfloat terrainPhotoRidge(vec2 p){return 1.-abs(terrainPhotoFbm(p)*2.-1.);}`);
		shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\nvec2 terrainPhotoXZ=vTerrainPhotorealWorldPosition.xz;\nfloat terrainPhotoHeight=vTerrainPhotorealWorldPosition.y;\nvec3 terrainPhotoNormal=normalize(vTerrainPhotorealWorldNormal);\nfloat terrainPhotoSlope=1.-clamp(abs(terrainPhotoNormal.y),0.,1.);\nfloat terrainPhotoVegetation=smoothstep(.004,.085,diffuseColor.g-max(diffuseColor.r,diffuseColor.b));\nfloat terrainPhotoLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));\nfloat terrainPhotoChroma=max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b))-min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b));\nfloat terrainPhotoSnow=smoothstep(.58,.88,terrainPhotoLuma)*(1.-smoothstep(.08,.24,terrainPhotoChroma));\nfloat terrainPhotoRegional=terrainPhotoFbm(terrainPhotoXZ/5200.+vec2(11.7,-4.1));\nfloat terrainPhotoBroad=terrainPhotoFbm(terrainPhotoXZ/2100.+vec2(-5.9,8.6));\nfloat terrainPhotoMacro=terrainPhotoFbm(terrainPhotoXZ/820.+vec2(-7.3,14.9));\nfloat terrainPhotoMeso=terrainPhotoFbm(terrainPhotoXZ/230.+vec2(23.8,3.6));\nfloat terrainPhotoGrain=terrainPhotoNoise(terrainPhotoXZ/58.+vec2(5.4,-18.2));\nfloat terrainPhotoMoisture=clamp(.52+(.5-terrainPhotoRegional)*.42+(.5-terrainPhotoBroad)*.32+(.5-terrainPhotoMeso)*.14,0.,1.);\nfloat terrainPhotoCoast=1.-smoothstep(1.2,28.,terrainPhotoHeight-${WATER_LEVEL_GLSL});\nfloat terrainPhotoTide=1.-smoothstep(.25,5.2,terrainPhotoHeight-${WATER_LEVEL_GLSL});\nfloat terrainPhotoSalt=terrainPhotoCoast*(1.-terrainPhotoTide*.7)*smoothstep(.5,.84,terrainPhotoGrain);\nfloat terrainPhotoAlluvial=terrainPhotoCoast*smoothstep(.44,.82,terrainPhotoMoisture)*(1.-terrainPhotoSlope*.7)*(.38+terrainPhotoRidge(terrainPhotoXZ/155.+vec2(4.2,-8.1))*.62);\nfloat terrainPhotoDry=terrainPhotoSlope*(1.-terrainPhotoSnow)*smoothstep(.48,.82,1.-terrainPhotoMoisture)*terrainPhotoRidge(terrainPhotoXZ/112.+vec2(-6.7,12.2));\nfloat terrainPhotoRock=terrainPhotoSlope*(1.-terrainPhotoVegetation*.6)*(1.-terrainPhotoSnow);\nfloat terrainPhotoScree=smoothstep(.25,.7,terrainPhotoSlope)*smoothstep(170.,520.,terrainPhotoHeight)*(1.-terrainPhotoSnow)*terrainPhotoRidge(terrainPhotoXZ/74.+vec2(9.2,-13.4));\nfloat terrainPhotoSnowCrust=terrainPhotoSnow*(0.58+terrainPhotoRidge(terrainPhotoXZ/34.+vec2(14.2,5.6))*.42);\nfloat terrainPhotoHighPass=clamp((terrainPhotoMacro-terrainPhotoBroad)*.62+(terrainPhotoMeso-terrainPhotoMacro)*.31,-.4,.4);\ndiffuseColor.rgb*=.90+(terrainPhotoRegional-.5)*.20+(terrainPhotoBroad-.5)*.15+(terrainPhotoMacro-.5)*.11+(terrainPhotoMeso-.5)*.055+terrainPhotoHighPass*.12;\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.07,.095,.052),terrainPhotoVegetation*terrainPhotoMoisture*.11);\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.27,.24,.19),terrainPhotoAlluvial*.17);\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.31,.25,.15),terrainPhotoDry*.15);\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.33,.33,.31),(terrainPhotoRock*.15+terrainPhotoScree*.18));\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.12,.13,.12),terrainPhotoTide*.12);\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.33,.33,.31),terrainPhotoSalt*.065);\nvec3 terrainPhotoSnowTone=mix(vec3(.64,.69,.72),vec3(.79,.80,.80),terrainPhotoRegional*.6+terrainPhotoGrain*.4);\ndiffuseColor.rgb=mix(diffuseColor.rgb,terrainPhotoSnowTone,terrainPhotoSnowCrust*.20);\ndiffuseColor.rgb*=1.+terrainPhotoSnow*(terrainPhotoGrain-.5)*.06;\ndiffuseColor.rgb=clamp(diffuseColor.rgb,vec3(.01),vec3(.88));`);
		shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nfloat terrainPhotoWet=terrainPhotoTide*.07+terrainPhotoAlluvial*.045+terrainPhotoCoast*.025;\nfloat terrainPhotoAggregate=terrainPhotoRock*.07+terrainPhotoScree*.08+abs(terrainPhotoHighPass)*.045;\nfloat terrainPhotoSnowRough=terrainPhotoSnow*((terrainPhotoGrain-.5)*.08+(terrainPhotoRidge(terrainPhotoXZ/11.+vec2(-18.7,41.2))-.5)*.06);\nroughnessFactor=clamp(roughnessFactor+terrainPhotoAggregate+terrainPhotoSnowRough-terrainPhotoWet+terrainPhotoSalt*.055,0.48,1.0);`);
		shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nfloat terrainPhotoN0=terrainPhotoNoise(terrainPhotoXZ/19.+vec2(7.1,-4.2));\nfloat terrainPhotoN1=terrainPhotoNoise(terrainPhotoXZ/19.+vec2(7.7,-3.6));\nfloat terrainPhotoR0=terrainPhotoRidge(terrainPhotoXZ/128.+vec2(9.2,-12.4));\nvec2 terrainPhotoGradient=vec2(terrainPhotoN1-terrainPhotoN0,terrainPhotoR0-.5);\nfloat terrainPhotoNormalMask=(terrainPhotoRock*.48+terrainPhotoScree*.38+terrainPhotoDry*.22+terrainPhotoAlluvial*.08+terrainPhotoSnowCrust*.15);\nnormal=normalize(normal+mat3(viewMatrix)*vec3(-terrainPhotoGradient.x,0.,-terrainPhotoGradient.y)*terrainPhotoNormalMask*.11);`);
	};
	const previousProgramKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : ''}|${TERRAIN_PHOTOREAL_SHADER_KEY}`;
}

export function applyTerrainMicroSurface(material) {
	if (!material?.isMeshStandardMaterial) throw new TypeError('terrain micro-surface requires MeshStandardMaterial');
	const surface = getSharedTerrainMicroSurfaceTextures();
	material.normalMap = surface.normalMap;
	material.normalMapType = THREE.TangentSpaceNormalMap;
	material.normalScale.setScalar(TERRAIN_MICRO_SURFACE_POLICY.normalStrength);
	material.roughnessMap = surface.roughnessMap;
	material.roughness = TERRAIN_MICRO_SURFACE_POLICY.roughnessBase;
	installBaseTerrainShader(material);
	installTerrainSurfaceFacies(material);
	installTerrainTransitionField(material);
	installTerrainRockFabric(material);
	installTerrainLowlandFabric(material);
	installTerrainCryosphere(material);
	material.userData.terrainMicroSurface = Object.freeze({
		policyId: TERRAIN_MICRO_SURFACE_POLICY.id,
		detailRepeatMeters: TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters,
		uvChannel: TERRAIN_MICRO_SURFACE_POLICY.uvChannel,
		macroColorBreakup: true,
		photorealDesaturation: true,
		naturalAlbedoRemap: true,
		regionalMoistureVariation: true,
		elevationWeathering: true,
		fractureNormals: true,
		ecologicalMosaic: true,
		drainageBreakup: true,
		nonPeriodicRockWeathering: true,
		multiScaleAerialContrast: true,
		aerialLowlandLithologyContrast: true,
		aerialDepositionalDomains: true,
		lowlandMesoNormalRecovery: true,
		lowlandGeomorphicRoughness: true,
		snowScourReadability: true,
		snowGranularAlbedo: true,
		snowMicroNormal: true,
		snowRoughnessVariation: true,
		snowSurfaceScaleMeters: Object.freeze([2.6, 11, 34]),
		slopeAwareCliffWeathering: true,
		erosionRunnels: true,
		screeAprons: true,
		coastalDampness: true,
		coastalIntertidalBreakup: true,
		coastalSaltSprayWeathering: true,
		coastalRoughnessResponse: true,
		aspectWeathering: true,
		roughnessResponse: true,
		terrainSurfaceFaciesPolicyId: TERRAIN_FACIES_POLICY.id,
		terrainSurfaceFaciesNames: TERRAIN_FACIES_NAMES,
		terrainSurfaceTransitionPolicyId: TERRAIN_TRANSITION_POLICY.id,
		terrainRockFabricPolicyId: TERRAIN_ROCK_FABRIC_POLICY.id,
		terrainLowlandFabricPolicyId: TERRAIN_LOWINLAND_FABRIC_POLICY.id,
		terrainCryospherePolicyId: TERRAIN_CRYOSPHERE_POLICY.id,
		terrainCryosphereWindPackedSnow: true,
		terrainCryosphereSastrugi: true,
		terrainCryosphereScourVsDeposition: true,
		canonicalHeightUnchanged: true,
		canonicalHydrologyUnchanged: true,
		canonicalColliderUnchanged: true,
		canonicalCoastlineUnchanged: true,
		newGeographyIntroduced: false,
		renderOnly: true,
	});
	material.needsUpdate = true;
	return material;
}
