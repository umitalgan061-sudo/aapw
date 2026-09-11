import {
  createSettlementWorldCoveragePlan,
  createSettlementWorldCoverageSession,
  SETTLEMENT_WORLD_COVERAGE_API,
} from '../src/3d/gameplay/settlementWorldCoverageSlice.js';
import {
  createSettlementWorldCoverageAcceptance,
  createSettlementWorldCoverageProof,
  SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_SERVICES,
} from '../src/3d/gameplay/settlementWorldCoverageAcceptance.js';

const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const clone=(value)=>JSON.parse(JSON.stringify(value));
const stable=(value)=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const hash=(value)=>{let result=2166136261;for(const character of stable(value)){result^=character.charCodeAt(0);result=Math.imul(result,16777619);}return(result>>>0).toString(16).padStart(8,'0');};
const frozen=(value,label)=>{assert(Object.isFrozen(value),`${label} not frozen`);if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))if(child&&typeof child==='object')frozen(child,`${label}.${key}`);};

const base={settlementId:'coverage-settlement',locationId:'center-gate',inSettlement:true,settlementOpen:true,health:96,maxHealth:100,copper:320,fatigue:41,reputation:5,saveEnabled:true,inventory:{bread:6,stew:2,iron_ore:10,coal:8,leather:4,linen:6},equipment:{mainHand:'iron_sword',gloves:'leather_gloves'},skills:{smithing:6,commerce:4,survival:5,dialogue:3},perks:['roadwise','merchant_road','market_eye'],quests:{'forge-order':{state:'active',step:1,completed:false,rewardClaimed:false}},flags:{met_smith:true,gate_open:true},survival:{hunger:28,exposure:8,morale:4}};

const assetFamilies={
  settlements:['door-north','road-east','vendor-market','stall-market','forge-blacksmith','workbench-blacksmith','field-farm','barn-farm','stable-main','mount-stable'],
  houses:['interior-tavern','barracks-main','house-main'],
  props:['npc-tavern','training-barracks','bed-house'],
};
const assets=Object.entries(assetFamilies).flatMap(([family,names])=>names.map((assetId)=>({family,assetId,status:'loaded',hydrated:true,materialSlots:3,textured:true,grounded:true,placementManifestId:`${({door:'gate',road:'gate',vendor:'market',stall:'market',interior:'tavern',npc:'tavern',forge:'blacksmith',workbench:'blacksmith',field:'farm',barn:'farm',barracks:'barracks',training:'barracks',stable:'stable',mount:'stable',house:'house',bed:'house'})[assetId.split('-')[0]]}-manifest`})));
const materialRoles=['wall','roof','wood','door','window','metal','stone-trim'];
const materials=materialRoles.map((role,index)=>({id:`material-${role}`,role,kind:'pbr',textured:true,textureSize:index%2?1024:2048,albedo:`albedo-${role}`,normal:`normal-${role}`,roughness:`roughness-${role}`,metalness:role==='metal'?'metalness-metal':''}));
const manifests=SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_SERVICES.map((serviceId)=>({id:`${serviceId}-manifest`,assetId:serviceId==='gate'?'door-north':serviceId==='market'?'vendor-market':serviceId==='tavern'?'interior-tavern':serviceId==='blacksmith'?'forge-blacksmith':serviceId==='farm'?'field-farm':serviceId==='barracks'?'barracks-main':serviceId==='stable'?'stable-main':'house-main',serviceId,materialManifestId:`${serviceId}-materials`,status:'validated',surfaceRoles:materialRoles,materialIds:materials.map((item)=>item.id),placeholderCount:0,missingMaterialCount:0,singleSurfaceRisk:false,groundAligned:true,sceneAttached:true}));
const placements=manifests.map((manifest,index)=>({id:`placement-${manifest.serviceId}`,assetId:manifest.assetId,serviceId:manifest.serviceId,status:'attached',manifestId:manifest.id,materialManifestId:manifest.materialManifestId,position:{x:index*3,y:0,z:index*2},groundPosition:{x:index*3,y:0,z:index*2},expectedGroundY:0,slope:Math.min(12,index+3),scale:{x:1,y:1,z:1},visible:true,collisionReady:true,materialValidated:true,grounded:true,overlapRisk:false}));
const cameras=['full-world','settlement-far','settlement-center','settlement-northwest'].map((profile)=>({profile,width:1536,height:1024,projection:'orthographic',readable:true}));
const interactions=SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_SERVICES.map((serviceId,index)=>({id:`i-${serviceId}`,serviceId,action:index===0?'enter':index===1?'trade':index===2?'talk':index===3?'craft':index===4?'interact':index===5?'train':index===6?'travel':'save',ok:true,sequence:index+1,at:index+1}));
const proofInput={settlementId:base.settlementId,assets,materials,manifests,placements,cameras,interactions};

