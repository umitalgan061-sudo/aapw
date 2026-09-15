import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66, validateEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
import { buildGroundBiomePaletteV66 } from '../src/3d/world/environmentRuntimeGroundResponseV66.js';
import { buildDailyWeatherEnvelopeV66 } from '../src/3d/world/environmentRuntimeClimateV66.js';

const biomes=['forest','taiga','wetland','riverine','coastal','alpine','tundra','steppe','grassland','desert'];
const weatherSet=[
 {id:'clear',precipitation:.02,humidity:.18,wind:.14,cloud:.08,temperature:.72},
 {id:'rain',precipitation:.62,humidity:.84,wind:.36,cloud:.68,temperature:.42},
 {id:'storm',precipitation:.96,humidity:.98,wind:.82,cloud:.94,temperature:.3},
 {id:'snow',precipitation:.38,humidity:.86,wind:.56,cloud:.78,temperature:.12},
 {id:'dry',precipitation:.03,humidity:.12,wind:.3,cloud:.05,temperature:.88},
];

for(let b=0;b<biomes.length;b+=1){
  const biome=biomes[b];
  const palette=buildGroundBiomePaletteV66(biome,{humidity:.55});
  const total=Object.values(palette).reduce((sum,value)=>sum+value,0);
  assert.ok(Math.abs(total-1)<.001,biome);
  for(let w=0;w<weatherSet.length;w+=1){
    const weather=weatherSet[w];
    const sample={x:b*40,z:w*45,elevation:200+b*170,slope:4+(b*7)%46,moisture:(w+1)/6,rainfall:weather.precipitation,soilDepth:.3+(b%5)/10,vegetationCover:(b%8)/10,rockExposure:(b%7)/10,waterDistance:4+(w+b%4)*30,waterDepth:(w===3&&b%3===0)?.18:0,roadDistance:50+b*18,settlementDistance:90+b*24,confidence:.82+(b%10)/50,biome};
    const runtime=buildEnvironmentRuntimeV66({samples:[sample,{...sample,x:sample.x+22,biome:biomes[(b+1)%biomes.length]}],weather,season:w===3?'winter':w===4?'summer':'autumn',dayOfYear:w===3?28:190,time:12+w*3,camera:{distance:700+w*480,mode:w===4?'sprint':'walk'},platform:w===4?'mobile':'desktop'});
    assert.equal(validateEnvironmentRuntimeV66(runtime).ok,true,`${biome}:${weather.id}`);
    assert.equal(runtime.deterministic,true);
    assert.equal(runtime.contract.noWorldMutation,true);
    assert.ok(runtime.audit.p0Pass);
  }
}

const forecast=buildDailyWeatherEnvelopeV66({input:{dayOfYear:345,latitude:41,baselineTemperature:.42,baselineMoisture:.64,elevation:1100,biome:'taiga'},forecast:14,seed:66});
assert.equal(forecast.entries.length,15);
for(let i=1;i<forecast.entries.length;i+=1){assert.ok(forecast.entries[i].day!==forecast.entries[i-1].day||i===forecast.entries.length-1);}
const a=buildEnvironmentRuntimeV66({samples:[{x:0,z:0,elevation:400,slope:12,moisture:.62,vegetationCover:.7,rockExposure:.1,waterDistance:70,roadDistance:100,settlementDistance:200,confidence:.94,biome:'forest'}],weather:weatherSet[0],season:'summer',dayOfYear:180,time:12,camera:{distance:1000},platform:'desktop'});
const b=buildEnvironmentRuntimeV66({samples:[{x:0,z:0,elevation:400,slope:12,moisture:.62,vegetationCover:.7,rockExposure:.1,waterDistance:70,roadDistance:100,settlementDistance:200,confidence:.94,biome:'forest'}],weather:weatherSet[2],season:'autumn',dayOfYear:270,time:18,camera:{distance:1600},platform:'desktop'});
assert.ok(a.digest!==b.digest);
console.log(JSON.stringify({ok:true,suite:'v66-world-matrix',biomes:biomes.length,weathers:weatherSet.length,forecastDays:forecast.entries.length}));
