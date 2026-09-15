import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
const biomes=['forest','taiga','wetland','riverine','coastal','alpine','tundra','steppe','grassland','desert'];
const cases=[];
for(let i=0;i<180;i+=1){
  cases.push({
    biome:biomes[i%biomes.length],
    x:i*11,
    z:(i%12)*17,
    elevation:120+(i%23)*145,
    slope:3+(i%46),
    moisture:(i%16)/16,
    rainfall:(i%12)/12,
    soilDepth:.18+(i%10)/13,
    vegetationCover:(i%11)/11,
    rockExposure:(i%9)/11,
    waterDistance:2+(i%22)*14,
    waterDepth:i%19===0?.16:0,
    roadDistance:35+(i%15)*21,
    settlementDistance:65+(i%18)*29,
    confidence:.72+(i%11)/42,
  });
}
let passed=0;
for(let i=0;i<cases.length;i+=1){
  const sample=cases[i];
  const weather={
    precipitation:(i%10)/10,
    humidity:(i%14)/14,
    wind:(i%8)/8,
    cloud:(i%12)/12,
    temperature:.08+((i*7)%86)/100,
  };
  const runtime=buildEnvironmentRuntimeV66({
    samples:[sample,{...sample,x:sample.x+19,biome:biomes[(i+1)%biomes.length]}],
    weather,
    season:i%4===0?'spring':i%4===1?'summer':i%4===2?'autumn':'winter',
    dayOfYear:1+(i*2)%364,
    time:i%24,
    camera:{distance:420+(i%9)*310,mode:i%7===0?'sprint':'walk'},
    platform:i%5===0?'mobile':'desktop',
  });
  assert.equal(runtime.contract.noWorldMutation,true);
  assert.equal(runtime.deterministic,true);
  assert.equal(runtime.navigation.field.length,2);
  assert.equal(runtime.ecology.layers.length,2);
  assert.ok(runtime.eventsRuntime.events.length<=48);
  assert.ok(runtime.audit.p0Pass);
  assert.match(runtime.digest,/^[0-9a-f]{8}$/);
  passed+=1;
}
assert.equal(passed,180);
console.log(JSON.stringify({ok:true,suite:'v66-biome-coverage',cases:passed,biomes:biomes.length}));