const firstPlan=createSettlementWorldCoveragePlan({snapshot:base,assets});
const secondPlan=createSettlementWorldCoveragePlan({snapshot:clone(base),assets:clone(assets)});
assert(JSON.stringify(firstPlan)===JSON.stringify(secondPlan),'plan replay serialization mismatch');
assert(firstPlan.fingerprint===secondPlan.fingerprint,'plan replay fingerprint mismatch');
frozen(firstPlan,'firstPlan');
frozen(secondPlan,'secondPlan');

for(const serviceId of SETTLEMENT_WORLD_COVERAGE_API.services){
  const probe=createSettlementWorldCoveragePlan({snapshot:base,assets});
  const row=probe.services.find((service)=>service.id===serviceId);
  assert(row,`missing service row ${serviceId}`);
  assert(Array.isArray(row.intents)&&row.intents.length>0,`missing intents ${serviceId}`);
  assert(Array.isArray(row.panels)&&row.panels.length>0,`missing panels ${serviceId}`);
  assert(row.assetCoverage&&typeof row.assetCoverage.status==='string',`missing asset status ${serviceId}`);
}

const mutations=[];
const session=createSettlementWorldCoverageSession({initialState:clone(base),assets:clone(assets),now:()=>1700000000000,handlers:{
  talk:({intent})=>{mutations.push(intent);return{ok:true,serviceId:'tavern',reputationDelta:1};},
  craft:({intent})=>{mutations.push(intent);return{ok:true,serviceId:'blacksmith',xpDelta:15};},
  train:({intent})=>{mutations.push(intent);return{ok:true,serviceId:'barracks',xpDelta:12};},
}});

const states=[];
states.push(session.snapshotState());
for(const step of [
  ['open','market','trade'],
  ['setPanel','trade'],
  ['execute','talk',{}],
  ['open','blacksmith','craft'],
  ['execute','craft',{recipeId:'iron_sword'}],
  ['open','barracks','quests'],
  ['execute','train',{}],
  ['open','house','save'],
  ['checkpoint','deterministic'],
]){
  if(step[0]==='open') session.open(step[1],step[2]);
  else if(step[0]==='setPanel') session.setPanel(step[1]);
  else if(step[0]==='execute') await session.execute(step[1],step[2]);
  else if(step[0]==='checkpoint') session.checkpoint({tag:step[1]});
  states.push(session.snapshotState());
}
assert(states.every((state)=>state.sequence>=0),'sequence contains invalid value');
assert(states.every((state)=>state.revision>=0),'revision contains invalid value');
for(let index=1;index<states.length;index+=1)assert(states[index].sequence>=states[index-1].sequence,'sequence regressed');
for(const state of states)frozen(state,'history-state');

const saved=session.snapshotState();
const savedJSON=JSON.stringify(saved);
const mutated=clone(saved);
mutated.history.push({sequence:999,ok:false});
mutated.receipts.push({id:'forged',ok:false});
assert(JSON.stringify(session.snapshotState())===savedJSON,'snapshot leaked mutable reference');
assert(session.snapshotState().history.length===saved.history.length,'history length changed through clone');
assert(session.snapshotState().receipts.length===saved.receipts.length,'receipt length changed through clone');

const checkpoint=saved.checkpoint;
assert(checkpoint,'checkpoint absent from snapshot');
const resumed=session.resume(checkpoint);
assert(resumed.ok,'resume replay failed');
assert(resumed.view.activeService===checkpoint.activeService,'resume service mismatch');
assert(resumed.view.panel===checkpoint.panel,'resume panel mismatch');

