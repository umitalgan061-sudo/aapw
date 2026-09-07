import assert from 'node:assert/strict';
import { TERRAIN_ENVIRONMENT_ASSET_MANIFEST,assetManifestEntry,assetsForBiome,assetsForFamily,preferredAssets,manifestValidation } from '../src/3d/world/terrainEnvironmentAssetManifest.js';
assert.equal(manifestValidation().ok,true);
assert.ok(TERRAIN_ENVIRONMENT_ASSET_MANIFEST.length>=25);
for(const entry of TERRAIN_ENVIRONMENT_ASSET_MANIFEST){assert.ok(entry.src.startsWith('assets/models/'));assert.ok(entry.materialSurfaces.length>0);assert.ok(entry.biomes.length>0);assert.ok(typeof entry.preferred==='boolean');assert.ok(entry.season);}
const direct=['assets/models/vegetation/birch_trees_R7qMWzb7nk.glb','assets/models/vegetation/pine_Zt62gceKXZ.glb','assets/models/vegetation/pine_trees_oYtDty0fR6.glb','assets/models/vegetation/maple_trees_iGFtQd0PJO.glb','assets/models/vegetation/grass_UGTOzcO3P2.glb','assets/models/vegetation/grass_ground_cover.fbx','assets/models/vegetation/flower_fern.glb','assets/models/vegetation/crops_Ro6K0Yg7mx.glb'];
for(const src of direct)assert.equal(assetManifestEntry(src)?.src,src);
const forest=assetsForBiome('forest');const meadow=assetsForBiome('meadow');const tundra=assetsForBiome('tundra');
assert.ok(forest.length>0&&meadow.length>0&&tundra.length>0);
assert.ok(forest.every((entry)=>entry.biomes.includes('forest')));assert.ok(tundra.every((entry)=>entry.biomes.includes('tundra')));
assert.ok(assetsForFamily('tree').length>=5);assert.ok(assetsForFamily('flower').length>=4);assert.ok(preferredAssets().length>8);
const winter=TERRAIN_ENVIRONMENT_ASSET_MANIFEST.filter((entry)=>entry.season==='winter');assert.ok(winter.some((entry)=>entry.src.includes('dead')));assert.ok(winter.some((entry)=>entry.src.includes('winter_tree')));
const forbiddenPalm=assetsForBiome('forest').filter((entry)=>entry.family==='palm');assert.equal(forbiddenPalm.length,0);
console.log(JSON.stringify({ok:true,count:TERRAIN_ENVIRONMENT_ASSET_MANIFEST.length,forest:forest.length,meadow:meadow.length,tundra:tundra.length,winter:winter.length}));
