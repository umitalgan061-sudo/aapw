import assert from 'node:assert/strict';
import {
  V67_POLICY,
  buildRuntimeFrameV67,
  validateRuntimeFrameV67,
  contractSnapshotV67,
  environmentalScoreV67,
  seasonPhaseV67,
  daylightV67,
  thermalComfortV67,
  scenarioSeedV67,
} from '../src/3d/world/environmentRuntimeV67.js';

const samples = Array.from({ length: 16 }, (_, i) => ({
  id:`core-${i}`,
  elevation:300+i*65,
  slope:4+i*4,
  moisture:.24+(i%6)*.11,
  temperature:2+(i%9)*2.4,
  humidity:.45+(i%5)*.09,
  wind:6+i*1.5,
  visibility:.32+(i%6)*.1,
  rain:.06+(i%7)*.09,
  canopy:.2+(i%6)*.12,
  waterDistance:22+i*19,
  humanPressure:i%4===0?.6:.12,
  biome:i%3===0?'forest':'temperate',
}));

const frame=buildRuntimeFrameV67({samples,clock:14,dayOfYear:208,seed:'core-v67'});
const validation=validateRuntimeFrameV67(frame);
assert.equal(validation.ok,true);
assert.equal(frame.policy,V67_POLICY.id);
assert.equal(frame.version,67);
assert.equal(frame.immutable,true);
assert.equal(frame.sampleCount,16);
assert.equal(typeof frame.digest,'string');
assert.equal(frame.digest.length,8);
assert.ok(frame.meanScore>=0&&frame.meanScore<=1);
assert.ok(frame.daylight>=0&&frame.daylight<=1);
assert.equal(seasonPhaseV67(30),'winter');
assert.equal(seasonPhaseV67(100),'spring');
assert.equal(seasonPhaseV67(220),'summer');
assert.equal(seasonPhaseV67(300),'autumn');
assert.equal(daylightV67(12)>daylightV67(0),true);
assert.ok(thermalComfortV67(14)>thermalComfortV67(-10));
assert.ok(samples.every(sample=>environmentalScoreV67(sample)>=0));
assert.ok(samples.every(sample=>environmentalScoreV67(sample)<=1));
const contract=contractSnapshotV67();
assert.equal(contract.noWorldMutation,true);
assert.equal(contract.deterministic,true);
assert.equal(contract.placementAuthority,'WorldAssetPlacementPipeline.js');
assert.equal(contract.materialAuthority,'MaterialAssignmentCore.js');
assert.equal(scenarioSeedV67({id:'same',clock:12}),scenarioSeedV67({id:'same',clock:12}));
assert.notEqual(scenarioSeedV67({id:'same',clock:12}),scenarioSeedV67({id:'other',clock:12}));
const replay=buildRuntimeFrameV67({samples,clock:14,dayOfYear:208,seed:'core-v67'});
assert.deepEqual(replay,frame);
const altered=buildRuntimeFrameV67({samples,clock:15,dayOfYear:208,seed:'core-v67'});
assert.notEqual(altered.digest,frame.digest);
for(const sample of frame.samples){
  assert.ok(typeof sample.id==='string');
  assert.ok(sample.slope>=0&&sample.slope<=1);
  assert.ok(sample.moisture>=0&&sample.moisture<=1);
  assert.ok(sample.humidity>=0&&sample.humidity<=1);
  assert.ok(sample.wind>=0&&sample.wind<=1);
  assert.ok(sample.visibility>=0&&sample.visibility<=1);
  assert.ok(sample.rain>=0&&sample.rain<=1);
  assert.ok(sample.canopy>=0&&sample.canopy<=1);
}
console.log('V67 core regression PASS');
