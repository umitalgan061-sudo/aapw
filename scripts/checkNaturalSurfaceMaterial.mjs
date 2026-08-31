#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  installNaturalSurfaceMaterial,
  NATURAL_SURFACE_MATERIAL_POLICY,
} from '../src/3d/world/naturalSurfaceMaterial.js';
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
assert.deepEqual(policy.valyriaMaterials, ['basalt', 'obsidian', 'ash', 'pumice', 'oxidation', 'sulfuric-weathering']);

function compileSource() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.91, metalness: 0 });
  installNaturalSurfaceMaterial(material);
  const shader = {
    vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\nvoid main(){\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n}',
  };
  material.onBeforeCompile(shader, {});
  assert.equal(material.userData.naturalSurfaceMaterial, policy);
  material.dispose();
  return shader;
}

const first = compileSource();
const second = compileSource();
assert.equal(first.vertexShader, second.vertexShader, 'vertex shader generation is not deterministic');
assert.equal(first.fragmentShader, second.fragmentShader, 'fragment shader generation is not deterministic');

for (const marker of [
  'naturalSurfaceOwnerUv',
  'naturalSurfaceValyriaInfluence',
  'naturalSurfaceCoolingFracture',
  'naturalSurfaceHighPass',
  'naturalSurfaceDarkRecovery',
  'naturalSurfaceIntertidalEnvelope',
  'naturalSurfaceRevisedVolcanicColor',
  'naturalSurfaceObsidian',
  'naturalSurfaceAsh',
  'naturalSurfacePumice',
  'naturalSurfaceOxidation',
  'naturalSurfaceSulfur',
  'naturalSurfaceRoughTarget',
  'naturalSurfacePerturbedWorldNormal',
]) assert(first.fragmentShader.includes(marker), `natural material shader lost ${marker}`);

assert(first.vertexShader.includes('modelMatrix * vec4(transformed, 1.0)'), 'world-space position varying disappeared');
assert(first.vertexShader.includes('mat3(modelMatrix) * objectNormal'), 'world-space normal varying disappeared');
assert(!first.vertexShader.includes('transformed +='), 'render-only material must not displace canonical terrain');
assert(!first.fragmentShader.includes('gl_FragDepth'), 'render-only material must not rewrite terrain depth');

console.log('[checkNaturalSurfaceMaterial] PASS: deterministic world-space Valyria PBR and all-world anti-airbrush/intertidal shading are render-only.');
