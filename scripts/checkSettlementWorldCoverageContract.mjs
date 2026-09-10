import {
  SETTLEMENT_WORLD_COVERAGE_API,
  createSettlementWorldCoveragePlan,
  createSettlementWorldCoverageSession,
  validateSettlementWorldCoveragePlan,
} from '../src/3d/gameplay/settlementWorldCoverageSlice.js';
import {
  SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_API,
  createSettlementWorldCoverageAcceptance,
  createSettlementWorldCoverageProof,
  validateSettlementWorldCoverageAcceptance,
} from '../src/3d/gameplay/settlementWorldCoverageAcceptance.js';

const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const clone=(value)=>JSON.parse(JSON.stringify(value));
const frozen=(value,label='value')=>{assert(Object.isFrozen(value),`${label} not frozen`);if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))if(child&&typeof child==='object')frozen(child,`${label}.${key}`);};
const stable=(value)=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;

const state={settlementId:'canonical-settlement',locationId:'gate',inSettlement:true,settlementOpen:true,health:100,maxHealth:100,copper:250,fatigue:25,reputation:10,saveEnabled:true,inventory:{bread:6,iron_ore:12,coal:8,leather:6,linen:8,stew:2},equipment:{mainHand:'iron_sword',gloves:'leather_gloves'},skills:{smithing:5,commerce:4,survival:4,dialogue:3},perks:['roadwise','merchant_road','market_eye'],quests:{},flags:{gate_open:true,met_smith:true},survival:{hunger:15,exposure:2,morale:10}};

const assetEvidence=[];
const addAsset=(family,assetId,status='loaded',extras={})=>assetEvidence.push({family,assetId,status,hydrated:['loaded','hydrated','ready'].includes(status),materialSlots:extras.materialSlots??3,textured:extras.textured??true,grounded:extras.grounded??true,path:extras.path??`assets/models/${family}/${assetId}.glb`});
for(const item of ['door-north','road-east','vendor-market','stall-market','forge-blacksmith','workbench-blacksmith','field-farm','barn-farm','stable-main','mount-stable'])addAsset('settlements',item);
for(const item of ['interior-tavern','barracks-main','house-main'])addAsset('houses',item);
for(const item of ['npc-tavern','training-barracks','bed-house'])addAsset('props',item);
addAsset('settlements','lfs-pointer','pointer',{textured:false,grounded:false,materialSlots:0});

const materialEvidence=[];
const addMaterial=(id,role,size=1024)=>materialEvidence.push({id,role,kind:'pbr',textured:true,textureSize:size,albedo:`${id}-albedo`,normal:`${id}-normal`,roughness:`${id}-roughness`,metalness:role==='metal'?`${id}-metalness`:''});
for(const [role,size] of [['wall',2048],['roof',2048],['wood',1024],['door',1024],['window',1024],['metal',1024],['stone-trim',2048]])addMaterial(`${role}-canonical`,role,size);

const manifestEvidence=[];
const addManifest=(serviceId,assetId,materialManifestId,surfaceRoles)=>manifestEvidence.push({id:`${serviceId}-manifest`,assetId,serviceId,materialManifestId,status:'validated',surfaceRoles,materialIds:materialEvidence.map((m)=>m.id),placeholderCount:0,missingMaterialCount:0,singleSurfaceRisk:false,groundAligned:true,sceneAttached:true});
addManifest('gate','door-north','materials-gate',['wall','roof','wood','door','window','metal','stone-trim']);
addManifest('market','vendor-market','materials-market',['wall','roof','wood','metal']);
addManifest('tavern','interior-tavern','materials-tavern',['wall','roof','wood','door','window']);
addManifest('blacksmith','forge-blacksmith','materials-blacksmith',['wall','roof','wood','metal','stone-trim']);
addManifest('farm','field-farm','materials-farm',['wood','stone-trim']);
addManifest('barracks','barracks-main','materials-barracks',['wall','roof','wood','door','window','stone-trim']);
addManifest('stable','stable-main','materials-stable',['wall','roof','wood']);
addManifest('house','house-main','materials-house',['wall','roof','wood','door','window']);
for(const [service,token] of [['gate','door-road'],['market','vendor-stall'],['tavern','interior-npc'],['blacksmith','forge-workbench'],['farm','field-barn'],['barracks','barracks-training'],['stable','stable-mount'],['house','house-bed']])manifestEvidence.push({id:`${service}-${token}-evidence`,serviceId:service,assetId:`${token}-evidence`});

