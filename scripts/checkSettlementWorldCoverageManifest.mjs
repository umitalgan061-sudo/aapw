import {
  SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_SERVICES,
  SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_API,
  createSettlementWorldCoverageAcceptance,
  createSettlementWorldCoverageProof,
} from '../src/3d/gameplay/settlementWorldCoverageAcceptance.js';

const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const clone=(value)=>JSON.parse(JSON.stringify(value));

const serviceAsset={
  gate:['door-north','road-east'],
  market:['vendor-market','stall-market'],
  tavern:['interior-tavern','npc-tavern'],
  blacksmith:['forge-blacksmith','workbench-blacksmith'],
  farm:['field-farm','barn-farm'],
  barracks:['barracks-main','training-barracks'],
  stable:['stable-main','mount-stable'],
  house:['house-main','bed-house'],
};
const serviceFamily={gate:['settlements','settlements'],market:['settlements','settlements'],tavern:['houses','props'],blacksmith:['settlements','props'],farm:['settlements','settlements'],barracks:['houses','props'],stable:['settlements','props'],house:['houses','props']};
const materialRoles=['wall','roof','wood','door','window','metal','stone-trim'];
const materials=materialRoles.map((role,index)=>({id:`mat-${role}`,role,kind:'pbr',textured:true,textureSize:index%2?1024:2048,albedo:`${role}-a`,normal:`${role}-n`,roughness:`${role}-r`,metalness:role==='metal'?'metal-m':''}));
const assets=[];
const manifests=[];
const placements=[];
for(const serviceId of SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_SERVICES){
  const manifestId=`manifest-${serviceId}`;
  for(let index=0;index<serviceAsset[serviceId].length;index+=1){
    const assetId=serviceAsset[serviceId][index];
    const family=serviceFamily[serviceId][index];
    assets.push({family,assetId,status:'loaded',hydrated:true,placementManifestId:manifestId,materialSlots:3,textured:true,grounded:true,path:`assets/models/${family}/${assetId}.glb`});
  }
  const assetId=serviceAsset[serviceId][0];
  const materialManifestId=`materials-${serviceId}`;
  manifests.push({id:manifestId,assetId,serviceId,materialManifestId,status:'validated',surfaceRoles:materialRoles,materialIds:materials.map((material)=>material.id),placeholderCount:0,missingMaterialCount:0,singleSurfaceRisk:false,groundAligned:true,sceneAttached:true,sourceAsset:`assets/models/${serviceFamily[serviceId][0]}/${assetId}.glb`});
  placements.push({id:`placement-${serviceId}`,assetId,serviceId,status:'attached',manifestId,materialManifestId,position:{x:serviceId.length,y:0,z:serviceId.charCodeAt(0)%7},groundPosition:{x:serviceId.length,y:0,z:serviceId.charCodeAt(0)%7},expectedGroundY:0,slope:Math.min(12,serviceId.length),scale:{x:1,y:1,z:1},visible:true,collisionReady:true,materialValidated:true,grounded:true,overlapRisk:false});
}

const cameras=SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_API.cameras.map((profile)=>({profile,width:1536,height:1024,projection:'orthographic',readable:true}));
const interactions=SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_SERVICES.map((serviceId,index)=>({id:`interaction-${serviceId}`,serviceId,action:index===0?'enter':index===1?'trade':index===2?'talk':index===3?'craft':index===4?'interact':index===5?'train':index===6?'travel':'save',ok:true,sequence:index+1,at:index+1}));
const input={settlementId:'coverage-manifest-settlement',assets,materials,manifests,placements,cameras,interactions};
const acceptance=createSettlementWorldCoverageAcceptance(input);
const proof=createSettlementWorldCoverageProof(input);

assert(acceptance.status==='green','manifest fixture must be green');
assert(acceptance.score===1,'manifest fixture score must be 1');
assert(acceptance.services.length===8,'manifest service count must be 8');
assert(acceptance.manifests.count===8,'manifest count must be 8');
assert(acceptance.placements.count===8,'placement count must be 8');
assert(acceptance.interactions.count===8,'interaction count must be 8');
assert(acceptance.cameras.valid,'camera contract must be valid');
assert(proof.assetProof.missing===0,'proof missing count must be zero');
assert(proof.materialProof.placeholderCount===0,'proof placeholder count must be zero');
assert(proof.materialProof.missingMaterialCount===0,'proof missing material count must be zero');
assert(proof.placementProof.invalidCount===0,'proof invalid placement count must be zero');
assert(proof.serviceProof.every((service)=>service.placementCount>=1),'every service must have placement evidence');
assert(proof.serviceProof.every((service)=>service.groundedPlacements===service.placementCount),'every placement must be grounded');

for(const serviceId of SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_SERVICES){
  const row=acceptance.services.find((service)=>service.serviceId===serviceId);
  assert(row,`missing acceptance service ${serviceId}`);
  assert(row.status==='covered',`service ${serviceId} not covered`);
  assert(row.evidence.every((evidence)=>evidence.ok),`service ${serviceId} missing evidence`);
  const manifest=acceptance.manifests.rows.find((entry)=>entry.serviceId===serviceId);
  assert(manifest?.valid,`service ${serviceId} material manifest invalid`);
  assert(manifest?.roleCount>=2,`service ${serviceId} material role count too small`);
  const placement=acceptance.placements.rows.find((entry)=>entry.serviceId===serviceId);
  assert(placement?.valid,`service ${serviceId} placement invalid`);
  assert(placement?.materialAligned,`service ${serviceId} material manifest alignment failed`);
  assert(placement?.manifestAligned,`service ${serviceId} placement manifest alignment failed`);
  assert(placement?.expectedError===0,`service ${serviceId} ground Y drift`);
  assert(placement?.verticalError===0,`service ${serviceId} floating placement`);
}