const secondSession=createSettlementWorldCoverageSession({initialState:clone(base),assets:clone(assets),now:()=>1700000000000,handlers:{
  talk:()=>({ok:true,serviceId:'tavern',reputationDelta:1}),
  craft:()=>({ok:true,serviceId:'blacksmith',xpDelta:15}),
  train:()=>({ok:true,serviceId:'barracks',xpDelta:12}),
}});
secondSession.open('market','trade');
secondSession.setPanel('trade');
await secondSession.execute('talk',{});
secondSession.open('blacksmith','craft');
await secondSession.execute('craft',{recipeId:'iron_sword'});
secondSession.open('barracks','quests');
await secondSession.execute('train',{});
secondSession.open('house','save');
secondSession.checkpoint({tag:'deterministic'});
secondSession.resume(secondSession.snapshotState().checkpoint);
assert(session.snapshotState().digest===secondSession.snapshotState().digest,'same input replay digest mismatch');
assert(JSON.stringify(session.view())===JSON.stringify(secondSession.view()),'same input replay view mismatch');

const beforeMutation=clone(secondSession.snapshotState());
const view=secondSession.view();
try{view.services[0].status='forged';}catch{}
try{view.player.copper=0;}catch{}
assert(JSON.stringify(secondSession.snapshotState())===JSON.stringify(beforeMutation),'view mutation altered session');

const acceptance=createSettlementWorldCoverageAcceptance(proofInput);
const proof=createSettlementWorldCoverageProof(proofInput);
assert(acceptance.status==='green','coverage acceptance not green');
assert(proof.assetProof.missing===0,'coverage proof missing asset count not zero');
assert(proof.materialProof.placeholderCount===0,'coverage proof placeholder count not zero');
assert(proof.placementProof.invalidCount===0,'coverage proof invalid placement count not zero');
assert(proof.visualProof.expectedResolution.width===1536,'visual proof width drift');
assert(proof.visualProof.expectedResolution.height===1024,'visual proof height drift');

const pointerInput=clone(proofInput);
pointerInput.assets[0].status='pointer';
pointerInput.assets[0].hydrated=false;
const pointerAcceptance=createSettlementWorldCoverageAcceptance(pointerInput);
assert(pointerAcceptance.assets.some((asset)=>asset.status==='pointer'),'pointer evidence lost');
assert(pointerAcceptance.assets.every((asset)=>asset.status!=='missing'),'pointer must not become missing');

const missingInput=clone(proofInput);
missingInput.assets=missingInput.assets.filter((asset)=>asset.assetId!=='door-north');
const missingAcceptance=createSettlementWorldCoverageAcceptance(missingInput);
assert(missingAcceptance.assets.filter((asset)=>asset.status==='missing').length===0,'missing status must only reflect explicit missing asset observations');
assert(missingAcceptance.status!=='green','missing gateway evidence must not pass coverage');

const invalidMaterialInput=clone(proofInput);
invalidMaterialInput.manifests[0].placeholderCount=1;
invalidMaterialInput.manifests[0].missingMaterialCount=2;
invalidMaterialInput.manifests[0].singleSurfaceRisk=true;
const invalidMaterial=createSettlementWorldCoverageAcceptance(invalidMaterialInput);
assert(invalidMaterial.manifests.invalidCount>0,'invalid material manifest not caught');
assert(invalidMaterial.flags.noPlaceholderMaterials===false,'placeholder guard missing');
assert(invalidMaterial.flags.noMissingMaterials===false,'missing material guard missing');
assert(invalidMaterial.flags.noSingleSurfaceRisk===false,'single surface guard missing');

const invalidPlacementInput=clone(proofInput);
invalidPlacementInput.placements[0].grounded=false;
invalidPlacementInput.placements[0].overlapRisk=true;
invalidPlacementInput.placements[0].position.y=2;
const invalidPlacement= createSettlementWorldCoverageAcceptance(invalidPlacementInput);
assert(invalidPlacement.placements.invalidCount===1,'invalid placement not caught');
assert(invalidPlacement.flags.noPlacementRisk===false,'placement risk guard missing');

const invalidCameraInput=clone(proofInput);
invalidCameraInput.cameras=[{profile:'full-world',width:640,height:360,projection:'perspective',readable:false,blackSkyRisk:true,seamRisk:true,clippingRisk:true}];
const invalidCamera=createSettlementWorldCoverageAcceptance(invalidCameraInput);
assert(!invalidCamera.cameras.valid,'invalid camera not caught');
assert(invalidCamera.flags.camerasValid===false,'camera flag missing');

