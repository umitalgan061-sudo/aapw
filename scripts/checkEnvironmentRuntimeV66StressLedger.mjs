import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66, validateEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
import { buildStreamingBudgetV66, buildChunkAdmissionV66 } from '../src/3d/world/environmentRuntimeStreamingV66.js';
import { synthesizeEnvironmentEventsV66 } from '../src/3d/world/environmentRuntimeEventsV66.js';
import { buildResonanceFieldV66 } from '../src/3d/world/environmentRuntimeResonanceV66.js';
import { buildVisibilityFieldV66 } from '../src/3d/world/environmentRuntimeVisibilityV66.js';
import { buildShelterFieldV66 } from '../src/3d/world/environmentRuntimeShelterV66.js';

const environments=[];
for(let i=0;i<12;i+=1){
  environments.push({
    x:i*27,
    z:(i%4)*31,
    elevation:150+i*140,
    slope:5+(i%42),
    moisture:(i%10)/10,
    rainfall:(i%9)/10,
    soilDepth:.2+(i%8)/10,
    vegetationCover:.12+(i%9)/10,
    rockExposure:(i%10)/10,
    waterDistance:3+(i%21)*13,
    waterDepth:i%7===0?.28:0,
    roadDistance:36+(i%12)*19,
    settlementDistance:76+(i%16)*24,
    confidence:.7+(i%11)/50,
    biome:['forest','taiga','wetland','riverine','coastal','alpine','tundra','steppe','grassland','desert'][i%10],
  });
}

const weatherProfiles=[
 {precipitation:.02,humidity:.12,wind:.16,cloud:.05,temperature:.84},
 {precipitation:.22,humidity:.46,wind:.28,cloud:.32,temperature:.64},
 {precipitation:.48,humidity:.7,wind:.42,cloud:.58,temperature:.46},
 {precipitation:.76,humidity:.9,wind:.66,cloud:.82,temperature:.3},
 {precipitation:1,humidity:1,wind:.92,cloud:1,temperature:.16},
];

let scenarioCount=0;
for(const weather of weatherProfiles){
  const runtime=buildEnvironmentRuntimeV66({
    samples:environments,
    weather,
    season:weather.temperature<.25?'winter':weather.temperature>.72?'summer':'autumn',
    dayOfYear:Math.round(30+weather.temperature*280),
    time:6+Math.round(weather.wind*12),
    camera:{distance:650+weather.cloud*1800,mode:weather.temperature>.75?'sprint':'walk'},
    platform:weather.temperature>.75?'mobile':'desktop',
  });
  const check=validateEnvironmentRuntimeV66(runtime);
  assert.equal(check.ok,true,check.errors.join(','));
  assert.equal(runtime.deterministic,true);
  assert.equal(runtime.contract.noWorldMutation,true);
  assert.ok(runtime.audit.p0Pass);
  assert.ok(runtime.navigation.field.length===environments.length);
  assert.ok(runtime.ecology.layers.length===environments.length);
  assert.ok(runtime.eventsRuntime.events.length<=48);
  scenarioCount+=1;
}

const budget=buildStreamingBudgetV66({platform:'mobile',fps:37,drawCalls:72,triangles:490000,textureMb:420,residentChunks:5});
const chunks=Array.from({length:40},(_,i)=>({id:`ledger-${i}`,distance:i*115,importance:i<5?.9:.35}));
const admission=buildChunkAdmissionV66({chunks,camera:{velocity:42},budget});
assert.ok(admission.admitted.length<=admission.cap);
assert.ok(admission.deferred.length>=1);

const eventContexts=environments.map((sample,index)=>({...sample,...weatherProfiles[index%weatherProfiles.length],seed:66}));
const events=synthesizeEnvironmentEventsV66({contexts:eventContexts,seed:66,horizonSeconds:900});
assert.ok(events.events.length<=48);
assert.equal(events.deterministic,true);

const resonance=buildResonanceFieldV66({samples:environments,weather:weatherProfiles[3]});
assert.equal(resonance.length,environments.length);
assert.ok(resonance.every(item=>item.windMotion>=0&&item.windMotion<=1));

const visibility=buildVisibilityFieldV66({samples:environments,weather:{fog:.55,precipitation:.64}});
assert.equal(visibility.length,environments.length);
assert.ok(visibility.every(item=>item.visibility>=0&&item.visibility<=1));

const shelter=buildShelterFieldV66({samples:environments,weather:weatherProfiles[4]});
assert.equal(shelter.length,environments.length);
assert.ok(shelter.every(item=>item.score>=0&&item.score<=1));

const signatures=new Set();
for(let i=0;i<6;i+=1){
  const runtime=buildEnvironmentRuntimeV66({samples:environments.slice(i,i+6),weather:weatherProfiles[i%weatherProfiles.length],season:'autumn',dayOfYear:210+i*7,time:10+i,camera:{distance:1000+i*180},platform:i%2===0?'desktop':'mobile'});
  signatures.add(runtime.digest);
}
assert.equal(signatures.size,6);

const replayInput={samples:environments.slice(0,8),weather:weatherProfiles[2],season:'autumn',dayOfYear:188,time:14,camera:{distance:1320},platform:'desktop'};
const replayA=buildEnvironmentRuntimeV66(replayInput);
const replayB=buildEnvironmentRuntimeV66(replayInput);
assert.deepEqual(replayA,replayB);

console.log(JSON.stringify({ok:true,suite:'v66-stress-ledger',scenarioCount,eventCount:events.events.length,admitted:admission.admitted.length,signatures:signatures.size}));
