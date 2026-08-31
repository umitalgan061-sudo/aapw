#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	installNaturalSurfaceMaterial,
	NATURAL_SURFACE_MATERIAL_POLICY,
} from '../src/3d/world/naturalSurfaceMaterial.js';
import {
	applyTerrainMicroSurface,
	TERRAIN_MICRO_SURFACE_POLICY,
} from '../src/3d/world/terrainMicroSurface.js';
import { VALYRIA_GEOLOGY_POLICY } from '../src/3d/world/valyriaGeology.js';

const policy = NATURAL_SURFACE_MATERIAL_POLICY;
for (const flag of [
	'renderOnly', 'deterministic', 'canonicalHeightUnchanged', 'canonicalHydrologyUnchanged',
	'canonicalColliderUnchanged', 'canonicalCoastlineUnchanged', 'allWorldMacroNormalVariation',
	'allWorldMacroRoughnessVariation', 'worldScaleLowlandReadability', 'worldScaleSnowFirnReadability',
	'anisotropicErosionFabric', 'cliffWeatheringStreaks', 'cryosphereFirnSastrugi', 'coastalStrandlineBreakup',
]) assert.equal(policy[flag], true, `${flag} must remain enabled`);
assert.equal(policy.newGeographyIntroduced, false);
assert.equal(policy.valyriaAuthorityPolicyId, VALYRIA_GEOLOGY_POLICY.id);
assert.deepEqual(policy.valyriaMaterials, ['basalt', 'obsidian', 'ash', 'pumice', 'oxidation', 'sulfuric-weathering']);

function shaderSkeleton() {
	return {
		vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
		fragmentShader: '#include <common>\nvoid main(){\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n}',
	};
}

function compileInstaller(installer) {
	const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.91, metalness: 0 });
	installer(material);
	const shader = shaderSkeleton();
	material.onBeforeCompile(shader, {});
	material.dispose();
	return shader;
}

const directFirst = compileInstaller(installNaturalSurfaceMaterial);
const directSecond = compileInstaller(installNaturalSurfaceMaterial);
assert.equal(directFirst.vertexShader, directSecond.vertexShader, 'natural surface vertex shader generation is not deterministic');
assert.equal(directFirst.fragmentShader, directSecond.fragmentShader, 'natural surface fragment shader generation is not deterministic');

const combinedFirst = compileInstaller(applyTerrainMicroSurface);
const combinedSecond = compileInstaller(applyTerrainMicroSurface);
assert.equal(combinedFirst.vertexShader, combinedSecond.vertexShader, 'combined terrain vertex shader generation is not deterministic');
assert.equal(combinedFirst.fragmentShader, combinedSecond.fragmentShader, 'combined terrain fragment shader generation is not deterministic');

for (const marker of [
	'naturalSurfaceOwnerUv',
	'naturalSurfaceValyriaInfluence',
	'naturalSurfaceCoolingFracture',
	'naturalSurfaceLavaFlowFabric',
	'naturalSurfaceAllWorldRelief',
	'naturalSurfaceErosionFabric',
	'naturalSurfaceCryosphereFabric',
	'naturalSurfaceLowlandMacroTone',
	'naturalSurfaceSnowReadability',
	'naturalSurfaceErodedSoil',
	'naturalSurfaceDepositionalSoil',
	'naturalSurfaceCliffStreak',
	'naturalSurfaceFirn',
	'naturalSurfaceWindScour',
	'naturalSurfaceStrandBreakup',
	'naturalSurfaceHighPass',
	'naturalSurfaceDarkRecovery',
	'naturalSurfaceIntertidalEnvelope',
	'naturalSurfaceBasaltColor',
	'naturalSurfaceObsidian',
	'naturalSurfaceAsh',
	'naturalSurfacePumice',
	'naturalSurfaceOxidation',
	'naturalSurfaceSulfur',
	'naturalSurfaceWorldRoughTarget',
	'naturalSurfaceCliffWeatheredRough',
	'naturalSurfaceAllWorldPerturbedNormal',
	'naturalSurfaceSnowWorldNormal',
	'naturalSurfacePerturbedWorldNormal',
]) {
	assert(combinedFirst.fragmentShader.includes(marker), `combined terrain shader lost ${marker}`);
}

for (const marker of [
	'terrainPhotoRegional',
	'terrainPhotoLandform',
	'terrainPhotoRunnel',
	'terrainPhotoScreeBand',
	'terrainPhotoCoastalWet',
]) {
	assert(combinedFirst.fragmentShader.includes(marker), `existing terrain photoreal layer lost ${marker}`);
}

assert(combinedFirst.vertexShader.includes('modelMatrix * vec4(transformed, 1.0)'), 'world-space position varying disappeared');
assert(combinedFirst.vertexShader.includes('mat3(modelMatrix) * objectNormal'), 'world-space normal varying disappeared');
assert(!combinedFirst.vertexShader.includes('transformed +='), 'render-only material must not displace canonical terrain');
assert(!combinedFirst.fragmentShader.includes('gl_FragDepth'), 'render-only material must not rewrite terrain depth');
assert.equal(TERRAIN_MICRO_SURFACE_POLICY.renderOnly, true);

console.log('[checkNaturalSurfaceMaterial] PASS: canonical geography retained with deterministic world-scale lowland, erosion, cliff, cryosphere, coast and Valyria PBR fabric.');