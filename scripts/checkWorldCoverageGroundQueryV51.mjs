import assert from 'node:assert/strict';
import {
  queryCanonicalGroundContextV51,
  queryCanonicalGroundBatchV51,
  queryCanonicalGroundForAgentV51,
  compareCanonicalGroundContextV51,
  WORLD_COVERAGE_GROUND_QUERY_V51,
} from '../src/3d/world/worldCoverageGroundQueryV51.js';

const base={
  id:'ridge',
  position:{x:120,y:840,z:-260},
  elevation:840,
  colliderY:840,
  canonicalHeight:840,
  slope:.62,
  moisture:.48,
  snow:.22,
  waterDistance:840,
  riverDistance:900,
  lakeDistance:1200,
  seaDistance:1800,
  waterDepth:0,
  roadDistance:140,
  settlementDistance:900,
  biome:'alpine',
};

const context=queryCanonicalGroundContextV51(base);
assert.equal(context.version,'v51-ground-query');
assert.equal(context.valid,true);
assert.deepEqual(context.position,{x:120,y:840,z:-260});
assert.equal(context.ground.parity.parity,true);
assert.equal(context.ground.parity.colliderDelta,0);
assert.equal(context.ground.parity.canonicalDelta,0);
assert.equal(context.slope.class,'steep');
assert.equal(context.hydrology.category,'river');
assert.equal(context.hydrology.submerged,false);
assert.equal(context.placement.eligible,true);
assert.equal(context.navigation.walkable,true);
assert.equal(context.biome.ecotoneHints.alpine,true);
assert.equal(context.biome.ecotoneHints.rocky,true);
assert.match(context.digest,/^[0-9a-f]{8}$/);
assert.equal(Object.isFrozen(context),true);

const wet={...base,id:'wet',position:{x:140,y:15,z:-40},elevation:15,colliderY:15,canonicalHeight:15,moisture:.9,waterDistance:12,riverDistance:3,lakeDistance:80,seaDistance:300,waterDepth:0.4,slope:.12,biome:'wetland'};
const wetContext=queryCanonicalGroundContextV51(wet);
assert.equal(wetContext.hydrology.category,'river');
assert.equal(wetContext.hydrology.submerged,false);
assert.equal(wetContext.hydrology.wetEdge,true);
assert.equal(wetContext.biome.ecotoneHints.wetland,true);
assert.equal(wetContext.navigation.walkable,true);

const submerged={...wet,id:'submerged',waterDistance:.7,waterDepth:2.1};
const submergedContext=queryCanonicalGroundContextV51(submerged);
assert.equal(submergedContext.hydrology.submerged,true);
assert.equal(submergedContext.placement.eligible,false);
assert.equal(submergedContext.placement.blockedReasons.includes('water'),true);
assert.equal(submergedContext.navigation.walkable,false);

const cliff={...base,id:'cliff',slope:.91};
const cliffContext=queryCanonicalGroundContextV51(cliff);
assert.equal(cliffContext.slope.class,'cliff');
assert.equal(cliffContext.placement.eligible,false);
assert.equal(cliffContext.placement.blockedReasons.includes('cliff'),true);
assert.equal(cliffContext.navigation.walkable,false);

const snow={...base,id:'snow',snow:.99};
const snowContext=queryCanonicalGroundContextV51(snow);
assert.equal(snowContext.placement.eligible,false);
assert.equal(snowContext.placement.blockedReasons.includes('permanent-snow'),true);

const road={...base,id:'road',roadDistance:2};
const roadContext=queryCanonicalGroundContextV51(road);
assert.equal(roadContext.placement.eligible,false);
assert.equal(roadContext.placement.blockedReasons.includes('road'),true);

const settlement={...base,id:'settlement',settlementDistance:2};
const settlementContext=queryCanonicalGroundContextV51(settlement);
assert.equal(settlementContext.placement.eligible,false);
assert.equal(settlementContext.placement.blockedReasons.includes('settlement'),true);

const parityBad={...base,id:'parity-bad',colliderY:839.7,canonicalHeight:840.3};
const parityContext=queryCanonicalGroundContextV51(parityBad);
assert.equal(parityContext.ground.parity.parity,false);
assert.equal(parityContext.ground.parity.colliderDelta,.3);
assert.equal(parityContext.ground.parity.canonicalDelta,.3);

const missingBiome=queryCanonicalGroundContextV51({...base,id:'missing-biome',biome:undefined});
assert.equal(missingBiome.valid,false);
assert.equal(missingBiome.fields.canonicalBiome,false);
assert.equal(missingBiome.fields.missing.includes('biome'),false);

const batch=queryCanonicalGroundBatchV51([base,wet,cliff]);
assert.equal(batch.version,'v51-ground-query');
assert.equal(batch.count,3);
assert.equal(batch.truncated,false);
assert.equal(batch.valid,true);
assert.equal(batch.results.length,3);
assert.match(batch.digest,/^[0-9a-f]{8}$/);
assert.equal(Object.isFrozen(batch.results),true);

const many=Array.from({length:520},(_,i)=>({...base,id:`s-${i}`,position:{x:i,y:100,z:i}}));
const capped=queryCanonicalGroundBatchV51(many);
assert.equal(capped.count,512);
assert.equal(capped.truncated,true);

const agent=queryCanonicalGroundForAgent('npc-fauna',base);
assert.equal(agent.version,'v51-ground-query');
assert.equal(agent.agent,'npc-fauna');
assert.equal(agent.contract.queryOnly,true);
assert.equal(agent.contract.mutationAllowed,false);
assert.equal(agent.contract.assetPlacementAuthority,'MaterialAssignmentCore+WorldAssetPlacementPipeline');
assert.equal(agent.context.valid,true);

const changed=compareCanonicalGroundContextV51(base,{...base,elevation:900,colliderY:900,canonicalHeight:900,slope:.72,moisture:.62,snow:.44,waterDistance:1200});
assert.equal(changed.version,'v51-ground-query');
assert.equal(changed.sameBiome,true);
assert.equal(changed.delta.elevation,60);
assert.equal(changed.delta.slope,.1);
assert.equal(changed.delta.moisture,.14);
assert.equal(changed.delta.snow,.22);
assert.equal(changed.delta.waterDistance,360);

assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.mutationAllowed,false);
assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.waterEpsilon,2);
assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.cliffSlope,.78);
assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.permanentSnow,.94);
assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.roadClearance,8);
assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.settlementClearance,8);
assert.equal(WORLD_COVERAGE_GROUND_QUERY_V51.assetPlacementAuthority,'MaterialAssignmentCore+WorldAssetPlacementPipeline');
assert.deepEqual(WORLD_COVERAGE_GROUND_QUERY_V51.requiredFields,[
  'elevation','slope','moisture','snow','waterDistance','roadDistance','settlementDistance','biome',
]);

console.log('checkWorldCoverageGroundQueryV51: PASS');
