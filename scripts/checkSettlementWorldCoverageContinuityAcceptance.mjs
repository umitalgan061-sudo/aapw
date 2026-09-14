import { strict as assert } from 'node:assert';
import { createSettlementWorldCoverageAcceptance } from '../src/3d/gameplay/settlementWorldCoverageAcceptance.js';
import { createSettlementWorldCoverageContinuityProof } from '../src/3d/gameplay/settlementWorldCoverageContinuity.js';
import { createSettlementWorldCoverageContinuityPlan } from '../src/3d/gameplay/settlementWorldCoverageContinuityPlanner.js';

const base = {
  settlementId:'winterhold',
  assets:[], materials:[], manifests:[], placements:[],
  cameras:[
    {profile:'full-world',width:1536,height:1024,projection:'orthographic',readable:true},
    {profile:'settlement-far',width:1536,height:1024,projection:'orthographic',readable:true},
    {profile:'settlement-center',width:1536,height:1024,projection:'orthographic',readable:true},
    {profile:'settlement-northwest',width:1536,height:1024,projection:'orthographic',readable:true},
  ],
  interactions:[
    {id:'a',serviceId:'gate',action:'enter',ok:true,sequence:1,at:1},
    {id:'b',serviceId:'market',action:'trade',ok:true,sequence:2,at:2},
  ],
};
const assets = [
  ['settlements','door-north','door'], ['settlements','road-east','road'], ['settlements','vendor-market','vendor'], ['settlements','stall-market','stall'],
  ['houses','interior-tavern','interior'], ['props','npc-tavern','npc'], ['settlements','forge-blacksmith','forge'], ['props','workbench-blacksmith','workbench'],
  ['settlements','field-farm','field'], ['settlements','barn-farm','barn'], ['houses','barracks-main','barracks'], ['props','training-barracks','training'],
  ['settlements','stable-main','stable'], ['props','mount-stable','mount'], ['houses','house-main','house'], ['props','bed-house','bed'],
].map(([family,assetId])=>({family,assetId,status:'loaded',hydrated:true,materialSlots:4,textured:true,grounded:true}));
const roles=['wall','roof','wood','door','window','metal','stone-trim'];
const materials=roles.map((role)=>({id:`m-${role}`,role,kind:'pbr',textured:true,textureSize:1024}));
const serviceAsset={gate:'door-north',market:'vendor-market',tavern:'interior-tavern',blacksmith:'forge-blacksmith',farm:'field-farm',barracks:'barracks-main',stable:'stable-main',house:'house-main'};
const manifests=Object.entries(serviceAsset).map(([serviceId,assetId])=>({id:`manifest-${serviceId}`,assetId,serviceId,materialManifestId:`materials-${serviceId}`,status:'validated',surfaceRoles:roles,materialIds:materials.map((m)=>m.id),placeholderCount:0,missingMaterialCount:0,singleSurfaceRisk:false,groundAligned:true,sceneAttached:true}));
const placements=manifests.map((manifest)=>({id:`placement-${manifest.serviceId}`,assetId:manifest.assetId,serviceId:manifest.serviceId,status:'attached',manifestId:manifest.id,materialManifestId:manifest.materialManifestId,position:{x:0,y:0,z:0},groundPosition:{x:0,y:0,z:0},expectedGroundY:0,slope:4,scale:{x:1,y:1,z:1},visible:true,collisionReady:true,materialValidated:true,grounded:true,overlapRisk:false}));
const full={...base,assets,materials,manifests,placements};

const green=createSettlementWorldCoverageAcceptance(full);
assert.equal(green.status,'green');
assert.equal(green.score,1);
assert.equal(green.flags.servicesCovered,true);
assert.equal(green.flags.noPlacementRisk,true);
assert.equal(green.flags.camerasValid,true);
assert.equal(green.flags.interactionsValid,true);
assert.equal(Object.isFrozen(green),true);
assert.equal(Object.isFrozen(green.services),true);
assert.ok(green.fingerprint);

const proof=createSettlementWorldCoverageContinuityProof({settlement:{id:'winterhold',regionId:'north_temperate_forest',anchor:{x:512,y:18,z:768},entrance:{x:520,y:18,z:768},services:['gate','market','tavern','blacksmith','farm','barracks','stable','house']},player:{position:{x:538,y:18,z:768},inSettlement:false,settlementOpen:true,health:100},surface:{biome:'north-temperate',layer:'forest',moisture:.7,elevationMeters:300,slopeDegrees:5},regionId:'north_temperate_forest',seed:123});
assert.equal(proof.validation.ok,true);
assert.equal(proof.gateway.state,'available');
assert.equal(proof.approach.count,24);
assert.ok(proof.fingerprint);

const badAsset={...full,assets:full.assets.map((asset,index)=>index===0?{...asset,status:'missing'}:asset)};
const badAssetAcceptance=createSettlementWorldCoverageAcceptance(badAsset);
assert.equal(badAssetAcceptance.status,'warning');
assert.equal(badAssetAcceptance.flags.noMissingAssets,false);

