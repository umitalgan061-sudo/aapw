import { TERRAIN_SURFACE_FABRIC_POLICY, buildTerrainSurfaceManifest, terrainSurfaceReliefContext, terrainSurfaceColorMultiplier, terrainSurfaceRoughness, terrainSurfaceNormalGain, chooseTerrainSubstrate } from './terrainSurfaceFabric.js';
import { TERRAIN_ENVIRONMENT_PROFILE_POLICY, resolveTerrainEnvironmentProfile, environmentSurfaceScore, validateTerrainEnvironmentPlacement, deterministicAssetTransform, makeEnvironmentAssetManifest } from './terrainEnvironmentProfiles.js';
import { ENVIRONMENT_ASSET_REGISTRY_POLICY, findVerifiedEnvironmentAsset, selectVerifiedEnvironmentCandidates, environmentAssetPlacementPlan, validateVerifiedEnvironmentAsset, deterministicEnvironmentSeed } from './terrainEnvironmentAssetRegistry.js';
import { buildSpatialDistributionManifest, ecotoneComposition } from './terrainEnvironmentSpatialPolicy.js';
import { buildEnvironmentMaterialRecipe, validateEnvironmentMaterialRecipe, buildMaterialManifest } from './terrainEnvironmentMaterialDirector.js';
import { scoreEnvironmentAssetGeography, explainAssetGeographyDecision } from './terrainEnvironmentAssetGeographyMatrix.js';
import { environmentPointCandidate } from './terrainEnvironmentDistributionPlanner.js';
import { climateExposureEnvelope, climateMaterialFamily } from './terrainEnvironmentClimateTransitions.js';
import { geologyResponseAtWorld, geologyPlacementEnvelope } from './terrainEnvironmentGeologyResponse.js';
import { seasonalEnvironmentResponse } from './terrainEnvironmentSeasonalGeography.js';

const freeze = (v) => Object.freeze(v);

export const TERRAIN_ENVIRONMENT_CONTRACT = freeze({
  id:'buzul-muhafizi-terrain-environment-contract-2026-09-08-v4',
  sequence:freeze(['asset-hydrate','surface-analysis','geography-score','material-recipe','material-validation','climate-response','geology-response','seasonal-response','distribution-decision','ground-transform','placement-manifest','scene-attach']),
  canonicalAuthorities:freeze({height:'src/3d/world/terrain.js',hydrology:'map/Pindex hydrology',material:'src/3d/materials/MaterialAssignmentCore.js',placement:'src/3d/world/WorldAssetPlacementPipeline.js'}),
  forbiddenShortcuts:freeze(['procedural-placeholder','editor-runtime-import','attach-before-material-validation','attach-before-ground-validation','visual-fabric-modifies-height','visual-fabric-modifies-hydrology','uniform-grid-distribution','asset-source-invention','geology-source-invention']),
});

export function analyzeTerrainSurfaceForEnvironment(sample={}) {
  const context=terrainSurfaceReliefContext(sample);
  return freeze({contractId:TERRAIN_ENVIRONMENT_CONTRACT.id,substrate:chooseTerrainSubstrate(context),context,response:freeze({colorMultiplier:terrainSurfaceColorMultiplier(context),roughness:terrainSurfaceRoughness(context),normalGain:terrainSurfaceNormalGain(context)}),manifest:buildTerrainSurfaceManifest({sample,materialPolicyId:TERRAIN_SURFACE_FABRIC_POLICY.id,sourceMapPolicyId:sample.sourceMapPolicyId??null})});
}

export function queryTerrainEnvironmentAssetFamily(category,context={}) {
  const profile=resolveTerrainEnvironmentProfile(category,context.metadata??{});
  return freeze({contractId:TERRAIN_ENVIRONMENT_CONTRACT.id,category:profile?.category??null,profile,requirement:environmentAssetPlacementPlan({},{category}),candidates:selectVerifiedEnvironmentCandidates(category,{biome:context.biome,winter:Boolean(context.winter),context:context.context})});
}

