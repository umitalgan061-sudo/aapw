import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV67, validateEnvironmentRuntimeV67 } from '../src/3d/world/environmentRuntimeIntegrationV67.js';
import { buildHydrologyFieldV67 } from '../src/3d/world/environmentRuntimeHydrologyV67.js';
import { buildHazardFieldV67 } from '../src/3d/world/environmentRuntimeHazardsV67.js';
import { buildNavigationFieldV67 } from '../src/3d/world/environmentRuntimeNavigationV67.js';

const edge=[
{id:'zero',elevation:0,slope:0,moisture:0,temperature:0,humidity:0,wind:0,visibility:1,rain:0,canopy:0,waterDistance:5000},
{id:'storm',elevation:100,slope:2,moisture:1,temperature:18,humidity:1,wind:50,visibility:0,rain:1,canopy:0,waterDistance:1},
{id:'cliff',elevation:2400,slope:90,moisture:.1,temperature:-18,humidity:.2,wind:50,visibility:.1,rain:1,canopy:.05,waterDistance:60},
{id:'heat',elevation:60,slope:3,moisture:.1,temperature:42,humidity:.25,wind:40,visibility:.96,rain:0,canopy:.02,waterDistance:900},
{id:'wet',elevation:40,slope:1,moisture:1,temperature:6,humidity:1,wind:3,visibility:.2,rain:1,canopy:.4,waterDistance:2},
];
const runtime=buildEnvironmentRuntimeV67({samples:edge,clock:23,dayOfYear:355,seed:'edge'});
assert.equal(validateEnvironmentRuntimeV67(runtime).ok,true);
for(const field of [runtime.hydrology,runtime.surface,runtime.atmosphere,runtime.wildlife,runtime.hazards,runtime.navigation,runtime.vegetation,runtime.climate,runtime.acoustics,runtime.resonance,runtime.shelter,runtime.visibility,runtime.coupling,runtime.geology]){
 assert.equal(Array.isArray(field),true);
 assert.equal(field.length,5);
}
assert.ok(buildHydrologyFieldV67(edge).every(x=>Number.isFinite(x.discharge)));
assert.ok(buildHazardFieldV67(edge).every(x=>x.risk>=0&&x.risk<=1));
assert.ok(buildNavigationFieldV67(edge.map((s,i)=>({...s,hazard:runtime.hazards[i].risk,traction:runtime.surface[i].traction}))).every(x=>x.score>=0&&x.score<=1));
const again=buildEnvironmentRuntimeV67({samples:edge,clock:23,dayOfYear:355,seed:'edge'});
assert.equal(again.digest,runtime.digest);
assert.deepEqual(again.events.events,runtime.events.events);
assert.deepEqual(again.runtime.samples,runtime.runtime.samples);
console.log('V67 edge regression PASS');
