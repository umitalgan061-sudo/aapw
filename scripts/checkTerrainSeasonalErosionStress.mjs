#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolveTerrainSeasonalErosionStack, seasonalErosionCacheKey } from '../src/3d/world/terrainSeasonalErosionAdapter.js';
import { resolveSeasonalErosionState, seasonalForcingAtDay, freezeThawState, snowpackState } from '../src/3d/world/terrainSeasonalErosionCycle.js';
import { TERRAIN_SEASONAL_EROSION_STRESS_MATRIX, seasonalStressRowAt } from './fixtures/terrainSeasonalErosionStressMatrix.js';
import { TERRAIN_SEASONAL_EROSION_LONG_GRID } from './fixtures/terrainSeasonalErosionLongGrid.js';
import { TERRAIN_SEASONAL_EROSION_RESPONSE_BOOK } from '../src/3d/world/terrainSeasonalErosionResponseBook.js';

const BASE={r:.48,g:.43,b:.37};
const errors=[];
const range=(v)=>Number.isFinite(v)&&v>=0&&v<=1;
function check(name,fn){try{fn();console.log(`PASS ${name}`);}catch(error){errors.push(`${name}: ${error.message}`);console.error(`FAIL ${name}: ${error.message}`);}}

check('stress fixture width',()=>{assert.equal(TERRAIN_SEASONAL_EROSION_STRESS_MATRIX.length%13,0);assert.equal(TERRAIN_SEASONAL_EROSION_STRESS_MATRIX.length/13,120);});
check('stress fixture ids',()=>{const ids=new Set();for(let i=0;i<TERRAIN_SEASONAL_EROSION_STRESS_MATRIX.length;i+=13){const id=TERRAIN_SEASONAL_EROSION_STRESS_MATRIX[i];assert(!ids.has(id),id);ids.add(id);assert(/^S\d+$/.test(id));}});
check('response book richness',()=>{assert(TERRAIN_SEASONAL_EROSION_RESPONSE_BOOK.length>=80);for(const item of TERRAIN_SEASONAL_EROSION_RESPONSE_BOOK){for(const key of ['wetness','frost','erosion','crust','mud','deposition'])assert(range(item[key]),`${item.id}:${key}`);}});

for(let index=0;index<120;index+=1){
  const row=seasonalStressRowAt(index);
  check(`stress:${row.id}`,()=>{
    const state=resolveSeasonalErosionState({...row,worldX:index*311-14000,worldZ:index*173-9000,heightMeters:72});
    assert.equal(state.canonicalTerrainUntouched,true);
    assert.equal(state.heightMeters,72);
    for(const key of ['erosion','frostWear','deposition','mud','crust','seasonalAge'])assert(range(state[key]),`${row.id}:${key}`);
    assert(state.profile.id.includes('-'));
    const material=resolveTerrainSeasonalErosionStack({...row,worldX:index*311-14000,worldZ:index*173-9000,heightMeters:72,baseColor:BASE,baseRoughness:.86});
    assert(range(material.visualWeight));
    for(const key of ['roughness','normalStrength','specularDamping'])assert(range(material.material[key]),`${row.id}:${key}`);
    assert(range(material.material.color.r));assert(range(material.material.color.g));assert(range(material.material.color.b));
  });
}

check('long grid coverage',()=>{
  assert.equal(TERRAIN_SEASONAL_EROSION_LONG_GRID.length,160);
  const signatures=new Set();
  for(let i=0;i<TERRAIN_SEASONAL_EROSION_LONG_GRID.length;i++){const row=TERRAIN_SEASONAL_EROSION_LONG_GRID[i];const state=resolveSeasonalErosionState({worldX:row[1],worldZ:row[2],dayOfYear:row[3],climate:row[4],substrate:row[5],moisture:row[6],rainfall:row[7],windExposure:row[8],slopeDegrees:row[9],heightMeters:70,snowWeight:row[4]==='alpine'?.86:.22});assert.equal(state.canonicalTerrainUntouched,true);signatures.add(JSON.stringify({p:state.profile.id,e:+state.erosion.toFixed(5),f:+state.frostWear.toFixed(5),a:+state.seasonalAge.toFixed(5)}));}
  assert(signatures.size>120,'world-space signatures collapsed');
});

