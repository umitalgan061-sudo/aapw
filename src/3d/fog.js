/**
 * Distance fog plus render-only terrain surface bootstrap.
 *
 * Fog remains tied to the day/night cycle. The P2 terrain adapter lives here deliberately because
 * `fog.js` is already part of the shipped/offline 3D shell: adding a side-effect-only terrain module
 * previously left offline PWA boots with an uncached import. Height/collider/hydrology stay untouched.
 * @module fog
 */

import * as THREE from 'three';
import { ChunkManager } from './world/chunkManager.js';

export const TERRAIN_APERIODIC_SURFACE_POLICY = Object.freeze({
	id: 'terrain-aperiodic-macro-breakup-2026-08-19-v3',
	macroScaleMeters: 173,
	mesoScaleMeters: 61,
	fineScaleMeters: 19,
	albedoAmplitude: 0.115,
	roughnessAmplitude: 0.085,
	normalContrastMin: 0.42,
	normalContrastMax: 1.0,
	maxDistanceMeters: 1750,
	fadeStartMeters: 650,
	renderOnly: true,
	offlineShellIntegrated: true,
});

const INSTALL_FLAG = Symbol.for('aapw.terrainAperiodicSurface.install.v3');
const MATERIAL_FLAG = Symbol.for('aapw.terrainAperiodicSurface.material.v3');

function terrainVertexInjection(shader) {
	if (!shader.vertexShader.includes('#include <worldpos_vertex>')) {
		throw new Error('[terrainAperiodicSurface] Three.js worldpos vertex chunk missing');
	}
	shader.vertexShader = shader.vertexShader
		.replace('void main() {', 'varying vec3 vAapwTerrainWorldPosition;\nvoid main() {')
		.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvAapwTerrainWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
}

function terrainFragmentInjection(shader) {
	if (!shader.fragmentShader.includes('#include <roughnessmap_fragment>')) {
		throw new Error('[terrainAperiodicSurface] Three.js roughness fragment chunk missing');
	}
	if (!shader.fragmentShader.includes('#include <color_fragment>')) {
		throw new Error('[terrainAperiodicSurface] Three.js color fragment chunk missing');
	}

	shader.fragmentShader = shader.fragmentShader
		.replace('void main() {', `varying vec3 vAapwTerrainWorldPosition;
float aapwHash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float aapwValueNoise(vec2 p) {
	vec2 cell = floor(p);
	vec2 local = fract(p);
	vec2 smoothLocal = local * local * (3.0 - 2.0 * local);
	float a = aapwHash21(cell);
	float b = aapwHash21(cell + vec2(1.0, 0.0));
	float c = aapwHash21(cell + vec2(0.0, 1.0));
	float d = aapwHash21(cell + vec2(1.0, 1.0));
	return mix(mix(a, b, smoothLocal.x), mix(c, d, smoothLocal.x), smoothLocal.y);
}
float aapwTerrainSignal(vec2 worldXZ) {
	float macroNoise = aapwValueNoise(worldXZ / ${TERRAIN_APERIODIC_SURFACE_POLICY.macroScaleMeters.toFixed(1)});
	vec2 rotated = mat2(0.8192, -0.5735, 0.5735, 0.8192) * worldXZ;
	float mesoNoise = aapwValueNoise(rotated / ${TERRAIN_APERIODIC_SURFACE_POLICY.mesoScaleMeters.toFixed(1)} + vec2(19.7, -7.3));
	vec2 skewed = vec2(worldXZ.x + worldXZ.y * 0.271, worldXZ.y - worldXZ.x * 0.193);
	float fineNoise = aapwValueNoise(skewed / ${TERRAIN_APERIODIC_SURFACE_POLICY.fineScaleMeters.toFixed(1)} + vec2(-31.4, 12.8));
	return (macroNoise - 0.5) * 0.58 + (mesoNoise - 0.5) * 0.29 + (fineNoise - 0.5) * 0.13;
}
void main() {`)
		.replace('#include <color_fragment>', `#include <color_fragment>
	float aapwTerrainDistance = length(vAapwTerrainWorldPosition.xz - cameraPosition.xz);
	float aapwTerrainFade = 1.0 - smoothstep(${TERRAIN_APERIODIC_SURFACE_POLICY.fadeStartMeters.toFixed(1)}, ${TERRAIN_APERIODIC_SURFACE_POLICY.maxDistanceMeters.toFixed(1)}, aapwTerrainDistance);
	float aapwTerrainBreakup = aapwTerrainSignal(vAapwTerrainWorldPosition.xz) * aapwTerrainFade;
	float aapwAlbedoGain = 1.0 + aapwTerrainBreakup * ${TERRAIN_APERIODIC_SURFACE_POLICY.albedoAmplitude.toFixed(3)};
	diffuseColor.rgb *= clamp(aapwAlbedoGain, 0.84, 1.16);`)
		.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
	roughnessFactor = clamp(roughnessFactor + aapwTerrainBreakup * ${TERRAIN_APERIODIC_SURFACE_POLICY.roughnessAmplitude.toFixed(3)}, 0.58, 1.0);`);

	if (shader.fragmentShader.includes('#include <normal_fragment_maps>')) {
		shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	float aapwNormalWeight = smoothstep(-0.10, 0.10, aapwTerrainBreakup);
	float aapwNormalContrast = mix(${TERRAIN_APERIODIC_SURFACE_POLICY.normalContrastMin.toFixed(2)}, ${TERRAIN_APERIODIC_SURFACE_POLICY.normalContrastMax.toFixed(2)}, aapwNormalWeight);
	normal = normalize(mix(nonPerturbedNormal, normal, aapwNormalContrast));`);
	}
}