const invalidInteractionInput=clone(proofInput);
invalidInteractionInput.interactions=invalidInteractionInput.interactions.map((item,index)=>index===0?{...item,sequence:8}:item);
const invalidInteraction=createSettlementWorldCoverageAcceptance(invalidInteractionInput);
assert(invalidInteraction.interactions.monotonicSequence===false,'non-monotonic interaction not caught');
assert(invalidInteraction.flags.interactionsValid===false,'interaction flag missing');

const stateVariants=[
  {name:'healthy',snapshot:base,expectBlocked:0},
  {name:'outside',snapshot:{...base,inSettlement:false},expectBlocked:7},
  {name:'defeated',snapshot:{...base,health:0},expectBlocked:7},
  {name:'closed',snapshot:{...base,settlementOpen:false},expectBlocked:0},
  {name:'disabled-save',snapshot:{...base,saveEnabled:false},expectBlocked:0},
  {name:'fatigued',snapshot:{...base,fatigue:92},expectBlocked:0},
];
for(const variant of stateVariants){
  const generated=createSettlementWorldCoveragePlan({snapshot:variant.snapshot,assets});
  const blocked=generated.services.filter((service)=>service.status==='blocked').length;
  assert(blocked>=variant.expectBlocked,`${variant.name} blocked count regression`);
  frozen(generated,`${variant.name}-plan`);
}

for(const action of SETTLEMENT_WORLD_COVERAGE_API.intents){
  const actionSession=createSettlementWorldCoverageSession({initialState:base,assets});
  const payload=action==='buy'||action==='sell'||action==='trade'?{itemId:'bread',quantity:1}:action==='craft'?{recipeId:'iron_sword'}:action==='travel'?{routeId:'north_gate',cost:18,fatigue:12}:{};
  const result=await actionSession.execute(action,payload);
  assert(result&&typeof result.ok==='boolean',`action result malformed for ${action}`);
}

const stateBudget=createSettlementWorldCoverageSession({initialState:base,assets,historyLimit:5});
for(let index=0;index<20;index+=1){await stateBudget.execute('talk',{});}
assert(stateBudget.view().history.length<=5,'history bound exceeded');

const queueBudget=createSettlementWorldCoverageSession({initialState:base,assets});
queueBudget.queue(Array.from({length:80},(_,index)=>({id:`queued-${index}`,intent:'talk',payload:{}})));
assert(queueBudget.snapshotState().intents.length<=48,'intent queue bound exceeded');

const receiptBudget=createSettlementWorldCoverageSession({initialState:base,assets});
for(let index=0;index<40;index+=1)await receiptBudget.execute('talk',{});
assert(receiptBudget.view().receipts.length<=32,'receipt bound exceeded');

const disposal=createSettlementWorldCoverageSession({initialState:base,assets});
assert(disposal.dispose()===true,'dispose first result drift');
assert(disposal.dispose()===false,'dispose idempotency drift');
const disposedReadiness=disposal.readiness('talk',{});
assert(disposedReadiness.ready===true||disposedReadiness.ready===false,'disposed readiness malformed');
const disposedExecute=await disposal.execute('talk',{});
assert(disposedExecute.ok===false,'disposed execute must fail closed');
assert(disposedExecute.reason==='disposed','disposed reason drift');

const stableProof=createSettlementWorldCoverageProof(proofInput);
assert(hash(stableProof)===hash(stableProof),'proof hash self-stability failed');
assert(stableProof.fingerprint,'proof fingerprint missing');
assert(stableProof.serviceProof.length===8,'service proof count drift');
assert(stableProof.serviceProof.every((row)=>typeof row.status==='string'),'service proof status malformed');

console.log('Settlement World Coverage Determinism: PASS');
console.log(JSON.stringify({
  firstPlan:firstPlan.fingerprint,
  replayPlan:secondPlan.fingerprint,
  session:session.snapshotState().digest,
  proof:proof.fingerprint,
  mutations,
  serviceCount:SETTLEMENT_WORLD_COVERAGE_API.services.length,
  intentCount:SETTLEMENT_WORLD_COVERAGE_API.intents.length,
}));
console.log(`replayHash=${hash(secondSession.snapshotState())}`);
console.log(`planHash=${hash(firstPlan)}`);
console.log(`proofHash=${hash(proof)}`);
console.log(`serviceFingerprint=${proof.fingerprint}`);
console.log(`sessionDigest=${session.snapshotState().digest}`);
console.log(`serviceCount=${SETTLEMENT_WORLD_COVERAGE_API.services.length}`);