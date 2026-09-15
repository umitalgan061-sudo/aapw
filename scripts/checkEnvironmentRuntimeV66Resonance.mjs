import assert from 'node:assert/strict';
import { buildResonanceFieldV66, computeEnvironmentalResonanceV66, validateResonanceRuntimeV66 } from '../src/3d/world/environmentRuntimeResonanceV66.js';

const samples=[
  {x:0,z:0,biome:'forest',slope:8,moisture:.7,vegetationCover:.82,waterDistance:120,elevation:400,temperature:.55},
  {x:40,z:0,biome:'wetland',slope:4,moisture:.92,vegetationCover:.62,waterDistance:4,elevation:220,temperature:.48},
  {x:80,z:0,biome:'alpine',slope:44,moisture:.28,vegetationCover:.12,waterDistance:180,elevation:2100,temperature:.12},
];
const weather={precipitation:.42,humidity:.74,wind:.58};
const field=buildResonanceFieldV66({samples,weather});
assert.equal(field.length,3);
assert.equal(validateResonanceRuntimeV66({policy:'environment-runtime-resonance-v66-2026-09-15',deterministic:true,field}).ok,true);
for(const item of field)for(const value of Object.values(item))if(typeof value==='number')assert.ok(value>=0&&value<=1);
const forest=computeEnvironmentalResonanceV66(samples[0],weather);
const alpine=computeEnvironmentalResonanceV66(samples[2],weather);
assert.ok(alpine.thermalContrast>forest.thermalContrast);
assert.ok(forest.windMotion>0);
assert.ok(field[1].wetGround>=field[0].wetGround*.7);
assert.deepEqual(field,buildResonanceFieldV66({samples,weather}));
console.log(JSON.stringify({ok:true,suite:'v66-resonance',samples:field.length}));
