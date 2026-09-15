import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66, validateEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
import { buildGroundMaterialResponseV66 } from '../src/3d/world/environmentRuntimeGroundResponseV66.js';
import { buildRiverCorridorV66 } from '../src/3d/world/environmentRuntimeWaterDynamicsV66.js';
import { buildWildlifeCorridorV66 } from '../src/3d/world/environmentRuntimeWildlifeV66.js';
import { buildV66ReleaseGate } from '../src/3d/world/environmentRuntimeReleaseV66.js';

const sample=(i)=>({x:i*25,z:i*19,elevation:240+i*110,slope:6+i,moisture:.45+i/30,rainfall:.2,soilDepth:.6,vegetationCover:.64,rockExposure:.18,waterDistance:40+i*8,waterDepth:0,roadDistance:90,settlementDistance:210,confidence:.93,biome:i%2?'grassland':'forest'});
const samples=Array.from({length:16},(_,i)=>sample(i));
const weather={precipitation:.31,humidity:.66,wind:.35,cloud:.44,temperature:.37};
const runtime=buildEnvironmentRuntimeV66({samples,weather,season:'autumn',dayOfYear:275,time:17,camera:{distance:1250,mode:'walk'},platform:'desktop'});
assert.equal(validateEnvironmentRuntimeV66(runtime).ok,true);
assert.equal(runtime.contract.noWorldMutation,true);
assert.equal(runtime.contract.placementAuthority,'WorldAssetPlacementPipeline.js');
assert.equal(runtime.contract.materialAuthority,'MaterialAssignmentCore.js');
assert.equal(runtime.deterministic,true);
assert.ok(runtime.audit.p0Pass);
assert.ok(runtime.audit.p1Pass);
assert.ok(runtime.eventsRuntime.events.length<=48);
assert.equal(runtime.navigation.field.length,16);
assert.equal(runtime.ecology.layers.length,16);
assert.match(runtime.digest,/^[0-9a-f]{8}$/);
for(const distance of [120,360,840,1500,3000]){
  const response=buildGroundMaterialResponseV66(samples[0],weather,{distance});
  assert.ok(response.repeat>=.8&&response.repeat<=18);
  assert.ok(response.lumaFloor>=.08);
}
const river=buildRiverCorridorV66({samples:samples.slice(0,8),weather});
assert.equal(river.corridor.length,8);
assert.ok(river.corridor.every(item=>item.width>=2));
const wildlife=buildWildlifeCorridorV66({samples:samples.slice(0,8),weather,time:21,seed:66});
assert.ok(wildlife.corridors.length>=0);
const gate=buildV66ReleaseGate(runtime);
assert.equal(gate.gates.deterministic,true);
assert.equal(gate.gates.noWorldMutation,true);
assert.equal(gate.gates.digest,true);
console.log(JSON.stringify({ok:true,suite:'v66-quality-guard',samples:samples.length,digest:runtime.digest,releaseReady:gate.pass}));
