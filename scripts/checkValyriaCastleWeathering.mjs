#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  VALYRIA_CASTLE_WEATHERING_POLICY,
  applyValyriaCastleWeathering,
} from '../src/3d/world/valyriaCastleWeathering.js';

const ROOT = resolve(import.meta.dirname, '..');
const settlementsSource = readFileSync(resolve(ROOT, 'src/3d/world/settlements.js'), 'utf8');
const weatheringSource = readFileSync(resolve(ROOT, 'src/3d/world/valyriaCastleWeathering.js'), 'utf8');
const P = VALYRIA_CASTLE_WEATHERING_POLICY;

assert.equal(P.renderOnly, true);
assert.equal(P.geographyAuthorityUnchanged, true);
assert.equal(P.terrainHeightAuthorityUnchanged, true);
assert.equal(P.colliderAuthorityUnchanged, true);
assert.equal(P.settlementFootprintUnchanged, true);
assert.equal(P.deterministic, true);
assert.equal(P.targetSeatId, 'umit');
assert(P.baseStoneHex > 0 && P.baseStoneHex <= 0xffffff);
assert(P.basaltMixMax > P.basaltMixMin);
assert(P.fissureEmissiveMax > 0 && P.fissureEmissiveMax <= 0.15);

for (const snippet of [
  "from './valyriaCastleWeathering.js'",
  'VALYRIA_CASTLE_WEATHERING_POLICY.baseStoneHex',
  'applyValyriaCastleWeathering(stoneMaterial',
  'seatId: assignment.seatId',
  'groundY: seat.groundY',
  'footprintMeters: footprint',
  'seed: seed + 2 + index',
]) {
  assert(settlementsSource.includes(snippet), `Valyria fortress runtime wiring lost: ${snippet}`);
}

// The real walled-city GLB is deliberately shared with Xaro, so the contract must be seat-based rather
// than filename-based. Otherwise weathering the shared model would turn Qarth into Valyria too.
const umitAssignment = settlementsSource.match(/seatId: 'umit'[^\n]+/u)?.[0] ?? '';
const xaroAssignment = settlementsSource.match(/seatId: 'Xaro'[^\n]+/u)?.[0] ?? '';
assert(umitAssignment.includes('walled_city_fortress_decimated.glb'));
assert(umitAssignment.includes('VALYRIA_CASTLE_WEATHERING_POLICY.baseStoneHex'));
assert(xaroAssignment.includes('walled_city_fortress_decimated.glb'));
assert(!xaroAssignment.includes('VALYRIA_CASTLE_WEATHERING_POLICY'), 'Xaro inherited Valyria base stone');

for (const snippet of [
  'renderOnly: true',
  "targetSeatId: 'umit'",
  'worldSpace: true',
  'multiScale: true',
  'basalt: true',
  'ash: true',
  'soot: true',
  'sparseThermalFissures: true',
  'vValyriaCastleWorldPosition',
  'valyriaCastleMacro',
  'valyriaCastleMeso',
  'valyriaCastleFine',
  'valyriaCastleFissure',
  'totalEmissiveRadiance',
]) {
  assert(weatheringSource.includes(snippet), `Valyria castle weathering source contract lost: ${snippet}`);
}
assert(!weatheringSource.includes('Math.random()'), 'castle weathering must remain deterministic');
assert(!weatheringSource.includes('setFromObject'), 'weathering must not mutate castle geometry/footprint');
assert(!weatheringSource.includes('position.set('), 'weathering must not move settlement geometry');

function fakeMaterial() {
  return {
    userData: {},
    needsUpdate: false,
    onBeforeCompile: null,
    customProgramCacheKey: () => 'stone-base',
  };
}

const xaro = fakeMaterial();
const xaroBeforeCompile = xaro.onBeforeCompile;
const xaroResult = applyValyriaCastleWeathering(xaro, {
  seatId: 'Xaro',
  groundY: 120,
  footprintMeters: 50,
  seed: 1337,
});
assert.equal(xaroResult, xaro);
assert.equal(xaro.onBeforeCompile, xaroBeforeCompile, 'non-Valyria seat shader was modified');
assert.equal(xaro.userData.valyriaCastleWeathering, undefined);
assert.equal(xaro.needsUpdate, false);

