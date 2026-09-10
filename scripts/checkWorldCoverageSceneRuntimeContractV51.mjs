import assert from 'node:assert/strict';
import {createWorldCoverageAcceptanceEvidenceV51} from '../src/3d/world/worldCoverageAcceptanceEvidenceV51.js';
import {createWorldCoverageSceneManifestV51} from '../src/3d/world/worldCoverageSceneManifestV51.js';

const s=(id,x,z,biome,extra={})=>({
  id,position:{x,y:extra.y??extra.elevation??10,z},elevation:extra.elevation??10,slope:extra.slope??.18,
  moisture:extra.moisture??.48,snow:extra.snow??0,waterDistance:extra.waterDistance??900,roadDistance:extra.roadDistance??90,
  settlementDistance:extra.settlementDistance??120,distance:extra.distance??500,horizonOcclusion:extra.horizonOcclusion??.04,biome,
  cameraBand:extra.cameraBand??'near-center',weather:extra.weather??{cloud:.22,precipitation:.04,wind:.18,temperatureC:16},
});

const rows=[
 s('center',0,0,'temperate-forest',{cameraBand:'near-center',moisture:.68}),
 s('nw',-1500,-1500,'alpine',{cameraBand:'near-northwest',elevation:1300,slope:.6,moisture:.74,snow:.9,distance:8500,weather:{cloud:.8,precipitation:.72,wind:.76,temperatureC:-7}}),
 s('coast',1200,-100,'coastal',{cameraBand:'near-coast',elevation:3,moisture:.86,waterDistance:8,weather:{cloud:.54,precipitation:.18,wind:.52,temperatureC:13}}),
 s('mountain',1800,1800,'karst',{cameraBand:'near-mountain',elevation:980,slope:.74,moisture:.42,snow:.24,distance:4200,weather:{cloud:.3,precipitation:.05,wind:.82,temperatureC:5}}),
 s('far',5000,5000,'boreal-forest',{cameraBand:'far',elevation:620,slope:.32,moisture:.65,snow:.42,distance:48000,weather:{cloud:.7,precipitation:.21,wind:.45,temperatureC:2}}),
];

const evidence=createWorldCoverageAcceptanceEvidenceV51({seed:912,observations:rows,framePressure:.24});
assert.equal(evidence.acceptanceReady,true);
assert.equal(evidence.score.ratio,1);
assert.deepEqual(evidence.requiredCameraBands,['full-world','far','near-center','near-northwest','near-coast','near-mountain']);
assert.equal(evidence.audits.cameras.complete,true);
assert.equal(evidence.audits.cameraGeometry.finite,true);
assert.equal(evidence.audits.surfaces.complete,true);
assert.equal(evidence.audits.p0.gridZero,true);
assert.equal(evidence.audits.p0.seamZero,true);
assert.equal(evidence.audits.p0.rectangularWaterZero,true);
assert.equal(evidence.audits.p0.moireZero,true);
assert.equal(evidence.audits.p1.coordinateParity,true);
assert.equal(evidence.audits.p5.blackSkyGuard,true);
assert.equal(evidence.audits.determinism.deterministic,true);

const stages=['sky','atmosphere','terrain-pbr','hydrology','vegetation','set-dressing','audio','acceptance']
  .map(id=>({id,status:'caller-owned',callerOwned:true,mutatesWorld:false,producesGeometry:false,evidence:'runtime'}));
const cameras=[
 {id:'full-world',seed:912,orthographicSize:100000,position:{x:0,y:50000,z:0},target:{x:0,y:0,z:0}},
 {id:'far',seed:912,orthographicSize:40000,position:{x:0,y:30000,z:20000},target:{x:0,y:0,z:0}},
 {id:'near-center',seed:912,orthographicSize:1200,position:{x:90,y:250,z:90},target:{x:0,y:0,z:0}},
 {id:'near-northwest',seed:912,orthographicSize:1500,position:{x:-700,y:520,z:-800},target:{x:-120,y:0,z:-120}},
 {id:'near-coast',seed:912,orthographicSize:1300,position:{x:900,y:430,z:-360},target:{x:500,y:0,z:-140}},
 {id:'near-mountain',seed:912,orthographicSize:1450,position:{x:1000,y:560,z:700},target:{x:250,y:100,z:180}},
];
const artifacts=cameras.map(c=>({id:`${c.id}-artifact`,band:c.id,path:`artifacts/world-environment-acceptance-proof/${c.id}.png`,seed:912,width:1536,height:1024,runtimeGenerated:true,postProcessed:false}));
const manifest=createWorldCoverageSceneManifestV51({seed:912,observations:rows,cameras,stages,artifacts});
assert.equal(manifest.acceptance.ready,true);
assert.equal(manifest.acceptance.noPostProcessing,true);
assert.equal(manifest.acceptance.sameResolution,true);
assert.equal(manifest.acceptance.orthographic,true);
assert.equal(manifest.acceptance.sameSeed,true);
assert.equal(manifest.acceptance.noWorldMutation,true);
assert.equal(manifest.acceptance.noGeometryCreation,true);
assert.equal(manifest.audits.camera.complete,true);
assert.equal(manifest.audits.stage.complete,true);
assert.equal(manifest.audits.artifact.complete,true);
assert.equal(manifest.audits.p0.clear,true);

const regress=createWorldCoverageSceneManifestV51({seed:912,observations:rows,cameras,stages,artifacts:[{...artifacts[0],postProcessed:true},...artifacts.slice(1)]});
assert.equal(regress.acceptance.noPostProcessing,false);
assert.equal(regress.audits.artifact.complete,false);
assert.ok(regress.audits.artifact.postProcessed.includes(artifacts[0].id));

console.log('checkWorldCoverageSceneRuntimeContractV51: PASS');
