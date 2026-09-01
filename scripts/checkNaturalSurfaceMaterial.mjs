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
assert.equal(policy.valyriaMacroNormalEnergyBounded, true);
assert.equal(policy.valyriaMacroNormalBlendMax, 0.16);
assert.equal(policy.valyriaLinearWeatheringPatina, true);
assert.equal(policy.valyriaPatchyLithicExposure, true);
assert.equal(policy.valyriaLinearCarrierRoughnessResponse, true);
assert.equal(policy.lowlandSoilAggregateBreakup, true);
assert.equal(policy.definedRidgeDarkRecovery, true);
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
  'naturalSurfaceSoilAggregate',
  'naturalSurfaceDarkFacetBreakup',
  'naturalSurfaceIntertidalEnvelope',
  'naturalSurfaceRevisedVolcanicColor',
  'naturalSurfaceObsidian',
  'naturalSurfaceAsh',
  'naturalSurfacePumice',
  'naturalSurfaceOxidation',
  'naturalSurfaceSulfur',
  'naturalSurfaceRoughTarget',
  'naturalSurfaceLinearWeatheringPatina',
  'naturalSurfacePatchyLithicExposure',
  'naturalSurfaceRoughLinearPatina',
  'naturalSurfacePerturbedWorldNormal',
]) assert(first.fragmentShader.includes(marker), `natural material shader lost ${marker}`);

assert(first.vertexShader.includes('modelMatrix * vec4(transformed, 1.0)'), 'world-space position varying disappeared');
assert(first.vertexShader.includes('mat3(modelMatrix) * objectNormal'), 'world-space normal varying disappeared');
assert(!first.vertexShader.includes('transformed +='), 'render-only material must not displace canonical terrain');
assert(!first.fragmentShader.includes('gl_FragDepth'), 'render-only material must not rewrite terrain depth');
assert(first.fragmentShader.includes('naturalSurfaceLinearCarrier = clamp(naturalSurfaceDrainage * 0.58')
  && first.fragmentShader.includes('naturalSurfaceLinearWeatheringPatina * (0.36 + naturalSurfaceSlope * 0.16)')
  && first.fragmentShader.includes('naturalSurfaceRoughLinearPatina * 0.30'),
'Valyria carrier patina lost its patchy albedo/roughness response');
assert(first.fragmentShader.includes('1.0 - smoothstep(0.055, 0.18, naturalSurfaceLuma)')
  && !first.fragmentShader.includes('smoothstep(0.18, 0.055, naturalSurfaceLuma)'),
'ridge dark recovery returned to undefined reversed smoothstep');
assert(first.fragmentShader.includes('naturalSurfaceAggregateFrame')
  && first.fragmentShader.includes('naturalSurfaceSoilAggregate - 0.5')
  && first.fragmentShader.includes('naturalSurfaceAggregateMask * 0.115'),
'lowland soil/stone aggregate breakup lost its bounded render-only response');
assert(first.fragmentShader.includes('naturalSurfaceStructuralX * 0.58')
  && first.fragmentShader.includes('naturalSurfaceLavaX * 0.24')
  && first.fragmentShader.includes('naturalSurfaceNormalValyria * 0.16'),
'Valyria macro normal energy escaped its artifact-audited bound');

console.log('[checkNaturalSurfaceMaterial] PASS: deterministic world-space Valyria PBR and all-world anti-airbrush/intertidal shading are render-only.');
