import assert from 'node:assert/strict';
import {
  createWorldCoverageSceneManifestV51,
  createWorldCoverageSceneManifestBeforeAfterV51,
  summarizeWorldCoverageSceneManifestV51,
  WORLD_COVERAGE_SCENE_MANIFEST_V51,
} from '../src/3d/world/worldCoverageSceneManifestV51.js';

const observations = [
  {id:'full',position:{x:0,y:20,z:0},elevation:20,slope:.2,moisture:.6,snow:0,waterDistance:800,roadDistance:100,settlementDistance:100,distance:300,biome:'temperate-forest',cameraBand:'near-center',weather:{cloud:.2,precipitation:.03,wind:.2,temperatureC:16}},
  {id:'nw',position:{x:-1600,y:1200,z:-1600},elevation:1200,slope:.62,moisture:.7,snow:.91,waterDistance:700,roadDistance:100,settlementDistance:800,distance:9000,biome:'alpine',cameraBand:'near-northwest',weather:{cloud:.8,precipitation:.7,wind:.75,temperatureC:-6}},
  {id:'coast',position:{x:900,y:4,z:-200},elevation:4,slope:.12,moisture:.88,snow:0,waterDistance:10,roadDistance:100,settlementDistance:900,distance:600,biome:'coastal',cameraBand:'near-coast',weather:{cloud:.55,precipitation:.2,wind:.5,temperatureC:13}},
  {id:'mountain',position:{x:1800,y:900,z:1800},elevation:900,slope:.73,moisture:.45,snow:.25,waterDistance:150,roadDistance:100,settlementDistance:900,distance:4200,biome:'karst',cameraBand:'near-mountain',weather:{cloud:.3,precipitation:.06,wind:.8,temperatureC:6}},
  {id:'far',position:{x:5200,y:500,z:5000},elevation:500,slope:.32,moisture:.68,snow:.42,waterDistance:900,roadDistance:200,settlementDistance:1200,distance:50000,biome:'boreal-forest',cameraBand:'far',weather:{cloud:.7,precipitation:.2,wind:.48,temperatureC:2}},
];

const cameras = [
  {id:'full-world',seed:77,orthographicSize:100000,position:{x:0,y:50000,z:0},target:{x:0,y:0,z:0}},
  {id:'far',seed:77,orthographicSize:40000,position:{x:0,y:30000,z:25000},target:{x:0,y:0,z:0}},
  {id:'near-center',seed:77,orthographicSize:1200,position:{x:100,y:250,z:100},target:{x:0,y:0,z:0}},
  {id:'near-northwest',seed:77,orthographicSize:1500,position:{x:-700,y:500,z:-800},target:{x:-120,y:0,z:-120}},
  {id:'near-coast',seed:77,orthographicSize:1300,position:{x:900,y:420,z:-360},target:{x:500,y:0,z:-140}},
  {id:'near-mountain',seed:77,orthographicSize:1450,position:{x:1000,y:550,z:700},target:{x:250,y:100,z:180}},
];

const artifacts = cameras.map(camera => ({id:`artifact:${camera.id}`,band:camera.id,path:`artifacts/world-environment-acceptance-proof/${camera.id}.png`,seed:77,width:1536,height:1024,runtimeGenerated:true,postProcessed:false}));
const stages = ['sky','atmosphere','terrain-pbr','hydrology','vegetation','set-dressing','audio','acceptance'].map(id => ({id,status:'caller-owned',callerOwned:true,mutatesWorld:false,producesGeometry:false,evidence:'runtime'}));

const manifest = createWorldCoverageSceneManifestV51({seed:77,observations,cameras,artifacts,stages,framePressure:.25});
const repeat = createWorldCoverageSceneManifestV51({seed:77,observations,cameras,artifacts,stages,framePressure:.25});
assert.deepEqual(manifest,repeat);
assert.equal(manifest.version,'v51-scene-manifest');
assert.equal(manifest.acceptance.sameResolution,true);
assert.equal(manifest.acceptance.orthographic,true);
assert.equal(manifest.acceptance.sameSeed,true);
assert.equal(manifest.acceptance.noPostProcessing,true);
assert.equal(manifest.acceptance.noWorldMutation,true);
assert.equal(manifest.acceptance.noGeometryCreation,true);
assert.equal(manifest.audits.camera.complete,true);
assert.equal(manifest.audits.stage.complete,true);
assert.equal(manifest.audits.artifact.complete,true);
assert.equal(manifest.audits.p0.clear,true);
assert.match(manifest.acceptance.digest,/^[0-9a-f]{8}$/);
assert.equal(Object.isFrozen(manifest),true);

const summary = summarizeWorldCoverageSceneManifestV51(manifest);
assert.equal(summary.valid,true);
assert.equal(summary.version,'v51-scene-manifest');
assert.equal(summary.resolution.width,1536);
assert.equal(summary.resolution.height,1024);
assert.equal(summary.acceptance.p0Clear,true);

const beforeAfter=createWorldCoverageSceneManifestBeforeAfterV51(
  {seed:77,observations,cameras,artifacts,stages,framePressure:.25},
  {seed:77,observations:cameras.slice(0,0).map(() => observations[0]),cameras,artifacts,stages,framePressure:.25},
);
assert.equal(beforeAfter.version,'v51-scene-manifest');
assert.equal(beforeAfter.regressions.acceptance,true);

const postProcessed = createWorldCoverageSceneManifestV51({
  seed:77,observations,cameras,
  artifacts:[{...artifacts[0],postProcessed:true},...artifacts.slice(1)],
  stages,
});
assert.equal(postProcessed.audits.artifact.complete,false);
assert.equal(postProcessed.acceptance.noPostProcessing,false);

const mutatingStage = createWorldCoverageSceneManifestV51({
  seed:77,observations,cameras,artifacts,
  stages:[...stages,{id:'mutation',status:'bad',callerOwned:true,mutatesWorld:true,producesGeometry:true,evidence:'forbidden'}],
});
assert.equal(mutatingStage.audits.stage.complete,false);
assert.equal(mutatingStage.acceptance.noWorldMutation,false);
assert.equal(mutatingStage.acceptance.noGeometryCreation,false);

const invalidCamera = createWorldCoverageSceneManifestV51({
  seed:77,observations,cameras: cameras.map(camera => camera.id==='far'?{...camera,orthographicSize:-1}:camera),artifacts,stages,
});
assert.equal(invalidCamera.audits.camera.complete,true);
assert.ok(invalidCamera.cameras.find(camera=>camera.id==='far').orthographicSize > 0);

const duplicateArtifact = createWorldCoverageSceneManifestV51({
  seed:77,observations,cameras,artifacts:[...artifacts,{...artifacts[0],id:'duplicate'}],stages,
});
assert.equal(duplicateArtifact.audits.artifact.complete,false);
assert.ok(duplicateArtifact.audits.artifact.duplicatePaths.length>0);

assert.equal(WORLD_COVERAGE_SCENE_MANIFEST_V51.version,'v51-scene-manifest');
assert.equal(WORLD_COVERAGE_SCENE_MANIFEST_V51.resolution.width,1536);
assert.equal(WORLD_COVERAGE_SCENE_MANIFEST_V51.resolution.height,1024);
assert.equal(WORLD_COVERAGE_SCENE_MANIFEST_V51.postProcessingAllowed,false);
assert.equal(WORLD_COVERAGE_SCENE_MANIFEST_V51.sceneMutationAllowed,false);
assert.equal(WORLD_COVERAGE_SCENE_MANIFEST_V51.geometryCreationAllowed,false);

console.log('checkWorldCoverageSceneManifestV51: PASS');
