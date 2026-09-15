import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV67, validateEnvironmentRuntimeV67, runtimeQualityScoreV67, acceptanceGateV67, compareEnvironmentRuntimeV67, immutableContractSnapshotV67 } from '../src/3d/world/environmentRuntimeIntegrationV67.js';

const samples=Array.from({length:18},(_,i)=>({
  id:`integration-${i}`,
  elevation:220+i*70,
  slope:7+i*3.5,
  moisture:.3+(i%7)*.09,
  temperature:4+(i%8)*3,
  humidity:.48+(i%4)*.1,
  wind:6+i,
  visibility:.4+(i%6)*.08,
  rain:.1+(i%5)*.12,
  canopy:.18+(i%7)*.11,
  waterDistance:18+i*16,
  humanPressure:i%6===0?.7:.12,
  biome:['forest','temperate','grassland','taiga','wetland','alpine'][i%6],
}));

const runtime=buildEnvironmentRuntimeV67({samples,clock:13,dayOfYear:196,seed:'integration-v67',weather:{precipitation:.22}});
assert.equal(validateEnvironmentRuntimeV67(runtime).ok,true);
assert.equal(runtime.contract.noWorldMutation,true);
assert.equal(runtime.contract.placementAuthority,'WorldAssetPlacementPipeline.js');
assert.equal(runtime.contract.materialAuthority,'MaterialAssignmentCore.js');
assert.equal(runtime.runtime.sampleCount,18);
assert.ok(runtime.digest.length===8);
assert.equal(runtime.hydrology.length,18);
assert.equal(runtime.weatherField.length,18);
assert.equal(runtime.surface.length,18);
assert.equal(runtime.atmosphere.length,18);
assert.equal(runtime.wildlife.length,18);
assert.equal(runtime.hazards.length,18);
assert.equal(runtime.navigation.length,18);
assert.equal(runtime.vegetation.length,18);
assert.equal(runtime.climate.length,18);
assert.equal(runtime.acoustics.length,18);
assert.equal(runtime.resonance.length,18);
assert.equal(runtime.continuity.length,17);
assert.equal(runtime.shelter.length,18);
assert.equal(runtime.visibility.length,18);
assert.equal(runtime.coupling.length,18);
assert.equal(runtime.geology.length,18);
assert.ok(runtime.events.activeCount>=0);
const quality=runtimeQualityScoreV67(runtime);
assert.ok(quality>=0&&quality<=1);
assert.equal(acceptanceGateV67(runtime).ok,true);
const snapshot=immutableContractSnapshotV67(runtime);
assert.equal(snapshot.noWorldMutation,true);
assert.equal(snapshot.deterministic,true);
assert.equal(snapshot.digest,runtime.digest);
const replay=buildEnvironmentRuntimeV67({samples,clock:13,dayOfYear:196,seed:'integration-v67',weather:{precipitation:.22}});
assert.deepEqual(compareEnvironmentRuntimeV67(runtime,replay).sameDigest,true);
assert.equal(replay.digest,runtime.digest);
console.log('V67 integration regression PASS');
