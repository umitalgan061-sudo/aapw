import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66, validateEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
const biomes = ['forest','taiga','wetland','riverine','coastal','alpine','tundra','steppe','grassland','desert'];
const seasons = ['spring','summer','autumn','winter'];
const hours = [2,7,11,15,19,23];
const base = (biome,i) => ({
  x:i*17,
  z:(i%6)*29,
  elevation:180+i*95,
  slope:4+(i%44),
  moisture:(i%10)/10,
  rainfall:(i%7)/8,
  soilDepth:.24+(i%8)/12,
  vegetationCover:(i%9)/9,
  rockExposure:(i%8)/10,
  waterDistance:3+(i%18)*15,
  waterDepth:i%17===0?.22:0,
  roadDistance:40+(i%13)*23,
  settlementDistance:70+(i%19)*31,
  confidence:.72+(i%10)/40,
  biome,
});
let checks=0;
for(let b=0;b<biomes.length;b+=1){
  for(let s=0;s<seasons.length;s+=1){
    for(let h=0;h<hours.length;h+=1){
      const sample=base(biomes[b],b+s+h);
      const weather={
        precipitation:(b+s)%5/5,
        humidity:(b+h)%6/6,
        wind:(s+h)%7/8,
        cloud:(b+h+s)%8/8,
        temperature:.12+((b+s*2+h)%80)/100,
      };
      const runtime=buildEnvironmentRuntimeV66({
        samples:[sample,{...sample,x:sample.x+21,biome:biomes[(b+1)%biomes.length]}],
        weather,
        season:seasons[s],
        dayOfYear:1+((b*37+s*71+h*13)%364),
        time:hours[h],
        camera:{distance:500+h*320,mode:h%4===0?'sprint':'walk'},
        platform:h%5===0?'mobile':'desktop',
      });
      const result=validateEnvironmentRuntimeV66(runtime);
      assert.equal(result.ok,true,`${biomes[b]}:${seasons[s]}:${hours[h]}:${result.errors.join(',')}`);
      assert.equal(runtime.contract.noWorldMutation,true);
      assert.equal(runtime.deterministic,true);
      assert.ok(runtime.audit.p0Pass);
      assert.ok(runtime.eventsRuntime.events.length<=48);
      assert.equal(runtime.navigation.field.length,2);
      assert.equal(runtime.ecology.layers.length,2);
      assert.match(runtime.digest,/^[0-9a-f]{8}$/);
      checks+=1;
    }
  }
}
assert.ok(checks>=200);
console.log(JSON.stringify({ok:true,suite:'v66-scenario-ledger',checks,biomes:biomes.length,seasons:seasons.length,hours:hours.length}));
