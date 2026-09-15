#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSeasonalErosionState, normalizeDayOfYear, seasonAtDay, snowpackState, freezeThawState, runoffPulse, windDrying, seasonalErosionMaterialResponse } from '../src/3d/world/terrainSeasonalErosionCycle.js';
import { TERRAIN_SEASONAL_EROSION_EDGE_CASES, validateEdgeCaseCatalog } from '../src/3d/world/terrainSeasonalErosionEdgeCases.js';
import { installTerrainSeasonalErosionShader } from '../src/3d/world/terrainSeasonalErosionShader.js';

const failures=[]; const check=(name,fn)=>{try{fn();console.log(`PASS ${name}`);}catch(error){failures.push(`${name}: ${error.message}`);console.error(`FAIL ${name}: ${error.message}`);}};
const valid=v=>Number.isFinite(v)&&v>=0&&v<=1;

check('edge-catalog-valid',()=>{const result=validateEdgeCaseCatalog();assert.equal(result.ok,true);assert.equal(result.count,TERRAIN_SEASONAL_EROSION_EDGE_CASES.length);});
check('edge-catalog-nonempty',()=>assert(TERRAIN_SEASONAL_EROSION_EDGE_CASES.length>=90));
check('calendar-zero',()=>assert.equal(normalizeDayOfYear(0),360));
check('calendar-negative',()=>assert.equal(normalizeDayOfYear(-1),359));
check('calendar-one-year',()=>assert.equal(normalizeDayOfYear(361),1));
check('calendar-two-year',()=>assert.equal(normalizeDayOfYear(721),1));
check('calendar-end-season',()=>assert.equal(seasonAtDay(360),'winter'));
check('calendar-start-season',()=>assert.equal(seasonAtDay(1),'spring'));

for(let i=0;i<TERRAIN_SEASONAL_EROSION_EDGE_CASES.length;i++){
 const row=TERRAIN_SEASONAL_EROSION_EDGE_CASES[i];
 check(`edge:${row.id}`,()=>{
   const state=resolveSeasonalErosionState({worldX:i*71.25,worldZ:-i*53.5,dayOfYear:(i*17)%361,climate:i%5===0?'alpine':i%4===0?'dry-temperate':i%3===0?'wet-temperate':'temperate',substrate:i%7===0?'schist':i%5===0?'shale':'granite',heightMeters:70,slopeDegrees:i%2?24:8,moisture:i%4===0?.24:.68,rainfall:i%5===0?.78:.61,windExposure:i%3===0?.76:.42,drainage:i%4===0?.72:.48,canopy:i%6===0?.76:.38,snowWeight:i%5===0?.82:.18,temperatureC:i%6===0?-3:14,frozenDays:i%6===0?21:5,dryDays:i%4===0?19:3});
   assert.equal(state.canonicalTerrainUntouched,true);
   for(const key of ['erosion','frostWear','deposition','mud','crust','seasonalAge'])assert(valid(state[key]),`${key}`);
   assert(valid(state.moisture.value)); assert(valid(state.snow.pack)); assert(valid(state.snow.runoffPulse)); assert(valid(state.thaw.crack)); assert(valid(state.pulse.rill)); assert(valid(state.drying.dry));
   const material=seasonalErosionMaterialResponse({state});
   for(const key of ['roughness','normalStrength','specularDamping'])assert(valid(material[key]),`material:${key}`);
   for(const key of ['r','g','b'])assert(valid(material.color[key]),`material:color:${key}`);
 });
}

check('snow-low',()=>{const s=snowpackState({dayOfYear:120,snowfall:0});assert.equal(s.pack,0);assert.equal(s.runoffPulse,0);});
check('snow-high',()=>{const s=snowpackState({dayOfYear:30,snowfall:1,temperatureC:-10});assert(s.pack>0);assert(valid(s.pack));});
check('snow-thaw',()=>{const a=snowpackState({dayOfYear:75,snowfall:.9,temperatureC:-4});const b=snowpackState({dayOfYear:75,snowfall:.9,temperatureC:4});assert(b.melt>=a.melt);});
check('freeze-dense',()=>{const s=freezeThawState({temperatureC:-2,humidity:.8,substrate:'granite'});assert(valid(s.crack));});
check('freeze-brittle',()=>{const s=freezeThawState({temperatureC:-2,humidity:.8,substrate:'schist'});assert(valid(s.crack));});
check('freeze-brittle-amplified',()=>{const a=freezeThawState({temperatureC:-2,humidity:.8,substrate:'granite'});const b=freezeThawState({temperatureC:-2,humidity:.8,substrate:'schist'});assert(b.crack>=a.crack);});
check('runoff-flat',()=>{const s=runoffPulse({rainfall:1,slopeDegrees:0,drainage:1,snowmelt:0});assert(valid(s.pulse));assert(s.rill<=s.concentrated);});
check('runoff-steep',()=>{const s=runoffPulse({rainfall:1,slopeDegrees:90,drainage:0,snowmelt:1});for(const key of ['concentrated','retention','rill','sheet','pulse'])assert(valid(s[key]));});
check('wind-zero',()=>{const s=windDrying({windExposure:0,canopy:1,humidity:1});assert.equal(s.dry,0);});
check('wind-max',()=>{const s=windDrying({windExposure:1,canopy:0,humidity:0});assert(valid(s.dry));assert(s.dry>0);});

check('shader-install-idempotent',()=>{
 const material={userData:{}};
 const first=installTerrainSeasonalErosionShader(material);
 const hook=first.onBeforeCompile;
 const second=installTerrainSeasonalErosionShader(material);
 assert.equal(first,second); assert.equal(second.onBeforeCompile,hook); assert.equal(second.userData.terrainSeasonalErosionShaderInstalled,true);
});
check('shader-null-rejected',()=>assert.throws(()=>installTerrainSeasonalErosionShader(null),TypeError));

if(failures.length){console.error(`\n${failures.length} edge-case checks failed`);for(const failure of failures)console.error(failure);process.exit(1);}
console.log(`\nSeasonal erosion edge-case regression passed: ${TERRAIN_SEASONAL_EROSION_EDGE_CASES.length} scenarios.`);
