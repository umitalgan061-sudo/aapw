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
assert.equal(policy.renderOnly, true);
assert.equal(policy.deterministic, true);
assert.equal(policy.canonicalHeightUnchanged, true);
assert.equal(policy.canonicalHydrologyUnchanged, true);
assert.equal(policy.canonicalColliderUnchanged, true);
assert.equal(policy.canonicalCoastlineUnchanged, true);
assert.equal(policy.newGeographyIntroduced, false);
assert.equal(policy.valyriaAuthorityPolicyId, VALYRIA_GEOLOGY_POLICY.id);
assert.equal(policy.allWorldMacroNormalVariation, true);
assert.equal(policy.allWorldMacroRoughnessVariation, true);
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
	'naturalSurfaceAllWorldRelief',
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
	'naturalSurfaceAllWorldPerturbedNormal',
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

console.log('[checkNaturalSurfaceMaterial] PASS: combined terrain shader keeps canonical geography and adds deterministic all-world macro normal/roughness plus Valyria volcanic PBR.');