const noGround=clone(input);
noGround.placements[0].grounded=false;
noGround.placements[0].position.y=0.4;
noGround.placements[0].groundPosition.y=0;
const noGroundAcceptance=createSettlementWorldCoverageAcceptance(noGround);
assert(noGroundAcceptance.placements.floatingCount>=1,'ground alignment regression not detected');
assert(noGroundAcceptance.flags.noPlacementRisk===false,'ground alignment should fail acceptance');

const noManifest=clone(input);
noManifest.placements[1].manifestId='missing-manifest';
const noManifestAcceptance=createSettlementWorldCoverageAcceptance(noManifest);
assert(noManifestAcceptance.placements.invalidCount>=1,'missing placement manifest should fail');

const wrongMaterial=clone(input);
wrongMaterial.placements[2].materialManifestId='wrong-materials';
const wrongMaterialAcceptance=createSettlementWorldCoverageAcceptance(wrongMaterial);
assert(wrongMaterialAcceptance.placements.invalidCount>=1,'wrong material manifest should fail');

const riskyScale=clone(input);
riskyScale.placements[3].scale={x:0,y:1,z:1};
const riskyScaleAcceptance=createSettlementWorldCoverageAcceptance(riskyScale);
assert(riskyScaleAcceptance.placements.invalidCount>=1,'zero placement scale should fail');

const steepSlope=clone(input);
steepSlope.placements[4].slope=85;
const steepSlopeAcceptance=createSettlementWorldCoverageAcceptance(steepSlope);
assert(steepSlopeAcceptance.placements.invalidCount>=1,'steep placement slope should fail');

const overlap=clone(input);
overlap.placements[5].overlapRisk=true;
const overlapAcceptance=createSettlementWorldCoverageAcceptance(overlap);
assert(overlapAcceptance.placements.overlapCount===1,'overlap risk should be counted');
assert(overlapAcceptance.placements.invalidCount>=1,'overlap risk should fail placement');

const placeholder=clone(input);
placeholder.manifests[6].placeholderCount=1;
const placeholderAcceptance=createSettlementWorldCoverageAcceptance(placeholder);
assert(placeholderAcceptance.manifests.placeholderCount===1,'placeholder count must propagate');
assert(placeholderAcceptance.flags.noPlaceholderMaterials===false,'placeholder material must fail');

const singleSurface=clone(input);
singleSurface.manifests[7].singleSurfaceRisk=true;
const singleSurfaceAcceptance=createSettlementWorldCoverageAcceptance(singleSurface);
assert(singleSurfaceAcceptance.manifests.singleSurfaceRiskCount===1,'single surface risk must propagate');
assert(singleSurfaceAcceptance.flags.noSingleSurfaceRisk===false,'single surface risk must fail');

const missingMaterial=clone(input);
missingMaterial.manifests[0].missingMaterialCount=3;
const missingMaterialAcceptance=createSettlementWorldCoverageAcceptance(missingMaterial);
assert(missingMaterialAcceptance.manifests.missingMaterialCount===3,'missing material count must propagate');
assert(missingMaterialAcceptance.flags.noMissingMaterials===false,'missing material must fail');

const missingServiceAsset=clone(input);
missingServiceAsset.assets=missingServiceAsset.assets.filter((asset)=>asset.assetId!=='vendor-market');
const missingServiceAssetAcceptance=createSettlementWorldCoverageAcceptance(missingServiceAsset);
const marketRow=missingServiceAssetAcceptance.services.find((service)=>service.serviceId==='market');
assert(marketRow?.status!=='covered','market without vendor evidence must not be covered');

const pointerServiceAsset=clone(input);
pointerServiceAsset.assets[0].status='pointer';
pointerServiceAsset.assets[0].hydrated=false;
const pointerAcceptance=createSettlementWorldCoverageAcceptance(pointerServiceAsset);
assert(pointerAcceptance.assets.some((asset)=>asset.status==='pointer'),'pointer asset state must remain visible');
assert(pointerAcceptance.assets.filter((asset)=>asset.status==='missing').length===0,'pointer must not be converted to missing');

const unknownStatus=clone(input);
unknownStatus.assets[0].status='corrupt-status';
const unknownAcceptance=createSettlementWorldCoverageAcceptance(unknownStatus);
assert(unknownAcceptance.assets[0].status==='unknown','unknown asset status should normalize');

const deterministicOne=createSettlementWorldCoverageProof(input);
const deterministicTwo=createSettlementWorldCoverageProof(clone(input));
assert(JSON.stringify(deterministicOne)===JSON.stringify(deterministicTwo),'proof serialization must be deterministic');
assert(deterministicOne.fingerprint===deterministicTwo.fingerprint,'proof fingerprint must be deterministic');

console.log('Settlement World Coverage Manifest Contract: PASS');
console.log(JSON.stringify({
  status:acceptance.status,
  score:acceptance.score,
  serviceCount:acceptance.services.length,
  manifestCount:acceptance.manifests.count,
  placementCount:acceptance.placements.count,
  missingAssets:proof.assetProof.missing,
  pointers:proof.assetProof.pointers,
  placeholders:proof.materialProof.placeholderCount,
  missingMaterials:proof.materialProof.missingMaterialCount,
  invalidPlacements:proof.placementProof.invalidCount,
  fingerprint:proof.fingerprint,
},null,2));