const placementEvidence=[];
const addPlacement=(serviceId,assetId)=>placementEvidence.push({id:`${serviceId}-placement`,assetId,serviceId,status:'attached',manifestId:`${serviceId}-manifest`,materialManifestId:`materials-${serviceId}`,position:{x:0,y:0,z:0},groundPosition:{x:0,y:0,z:0},expectedGroundY:0,slope:5,scale:{x:1,y:1,z:1},visible:true,collisionReady:true,materialValidated:true,grounded:true,overlapRisk:false});
addPlacement('gate','door-north');addPlacement('market','vendor-market');addPlacement('tavern','interior-tavern');addPlacement('blacksmith','forge-blacksmith');addPlacement('farm','field-farm');addPlacement('barracks','barracks-main');addPlacement('stable','stable-main');addPlacement('house','house-main');

const cameras=['full-world','settlement-far','settlement-center','settlement-northwest'].map((profile)=>({profile,width:1536,height:1024,projection:'orthographic',readable:true}));
const interactions=[];
const addInteraction=(id,serviceId,action,sequence,ok=true,reason='')=>interactions.push({id,serviceId,action,sequence,at:sequence,ok,reason});
addInteraction('i1','gate','enter',1);addInteraction('i2','market','trade',2);addInteraction('i3','tavern','talk',3);addInteraction('i4','blacksmith','craft',4);addInteraction('i5','house','save',5);

const completeInput={settlementId:'canonical-settlement',assets:assetEvidence,materials:materialEvidence,manifests:manifestEvidence,placements:placementEvidence,cameras,interactions};
const acceptance=createSettlementWorldCoverageAcceptance(completeInput);
assert(acceptance.status==='green',`expected green acceptance, got ${acceptance.status}; score=${acceptance.score}; flags=${JSON.stringify(acceptance.flags)}; services=${JSON.stringify(acceptance.services)}`);
assert(acceptance.score===1,'complete acceptance score drift');
assert(acceptance.flags.noMissingAssets,'missing asset flag drift');
assert(acceptance.flags.noPlaceholderMaterials,'placeholder material flag drift');
assert(acceptance.flags.noMissingMaterials,'missing material flag drift');
assert(acceptance.flags.noSingleSurfaceRisk,'single surface flag drift');
assert(acceptance.flags.noPlacementRisk,'placement flag drift');
assert(acceptance.flags.camerasValid,'camera flag drift');
assert(acceptance.flags.interactionsValid,'interaction flag drift');
frozen(acceptance,'acceptance');

const acceptanceJSON=JSON.stringify(acceptance);
const acceptanceClone=createSettlementWorldCoverageAcceptance(clone(completeInput));
assert(JSON.stringify(acceptanceClone)===acceptanceJSON,'acceptance serialization is not deterministic');
assert(acceptanceClone.fingerprint===acceptance.fingerprint,'acceptance fingerprint is not deterministic');

const validation=validateSettlementWorldCoverageAcceptance(completeInput);
assert(validation.ok,`complete validation rejected: ${validation.errors.join(',')}`);
frozen(validation,'acceptance-validation');
const proof=createSettlementWorldCoverageProof(completeInput);
assert(proof.acceptance.status==='green','proof status drift');
assert(proof.assetProof.missing===0,'proof must show zero missing assets');
assert(proof.assetProof.pointers===1,'pointer count must remain explicit');
assert(proof.materialProof.placeholderCount===0,'proof placeholder count drift');
assert(proof.placementProof.invalidCount===0,'proof placement invalid count drift');
frozen(proof,'proof');

const matrix=[];
for(const service of SETTLEMENT_WORLD_COVERAGE_API.services){
  const row={service,covered:Boolean(SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_API.services.includes(service)),intents:[],panels:[]};
  const perService={
    gate:['enter','exit','travel'],market:['talk','trade','buy','sell'],tavern:['talk','rest','acceptQuest','advanceQuest'],blacksmith:['talk','trade','craft','equip'],farm:['interact','trade','rest','travel'],barracks:['talk','train','acceptQuest','equip'],stable:['talk','trade','travel','rest'],house:['interact','talk','save','rest'],
  };
  row.intents=perService[service]??[];
  row.panels=service==='market'?['overview','trade']:service==='blacksmith'?['overview','craft','equipment']:service==='tavern'?['overview','dialogue','quests','rest']:service==='gate'?['overview','travel']:service==='house'?['overview','equipment','rest','save']:service==='barracks'?['overview','quests','equipment']:service==='stable'?['overview','travel','rest']:['overview','rest','travel'];
  assert(row.intents.length>0,`service ${service} lost intent contract`);
  assert(row.panels.length>0,`service ${service} lost panel contract`);
  matrix.push(row);
}
assert(matrix.length===8,'service matrix must cover all eight authored services');

