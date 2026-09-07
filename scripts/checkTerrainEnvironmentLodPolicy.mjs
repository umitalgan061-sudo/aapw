import assert from 'node:assert/strict';
import { TERRAIN_ENVIRONMENT_LOD_POLICY, ENVIRONMENT_LOD_FAMILIES, resolveEnvironmentLod, shouldCullEnvironment, instanceBatchKey, estimateEnvironmentBatchCost, validateLodPolicy } from '../src/3d/world/terrainEnvironmentLodPolicy.js';
assert.equal(validateLodPolicy().ok,true);assert.equal(TERRAIN_ENVIRONMENT_LOD_POLICY.placeholderAllowed,false);assert.equal(TERRAIN_ENVIRONMENT_LOD_POLICY.instancePreferred,true);
for(const [category,family] of Object.entries(ENVIRONMENT_LOD_FAMILIES)){assert.ok(family.levels.length>=3,category);for(let i=1;i<family.levels.length;i++)assert.ok(family.levels[i].maxDistance>family.levels[i-1].maxDistance,category);assert.ok(resolveEnvironmentLod(category,0).level===0);assert.ok(resolveEnvironmentLod(category,Number.MAX_SAFE_INTEGER).level===family.levels.length-1);}
assert.equal(shouldCullEnvironment('tree',2300),false);assert.equal(shouldCullEnvironment('tree',2301),true);assert.equal(shouldCullEnvironment('house',4300),false);assert.equal(shouldCullEnvironment('house',4301),true);
assert.equal(instanceBatchKey({assetId:'birch',materialKey:'bark',lod:2,season:'temperate-winter',substrate:'dampMoss'}),'birch|bark|lod:2|season:temperate-winter|substrate:dampMoss');
const cost=estimateEnvironmentBatchCost(100,5000,2);assert.equal(cost.instances,100);assert.equal(cost.triangles,500000);assert.equal(cost.drawCalls,2);assert.ok(cost.relativeGpuCost>0);
console.log(JSON.stringify({ok:true,families:Object.keys(ENVIRONMENT_LOD_FAMILIES).length}));
