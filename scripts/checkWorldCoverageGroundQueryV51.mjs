import assert from 'node:assert/strict';
import {queryCanonicalGroundContextV51,queryCanonicalGroundBatchV51,queryCanonicalGroundForAgentV51,compareCanonicalGroundContextV51,WORLD_COVERAGE_GROUND_QUERY_V51} from '../src/3d/world/worldCoverageGroundQueryV51.js';

const base={id:'ridge',position:{x:120,y:840,z:-260},elevation:840,colliderY:840,canonicalHeight:840,slope:.62,moisture:.48,snow:.22,waterDistance:840,riverDistance:900,lakeDistance:1200,seaDistance:1800,waterDepth:0,roadDistance:140,settlementDistance:900,biome:'alpine'};
const context=queryCanonicalGroundContextV51(base);
assert.equal(context.valid,true); assert.deepEqual(context.position,{x:120,y:840,z:-260}); assert.equal(context.ground.parity.parity,true);
assert.equal(context.slope.class,'steep'); assert.equal(context.hydrology.category,'river'); assert.equal(context.placement.eligible,true); assert.equal(context.navigation.walkable,true);
assert.equal(context.biome.ecotoneHints.alpine,true); assert.equal(context.biome.ecotoneHints.rocky,true); assert.match(context.digest,/^[0-9a-f]{8}$/); assert.equal(Object.isFrozen(context),true);

const wet={...base,id:'wet',position:{x:140,y:15,z:-40},elevation:15,colliderY:15,canonicalHeight:15,moisture:.9,waterDistance:12,riverDistance:3,lakeDistance:80,seaDistance:300,waterDepth:.4,slope:.12,biome:'wetland'};
const wetContext=queryCanonicalGroundContextV51(wet);
assert.equal(wetContext.hydrology.category,'river'); assert.equal(wetContext.hydrology.wetEdge,true); assert.equal(wetContext.biome.ecotoneHints.wetland,true); assert.equal(wetContext.navigation.walkable,true);

for(const row of [
  {...base,id:'submerged',waterDistance:.7,waterDepth:2.1},
  {...base,id:'cliff',slope:.91},
  {...base,id:'snow',snow:.99},
  {...base,id:'road',roadDistance:2},
  {...base,id:'settlement',settlementDistance:2},
]) {
  const result=queryCanonicalGroundContextV51(row);
  assert.equal(result.placement.eligible,false);
  assert.ok(result.placement.blockedReasons.length>0);
}
const parity=queryCanonicalGroundContextV51({...base,id:'parity-bad',colliderY:839.7,canonicalHeight:840.3});
assert.equal(parity.ground.parity.parity,false); assert.equal(parity.ground.parity.colliderDelta,.3); assert.equal(parity.ground.parity.canonicalDelta,.3);

const batch=queryCanonicalGroundBatchV51([base,wet,{...base,id:'third',slope:.1}]);
assert.equal(batch.count,3); assert.equal(batch.valid,true); assert.equal(batch.truncated,false); assert.match(batch.digest,/^[0-9a-f]{8}$/);
const many=Array.from({length:520},(_,i)=>({...base,id:`s-${i}`})); const capped=queryCanonicalGroundBatchV51(many); assert.equal(capped.count,512); assert.equal(capped.truncated,true);

const agent=queryCanonicalGroundForAgent('npc-fauna',base); assert.equal(agent.agent,'npc-fauna'); assert.equal(agent.contract.queryOnly,true); assert.equal(agent.contract.mutationAllowed,false); assert.equal(agent.context.valid,true);
const changed=compareCanonicalGroundContextV51(base,{...base,elevation:900,colliderY:900,canonicalHeight:900,slope:.72,moisture:.62,snow:.44,waterDistance:1200});
assert.equal(changed.sameBiome,true); assert.equal(changed.delta.elevation,60); assert.equal(changed.delta.slope,.1); assert.equal(changed.delta.moisture,.14); assert.equal(changed.delta.snow,.22); assert.equal(changed.delta.waterDistance,360);

assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.mutationAllowed,false); assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.waterEpsilon,2); assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.cliffSlope,.78); assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.permanentSnow,.94); assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.roadClearance,8); assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.settlementClearance,8);
console.log('checkWorldCoverageGroundQueryV51: PASS');
