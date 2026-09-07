/**
 * Audited visual-family manifest derived only from files present on exact origin/main.
 * This is metadata, not an alternate loader or placement implementation.
 */
const freeze=(v)=>Object.freeze(v);
export const TERRAIN_ENVIRONMENT_ASSET_MANIFEST=freeze([
 freeze({src:'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb',family:'tree',biomes:['forest','forest-edge','meadow'],materialSurfaces:['BirchTree_Bark','BirchTree_Leaves'],season:'temperate-winter',preferred:true}),
 freeze({src:'assets/models/vegetation/pine_Zt62gceKXZ.glb',family:'tree',biomes:['forest','highland','tundra-edge'],materialSurfaces:['foliage','bark'],season:'evergreen',preferred:true}),
 freeze({src:'assets/models/vegetation/pine_trees_oYtDty0fR6.glb',family:'tree',biomes:['forest','highland','tundra-edge'],materialSurfaces:['foliage','bark'],season:'evergreen',preferred:true}),
 freeze({src:'assets/models/vegetation/maple_trees_iGFtQd0PJO.glb',family:'tree',biomes:['forest','forest-edge','meadow'],materialSurfaces:['foliage','bark'],season:'temperate',preferred:true}),
 freeze({src:'assets/models/vegetation/tree_QVOop92WmG.glb',family:'tree',biomes:['meadow','forest-edge'],materialSurfaces:['foliage','bark'],season:'temperate',preferred:false}),
 freeze({src:'assets/models/vegetation/tree_VfZbAkek1r.glb',family:'tree',biomes:['meadow','forest-edge'],materialSurfaces:['foliage','bark'],season:'temperate',preferred:false}),
 freeze({src:'assets/models/vegetation/tree_aVOxaHRPWe.glb',family:'tree',biomes:['meadow','forest-edge'],materialSurfaces:['foliage','bark'],season:'temperate',preferred:false}),
 freeze({src:'assets/models/vegetation/tree_qZtx0AHhcy.glb',family:'tree',biomes:['meadow','forest-edge'],materialSurfaces:['foliage','bark'],season:'temperate',preferred:false}),
 freeze({src:'assets/models/vegetation/trees_etFGNvsiFv.glb',family:'tree-cluster',biomes:['forest'],materialSurfaces:['foliage','bark'],season:'temperate',preferred:false}),
 freeze({src:'assets/models/vegetation/twisted_tree_8oraKn9m0x.glb',family:'twisted-tree',biomes:['forest-edge','heath','rocky-upland'],materialSurfaces:['bark','foliage'],season:'temperate',preferred:true}),
 freeze({src:'assets/models/vegetation/twisted_tree_9aWlx82xUf.glb',family:'twisted-tree',biomes:['forest-edge','heath','rocky-upland'],materialSurfaces:['bark','foliage'],season:'temperate',preferred:true}),
 freeze({src:'assets/models/vegetation/twisted_tree_GVTsMmuzv7.glb',family:'twisted-tree',biomes:['forest-edge','heath','rocky-upland'],materialSurfaces:['bark','foliage'],season:'temperate',preferred:true}),
 freeze({src:'assets/models/vegetation/dead_tree_n8FhMgMldD.glb',family:'dead-tree',biomes:['tundra','highland','forest-edge'],materialSurfaces:['weathered-bark'],season:'winter',preferred:true}),
 freeze({src:'assets/models/vegetation/dead_trees_F5I0Q7TwO5.glb',family:'dead-tree-cluster',biomes:['tundra','highland','forest-edge'],materialSurfaces:['weathered-bark'],season:'winter',preferred:false}),
 freeze({src:'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',family:'snow-dead-tree',biomes:['tundra','alpine-bare'],materialSurfaces:['weathered-bark','snow'],season:'winter',preferred:true}),
 freeze({src:'assets/models/vegetation/winter_tree.glb',family:'winter-tree',biomes:['tundra','highland','forest-edge'],materialSurfaces:['bark','snow','foliage'],season:'winter',preferred:true}),
 freeze({src:'assets/models/vegetation/fall_tree_4GYen9Xm3Kj.glb',family:'tree',biomes:['temperate','heath','forest-edge'],materialSurfaces:['bark','foliage'],season:'autumn',preferred:false}),
 freeze({src:'assets/models/vegetation/grass_UGTOzcO3P2.glb',family:'grass',biomes:['meadow','wet-meadow','forest-edge'],materialSurfaces:['grass','ground'],season:'temperate',preferred:true}),
 freeze({src:'assets/models/vegetation/grass_ground_cover.fbx',family:'grass-ground-cover',biomes:['meadow','wet-meadow','forest-edge'],materialSurfaces:['grass','soil'],season:'temperate',preferred:true}),
 freeze({src:'assets/models/vegetation/flower_fern.glb',family:'fern',biomes:['forest','forest-edge','wet-meadow'],materialSurfaces:['leaf','stem'],season:'temperate',preferred:true}),
 freeze({src:'assets/models/vegetation/flower_meadow_short.glb',family:'flower',biomes:['meadow'],materialSurfaces:['flower','stem'],season:'temperate',preferred:true}),
 freeze({src:'assets/models/vegetation/flower_green_short.glb',family:'flower',biomes:['meadow','forest-edge'],materialSurfaces:['flower','stem'],season:'temperate',preferred:false}),
 freeze({src:'assets/models/vegetation/flower_brown_tall.glb',family:'flower',biomes:['heath','dry-upland'],materialSurfaces:['flower','stem'],season:'dry',preferred:false}),
 freeze({src:'assets/models/vegetation/flower_grass_tall.glb',family:'flower-grass',biomes:['meadow','heath'],materialSurfaces:['blade','stem'],season:'temperate',preferred:true}),
 freeze({src:'assets/models/vegetation/flower_pink_short.glb',family:'flower',biomes:['meadow','forest-edge'],materialSurfaces:['flower','stem'],season:'temperate',preferred:false}),
 freeze({src:'assets/models/vegetation/flower_purple_tall.glb',family:'flower',biomes:['meadow','forest-edge'],materialSurfaces:['flower','stem'],season:'temperate',preferred:false}),
 freeze({src:'assets/models/vegetation/flower_yellow_tall.glb',family:'flower',biomes:['meadow','forest-edge'],materialSurfaces:['flower','stem'],season:'temperate',preferred:false}),
 freeze({src:'assets/models/vegetation/palm_trees_VYslw9DEi6.glb',family:'palm',biomes:['warm-coast'],materialSurfaces:['foliage','trunk'],season:'warm',preferred:false}),
 freeze({src:'assets/models/vegetation/crops_Ro6K0Yg7mx.glb',family:'crop',biomes:['lowland','meadow','settlement-envelope'],materialSurfaces:['stem','leaf','crop-head'],season:'temperate',preferred:true}),
]);
export function assetManifestEntry(src){return TERRAIN_ENVIRONMENT_ASSET_MANIFEST.find((entry)=>entry.src===src)||null;}
export function assetsForBiome(biome){const key=String(biome??'').toLowerCase();return freeze(TERRAIN_ENVIRONMENT_ASSET_MANIFEST.filter((entry)=>entry.biomes.includes(key)));}
export function assetsForFamily(family){return freeze(TERRAIN_ENVIRONMENT_ASSET_MANIFEST.filter((entry)=>entry.family===family));}
export function preferredAssets(){return freeze(TERRAIN_ENVIRONMENT_ASSET_MANIFEST.filter((entry)=>entry.preferred));}
export function manifestValidation(){const errors=[];for(const entry of TERRAIN_ENVIRONMENT_ASSET_MANIFEST){if(!entry.src.startsWith('assets/models/'))errors.push(`invalid-source:${entry.src}`);if(!entry.materialSurfaces.length)errors.push(`missing-surfaces:${entry.src}`);if(!entry.biomes.length)errors.push(`missing-biomes:${entry.src}`);}return freeze({ok:errors.length===0,errors:freeze(errors),count:TERRAIN_ENVIRONMENT_ASSET_MANIFEST.length});}