for(const intent of SETTLEMENT_WORLD_COVERAGE_API.intents){
  const readinessSession=createSettlementWorldCoverageSession({initialState:state,assets:assetEvidence});
  const payload=intent==='buy'||intent==='sell'||intent==='trade'?{itemId:'bread',quantity:1}:intent==='craft'?{recipeId:'iron_sword'}:intent==='travel'?{routeId:'north_gate',cost:18,fatigue:12}:{};
  const plan=readinessSession.readiness(intent,payload);
  assert(plan.intent===intent,`readiness intent mismatch for ${intent}`);
  assert(typeof plan.ready==='boolean',`readiness missing boolean for ${intent}`);
  assert(typeof plan.reason==='string',`readiness missing reason for ${intent}`);
}

const outside=createSettlementWorldCoverageSession({initialState:{...state,inSettlement:false},assets:assetEvidence});
for(const intent of ['talk','trade','buy','sell','craft','equip','acceptQuest','advanceQuest','travel','rest','train','save']){
  const result=await outside.execute(intent,intent==='buy'?{itemId:'bread'}:intent==='craft'?{recipeId:'iron_sword'}:intent==='travel'?{routeId:'north_gate',cost:18,fatigue:12}:{});
  assert(!result.ok,`outside settlement ${intent} must be blocked`);
  assert(result.reason==='outside-settlement',`outside settlement ${intent} wrong reason: ${result.reason}`);
}
assert((await outside.execute('exit',{})).ok,'outside settlement exit should remain available');

const defeated=createSettlementWorldCoverageSession({initialState:{...state,health:0},assets:assetEvidence});
for(const intent of ['talk','trade','buy','sell','craft','equip','acceptQuest','advanceQuest','travel','rest','train']){
  const result=await defeated.execute(intent,intent==='buy'?{itemId:'bread'}:intent==='craft'?{recipeId:'iron_sword'}:intent==='travel'?{routeId:'north_gate',cost:18,fatigue:12}:{});
  assert(!result.ok,`defeated ${intent} must be blocked`);
  assert(result.reason==='player-defeated',`defeated ${intent} wrong reason: ${result.reason}`);
}

const closed=createSettlementWorldCoverageSession({initialState:{...state,settlementOpen:false},assets:assetEvidence});
const closedEnter=await closed.execute('enter',{});
assert(!closedEnter.ok&&closedEnter.reason==='settlement-closed','closed settlement enter guard failed');

const noCopper=createSettlementWorldCoverageSession({initialState:{...state,copper:0},assets:assetEvidence});
const noCopperBuy=await noCopper.execute('buy',{itemId:'bread',quantity:1});
assert(!noCopperBuy.ok&&noCopperBuy.reason==='insufficient-copper','zero copper buy guard failed');

const noRecipe=createSettlementWorldCoverageSession({initialState:state,assets:assetEvidence});
const noRecipeResult=await noRecipe.execute('craft',{});
assert(!noRecipeResult.ok&&noRecipeResult.reason==='unknown-recipe','missing recipe guard failed');

const noRoute=createSettlementWorldCoverageSession({initialState:state,assets:assetEvidence});
const noRouteResult=await noRoute.execute('travel',{});
assert(!noRouteResult.ok&&noRouteResult.reason==='unknown-route','missing route guard failed');

const noItem=createSettlementWorldCoverageSession({initialState:state,assets:assetEvidence});
const noItemResult=await noItem.execute('buy',{});
assert(!noItemResult.ok&&noItemResult.reason==='item-required','missing item guard failed');

const queue=createSettlementWorldCoverageSession({initialState:state,assets:assetEvidence});
const queued=queue.queue([{id:'a',intent:'talk',payload:{}},{id:'b',intent:'craft',payload:{recipeId:'iron_sword'}},{id:'c',intent:'train',payload:{}}]);
assert(queued.plans.length===3,'queue plan length drift');
const queuedAgain=queue.queue(clone([{id:'a',intent:'talk',payload:{}},{id:'b',intent:'craft',payload:{recipeId:'iron_sword'}},{id:'c',intent:'train',payload:{}}]));
assert(queued.digest===queuedAgain.digest,'queue digest nondeterminism');
const queueRun=await queue.runQueue(true);
assert(queueRun.completed===3,'queue should complete all healthy actions');
assert(queueRun.blocked===0,'queue unexpectedly blocked healthy actions');

