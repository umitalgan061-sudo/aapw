import assert from 'node:assert/strict';
import { classifyGeologyFaceV66, buildTalusEnvelopeV66, buildRockFaceResponseV66, validateGeologyRuntimeV66 } from '../src/3d/world/environmentRuntimeGeologyV66.js';
const base={x:0,z:0,elevation:900,slope:18,rockExposure:.18,soilDepth:.68,moisture:.62,freezeThaw:.12,biome:'forest',waterDistance:90};
for(const slope of [4,18,31,44,58,72]){const g=classifyGeologyFaceV66({...base,slope,rockExposure:slope/100});assert.ok(g.rockNeed>=0&&g.rockNeed<=1);assert.ok(g.soil>=0&&g.soil<=1);}
const steep=classifyGeologyFaceV66({...base,slope:56,rockExposure:.82,soilDepth:.08,freezeThaw:.8});assert.ok(['talus','cliff','bedrock'].includes(steep.class));
const envelope=buildTalusEnvelopeV66({samples:[base,{...base,x:40,slope:52,rockExposure:.72},{...base,x:80,slope:60,rockExposure:.9}],seed:66});assert.equal(validateGeologyRuntimeV66({policy:'environment-runtime-geology-v66-2026-09-15',deterministic:true,envelope}).ok,true);assert.ok(envelope.some(i=>i.rockAmount>.3));
const face=buildRockFaceResponseV66({...base,slope:56,rockExposure:.8},{humidity:.84});assert.ok(face.normalStrength>.5);assert.ok(face.screeProbability>0.3);
assert.deepEqual(envelope,buildTalusEnvelopeV66({samples:[base,{...base,x:40,slope:52,rockExposure:.72},{...base,x:80,slope:60,rockExposure:.9}],seed:66}));
console.log(JSON.stringify({ok:true,suite:'v66-geology',samples:envelope.length}));