export function prepareTerrainEnvironmentAssetContext(asset,{category=asset?.category,worldX=0,worldZ=0,seedOrdinal=0,biome='',climate='',winter=false,sample={}}={}) {
  const profile=resolveTerrainEnvironmentProfile(category,asset??{});
  const registryAsset=asset?.src||asset?.id?findVerifiedEnvironmentAsset(asset.src??asset.id):null;
  const chosen=registryAsset??asset??null;
  const validation=validateVerifiedEnvironmentAsset(chosen,{category,sample});
  const placementValidation=validateTerrainEnvironmentPlacement(profile,sample);
  const surfaceScore=environmentSurfaceScore(profile,{slopeDegrees:sample.slopeDegrees??sample.slope,heightMeters:sample.heightMeters??sample.height,moisture:sample.moisture,waterDepth:sample.waterDepth,biome:sample.biome,roadDistance:sample.roadDistance,settlementDistance:sample.settlementDistance});
  const deterministicSeed=deterministicEnvironmentSeed(chosen?.id??category,worldX,worldZ);
  const transform=deterministicAssetTransform(deterministicSeed,seedOrdinal,profile);
  const plan=environmentAssetPlacementPlan(chosen??{},{category,worldX,worldZ,biome,climate,winter,sample});
  const spatial=buildSpatialDistributionManifest({category,seed:deterministicSeed,worldX,worldZ,sample});
  const climateEnvelope=climateExposureEnvelope({biome,temperatureC:sample.temperatureC,moisture:sample.moisture,windExposure:sample.windExposure,elevationMeters:sample.heightAboveSeaMeters??sample.heightMeters,slopeDegrees:sample.slopeDegrees});
  const climateFamily=climateMaterialFamily(category,sample);
  const geography=chosen?scoreEnvironmentAssetGeography(chosen,sample):freeze({accepted:false,score:0,reasons:['missing-asset']});
  const materialRecipe=chosen?buildEnvironmentMaterialRecipe({asset:chosen,category,biome,season:sample.season??'summer',winter,context:climate,sample}):null;
  const materialValidation=validateEnvironmentMaterialRecipe(materialRecipe);
  const geology = ['rock','cliff','scree'].includes(String(category).toLowerCase()) ? geologyResponseAtWorld({worldX,worldZ,sample}) : null;
  const geologyEnvelope = geology ? geologyPlacementEnvelope({worldX,worldZ,sample,category}) : null;
  const seasonal = seasonalEnvironmentResponse({season:sample.season??'summer',biome,climate,category,sample});
  return freeze({contractId:TERRAIN_ENVIRONMENT_CONTRACT.id,asset:chosen,profile,registry:freeze({verified:Boolean(registryAsset),validation}),surface:freeze({score:surfaceScore,validation:placementValidation,analysis:analyzeTerrainSurfaceForEnvironment({...sample,worldX,worldZ})}),transform,plan,spatial,climate:freeze({family:climateFamily,envelope:climateEnvelope}),geography,material:freeze({recipe:materialRecipe,validation:materialValidation}),geology:freeze({response:geology,envelope:geologyEnvelope}),seasonal,attachAllowed:Boolean(chosen&&registryAsset&&validation.ok&&placementValidation.ok&&surfaceScore>0&&geography.accepted&&materialValidation.ok&&plan.material?.required&&plan.placement?.groundRequired&&plan.placement?.manifestRequired)});
}

export function buildTerrainEnvironmentProductionPlan(asset,{category=asset?.category,worldX=0,worldZ=0,seedOrdinal=0,biome='',climate='',winter=false,sample={},distanceMeters=0,visibility=1}={}) {
  const context=prepareTerrainEnvironmentAssetContext(asset,{category,worldX,worldZ,seedOrdinal,biome,climate,winter,sample});
  const distribution=environmentPointCandidate({category,worldX,worldZ,seed:context.plan?.deterministicSeed??seedOrdinal,ordinal:seedOrdinal,distanceMeters,visibility,sample});
  const attach=assertTerrainEnvironmentAttachReady(context);
  return freeze({contractId:TERRAIN_ENVIRONMENT_CONTRACT.id,context,distribution,materialManifest:context.material?.recipe?buildMaterialManifest(context.material.recipe):null,geographyDecision:context.asset?explainAssetGeographyDecision(context.asset,sample):null,attach});
}