export function applyTerrainAperiodicSurface(material) {
	if (!material?.isMeshStandardMaterial) throw new TypeError('aperiodic terrain surface requires MeshStandardMaterial');
	if (material[MATERIAL_FLAG]) return material;
	const previousCompile = material.onBeforeCompile;
	material.onBeforeCompile = (shader, renderer) => {
		if (typeof previousCompile === 'function') previousCompile.call(material, shader, renderer);
		terrainVertexInjection(shader);
		terrainFragmentInjection(shader);
	};
	const previousProgramKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : 'standard'}|${TERRAIN_APERIODIC_SURFACE_POLICY.id}`;
	material.userData.terrainAperiodicSurface = Object.freeze({ ...TERRAIN_APERIODIC_SURFACE_POLICY, policyId: TERRAIN_APERIODIC_SURFACE_POLICY.id });
	Object.defineProperty(material, MATERIAL_FLAG, { value: true });
	material.needsUpdate = true;
	return material;
}

export function applyTerrainAperiodicSurfaceToMesh(mesh) {
	if (!mesh?.material) throw new TypeError('terrain mesh with material is required');
	if (Array.isArray(mesh.material)) throw new TypeError('terrain mesh must use one material');
	applyTerrainAperiodicSurface(mesh.material);
	mesh.userData.terrainAperiodicSurface = Object.freeze({ policyId: TERRAIN_APERIODIC_SURFACE_POLICY.id, renderOnly: true });
	return mesh;
}

export function installTerrainAperiodicSurface() {
	if (ChunkManager.prototype[INSTALL_FLAG]) return false;
	const previousLoadChunk = ChunkManager.prototype.loadChunk;
	ChunkManager.prototype.loadChunk = function loadChunkWithAperiodicSurface(chunkX, chunkZ) {
		const mesh = previousLoadChunk.call(this, chunkX, chunkZ);
		applyTerrainAperiodicSurfaceToMesh(mesh);
		return mesh;
	};
	Object.defineProperty(ChunkManager.prototype, INSTALL_FLAG, { value: true });
	return true;
}

installTerrainAperiodicSurface();

const FOG_DENSITY_DAY = 0.0004;
const FOG_DENSITY_NIGHT = 0.00055;

export function createFog() {
	return new THREE.FogExp2(0x000000, FOG_DENSITY_DAY);
}

export function updateFog(fog, dayNight) {
	fog.color.copy(dayNight.horizonColor);
	fog.density = FOG_DENSITY_DAY + (FOG_DENSITY_NIGHT - FOG_DENSITY_DAY) * dayNight.nightFactor;
}
