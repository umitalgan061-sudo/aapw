import assert from 'node:assert/strict';
import {
  applyWorldAssetSurfaceFabric,
  isWorldAssetSurfaceFabricInstalled,
  surfaceFabricResponseHint,
  WORLD_ASSET_SURFACE_FABRIC_POLICY,
} from '../src/3d/materials/worldAssetSurfaceFabric.js';

function makeMaterial() {
  return {
    userData: {},
    onBeforeCompile: null,
    customProgramCacheKey: null,
    needsUpdate: false,
  };
}

function makeShader() {
  return {
    vertexShader: [
      '#include <common>',
      '#include <beginnormal_vertex>',
      '#include <begin_vertex>',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      '#include <color_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <normal_fragment_maps>',
    ].join('\n'),
  };
}

const material = makeMaterial();
applyWorldAssetSurfaceFabric(material, {
  family: 'granite',
  surface: 'rock',
  variant: 'G77-outer-ridge-03',
});

assert.equal(material.userData.worldAssetSurfaceFabric.policyId, WORLD_ASSET_SURFACE_FABRIC_POLICY.id);
assert.equal(material.userData.worldAssetSurfaceFabric.worldSpace, true);
assert.equal(material.userData.worldAssetSurfaceFabric.renderOnly, true);
assert.equal(isWorldAssetSurfaceFabricInstalled(material), true);
assert.equal(material.needsUpdate, true);
assert.equal(typeof material.customProgramCacheKey(), 'string');

const shader = makeShader();
material.onBeforeCompile(shader, {});
assert.match(shader.vertexShader, /vWorldAssetFabricPosition/);
assert.match(shader.vertexShader, /vWorldAssetFabricNormal/);
assert.match(shader.vertexShader, /USE_INSTANCING/);
assert.match(shader.fragmentShader, /worldAssetFabricFbm/);
assert.match(shader.fragmentShader, /worldAssetFabricRoughnessNoise/);
assert.match(shader.fragmentShader, /worldAssetFabricNormalStrength/);
assert.match(shader.fragmentShader, /WORLD_ASSET_SURFACE/);

const rockHint = surfaceFabricResponseHint({ family: 'rock', slope: 62, moisture: 0.55 });
const snowHint = surfaceFabricResponseHint({ family: 'snow', slope: 18, moisture: 0.78 });
assert.equal(rockHint.preferredRoughnessResponse, 'rock-fracture-high');
assert.equal(snowHint.preferredRoughnessResponse, 'snow-pack-softened');
assert.ok(rockHint.weathering > 0);
assert.ok(snowHint.weathering > 0);

const second = makeMaterial();
applyWorldAssetSurfaceFabric(second, { family: 'rock', surface: 'rock', variant: 'G77-outer-ridge-03' });
assert.equal(second.customProgramCacheKey(), material.customProgramCacheKey());

const third = makeMaterial();
applyWorldAssetSurfaceFabric(third, { family: 'rock', surface: 'rock', variant: 'G77-outer-ridge-04' });
assert.notEqual(third.customProgramCacheKey(), material.customProgramCacheKey());

console.log('World asset surface fabric contract: PASS');