export function finalizeTerrainEnvironmentManifest(context,{materialManifest=null,placementManifest=null}={}) {
  if(!context||typeof context!=='object') return null;
  return makeEnvironmentAssetManifest({asset:context.asset??{},profile:context.profile??null,sample:context.surface?.analysis?.context??{},transform:context.transform??null,materialManifest,placementManifest});
}

export function assertTerrainEnvironmentAttachReady(context) {
  const errors=[];
  if(!context?.asset)errors.push('missing-asset');
  if(!context?.registry?.verified)errors.push('asset-not-verified');
  if(!context?.registry?.validation?.ok)errors.push('asset-validation-failed');
  if(!context?.surface?.validation?.ok)errors.push('surface-placement-failed');
  if(!(context?.surface?.score>0))errors.push('surface-score-zero');
  if(!(context?.geography?.accepted))errors.push('geography-rejected');
  if(!context?.material?.validation?.ok)errors.push('material-contract-invalid');
  if(!context?.plan?.material?.required)errors.push('material-contract-missing');
  if(!context?.plan?.placement?.authority)errors.push('placement-authority-missing');
  if(!context?.plan?.placement?.groundRequired)errors.push('ground-contract-missing');
  if(!context?.plan?.placement?.manifestRequired)errors.push('placement-manifest-missing');
  if(context?.asset?.placeholder===true)errors.push('placeholder-asset');
  return freeze({ok:errors.length===0,errors:freeze(errors)});
}

export function environmentContextForOtherOwners(category,sample={},asset={}) {
  const context=prepareTerrainEnvironmentAssetContext(asset,{category,worldX:sample.worldX,worldZ:sample.worldZ,biome:sample.biome,climate:sample.climate,winter:sample.winter,sample});
  return freeze({queryOnly:true,contractId:TERRAIN_ENVIRONMENT_CONTRACT.id,gate:assertTerrainEnvironmentAttachReady(context),asset:context.asset,profile:context.profile,surfaceScore:context.surface.score,geography:context.geography,material:context.material,geology:context.geology,seasonal:context.seasonal,deterministicTransform:context.transform,spatial:ecotoneComposition(category,{...sample,seed:sample.seed}),heightAuthority:TERRAIN_ENVIRONMENT_CONTRACT.canonicalAuthorities.height,materialAuthority:TERRAIN_ENVIRONMENT_CONTRACT.canonicalAuthorities.material,placementAuthority:TERRAIN_ENVIRONMENT_CONTRACT.canonicalAuthorities.placement});
}

export function validateTerrainEnvironmentContract() {
  const errors=[];
  const expected=['asset-hydrate','surface-analysis','geography-score','material-recipe','material-validation','climate-response','geology-response','seasonal-response','distribution-decision','ground-transform','placement-manifest','scene-attach'];
  if(TERRAIN_ENVIRONMENT_CONTRACT.sequence.join('>')!==expected.join('>'))errors.push('operation-sequence');
  if(TERRAIN_SURFACE_FABRIC_POLICY.canonicalHeightUnchanged!==true)errors.push('surface-height-bypass');
  if(TERRAIN_SURFACE_FABRIC_POLICY.canonicalHydrologyUnchanged!==true)errors.push('surface-hydrology-bypass');
  if(ENVIRONMENT_ASSET_REGISTRY_POLICY.placeholderAllowed!==false)errors.push('placeholder-policy-open');
  if(ENVIRONMENT_ASSET_REGISTRY_POLICY.proceduralReplacementAllowed!==false)errors.push('procedural-replacement-open');
  if(TERRAIN_ENVIRONMENT_PROFILE_POLICY.editorRuntimeImportAllowed!==false)errors.push('editor-runtime-import-open');
  if(TERRAIN_ENVIRONMENT_CONTRACT.canonicalAuthorities.placement!=='src/3d/world/WorldAssetPlacementPipeline.js')errors.push('placement-authority-drift');
  if(TERRAIN_ENVIRONMENT_CONTRACT.canonicalAuthorities.material!=='src/3d/materials/MaterialAssignmentCore.js')errors.push('material-authority-drift');
  return freeze({ok:errors.length===0,errors:freeze(errors),contractId:TERRAIN_ENVIRONMENT_CONTRACT.id});
}