const stopQueue=createSettlementWorldCoverageSession({initialState:{...state,inSettlement:false},assets:assetEvidence});
stopQueue.queue([{id:'bad',intent:'talk',payload:{}},{id:'later',intent:'exit',payload:{}}]);
const stopped=await stopQueue.runQueue(true);
assert(stopped.blocked===1&&stopped.results.length===1,'stop-on-failure queue contract failed');

const continueQueue=createSettlementWorldCoverageSession({initialState:{...state,inSettlement:false},assets:assetEvidence});
continueQueue.queue([{id:'bad',intent:'talk',payload:{}},{id:'later',intent:'exit',payload:{}}]);
const continued=await continueQueue.runQueue(false);
assert(continued.results.length===2,'continue-on-failure queue contract failed');
assert(continued.results[1].ok,'continue-on-failure should execute subsequent allowed action');

const checkpointSession=createSettlementWorldCoverageSession({initialState:state,assets:assetEvidence});
const opened=checkpointSession.open('blacksmith','craft');
assert(opened.ok,'blacksmith open failed');
const checkpoint=checkpointSession.checkpoint({source:'contract-test'});
assert(checkpoint.ok,'checkpoint failed');
const restored=checkpointSession.resume(checkpoint.checkpoint);
assert(restored.ok,'resume failed');
assert(restored.view.activeService==='blacksmith','resume active service mismatch');
assert(restored.view.panel==='craft','resume panel mismatch');

const plan=checkpointSession.view();
assert(plan.services.length===8,'session view service count drift');
assert(plan.trade.length<=24,'trade bound drift');
assert(plan.craft.length<=6,'craft bound drift');
assert(plan.travel.length<=6,'travel bound drift');
assert(plan.quests.length<=32,'quest bound drift');
frozen(plan,'session-view');

const planValidation=validateSettlementWorldCoveragePlan({snapshot:state,assets:assetEvidence});
assert(planValidation.ok,`coverage plan invalid: ${planValidation.errors.join(',')}`);
frozen(planValidation,'plan-validation');

const malformedPlan=createSettlementWorldCoveragePlan({snapshot:{health:'not-a-number',copper:'NaN',fatigue:'Infinity',settlementId:null},assets:[null,{},...assetEvidence]});
assert(Number.isFinite(malformedPlan.player.health),'malformed health leaked NaN');
assert(Number.isFinite(malformedPlan.player.copper),'malformed copper leaked NaN');
assert(Number.isFinite(malformedPlan.player.fatigue),'malformed fatigue leaked Infinity');
frozen(malformedPlan,'malformed-plan');

const negativeCamera=createSettlementWorldCoverageAcceptance({ ...completeInput, cameras:[{profile:'full-world',width:-1,height:-1,projection:'perspective',readable:false,blackSkyRisk:true,seamRisk:true,clippingRisk:true}] });
assert(!negativeCamera.cameras.valid,'negative camera must fail');
const floating=createSettlementWorldCoverageAcceptance({ ...completeInput, placements:[{...placementEvidence[0],grounded:false,status:'attached',position:{x:0,y:2,z:0},groundPosition:{x:0,y:0,z:0},overlapRisk:true}] });
assert(floating.placements.invalidCount===1,'floating/overlap placement must fail');
const placeholder=createSettlementWorldCoverageAcceptance({ ...completeInput, manifests:[{...manifestEvidence[0],placeholderCount:1,missingMaterialCount:1,singleSurfaceRisk:true}] });
assert(placeholder.manifests.invalidCount===1,'placeholder/missing material manifest must fail');
const failedInteraction=createSettlementWorldCoverageAcceptance({ ...completeInput, interactions:[...interactions,{id:'bad',serviceId:'market',action:'trade',sequence:6,at:6,ok:false,reason:'npc-busy'}] });
assert(failedInteraction.interactions.failedCount===1,'failed interaction count drift');
assert(!failedInteraction.interactions.valid,'failed interaction set must not be valid');

console.log('Settlement World Coverage Contract: PASS');
console.log(JSON.stringify({
  serviceCount:SETTLEMENT_WORLD_COVERAGE_API.services.length,
  intentCount:SETTLEMENT_WORLD_COVERAGE_API.intents.length,
  serviceMatrix:matrix,
  acceptanceFingerprint:acceptance.fingerprint,
  proofFingerprint:proof.fingerprint,
  planValidation:planValidation.ok,
  queueCompleted:queueRun.completed,
  queueStopped:stopped.results.length,
  queueContinued:continued.results.length,
  checkpointService:restored.view.activeService,
},null,2));
