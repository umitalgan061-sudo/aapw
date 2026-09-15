import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV67 } from '../src/3d/world/environmentRuntimeIntegrationV67.js';
import { buildStreamingFieldV67, streamingUsageV67 } from '../src/3d/world/environmentRuntimeStreamingV67.js';
import { buildHazardFieldV67 } from '../src/3d/world/environmentRuntimeHazardsV67.js';
import { buildResourceFieldV67 } from '../src/3d/world/environmentRuntimeResourcesV67.js';
import { buildInteractionFieldV67 } from '../src/3d/world/environmentRuntimeInteractionV67.js';

const samples=Array.from({length:96},(_,i)=>({
 id:`stress-${i}`,
 elevation:40+(i%32)*76,
 slope:(i*7)%88,
 moisture:((i*13)%97)/100,
 temperature:-18+((i*11)%58),
 humidity:.2+((i*17)%79)/100,
 wind:3+(i*5)%48,
 visibility:.12+((i*19)%86)/100,
 rain:((i*23)%90)/100,
 snow:i%9===0?.82:((i*29)%45)/100,
 canopy:((i*31)%92)/100,
 waterDistance:2+(i*37)%420,
 humanPressure:i%11===0?.82:.06+(i%5)*.07,
 biome:['alpine','tundra','taiga','forest','grassland','scrub','wetland','temperate'][i%8],
}));

const runtime=buildEnvironmentRuntimeV67({samples,clock:17,dayOfYear:247,seed:'stress-v67',weather:{precipitation:.31}});
assert.equal(runtime.runtime.sampleCount,64);
assert.equal(runtime.hydrology.length,96);
assert.equal(runtime.hazards.length,96);
assert.equal(runtime.resources.length,96);
assert.equal(runtime.interactions.length,96);
assert.ok(runtime.digest.length===8);
assert.ok(runtime.hazards.every(x=>x.risk>=0&&x.risk<=1));
assert.ok(runtime.resources.every(x=>x.abundance>=0&&x.abundance<=1));
assert.ok(runtime.interactions.every(x=>x.safety>=0&&x.safety<=1));
const chunks=samples.slice(0,48).map((sample,i)=>({id:sample.id,distance:10+i*8,visibility:sample.visibility,hazard:runtime.hazards[i].risk,wildlife:runtime.wildlife[i]?.suitability??0,previousWeight:i%3/3}));
const stream=buildStreamingFieldV67(chunks,{platform:'desktop',visibility:.72,budgetUse:.42});
const usage=streamingUsageV67(stream);
assert.equal(stream.length,48);
assert.ok(usage.admitted>=0&&usage.admitted<=48);
assert.ok(usage.admissionRate>=0&&usage.admissionRate<=1);
const second=buildEnvironmentRuntimeV67({samples,clock:17,dayOfYear:247,seed:'stress-v67',weather:{precipitation:.31}});
assert.equal(second.digest,runtime.digest);
assert.deepEqual(second.hazards,runtime.hazards);
assert.deepEqual(second.resources,runtime.resources);
assert.deepEqual(second.interactions,runtime.interactions);
console.log('V67 stress regression PASS');
