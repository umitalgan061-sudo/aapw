#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedMapToWorldXZ } from '../src/3d/world/worldReferenceMap.js';
import {
  WINTER_VEGETATION_ASSET_POLICY,
  applyWinterPineMaterialTreatment,
  buildWinterPineClimateInstanceValues,
  winterPineClimateSnowFactorAtWorldXZ,
} from '../src/3d/world/winterVegetationAsset.js';

const toWorld = (x, y) => normalizedMapToWorldXZ(
  x,
  y,
  WORLD_SCALE.MAP_BOUNDS,
  WORLD_SCALE.METERS_PER_MAP_UNIT,
);

const deepWinterWorld = toWorld(0.145, 0.115);
const temperateWorld = toWorld(0.145, 0.56);
const deepWinter = winterPineClimateSnowFactorAtWorldXZ(deepWinterWorld.x, deepWinterWorld.z);
const temperate = winterPineClimateSnowFactorAtWorldXZ(temperateWorld.x, temperateWorld.z);

assert(deepWinter.permanentIce > 0.95, 'Always Winter centre must retain canonical permanent ice');
assert(deepWinter.snowFactor > 0.95, 'Always Winter centre must drive near-maximum model snow treatment');
assert.equal(temperate.snowFactor, 0, 'temperate reference ground must not receive cryosphere snow gain');

let transition = null;
for (let step = 0; step <= 220; step += 1) {
  const normalizedY = 0.115 + (0.56 - 0.115) * (step / 220);
  const point = toWorld(0.145, normalizedY);
  const sample = winterPineClimateSnowFactorAtWorldXZ(point.x, point.z);
  if (sample.snowFactor > 0.2 && sample.snowFactor < 0.8) {
    transition = { normalizedY, point, sample };
    break;
  }
}
assert(transition, 'canonical north field must expose a mixed snow-treatment transition');
assert(deepWinter.snowFactor > transition.sample.snowFactor, 'deep winter model must be snowier than transition model');
assert(transition.sample.snowFactor > temperate.snowFactor, 'transition model must be snowier than temperate model');
assert.equal(
  winterPineClimateSnowFactorAtWorldXZ(transition.point.x, transition.point.z).snowFactor,
  transition.sample.snowFactor,
  'climate material response must be deterministic',
);

const sourceGeometry = new THREE.BoxGeometry(1, 1, 1);
const sourceMaterial = new THREE.MeshBasicMaterial();
const source = new THREE.InstancedMesh(sourceGeometry, sourceMaterial, 3);
source.name = WINTER_VEGETATION_ASSET_POLICY.proceduralTrunkName;
const parent = new THREE.Group();
parent.position.set(73, 0, -41);
parent.add(source);

const targets = [deepWinterWorld, transition.point, temperateWorld];
const matrix = new THREE.Matrix4();
for (let index = 0; index < targets.length; index += 1) {
  matrix.makeTranslation(
    targets[index].x - parent.position.x,
    0,
    targets[index].z - parent.position.z,
  );
  source.setMatrixAt(index, matrix);
}
source.instanceMatrix.needsUpdate = true;
parent.updateMatrixWorld(true);

const instanceClimate = buildWinterPineClimateInstanceValues(source);
assert.equal(instanceClimate.length, 3, 'one climate scalar is required per existing snow-pine instance');
assert(Math.abs(instanceClimate[0] - deepWinter.snowFactor) < 1e-6, 'instance climate must consume translated world position');
assert(Math.abs(instanceClimate[1] - transition.sample.snowFactor) < 1e-6, 'transition instance climate mismatch');
assert(Math.abs(instanceClimate[2] - temperate.snowFactor) < 1e-6, 'temperate instance climate mismatch');
assert(instanceClimate[0] > instanceClimate[1] && instanceClimate[1] > instanceClimate[2], 'instance climate must preserve geographic snow gradient');

const sourceMap = new THREE.Texture();
const foliage = new THREE.MeshStandardMaterial({ map: sourceMap, transparent: true, roughness: 0.4 });
applyWinterPineMaterialTreatment(
  foliage,
  WINTER_VEGETATION_ASSET_POLICY.preferredSnowPineAsset,
);
assert.equal(foliage.map, sourceMap, 'geographic snow treatment must preserve the real GLB source map');
assert.equal(foliage.userData.winterPineTreatment, 'snow-foliage-shader');
assert(foliage.roughness >= WINTER_VEGETATION_ASSET_POLICY.pineFoliageMinRoughness);

const shader = {
  vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
  fragmentShader: [
    '#include <common>',
    'void main() {',
    '#include <map_fragment>',
    '#include <normal_fragment_maps>',
    '#include <roughnessmap_fragment>',
    '}',
  ].join('\n'),
};
foliage.onBeforeCompile(shader, {});
for (const needle of [
  'attribute float winterPineClimate;',
  'varying float vWinterPineClimate;',
  'vWinterPineClimate = winterPineClimate;',
  'winterClimateSnowMultiplier',
  WINTER_VEGETATION_ASSET_POLICY.pineFoliageClimateSnowMixMinMultiplier.toFixed(3),
  WINTER_VEGETATION_ASSET_POLICY.pineFoliageClimateSnowMixMaxMultiplier.toFixed(3),
]) {
  assert(shader.vertexShader.includes(needle) || shader.fragmentShader.includes(needle), `shader missing climate material contract: ${needle}`);
}
assert(foliage.customProgramCacheKey().includes('snow-foliage-v2'), 'shader cache key must advance for climate-aware material');

sourceGeometry.dispose();
sourceMaterial.dispose();
sourceMap.dispose();
foliage.dispose();

console.log('[checkWinterPineClimateMaterial] PASS', JSON.stringify({
  policyId: WINTER_VEGETATION_ASSET_POLICY.id,
  deepWinterSnowFactor: Number(deepWinter.snowFactor.toFixed(4)),
  transitionSnowFactor: Number(transition.sample.snowFactor.toFixed(4)),
  transitionNormalizedY: Number(transition.normalizedY.toFixed(4)),
  temperateSnowFactor: Number(temperate.snowFactor.toFixed(4)),
  instanceValues: Array.from(instanceClimate, (value) => Number(value.toFixed(4))),
}));
