import assert from 'node:assert/strict';
import { TERRAIN_AEOLIAN_DUST_POLICY, TERRAIN_AEOLIAN_CANONICAL_INVARIANTS, resolveTerrainAeolianDustState, resolveTerrainAeolianDustMaterialResponse, aeolianDustPolicySnapshot } from '../src/3d/world/terrainSurfaceAeolianDust.js';

assert.equal(TERRAIN_AEOLIAN_DUST_POLICY.renderOnly, true);
assert.equal(TERRAIN_AEOLIAN_DUST_POLICY.deterministic, true);
assert.equal(TERRAIN_AEOLIAN_DUST_POLICY.newGeographyIntroduced, false);
for (const key of TERRAIN_AEOLIAN_CANONICAL_INVARIANTS) assert.equal(typeof key, 'string');
const finite01=(v,k)=>{assert.equal(Number.isFinite(v),true,`${k} finite`);assert.equal(v>=0&&v<=1,true,`${k} bounded`);};
let checksum=0;
for(let i=0;i<720;i+=1){const input={worldX:-18000+((i*173.5)%36000),worldZ:-14000+((i*97.25)%28000),heightMeters:5+((i*37)%2900),slopeDegrees:(i*9.125)%56,moisture:((i*23)%101)/100,baseColor:{r:.16+((i*11)%61)/100,g:.13+((i*17)%57)/100,b:.10+((i*19)%53)/100}};const a=resolveTerrainAeolianDustState(input),b=resolveTerrainAeolianDustState(input);assert.deepEqual(a,b,`repeat ${i}`);for(const [k,v] of Object.entries(a))finite01(v,k);const r=resolveTerrainAeolianDustMaterialResponse({state:a,baseColor:input.baseColor});for(const c of ['r','g','b'])finite01(r.color[c],`color.${c}`);finite01(r.roughness,'roughness');finite01(r.normalStrength,'normalStrength');checksum=(checksum+Math.round((a.deposition+a.veil+a.exposedSubstrate)*1000003)+i*19)>>>0;}
const dry=resolveTerrainAeolianDustState({worldX:10,worldZ:20,heightMeters:420,slopeDegrees:15,moisture:.08});
const wet=resolveTerrainAeolianDustState({worldX:10,worldZ:20,heightMeters:420,slopeDegrees:15,moisture:.92});
assert(dry.aridity>wet.aridity);assert(dry.transport>wet.transport);assert(dry.fineFilm>=0&&wet.fineFilm>=0);
const snap=aeolianDustPolicySnapshot();assert.equal(snap.id,TERRAIN_AEOLIAN_DUST_POLICY.id);assert.equal(snap.renderOnly,true);assert.deepEqual(snap.invariants,TERRAIN_AEOLIAN_CANONICAL_INVARIANTS);
console.log('[checkTerrainSurfaceAeolianDust] PASS',JSON.stringify({samples:720,checksum}));
