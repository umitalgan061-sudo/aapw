import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66, validateEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
import { ENVIRONMENT_RUNTIME_V66_MANIFEST } from '../src/3d/world/environmentRuntimeV66Manifest.js';

const sample=(i)=>({x:i*32,z:(i%3)*18,elevation:300+i*22,slope:6+(i%24),moisture:.35+(i%8)/12,rainfall:.12+(i%6)/14,soilDepth:.42+(i%5)/10,vegetationCover:.3+(i%7)/10,rockExposure:(i%6)/18,waterDistance:8+(i%15)*14,waterDepth:i%11===0?.36:0,roadDistance:60+(i%8)*28,settlementDistance:120+(i%12)*30,confidence:.78+(i%10)/50,biome:['forest','wetland','grassland','taiga'][i%4]});
const samples=Array.from({length:18},(_,i)=>sample(i));
const input={samples,weather:{precipitation:.41,humidity:.72,wind:.38,cloud:.48,temperature:.31},season:'autumn',dayOfYear:274,time:18,camera:{distance:1450,mode:'walk'},platform:'desktop'};
const a=buildEnvironmentRuntimeV66(input);const b=buildEnvironmentRuntimeV66(input);
assert.deepEqual(a,b);assert.equal(validateEnvironmentRuntimeV66(a).ok,true);assert.equal(a.contract.noWorldMutation,true);assert.equal(a.contract.placementAuthority,'WorldAssetPlacementPipeline.js');assert.equal(a.contract.materialAuthority,'MaterialAssignmentCore.js');
assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.version,66);assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.acceptance.width,1536);assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.acceptance.height,1024);assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.deterministic,true);
assert.ok(a.audit.p0Pass);assert.ok(a.eventsRuntime.events.length<=48);assert.ok(a.navigation.field.length===samples.length);assert.ok(a.ecology.layers.length===samples.length);
console.log(JSON.stringify({ok:true,suite:'v66-final',digest:a.digest,samples:samples.length,events:a.eventsRuntime.events.length}));
