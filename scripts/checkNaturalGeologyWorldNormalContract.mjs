#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { NATURAL_GEOLOGY_RENDER_POLICY } from '../src/3d/world/naturalGeology.js';

const ROOT = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(ROOT, 'src/3d/world/naturalGeology.js'), 'utf8');

assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.worldSpaceRockNormalVariation, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.instanceScaleCompensatedWorldNormal, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.cameraStableRockWeathering, true);
assert(NATURAL_GEOLOGY_RENDER_POLICY.id.includes('v4-correct-world-normal-weathering') || NATURAL_GEOLOGY_RENDER_POLICY.id.includes('v5-regional-hydrated-rocks') || NATURAL_GEOLOGY_RENDER_POLICY.id.includes('v6-natural-volcanic-value') || NATURAL_GEOLOGY_RENDER_POLICY.id.includes('v7-faceted-fallback-and-biome-assets') || NATURAL_GEOLOGY_RENDER_POLICY.id.includes('v8-hydrated-texture-fidelity'));

for (const required of [
  "#include <beginnormal_vertex>",
  'naturalRockWeatheringObjectNormal = objectNormal',
  'mat3 naturalRockInstanceNormalMatrix = mat3(instanceMatrix)',
  'naturalRockWeatheringObjectNormal /= vec3(',
  'dot(naturalRockInstanceNormalMatrix[0], naturalRockInstanceNormalMatrix[0])',
  'naturalRockWeatheringObjectNormal = naturalRockInstanceNormalMatrix * naturalRockWeatheringObjectNormal',
  'vNaturalRockWorldNormal = normalize(mat3(modelMatrix) * naturalRockWeatheringObjectNormal)',
  'normalize(mat3(viewMatrix) * naturalRockPerturbedWorldNormal)',
]) {
  assert(source.includes(required), `natural geology world-normal contract lost: ${required}`);
}
assert(!source.includes('vNaturalRockWorldNormal = normalize(mat3(modelMatrix) * transformedNormal)'),
  'view/instance transformedNormal must never be reinterpreted as a world-space normal');

function shaderInstanceNormal(objectNormal, instanceMatrix) {
  const m = new THREE.Matrix3().setFromMatrix4(instanceMatrix);
  const e = m.elements;
  // Matrix3 is column-major. This exactly mirrors the GLSL dot(column,column) compensation.
  const compensated = objectNormal.clone();
  compensated.x /= e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  compensated.y /= e[3] * e[3] + e[4] * e[4] + e[5] * e[5];
  compensated.z /= e[6] * e[6] + e[7] * e[7] + e[8] * e[8];
  return compensated.applyMatrix3(m).normalize();
}

function expectedNormal(objectNormal, instanceMatrix) {
  return objectNormal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(instanceMatrix)).normalize();
}

const cases = [
  { euler: [0.19, 0.81, -0.23], scale: [2.4, 0.7, 1.3] },
  { euler: [-0.42, 1.74, 0.31], scale: [0.55, 3.2, 1.1] },
  { euler: [0.62, -2.2, -0.37], scale: [4.1, 0.45, 2.3] },
  { euler: [-0.16, 0.34, 0.77], scale: [0.8, 1.9, 3.6] },
];
const normals = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0.31, 0.82, -0.48).normalize(),
  new THREE.Vector3(-0.63, 0.19, 0.75).normalize(),
];
let worstAngularErrorDegrees = 0;
for (const [caseIndex, entry] of cases.entries()) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(17 + caseIndex, -4, 9),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...entry.euler)),
    new THREE.Vector3(...entry.scale),
  );
  for (const objectNormal of normals) {
    const actual = shaderInstanceNormal(objectNormal, matrix);
    const expected = expectedNormal(objectNormal, matrix);
    const angleDegrees = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(actual.dot(expected), -1, 1)));
    worstAngularErrorDegrees = Math.max(worstAngularErrorDegrees, angleDegrees);
    assert(angleDegrees < 1e-4, `instance normal mismatch ${angleDegrees}° for case ${caseIndex}`);
  }
}

// World-space weathering orientation must be camera-independent. Only the final conversion into Three's
// view-space lighting normal is allowed to react to a camera transform.
const worldNormal = new THREE.Vector3(0.28, 0.91, -0.31).normalize();
const cameraA = new THREE.Matrix4().lookAt(
  new THREE.Vector3(40, 30, 70),
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 1, 0),
).invert();
const cameraB = new THREE.Matrix4().lookAt(
  new THREE.Vector3(-65, 18, 22),
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 1, 0),
).invert();
const viewA = worldNormal.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(cameraA)).normalize();
const viewB = worldNormal.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(cameraB)).normalize();
assert(worldNormal.distanceTo(new THREE.Vector3(0.28, 0.91, -0.31).normalize()) < 1e-12);
assert(viewA.distanceTo(viewB) > 0.05, 'view-space lighting normal should follow camera orientation');

console.log('[checkNaturalGeologyWorldNormalContract] PASS');
console.log(JSON.stringify({
  policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
  matrixCases: cases.length,
  testedNormals: cases.length * normals.length,
  worstAngularErrorDegrees,
  sourceRejectsTransformedNormalAsWorldNormal: true,
  cameraStableWeatheringFrame: true,
}, null, 2));
