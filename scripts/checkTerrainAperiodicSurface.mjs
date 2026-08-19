#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ChunkManager } from '../src/3d/world/chunkManager.js';
import {
	applyTerrainAperiodicSurface,
	applyTerrainAperiodicSurfaceToMesh,
	installTerrainAperiodicSurface,
	TERRAIN_APERIODIC_SURFACE_POLICY,
} from '../src/3d/world/terrainAperiodicSurface.js';

const policy = TERRAIN_APERIODIC_SURFACE_POLICY;
assert.equal(policy.renderOnly, true);
assert(policy.macroScaleMeters > policy.mesoScaleMeters);
assert(policy.mesoScaleMeters > policy.fineScaleMeters);
assert(policy.macroScaleMeters / policy.mesoScaleMeters > 2.5);
assert(policy.mesoScaleMeters / policy.fineScaleMeters > 2.5);
assert.notEqual(policy.macroScaleMeters % 22, 0, 'macro breakup must not synchronize to legacy 22m period');
assert.notEqual(policy.mesoScaleMeters % 22, 0, 'meso breakup must not synchronize to legacy 22m period');
assert.notEqual(policy.fineScaleMeters, 22, 'fine breakup must not repeat the legacy micro period');
assert(policy.fadeStartMeters >= 500);
assert(policy.maxDistanceMeters > policy.fadeStartMeters);
assert(policy.albedoAmplitude > 0.05 && policy.albedoAmplitude < 0.2);
assert(policy.roughnessAmplitude > 0.03 && policy.roughnessAmplitude < 0.15);
assert(policy.normalContrastMin >= 0.3 && policy.normalContrastMin < 0.65);
assert.equal(policy.normalContrastMax, 1.0);

const material = new THREE.MeshStandardMaterial({ color: 0x7d8758, roughness: 0.94, metalness: 0 });
const originalCompile = material.onBeforeCompile;
applyTerrainAperiodicSurface(material);
assert.notEqual(material.onBeforeCompile, originalCompile);
assert.equal(material.userData.terrainAperiodicSurface.policyId, policy.id);
assert.equal(material.userData.terrainAperiodicSurface.renderOnly, true);
const firstCompile = material.onBeforeCompile;
applyTerrainAperiodicSurface(material);
assert.equal(material.onBeforeCompile, firstCompile, 'material install must be idempotent');
assert(material.customProgramCacheKey().includes(policy.id));

const shader = {
	vertexShader: `
void main() {
vec3 transformed = position;
#include <worldpos_vertex>
gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
	fragmentShader: `
void main() {
vec4 diffuseColor = vec4(1.0);
float roughnessFactor = 1.0;
vec3 normal = vec3(0.0, 1.0, 0.0);
vec3 nonPerturbedNormal = normal;
#include <color_fragment>
#include <roughnessmap_fragment>
#include <normal_fragment_maps>
gl_FragColor = diffuseColor;
}`,
};
material.onBeforeCompile(shader, {});
assert(shader.vertexShader.includes('vAapwTerrainWorldPosition'));
assert(shader.vertexShader.includes('modelMatrix * vec4(transformed, 1.0)'));
assert(shader.fragmentShader.includes('aapwTerrainSignal'));
assert(shader.fragmentShader.includes(`worldXZ / ${policy.macroScaleMeters.toFixed(1)}`));
assert(shader.fragmentShader.includes(`rotated / ${policy.mesoScaleMeters.toFixed(1)}`));
assert(shader.fragmentShader.includes(`skewed / ${policy.fineScaleMeters.toFixed(1)}`));
assert(shader.fragmentShader.includes('roughnessFactor = clamp'));
assert(shader.fragmentShader.includes('diffuseColor.rgb *= clamp'));
assert(shader.fragmentShader.includes('aapwNormalContrast'));
assert(shader.fragmentShader.includes('mix(nonPerturbedNormal, normal, aapwNormalContrast)'));
assert(!shader.fragmentShader.includes('mix(geometryNormal, normal, aapwNormalContrast)'), 'do not rely on removed Three.js geometryNormal symbol');
assert(shader.fragmentShader.includes(policy.normalContrastMin.toFixed(2)));
assert(shader.fragmentShader.includes(policy.normalContrastMax.toFixed(2)));
assert(shader.fragmentShader.includes(`smoothstep(${policy.fadeStartMeters.toFixed(1)}, ${policy.maxDistanceMeters.toFixed(1)}`));
assert(!shader.fragmentShader.includes('sin('), 'aperiodic breakup should use value noise, not obvious sinusoidal bands');
assert(!shader.fragmentShader.includes('cos('), 'aperiodic breakup should use value noise, not obvious sinusoidal bands');

const geometry = new THREE.PlaneGeometry(8, 8, 1, 1);
const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff }));
const positionBefore = Array.from(mesh.geometry.getAttribute('position').array);
applyTerrainAperiodicSurfaceToMesh(mesh);
assert.equal(mesh.userData.terrainAperiodicSurface.policyId, policy.id);
assert.deepEqual(Array.from(mesh.geometry.getAttribute('position').array), positionBefore, 'render adapter must not alter terrain geometry');

assert.equal(installTerrainAperiodicSurface(), false, 'module side effect must install only once');
const scene = new THREE.Scene();
const manager = new ChunkManager({ scene, chunkSizeMeters: 250, seed: 12345, flattenPads: [] });
const chunk = manager.loadChunk(0, 0);
assert.equal(chunk.userData.terrainAperiodicSurface.policyId, policy.id, 'real ChunkManager load must receive anti-tiling layer');
assert.equal(chunk.material.userData.terrainAperiodicSurface.policyId, policy.id);
assert.equal(scene.children.includes(chunk), true);
const samplerHeight = chunk.geometry.getAttribute('position').getY(0);
manager.loadChunk(0, 0);
assert.equal(chunk.geometry.getAttribute('position').getY(0), samplerHeight, 'repeat load must not mutate canonical geometry');

const neighbor = manager.loadChunk(1, 0);
assert.equal(neighbor.material.userData.terrainAperiodicSurface.policyId, policy.id);
assert.notEqual(neighbor.material, chunk.material, 'chunks retain their own material ownership');
assert.equal(neighbor.geometry.getAttribute('position').count, chunk.geometry.getAttribute('position').count);

manager.disposeAll();
geometry.dispose();
mesh.material.dispose();
material.dispose();
console.log('[checkTerrainAperiodicSurface] PASS: shipped ChunkManager terrain receives render-only multi-scale albedo/roughness and Three.js-compatible aperiodic micro-normal contrast without changing geometry/collider authority.');
