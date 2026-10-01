import assert from 'node:assert/strict';
import {
  createWorldCoverageAssetBoundaryV51,
  createWorldCoverageAssetBoundaryBatchV51,
  createWorldCoverageAssetBoundaryDecisionV51,
  WORLD_COVERAGE_ASSET_BOUNDARY_V51,
} from '../src/3d/world/worldCoverageAssetBoundaryV51.js';

const observation = (overrides={}) => ({
  id:'ridge-rock-01',
  position:{x:120,y:840,z:-260},
  elevation:840,
  slope:.62,
  moisture:.48,
  snow:.22,
  waterDistance:840,
  roadDistance:140,
  settlementDistance:900,
  biome:'alpine',
  ...overrides,
});

const pipeline=[
  'hydrate-load',
  'surface-analysis',
  'multi-material-recipe',
  'material-validation',
  'ground-transform',
  'placement-manifest',
  'scene-attach',
];

const good = createWorldCoverageAssetBoundaryV51({
  assetPath:'assets/models/env/rocks/ridge-rock.glb',
  policy:'shared-pipeline',
  sharedAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
  observation:observation(),
  pipeline,
  materialAssignment:{surfaces:[
    {id:'rock',name:'rock',pbr:true},
    {id:'moss',name:'moss',textureSet:true},
  ]},
});

assert.equal(good.version,'v51-asset-boundary');
assert.equal(good.handoff.valid,true);
assert.equal(good.handoff.sharedAuthority,true);
assert.equal(good.handoff.pipeline.complete,true);
assert.equal(good.handoff.observation.finite,true);
assert.equal(good.handoff.observation.withinBounds,true);
assert.equal(good.handoff.materials.placeholderCount,0);
assert.equal(good.handoff.materials.pbrGapCount,0);
assert.equal(good.handoff.geometryCreated,false);
assert.equal(good.handoff.assetHydratedHere,false);
assert.equal(good.handoff.editorImportedHere,false);
assert.equal(good.handoff.sceneAttachedHere,false);
assert.match(good.digest,/^[0-9a-f]{8}$/);
assert.equal(Object.isFrozen(good),true);
assert.equal(Object.isFrozen(good.handoff),true);

const decision=createWorldCoverageAssetBoundaryDecisionV51({
  assetPath:good.handoff.assetPath,
  observation:observation(),
  pipeline,
  policy:'shared-pipeline',
  sharedAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
  materialAssignment:{surfaces:[{id:'rock',name:'rock',pbr:true},{id:'moss',name:'moss',pbr:true}]},
});
assert.equal(decision.accept,true);
assert.equal(decision.reason,'accepted');
assert.equal(decision.pipelineComplete,true);
assert.equal(decision.localHydrationBlocked,false);
assert.equal(decision.editorImportBlocked,false);
assert.equal(decision.geometryCreationBlocked,false);

const badPolicy=createWorldCoverageAssetBoundaryV51({
  assetPath:'assets/models/env/rocks/ridge-rock.glb',
  policy:'local-runtime',
  sharedAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
  observation:observation(),
  pipeline,
  materialAssignment:{surfaces:[{id:'rock',name:'rock',pbr:true},{id:'moss',name:'moss',pbr:true}]},
});
assert.equal(badPolicy.handoff.valid,false);
assert.equal(createWorldCoverageAssetBoundaryDecisionV51(badPolicy.handoff).accept,false);

const badOrder=createWorldCoverageAssetBoundaryV51({
  assetPath:'assets/models/env/rocks/ridge-rock.glb',
  policy:'shared-pipeline',
  sharedAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
  observation:observation(),
  pipeline:['surface-analysis','hydrate-load',...pipeline.slice(2)],
  materialAssignment:{surfaces:[{id:'rock',name:'rock',pbr:true},{id:'moss',name:'moss',pbr:true}]},
});
assert.equal(badOrder.handoff.pipeline.complete,false);
assert.equal(badOrder.handoff.valid,false);

