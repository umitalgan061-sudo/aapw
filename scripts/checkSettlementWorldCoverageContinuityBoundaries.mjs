import { strict as assert } from 'node:assert';
import {
  boundaryBandFor,
  boundaryOwnerFor,
  chunkKeyFor,
  chunkBoundsFor,
  continuitySeedFor,
  continuityWindowForChunk,
  distanceToChunkBoundary,
  pointInWindow,
} from '../src/3d/world/geographicAssetRuntimeOrchestrator.js';
import {
  buildSettlementWorldCoverageContinuityContext,
  planSettlementWorldCoverageTransition,
} from '../src/3d/gameplay/settlementWorldCoverageContinuity.js';
import { createSettlementWorldCoverageContinuityPlan } from '../src/3d/gameplay/settlementWorldCoverageContinuityPlanner.js';

const settlement = {
  id:'winterhold', regionId:'north_temperate_forest',
  anchor:{x:512,y:18,z:768}, entrance:{x:520,y:18,z:768},
  services:['gate','market','tavern','blacksmith','farm','barracks','stable','house'],
};
const surface = { biome:'north-temperate', layer:'forest', moisture:.7, elevationMeters:300, slopeDegrees:5 };

assert.equal(chunkKeyFor(512, 768), '4:6');
assert.equal(chunkKeyFor(511.999, 767.999), '3:5');
const bounds = chunkBoundsFor('4:6');
assert.deepEqual(bounds, { minX:512, maxX:640, minZ:768, maxZ:896 });
assert.equal(boundaryBandFor(512,768), true);
assert.equal(boundaryBandFor(576,832), false);
assert.ok(distanceToChunkBoundary(512,768) <= 8);
assert.ok(distanceToChunkBoundary(576,832) > 8);
assert.equal(boundaryOwnerFor(512,768), '3:5');
assert.equal(boundaryOwnerFor(576,832), '4:6');

const window = continuityWindowForChunk('4:6');
assert.equal(window.radius, 24);
assert.equal(pointInWindow({x:512,z:768}, window), true);
assert.equal(pointInWindow({x:490,z:746}, window), true);
assert.equal(pointInWindow({x:480,z:736}, window), false);

const seedA = continuitySeedFor({worldX:512,worldZ:768,seed:77,familyId:'winterhold'});
const seedB = continuitySeedFor({worldX:512,worldZ:768,seed:77,familyId:'winterhold'});
const seedC = continuitySeedFor({worldX:512,worldZ:768,seed:78,familyId:'winterhold'});
assert.equal(seedA, seedB);
assert.notEqual(seedA, seedC);

const exact = buildSettlementWorldCoverageContinuityContext({ settlement, player:{position:{x:548,y:18,z:768},inSettlement:false,settlementOpen:true,health:100}, surface, regionId:settlement.regionId, seed:19 });
assert.equal(exact.stage, 'threshold');
assert.equal(exact.worldChunkKey, '4:6');
assert.equal(typeof exact.ownerChunkKey, 'string');

const edge = buildSettlementWorldCoverageContinuityContext({ settlement, player:{position:{x:640,y:18,z:896},inSettlement:false,settlementOpen:true,health:100}, surface, regionId:settlement.regionId, seed:19 });
assert.equal(edge.worldChunkKey, '4:6');
assert.equal(edge.boundaryBand, true);

const far = planSettlementWorldCoverageTransition({ settlement, player:{position:{x:1000,y:18,z:1000},inSettlement:false,settlementOpen:true,health:100}, surface, regionId:settlement.regionId, seed:19 });
assert.equal(far.transition.gatewayState,'blocked');
assert.equal(far.transition.canApproach,false);

const approach = planSettlementWorldCoverageTransition({ settlement, player:{position:{x:650,y:18,z:768},inSettlement:false,settlementOpen:true,health:100}, surface, regionId:settlement.regionId, seed:19 });
assert.equal(approach.transition.gatewayState,'approach-only');
assert.equal(approach.transition.canApproach,true);

const threshold = planSettlementWorldCoverageTransition({ settlement, player:{position:{x:548,y:18,z:768},inSettlement:false,settlementOpen:true,health:100}, surface, regionId:settlement.regionId, seed:19 });
assert.equal(threshold.transition.gatewayState,'available');
assert.equal(threshold.transition.canEnter,true);