const placeholder={...full,manifests:full.manifests.map((manifest,index)=>index===0?{...manifest,placeholderCount:2}:manifest)};
const placeholderAcceptance=createSettlementWorldCoverageAcceptance(placeholder);
assert.notEqual(placeholderAcceptance.status,'green');
assert.equal(placeholderAcceptance.flags.noPlaceholderMaterials,false);

const missingMaterial={...full,manifests:full.manifests.map((manifest,index)=>index===1?{...manifest,missingMaterialCount:4}:manifest)};
const missingMaterialAcceptance=createSettlementWorldCoverageAcceptance(missingMaterial);
assert.equal(missingMaterialAcceptance.flags.noMissingMaterials,false);

const surfaceRisk={...full,manifests:full.manifests.map((manifest,index)=>index===2?{...manifest,singleSurfaceRisk:true}:manifest)};
const surfaceRiskAcceptance=createSettlementWorldCoverageAcceptance(surfaceRisk);
assert.equal(surfaceRiskAcceptance.flags.noSingleSurfaceRisk,false);

const floating={...full,placements:full.placements.map((placement,index)=>index===3?{...placement,grounded:false,position:{x:0,y:2,z:0}}:placement)};
const floatingAcceptance=createSettlementWorldCoverageAcceptance(floating);
assert.equal(floatingAcceptance.flags.noPlacementRisk,false);
assert.equal(floatingAcceptance.placements.floatingCount,1);

const cameraFailure={...full,cameras:[{profile:'full-world',width:800,height:600,projection:'perspective',readable:false,blackSkyRisk:true,seamRisk:true,clippingRisk:true}]};
const cameraAcceptance=createSettlementWorldCoverageAcceptance(cameraFailure);
assert.equal(cameraAcceptance.flags.camerasValid,false);

const interactionFailure={...full,interactions:[...full.interactions,{id:'bad',serviceId:'market',action:'trade',ok:false,sequence:3,at:3,reason:'npc-busy'}]};
const interactionAcceptance=createSettlementWorldCoverageAcceptance(interactionFailure);
assert.equal(interactionAcceptance.flags.interactionsValid,false);
assert.equal(interactionAcceptance.interactions.failedCount,1);

const nonMonotonic={...full,interactions:[{id:'x',serviceId:'gate',action:'enter',ok:true,sequence:2,at:2},{id:'y',serviceId:'market',action:'trade',ok:true,sequence:1,at:1}]};
const nonMonotonicAcceptance=createSettlementWorldCoverageAcceptance(nonMonotonic);
assert.equal(nonMonotonicAcceptance.interactions.monotonicSequence,false);

const pointer={...full,assets:full.assets.map((asset,index)=>index===0?{...asset,status:'pointer',hydrated:false}:asset)};
const pointerAcceptance=createSettlementWorldCoverageAcceptance(pointer);
assert.equal(pointerAcceptance.assets[0].status,'pointer');
assert.equal(pointerAcceptance.flags.noMissingAssets,true);

const sparse={settlementId:'winterhold',assets:[{id:'only',status:'loaded',family:'settlements'}],materials:[],manifests:[],placements:[],cameras:[],interactions:[]};
const sparseAcceptance=createSettlementWorldCoverageAcceptance(sparse);
assert.notEqual(sparseAcceptance.status,'green');
assert.equal(sparseAcceptance.flags.camerasValid,false);
assert.equal(sparseAcceptance.flags.servicesCovered,false);

const deterministicA=createSettlementWorldCoverageAcceptance(full);
const deterministicB=createSettlementWorldCoverageAcceptance(JSON.parse(JSON.stringify(full)));
assert.equal(deterministicA.fingerprint,deterministicB.fingerprint);
assert.deepEqual(JSON.stringify(deterministicA),JSON.stringify(deterministicB));

const settlement={id:'winterhold',regionId:'north_temperate_forest',anchor:{x:512,y:18,z:768},entrance:{x:520,y:18,z:768},services:Object.keys(serviceAsset)};
const player={position:{x:538,y:18,z:768},inSettlement:false,settlementOpen:true,health:100,copper:240,fatigue:30};
const surface={biome:'north-temperate',layer:'forest',moisture:.65,elevationMeters:320,slopeDegrees:6};
for(const seed of [1,2,3,9,99,12345]){
  const plan=createSettlementWorldCoverageContinuityPlan({settlement,player,surface,regionId:settlement.regionId,seed});
  const repeat=createSettlementWorldCoverageContinuityPlan({settlement:JSON.parse(JSON.stringify(settlement)),player:JSON.parse(JSON.stringify(player)),surface:JSON.parse(JSON.stringify(surface)),regionId:settlement.regionId,seed});
  assert.equal(plan.fingerprint,repeat.fingerprint,`planner replay ${seed}`);
  assert.equal(plan.serviceRecommendations.length,8);
  assert.ok(plan.recommendedService);
}

console.log('Settlement World Coverage Continuity Acceptance: PASS');
console.log(JSON.stringify({status:green.status,score:green.score,acceptanceFingerprint:green.fingerprint,proofFingerprint:proof.fingerprint,pointerStatus:pointerAcceptance.assets[0].status,sparseStatus:sparseAcceptance.status}));
