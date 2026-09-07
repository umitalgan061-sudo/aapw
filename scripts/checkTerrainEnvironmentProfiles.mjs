import assert from 'node:assert/strict';
import { TERRAIN_ENVIRONMENT_PROFILE_POLICY,TERRAIN_ENVIRONMENT_ASSET_PROFILES,resolveTerrainEnvironmentProfile,environmentSurfaceScore,validateTerrainEnvironmentPlacement,deterministicAssetTransform,makeEnvironmentAssetManifest } from '../src/3d/world/terrainEnvironmentProfiles.js';
assert.equal(TERRAIN_ENVIRONMENT_PROFILE_POLICY.editorRuntimeImportAllowed,false);
assert.equal(TERRAIN_ENVIRONMENT_PROFILE_POLICY.proceduralPlaceholderAllowed,false);
const categories=['tree','shrub','grass','rock','cliff','scree','snow-patch','house','bridge'];
for(const category of categories){const p=resolveTerrainEnvironmentProfile(category);assert.ok(p,category);assert.equal(p.category,category);assert.ok(p.allowedBiomes.length>0||category==='bridge');assert.ok(p.maxSlopeDegrees>=p.minSlopeDegrees);assert.ok(p.scale.max>=p.scale.min);assert.ok(p.requiredSurfaces.length>0);assert.ok(p.lod.maxVisibleMeters>0);}
const aliasChecks=[['trees','tree'],['vegetation','tree'],['rocks','rock'],['boulder','rock'],['cliffs','cliff'],['building','house'],['buildings','house']];
for(const [alias,expected] of aliasChecks)assert.equal(resolveTerrainEnvironmentProfile(alias)?.category,expected);
for(const p of Object.values(TERRAIN_ENVIRONMENT_ASSET_PROFILES)){const good={slopeDegrees:p.minSlopeDegrees,heightMeters:Math.max(p.minHeightMeters,1),moisture:.58,waterDepth:0,biome:p.allowedBiomes[0]==='any-dry'?'':p.allowedBiomes[0]};assert.equal(validateTerrainEnvironmentPlacement(p,good).ok,true);}
const tree=resolveTerrainEnvironmentProfile('tree');
assert.equal(validateTerrainEnvironmentPlacement(tree,{slopeDegrees:40,heightMeters:30,moisture:.5,waterDepth:0,biome:'meadow'}).ok,false);
assert.equal(validateTerrainEnvironmentPlacement(tree,{slopeDegrees:5,heightMeters:30,moisture:.5,waterDepth:1,biome:'meadow'}).ok,false);
assert.equal(environmentSurfaceScore(tree,{slopeDegrees:8,heightMeters:30,moisture:.6,waterDepth:0,biome:'meadow',roadDistance:20})>0,true);
assert.equal(environmentSurfaceScore(tree,{slopeDegrees:8,heightMeters:30,moisture:.6,waterDepth:0,biome:'ocean',roadDistance:20}),0);
const t1=deterministicAssetTransform(12345,9,tree),t2=deterministicAssetTransform(12345,9,tree),t3=deterministicAssetTransform(12345,10,tree);assert.deepEqual(t1,t2);assert.notDeepEqual(t1,t3);
const manifest=makeEnvironmentAssetManifest({asset:{id:'x',category:'tree',src:'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb'},profile:tree,sample:{slopeDegrees:8,heightMeters:30,biome:'meadow',waterDepth:0},transform:t1});assert.equal(manifest.acceptance.placeholderAllowed,false);assert.equal(manifest.acceptance.editorRuntimeImportAllowed,false);assert.equal(manifest.profile.category,'tree');
console.log(JSON.stringify({ok:true,categories:categories.length,policy:TERRAIN_ENVIRONMENT_PROFILE_POLICY.id}));