const placeholder=createWorldCoverageAssetBoundaryV51({
  assetPath:'assets/models/env/rocks/ridge-rock.glb',
  policy:'shared-pipeline',
  sharedAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
  observation:observation(),
  pipeline,
  materialAssignment:{surfaces:[{id:'default-cube',name:'placeholder-cube',pbr:false}]},
});
assert.equal(placeholder.handoff.materials.placeholderCount,1);
assert.equal(placeholder.handoff.valid,false);

const localHydrate=createWorldCoverageAssetBoundaryV51({
  assetPath:'assets/models/env/rocks/ridge-rock.glb',
  policy:'shared-pipeline',
  sharedAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
  observation:observation(),
  pipeline,
  assetHydratedHere:true,
  materialAssignment:{surfaces:[{id:'rock',name:'rock',pbr:true},{id:'moss',name:'moss',pbr:true}]},
});
assert.equal(localHydrate.handoff.assetHydratedHere,true);
assert.equal(localHydrate.handoff.valid,false);

const editorImport=createWorldCoverageAssetBoundaryV51({
  assetPath:'assets/models/env/rocks/ridge-rock.glb',
  policy:'shared-pipeline',
  sharedAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
  observation:observation(),
  pipeline,
  editorImportedHere:true,
  codeMarkerText:'EditorMaterialStudio',
  materialAssignment:{surfaces:[{id:'rock',name:'rock',pbr:true},{id:'moss',name:'moss',pbr:true}]},
});
assert.equal(editorImport.handoff.editorImportedHere,true);
assert.equal(editorImport.handoff.forbiddenMarkers.length,1);
assert.equal(editorImport.handoff.valid,false);

const geometry=createWorldCoverageAssetBoundaryV51({
  assetPath:'assets/models/env/rocks/ridge-rock.glb',
  policy:'shared-pipeline',
  sharedAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
  observation:observation(),
  pipeline,
  geometryCreated:true,
  materialAssignment:{surfaces:[{id:'rock',name:'rock',pbr:true},{id:'moss',name:'moss',pbr:true}]},
});
assert.equal(geometry.handoff.geometryCreated,true);
assert.equal(geometry.handoff.valid,false);

const water= createWorldCoverageAssetBoundaryDecisionV51({
  assetPath:'assets/models/env/rocks/ridge-rock.glb',
  policy:'shared-pipeline',
  sharedAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',
  observation:observation({waterDistance:0.7}),
  pipeline,
  materialAssignment:{surfaces:[{id:'rock',name:'rock',pbr:true},{id:'moss',name:'moss',pbr:true}]},
});
assert.equal(water.accept,false);
assert.equal(water.materialValidation.placeholderCount,0);

const batch=createWorldCoverageAssetBoundaryBatchV51([
  {
    assetPath:'assets/models/env/rocks/a.glb',policy:'shared-pipeline',sharedAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',observation:observation({id:'a'}),pipeline,
    materialAssignment:{surfaces:[{id:'rock',name:'rock',pbr:true},{id:'moss',name:'moss',pbr:true}]},
  },
  {
    assetPath:'assets/models/env/rocks/b.glb',policy:'shared-pipeline',sharedAuthority:'MaterialAssignmentCore+WorldAssetPlacementPipeline',observation:observation({id:'b',slope:.81}),pipeline,
    materialAssignment:{surfaces:[{id:'rock',name:'rock',pbr:true},{id:'moss',name:'moss',pbr:true}]},
  },
]);
assert.equal(batch.count,2);
assert.equal(batch.invalid,1);
assert.equal(batch.allValid,false);
assert.match(batch.digest,/^[0-9a-f]{8}$/);

assert.equal(WORLD_COVERAGE_ASSET_BOUNDARY_V51.version,'v51-asset-boundary');
assert.equal(WORLD_COVERAGE_ASSET_BOUNDARY_V51.authority,'MaterialAssignmentCore+WorldAssetPlacementPipeline');
assert.equal(WORLD_COVERAGE_ASSET_BOUNDARY_V51.requiredPipeline.length,7);
assert.ok(WORLD_COVERAGE_ASSET_BOUNDARY_V51.forbiddenCallerMarkers.includes('EditorMaterialStudio'));

console.log('checkWorldCoverageAssetBoundaryV51: PASS');
