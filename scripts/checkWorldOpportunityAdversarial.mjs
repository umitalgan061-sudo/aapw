import assert from 'node:assert/strict';
import { buildWorldOpportunitySnapshot, normalizeOpportunityContext, scoreWorldOpportunity } from '../src/3d/gameplay/worldOpportunityPolicy.js';
import { planWorldOpportunitySteps } from '../src/3d/gameplay/worldOpportunityPlanner.js';
import { buildOpportunityProof } from '../src/3d/gameplay/worldOpportunityEvidence.js';
const cases=[{},{distanceMeters:-1e9},{distanceMeters:1e9},{visibility:NaN},{clockSeconds:-1},{clockSeconds:1e12},{weather:'storm',threatLevel:9},{weather:'clear',populationDensity:-4},{weather:'snow',routeFriction:4},{seed:null,biome:null,shelterAvailable:0}];
for(const input of cases){const c=normalizeOpportunityContext(input);for(const key of ['distanceMeters','visibility','threatLevel','routeFriction'])assert(c[key]>=0);const s=buildWorldOpportunitySnapshot(c);assert(Object.isFrozen(s));const p=planWorldOpportunitySteps(c);assert(p.steps.length<=8);assert(buildOpportunityProof(c).valid);for(const type of ['landmark','resource_patch','shelter','trade_window','social_gathering','watch_point','route_choice','weather_break','quiet_space','danger_edge','craft_window','rest_window']){const n=scoreWorldOpportunity(type,c);assert(n>=0&&n<=1);}}
const deterministicA=buildWorldOpportunitySnapshot({seed:'x',clockSeconds:123,weather:'rain'});const deterministicB=buildWorldOpportunitySnapshot({seed:'x',clockSeconds:123,weather:'rain'});assert.deepEqual(deterministicA,deterministicB);
console.log('world opportunity adversarial: PASS');