const umit = fakeMaterial();
const returned = applyValyriaCastleWeathering(umit, {
  seatId: 'umit',
  groundY: 146.25,
  footprintMeters: 46,
  seed: 7331,
});
assert.equal(returned, umit);
assert.equal(umit.needsUpdate, true);
assert.equal(umit.userData.valyriaCastleWeathering.active, true);
assert.equal(umit.userData.valyriaCastleWeathering.policyId, P.id);
assert.equal(umit.userData.valyriaCastleWeathering.seatId, 'umit');
assert.equal(umit.userData.valyriaCastleWeathering.renderOnly, true);
assert.equal(umit.userData.valyriaCastleWeathering.worldSpace, true);
assert.equal(umit.userData.valyriaCastleWeathering.groundY, 146.25);
assert.equal(umit.userData.valyriaCastleWeathering.footprintMeters, 46);
assert.equal(typeof umit.onBeforeCompile, 'function');
assert(umit.customProgramCacheKey().includes(P.id));
assert(umit.customProgramCacheKey().includes('umit'));

// Running twice must be idempotent: no nested shader transforms and no program-key growth.
const hook = umit.onBeforeCompile;
const key = umit.customProgramCacheKey();
applyValyriaCastleWeathering(umit, {
  seatId: 'umit',
  groundY: 999,
  footprintMeters: 99,
  seed: 999,
});
assert.equal(umit.onBeforeCompile, hook);
assert.equal(umit.customProgramCacheKey(), key);
assert.equal(umit.userData.valyriaCastleWeathering.groundY, 146.25);

const shader = {
  uniforms: {},
  vertexShader: `
#include <common>
void main() {
  vec3 transformed = vec3(0.0);
  mat4 modelMatrix = mat4(1.0);
  #include <worldpos_vertex>
}`,
  fragmentShader: `
#include <common>
void main() {
  vec4 diffuseColor = vec4(1.0);
  float roughnessFactor = 0.8;
  vec3 totalEmissiveRadiance = vec3(0.0);
  #include <color_fragment>
  #include <roughnessmap_fragment>
  #include <emissivemap_fragment>
}`,
};
umit.onBeforeCompile(shader, null);

assert.equal(shader.uniforms.uValyriaCastleGroundY.value, 146.25);
assert.equal(shader.uniforms.uValyriaCastleHeightScale.value, 46 * 1.18);
assert.equal(shader.uniforms.uValyriaCastleSeed.value.length, 2);
for (const snippet of [
  'varying vec3 vValyriaCastleWorldPosition',
  'vec4 valyriaCastleWorldPosition = vec4(transformed, 1.0)',
  'valyriaCastleWorldPosition = modelMatrix * valyriaCastleWorldPosition',
  'vValyriaCastleWorldPosition = valyriaCastleWorldPosition.xyz',
]) {
  assert(shader.vertexShader.includes(snippet), `vertex shader injection lost: ${snippet}`);
}
assert(!shader.vertexShader.includes('vValyriaCastleWorldPosition = worldPosition.xyz'), 'weathering must not depend on conditional Three.js worldPosition');
for (const snippet of [
  'valyriaCastleHash',
  'valyriaCastleNoise',
  'valyriaCastleFbm',
  'valyriaCastleBasalt',
  'valyriaCastleAsh',
  'valyriaCastleSoot',
  'valyriaCastleFissure',
  'roughnessFactor = clamp',
  'totalEmissiveRadiance +=',
]) {
  assert(shader.fragmentShader.includes(snippet), `fragment shader injection lost: ${snippet}`);
}

console.log('[checkValyriaCastleWeathering] PASS');
console.log(JSON.stringify({
  policyId: P.id,
  targetSeatId: P.targetSeatId,
  baseStoneHex: `0x${P.baseStoneHex.toString(16).padStart(6, '0')}`,
  sharedAssetIsolation: true,
  runtimeFactoryWired: true,
  shaderInjection: {
    basalt: true,
    ash: true,
    soot: true,
    sparseThermalFissures: true,
    unconditionalWorldPosition: true,
  },
  geometryAuthorityUnchanged: true,
}, null, 2));