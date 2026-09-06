#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	WINTER_VEGETATION_ASSET_POLICY,
	applyWinterPineMaterialTreatment,
} from '../src/3d/world/winterVegetationAsset.js';

assert.equal(
	WINTER_VEGETATION_ASSET_POLICY.candidates[0],
	WINTER_VEGETATION_ASSET_POLICY.preferredSnowPineAsset,
	'textured singular pine must remain the first materialized snow-pine candidate',
);

const foliageTexture = new THREE.Texture();
const foliage = new THREE.MeshStandardMaterial({
	map: foliageTexture,
	transparent: true,
	roughness: 0.4,
	metalness: 0.4,
});
applyWinterPineMaterialTreatment(
	foliage,
	WINTER_VEGETATION_ASSET_POLICY.preferredSnowPineAsset,
);
assert.equal(foliage.userData.winterPineTreatment, 'snow-foliage-shader');
assert.equal(foliage.metalness, 0, 'winter foliage must not retain metallic source response');
assert(foliage.roughness >= WINTER_VEGETATION_ASSET_POLICY.pineFoliageMinRoughness);
assert.match(foliage.customProgramCacheKey(), /snow-foliage-v1/);

const shader = {
	fragmentShader: 'void main() {\n#include <map_fragment>\n}',
};
foliage.onBeforeCompile(shader, {});
assert.match(shader.fragmentShader, /winterFoliageLuma/,
	'winter foliage shader must preserve map sampling then derive a snow blend from visible texels');
assert.match(shader.fragmentShader, /winterSnowMix/);
assert.match(shader.fragmentShader, /winterNeedleShade/,
	'source foliage must retain a darker needle response beneath the snow coverage');
assert.match(shader.fragmentShader, /pineNeedleShadowStrength|0\.640/,
	'needle contrast must remain policy-controlled and deterministic');
assert.match(shader.fragmentShader, /smoothstep\(0\.38, 0\.78, winterFoliageLuma\)/,
	'snow coverage must reserve the strongest blend for genuinely bright authored texels');
assert.match(shader.fragmentShader, /diffuseColor\.rgb = mix/);
assert.match(shader.fragmentShader, /#include <map_fragment>/,
	'source texture/alpha map fragment must remain in the compiled shader');

const trunkTexture = new THREE.Texture();
const trunk = new THREE.MeshStandardMaterial({ map: trunkTexture, roughness: 0.65, metalness: 0.4 });
applyWinterPineMaterialTreatment(trunk, WINTER_VEGETATION_ASSET_POLICY.preferredSnowPineAsset);
assert.equal(trunk.userData.winterPineTreatment, 'winter-trunk-source-map');
assert.equal(trunk.metalness, 0);
assert(trunk.roughness >= WINTER_VEGETATION_ASSET_POLICY.pineFoliageMinRoughness);

const unrelated = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), transparent: true, metalness: 0.4 });
const originalCompile = unrelated.onBeforeCompile;
applyWinterPineMaterialTreatment(unrelated, WINTER_VEGETATION_ASSET_POLICY.bareWinterTreeAsset);
assert.equal(unrelated.userData.winterPineTreatment, undefined,
	'fallback bare winter tree must retain its authored material rather than receive pine snow treatment');
assert.equal(unrelated.metalness, 0.4);
assert.strictEqual(unrelated.onBeforeCompile, originalCompile);

foliage.dispose();
trunk.dispose();
unrelated.dispose();
foliageTexture.dispose();
trunkTexture.dispose();

console.log('[checkWinterPineMaterialTreatment] PASS', JSON.stringify({
	policy: WINTER_VEGETATION_ASSET_POLICY.id,
	preferred: WINTER_VEGETATION_ASSET_POLICY.preferredSnowPineAsset,
	snowColor: WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowColor,
	mix: [
		WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixMin,
		WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixMin + WINTER_VEGETATION_ASSET_POLICY.pineFoliageSnowMixRange,
	],
}));

