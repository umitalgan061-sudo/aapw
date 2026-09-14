import { strict as assert } from 'node:assert';
import { createSettlementCampaignRuntime } from '../src/3d/gameplay/settlementCampaignRuntime.js';
import { createSettlementWorldCoverageContinuitySession } from '../src/3d/gameplay/settlementWorldCoverageContinuity.js';
import { createSettlementWorldCoverageContinuityPlan } from '../src/3d/gameplay/settlementWorldCoverageContinuityPlanner.js';
import { validateSettlementWorldCoverageContinuityAudit } from '../src/3d/gameplay/settlementWorldCoverageContinuityAudit.js';
import { validateSettlementWorldCoverageContinuityCatalogue } from '../src/3d/gameplay/settlementWorldCoverageContinuityCatalog.js';

const settlementId = 'north-settlement';
const settlement = { id:settlementId, regionId:'north_temperate_forest', anchor:{x:512,y:18,z:768}, entrance:{x:520,y:18,z:768}, services:['gate','market','tavern','blacksmith','farm','barracks','stable','house'] };
const surface = { biome:'north-temperate', layer:'forest', moisture:.68, elevationMeters:312, slopeDegrees:7, roadDistanceMeters:10 };
const player = { settlementId, locationId:settlementId, inSettlement:true, health:92, maxHealth:100, copper:240, fatigue:36, reputation:3, inventory:{iron_ore:10,coal:5,bread:5}, skills:{smithing:4,commerce:4}, perks:['roadwise','merchant_road'], quests:{}, flags:{}, survival:{hunger:20,exposure:3,morale:4} };

assert.equal(validateSettlementWorldCoverageContinuityCatalogue().ok,true);
assert.equal(validateSettlementWorldCoverageContinuityCatalogue().count,560);

const events=[];
const handlers={};
for(const action of ['enterSettlement','exitSettlement','interact','talk','trade','buy','sell','craft','equip','acceptQuest','advanceQuest','travel','rest','train','save']) handlers[action]=async ({action:kind})=>({ok:true,action:kind});
const runtime=createSettlementCampaignRuntime({initialState:player,handlers,onEvent:(event)=>events.push(event),now:()=>1700000000000});
assert.equal(runtime.validateContent().ok,true);
assert.equal(runtime.getViewModel().player.settlementId,settlementId);

const opened=runtime.open('market','trade');
assert.equal(opened.panel,'trade');
assert.equal(opened.activeService.id,'market');
const traded=await runtime.execute('trade',{itemId:'bread',quantity:1,direction:'buy',requestId:'integration-trade-1'});
assert.equal(traded.ok,true);
const duplicated=await runtime.execute('trade',{itemId:'bread',quantity:1,direction:'buy',requestId:'integration-trade-1'});
assert.equal(duplicated.ok,false);
assert.equal(duplicated.reason,'duplicate-request');
const forged=await runtime.execute('craft',{recipeId:'iron_sword',requestId:'integration-craft-1'});
assert.equal(forged.ok,true);
const saved=await runtime.save({requestId:'integration-save-1',source:'continuity'});
assert.equal(saved.ok,true);
const exported=runtime.exportState();
assert.equal(exported.version,1);
assert.equal(runtime.importState(exported).ok,true);
assert.ok(events.length>=3);
assert.ok(events.every((event)=>Number.isFinite(event.revision)));

const bridge=createSettlementWorldCoverageContinuitySession({ settlement, initialPlayer:{position:{x:538,y:18,z:768},inSettlement:false,settlementOpen:true,health:92,fatigue:36}, surface, regionId:settlement.regionId, seed:7733, now:()=>1700000000000 });
assert.equal(bridge.transition().transition.gatewayState,'available');
const entered=bridge.enter();
assert.equal(entered.ok,true);
assert.equal(entered.player.inSettlement,true);
const bridgeCheckpoint=bridge.checkpoint({from:'integration',runtimeState:runtime.exportState()});
assert.equal(bridgeCheckpoint.ok,true);
const moved=bridge.move({position:{x:700,y:18,z:768},inSettlement:false,health:92});
assert.equal(moved.ok,true);
assert.equal(bridge.resume(bridgeCheckpoint.checkpoint).ok,true);
const wrongSettlement=bridge.resume({...bridgeCheckpoint.checkpoint,settlementId:'other-settlement'});
assert.equal(wrongSettlement.ok,false);
assert.equal(wrongSettlement.reason,'settlement-mismatch');

const plan=createSettlementWorldCoverageContinuityPlan({settlement,player:{position:{x:538,y:18,z:768},inSettlement:false,settlementOpen:true,health:92,copper:240,fatigue:36},surface,regionId:settlement.regionId,seed:7733});
assert.equal(plan.catalogue.count,560);
assert.equal(plan.stage,'threshold');
assert.equal(plan.gatewayState,'available');
assert.equal(plan.serviceRecommendations.length,8);
assert.equal(plan.recommendedService.serviceId,'market');

const audit=validateSettlementWorldCoverageContinuityAudit({settlement,player:{position:{x:538,y:18,z:768},inSettlement:false,settlementOpen:true,health:92},surface,regionId:settlement.regionId,seed:7733});
assert.equal(audit.ok,true,audit.errors.join(','));
assert.equal(audit.report.services.count,8);
assert.equal(audit.matrix.rowCount,8);

const stateAfter=runtime.getViewModel();
assert.equal(stateAfter.activeService.id,'market');
assert.ok(stateAfter.history.length>=1);
runtime.dispose();
assert.equal(runtime.isDisposed(),true);
const afterDispose=await runtime.execute('talk',{requestId:'post-dispose'});
assert.equal(afterDispose.ok,false);
assert.equal(afterDispose.code,'disposed');

console.log('Settlement World Coverage Continuity Integration: PASS');
console.log(JSON.stringify({runtimeVersion:runtime.version,events:events.length,continuityPlan:plan.fingerprint,auditFingerprint:audit.fingerprint,bridgeSequence:bridgeCheckpoint.checkpoint.sequence}));