const inside = planSettlementWorldCoverageTransition({ settlement, player:{position:{x:512,y:18,z:768},inSettlement:true,settlementOpen:true,health:100}, surface, regionId:settlement.regionId, seed:19 });
assert.equal(inside.transition.gatewayState,'inside');
assert.equal(inside.transition.canExit,true);

const defeated = planSettlementWorldCoverageTransition({ settlement, player:{position:{x:512,y:18,z:768},inSettlement:true,settlementOpen:true,health:0}, surface, regionId:settlement.regionId, seed:19 });
assert.equal(defeated.transition.gatewayState,'departure-only');
assert.equal(defeated.transition.canExit,true);
assert.equal(defeated.transition.canEnter,false);

const closed = planSettlementWorldCoverageTransition({ settlement, player:{position:{x:548,y:18,z:768},inSettlement:false,settlementOpen:false,health:100}, surface, regionId:settlement.regionId, seed:19 });
assert.equal(closed.transition.gatewayState,'approach-only');
assert.equal(closed.transition.canEnter,false);

const plannerAtThreshold = createSettlementWorldCoverageContinuityPlan({ settlement, player:{position:{x:548,y:18,z:768},inSettlement:false,settlementOpen:true,health:100,copper:200}, surface, regionId:settlement.regionId, seed:19 });
assert.equal(plannerAtThreshold.gateway.canEnter,true);
assert.ok(plannerAtThreshold.approach.count > 0);
assert.ok(plannerAtThreshold.recommendedService);

const plannerAtFar = createSettlementWorldCoverageContinuityPlan({ settlement, player:{position:{x:1000,y:18,z:1000},inSettlement:false,settlementOpen:true,health:100,copper:200}, surface, regionId:settlement.regionId, seed:19 });
assert.equal(plannerAtFar.gateway.canEnter,false);
assert.ok(plannerAtFar.serviceRecommendations.length === 8);

const waterSurface = { ...surface, biome:'river', layer:'shoreline', isWater:true, waterBody:'lake' };
const water = buildSettlementWorldCoverageContinuityContext({ settlement, player:{position:{x:548,y:18,z:768},inSettlement:false,settlementOpen:true,health:100}, surface:waterSurface, regionId:settlement.regionId, seed:20 });
assert.equal(water.geography.layer,'shoreline');
assert.equal(water.surface.isWater,true);

const badInput = buildSettlementWorldCoverageContinuityContext({ settlement:null, player:null, surface:null, regionId:null, seed:null });
assert.ok(Number.isFinite(badInput.player.x));
assert.ok(Number.isFinite(badInput.player.z));
assert.ok(Number.isFinite(badInput.distance));
assert.ok(Number.isFinite(badInput.continuitySeed));

const deterministicPlans = Array.from({length:12},(_,index)=>planSettlementWorldCoverageTransition({ settlement, player:{position:{x:548 + index,y:18,z:768},inSettlement:false,settlementOpen:true,health:100}, surface, regionId:settlement.regionId, seed:42 }));
assert.equal(new Set(deterministicPlans.map((plan)=>plan.digest)).size, deterministicPlans.length);
for(const plan of deterministicPlans) assert.ok(plan.gatewayCandidates.length === 16);

const replayPlans = deterministicPlans.map((plan,index)=>planSettlementWorldCoverageTransition({ settlement, player:{position:{x:548 + index,y:18,z:768},inSettlement:false,settlementOpen:true,health:100}, surface, regionId:settlement.regionId, seed:42 }));
assert.deepEqual(deterministicPlans.map((plan)=>plan.digest), replayPlans.map((plan)=>plan.digest));

console.log('Settlement World Coverage Continuity Boundaries: PASS');
console.log(JSON.stringify({
  canonicalChunk:'4:6',
  continuityWindowRadius:window.radius,
  thresholdGateway:threshold.transition.gatewayState,
  insideGateway:inside.transition.gatewayState,
  defeatedGateway:defeated.transition.gatewayState,
  farGateway:far.transition.gatewayState,
  plannerRecommendation:plannerAtThreshold.recommendedService.serviceId,
  deterministicSamples:deterministicPlans.length,
}));