check('world-space translation sensitivity',()=>{const common={dayOfYear:180,climate:'temperate',substrate:'granite',moisture:.58,rainfall:.64,windExposure:.52,slopeDegrees:9,heightMeters:70};const a=resolveSeasonalErosionState({...common,worldX:-5000,worldZ:-3000});const b=resolveSeasonalErosionState({...common,worldX:5000,worldZ:3000});assert(Math.abs(a.seasonalAge-b.seasonalAge)>1e-7);assert(Math.abs(a.local-b.local)>1e-7);});
check('day sensitivity',()=>{const input={worldX:1520,worldZ:-740,climate:'temperate',substrate:'granite',moisture:.58,rainfall:.64,windExposure:.52,slopeDegrees:9,heightMeters:70};const a=resolveSeasonalErosionState({...input,dayOfYear:30});const b=resolveSeasonalErosionState({...input,dayOfYear:210});assert(Math.abs(a.seasonalAge-b.seasonalAge)>1e-7);assert.notEqual(a.season,b.season);});
check('substrate sensitivity',()=>{const input={worldX:1234,worldZ:-987,dayOfYear:45,climate:'temperate',moisture:.71,rainfall:.68,windExposure:.56,slopeDegrees:14,heightMeters:70,temperatureC:-1,frozenDays:20};const brittle=resolveSeasonalErosionState({...input,substrate:'schist'});const dense=resolveSeasonalErosionState({...input,substrate:'granite'});assert(brittle.frostWear>=dense.frostWear);assert(brittle.thaw.crack>=dense.thaw.crack);});
check('snowmelt sensitivity',()=>{const frozen=snowpackState({dayOfYear:72,snowfall:.9,temperatureC:-2});const thawed=snowpackState({dayOfYear:72,snowfall:.9,temperatureC:5});assert(thawed.melt>=frozen.melt);assert(thawed.runoffPulse>=frozen.runoffPulse);});
check('freeze-thaw substrate response',()=>{const weak=freezeThawState({temperatureC:-2,humidity:.8,substrate:'shale'});const strong=freezeThawState({temperatureC:-2,humidity:.8,substrate:'granite'});assert(weak.crack>=strong.crack);});
check('cache key determinism',()=>{for(let i=0;i<50;i++){const row=seasonalStressRowAt(i);const input={worldX:i*17.2,worldZ:-i*23.7,dayOfYear:row.dayOfYear,moisture:row.moisture,windExposure:row.windExposure,profileIndex:i};assert.equal(seasonalErosionCacheKey(input),seasonalErosionCacheKey({...input}));}});
check('cache key coordinate separation',()=>{const base={worldX:0,worldZ:0,dayOfYear:180,moisture:.5,windExposure:.5,profileIndex:0};const keys=[seasonalErosionCacheKey(base),seasonalErosionCacheKey({...base,worldX:1}),seasonalErosionCacheKey({...base,worldZ:1}),seasonalErosionCacheKey({...base,dayOfYear:181}),seasonalErosionCacheKey({...base,profileIndex:1})];assert.equal(new Set(keys).size,keys.length);});
check('forcing annual sample',()=>{let min=1,max=0;for(let day=1;day<=360;day++){const f=seasonalForcingAtDay(day);min=Math.min(min,f.warmth);max=Math.max(max,f.warmth);assert(range(f.rain));assert(range(f.frost));}assert(min<.1);assert(max>.9);});
check('canonical height preservation',()=>{for(let i=0;i<30;i++){const row=seasonalStressRowAt(i);const state=resolveSeasonalErosionState({...row,heightMeters:100+i,worldX:i*100,worldZ:-i*100});assert.equal(state.heightMeters,100+i);assert.equal(state.canonicalTerrainUntouched,true);}});
check('material does not exceed bounds',()=>{for(let i=0;i<80;i++){const row=seasonalStressRowAt(i);const m=resolveTerrainSeasonalErosionStack({...row,worldX:i*90,worldZ:i*-60,heightMeters:70,baseColor:BASE});for(const channel of ['r','g','b'])assert(range(m.material.color[channel]),`${i}:${channel}`);for(const key of ['roughness','normalStrength','specularDamping'])assert(range(m.material[key]),`${i}:${key}`);}});

check('stress performance baseline',()=>{
  const samples=[]; const start=performance.now();
  for(let i=0;i<512;i++){const row=seasonalStressRowAt(i%120);samples.push(resolveTerrainSeasonalErosionStack({...row,worldX:i*41.1,worldZ:i*-37.4,heightMeters:70,baseColor:BASE}));}
  const elapsed=performance.now()-start;assert(samples.length===512);assert(elapsed<4000,`elapsed ${elapsed.toFixed(2)}ms exceeds 4s guard`);console.log(`  performance: ${elapsed.toFixed(2)}ms / 512 samples`);
});
check('repeat deterministic performance',()=>{
  const inputs=Array.from({length:96},(_,i)=>{const row=seasonalStressRowAt(i%120);return{...row,worldX:i*73.5,worldZ:i*-61.2,heightMeters:71,baseColor:BASE};});
  const first=inputs.map(value=>resolveTerrainSeasonalErosionStack(value));
  const second=inputs.map(value=>resolveTerrainSeasonalErosionStack(value));
  assert.deepEqual(first.map(v=>v.material),second.map(v=>v.material));
});

if(errors.length){console.error(`\n${errors.length} stress checks failed`);for(const error of errors)console.error(error);process.exit(1);}
console.log(`\nSeasonal erosion stress suite passed: ${TERRAIN_SEASONAL_EROSION_STRESS_MATRIX.length/13} scenarios + long-grid + determinism/performance guards.`);
