#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  resolveSeasonalErosionState,
  seasonalForcingAtDay,
  normalizeDayOfYear,
  seasonAtDay,
  snowpackState,
  freezeThawState,
  runoffPulse,
  windDrying,
  seasonalAgeAccumulator,
} from '../src/3d/world/terrainSeasonalErosionCycle.js';
import {
  TERRAIN_SEASONAL_EROSION_PROFILES,
  seasonalErosionProfileByClimate,
  seasonalErosionProfileBySubstrate,
} from '../src/3d/world/terrainSeasonalErosionProfiles.js';
import {
  TERRAIN_SEASONAL_DIAGNOSTIC_CASES,
  runAllSeasonalDiagnostics,
} from '../src/3d/world/terrainSeasonalErosionDiagnostics.js';
import {
  resolveTerrainSeasonalErosionStack,
  seasonalErosionCacheKey,
  seasonalErosionDeterministicProbe,
  validateTerrainSeasonalErosionIntegration,
} from '../src/3d/world/terrainSeasonalErosionAdapter.js';

const finiteRange=(value,min=0,max=1)=>Number.isFinite(value)&&value>=min&&value<=max;
const base={r:.48,g:.43,b:.37};
const failures=[];
function check(name,fn){try{fn();console.log(`PASS ${name}`);}catch(error){failures.push(`${name}: ${error.message}`);console.error(`FAIL ${name}: ${error.message}`);}}
function stateFor(day,climate,extra={}){return resolveSeasonalErosionState({worldX:day*13.25,worldZ:day*-8.5,dayOfYear:day,heightMeters:72,slopeDegrees:9,moisture:.58,rainfall:.64,windExposure:.52,drainage:.48,canopy:.42,climate,snowWeight:climate==='alpine'?.86:.24,temperatureC:extra.temperatureC,frozenDays:extra.frozenDays??8,dryDays:extra.dryDays??4,...extra});}

const cases=[
['north-01',15,'subarctic',-6,.72,.71,.42,.54],['north-02',30,'subarctic',-2,.74,.68,.43,.51],['north-03',45,'subarctic',0,.70,.73,.48,.49],['north-04',60,'subarctic',3,.67,.76,.50,.46],
['north-05',75,'subarctic',5,.65,.70,.55,.48],['north-06',90,'subarctic',7,.61,.66,.58,.52],['north-07',105,'subarctic',8,.58,.64,.61,.55],['north-08',120,'subarctic',10,.54,.60,.64,.58],
['fjord-01',135,'cold-oceanic',10,.82,.78,.73,.38],['fjord-02',150,'cold-oceanic',13,.79,.75,.77,.36],['fjord-03',165,'cold-oceanic',15,.76,.72,.81,.39],['fjord-04',180,'cold-oceanic',16,.74,.70,.84,.41],
['fjord-05',195,'cold-oceanic',15,.71,.73,.86,.40],['fjord-06',210,'cold-oceanic',13,.75,.76,.79,.37],['fjord-07',225,'cold-oceanic',11,.80,.79,.76,.35],['fjord-08',240,'cold-oceanic',9,.83,.82,.72,.39],
['temp-01',15,'temperate',4,.63,.59,.38,.55],['temp-02',30,'temperate',6,.61,.63,.41,.56],['temp-03',45,'temperate',8,.60,.66,.45,.55],['temp-04',60,'temperate',10,.58,.68,.47,.54],
['temp-05',75,'temperate',13,.55,.65,.50,.53],['temp-06',90,'temperate',16,.52,.61,.53,.55],['temp-07',105,'temperate',17,.50,.58,.56,.56],['temp-08',120,'temperate',18,.47,.56,.59,.57],
['temp-09',135,'temperate',19,.45,.57,.62,.58],['temp-10',150,'temperate',20,.43,.54,.64,.59],['temp-11',165,'temperate',18,.47,.59,.59,.56],['temp-12',180,'temperate',16,.51,.63,.53,.54],
['temp-13',195,'temperate',13,.55,.67,.49,.52],['temp-14',210,'temperate',11,.59,.69,.45,.50],['temp-15',225,'temperate',8,.62,.72,.42,.48],['temp-16',240,'temperate',6,.65,.70,.40,.49],
['ocean-01',255,'mild-oceanic',17,.76,.75,.68,.44],['ocean-02',270,'mild-oceanic',16,.78,.79,.71,.42],['ocean-03',285,'mild-oceanic',14,.80,.81,.74,.41],['ocean-04',300,'mild-oceanic',11,.82,.78,.76,.40],
['ocean-05',315,'mild-oceanic',8,.79,.76,.72,.42],['ocean-06',330,'mild-oceanic',6,.77,.74,.69,.44],['ocean-07',345,'mild-oceanic',7,.75,.73,.66,.45],['ocean-08',360,'mild-oceanic',9,.74,.71,.63,.46],
['marsh-01',15,'wet-temperate',6,.94,.81,.17,.33],['marsh-02',30,'wet-temperate',7,.95,.84,.19,.32],['marsh-03',45,'wet-temperate',8,.96,.86,.20,.34],['marsh-04',60,'wet-temperate',10,.95,.82,.22,.35],
['marsh-05',75,'wet-temperate',12,.94,.79,.24,.36],['marsh-06',90,'wet-temperate',14,.93,.77,.27,.37],['marsh-07',105,'wet-temperate',16,.92,.75,.28,.38],['marsh-08',120,'wet-temperate',17,.91,.78,.25,.36],
['dry-01',135,'dry-temperate',22,.36,.43,.65,.72],['dry-02',150,'dry-temperate',24,.32,.39,.68,.74],['dry-03',165,'dry-temperate',27,.28,.36,.71,.77],['dry-04',180,'dry-temperate',29,.24,.33,.74,.79],
['dry-05',195,'dry-temperate',31,.20,.29,.78,.82],['dry-06',210,'dry-temperate',28,.22,.34,.81,.80],['dry-07',225,'dry-temperate',26,.25,.37,.79,.78],['dry-08',240,'dry-temperate',24,.27,.40,.75,.76],
['med-01',255,'mediterranean',23,.39,.56,.61,.72],['med-02',270,'mediterranean',25,.35,.52,.64,.74],['med-03',285,'mediterranean',27,.32,.48,.68,.76],['med-04',300,'mediterranean',21,.41,.64,.58,.70],
['high-01',15,'highland',-4,.66,.64,.51,.57],['high-02',30,'highland',-2,.67,.68,.53,.55],['high-03',45,'highland',1,.68,.71,.55,.54],['high-04',60,'highland',4,.65,.72,.57,.53],
['high-05',75,'highland',7,.61,.69,.59,.55],['high-06',90,'highland',10,.57,.66,.62,.58],['high-07',105,'highland',12,.54,.62,.64,.60],['high-08',120,'highland',13,.52,.60,.67,.62],
['alpine-01',15,'alpine',-10,.75,.73,.57,.53],['alpine-02',30,'alpine',-8,.77,.75,.60,.51],['alpine-03',45,'alpine',-5,.79,.78,.63,.50],['alpine-04',60,'alpine',-2,.76,.81,.66,.49],
['alpine-05',75,'alpine',1,.72,.83,.69,.48],['alpine-06',90,'alpine',4,.68,.80,.71,.50],['alpine-07',105,'alpine',6,.64,.76,.73,.52],['alpine-08',120,'alpine',8,.60,.72,.75,.54],
['volc-01',135,'volcanic',12,.55,.66,.67,.62],['volc-02',150,'volcanic',15,.52,.63,.70,.64],['volc-03',165,'volcanic',18,.49,.60,.73,.67],['volc-04',180,'volcanic',21,.46,.57,.76,.69],
['volc-05',195,'volcanic',22,.44,.55,.79,.71],['volc-06',210,'volcanic',20,.47,.58,.77,.69],['volc-07',225,'volcanic',17,.50,.61,.74,.66],['volc-08',240,'volcanic',14,.53,.64,.70,.63],
];

check('profile count',()=>assert.equal(TERRAIN_SEASONAL_EROSION_PROFILES.length,100));
check('climate coverage',()=>{for(const climate of ['subarctic','cold-oceanic','temperate','mild-oceanic','wet-temperate','dry-temperate','mediterranean','highland','alpine','volcanic'])assert(seasonalErosionProfileByClimate(climate).length>0,climate);});
check('substrate coverage',()=>{for(const substrate of ['granite','schist','shale','sandstone','limestone','basalt','colluvium','till'])assert(seasonalErosionProfileBySubstrate(substrate).length>0,substrate);});
check('day normalization',()=>{assert.equal(normalizeDayOfYear(361),1);assert.equal(normalizeDayOfYear(720),0);assert.equal(normalizeDayOfYear(0),360);assert.equal(normalizeDayOfYear(-1),359);});
check('season ordering',()=>{assert.equal(seasonAtDay(1),'spring');assert.equal(seasonAtDay(90),'spring');assert.equal(seasonAtDay(91),'summer');assert.equal(seasonAtDay(180),'summer');assert.equal(seasonAtDay(181),'autumn');assert.equal(seasonAtDay(270),'autumn');assert.equal(seasonAtDay(271),'winter');assert.equal(seasonAtDay(360),'winter');});

for(const row of cases){
  check(`case:${row[0]}`,()=>{
    const [id,day,climate,temp,moisture,rainfall,wind,drainage]=row;
    const state=resolveSeasonalErosionState({worldX:day*13.25,worldZ:day*-8.5,dayOfYear:day,heightMeters:72,slopeDegrees:9,moisture,rainfall,windExposure:wind,drainage,climate,temperatureC:temp,snowWeight:climate==='alpine'?.86:.24,canopy:wind<.35?.76:.40,frozenDays:temp<0?18:7,dryDays:temp>21?14:4});
    assert.equal(state.canonicalTerrainUntouched,true,id);
    for(const key of ['erosion','frostWear','deposition','mud','crust','seasonalAge'])assert(finiteRange(state[key]),`${id}:${key}`);
    assert(state.profile.id.length>0,id);
    const material=resolveTerrainSeasonalErosionStack({worldX:state.worldX,worldZ:state.worldZ,dayOfYear:day,heightMeters:72,slopeDegrees:9,moisture,rainfall,windExposure:wind,drainage,climate,temperatureC:temp,snowWeight:climate==='alpine'?.86:.24,frozenDays:temp<0?18:7,dryDays:temp>21?14:4,baseColor:base});
    assert(validateTerrainSeasonalErosionIntegration(material).ok,id);
  });
}

check('deterministic catalog',()=>{
  for(const row of cases){const input={worldX:row[1]*13.25,worldZ:row[1]*-8.5,dayOfYear:row[1],heightMeters:72,slopeDegrees:9,moisture:row[4],rainfall:row[5],windExposure:row[6],drainage:row[7],climate:row[2],temperatureC:row[3],snowWeight:row[2]==='alpine'?.86:.24};const a=seasonalErosionDeterministicProbe(input),b=seasonalErosionDeterministicProbe(input);assert(a.stable);assert.deepEqual(a.material,b.material);assert.equal(a.cacheKey,b.cacheKey);}
});
check('cache key perturbation',()=>{const input={worldX:12,worldZ:33,dayOfYear:180,moisture:.5,windExposure:.4,profileIndex:2};const a=seasonalErosionCacheKey(input),b=seasonalErosionCacheKey({...input,dayOfYear:181});assert.notEqual(a,b);});
check('forcing bounds',()=>{for(let day=1;day<=360;day++){const f=seasonalForcingAtDay(day);for(const key of ['warmth','thaw','rain','dry','frost','snowmelt'])assert(finiteRange(f[key]),`${day}:${key}`);}});
check('snowpack bounds',()=>{for(let day=1;day<=360;day+=2){const s=snowpackState({dayOfYear:day,snowfall:.84});for(const key of ['pack','frozen','melt','runoffPulse'])assert(finiteRange(s[key]),`${day}:${key}`);}});
check('freeze thaw bounds',()=>{for(const substrate of ['granite','schist','shale','limestone','basalt','tuff'])for(let temp=-14;temp<=14;temp+=1){const s=freezeThawState({temperatureC:temp,humidity:.72,substrate});for(const key of ['nearFreeze','below','above','cycle','crack','relax'])assert(finiteRange(s[key]),`${substrate}:${temp}:${key}`);}});
check('runoff bounds',()=>{for(let slope=0;slope<=55;slope+=1)for(let rain=0;rain<=1;rain+=.1){const s=runoffPulse({rainfall:rain,slopeDegrees:slope,drainage:.5,snowmelt:.2});for(const key of ['concentrated','retention','rill','sheet','pulse'])assert(finiteRange(s[key]),`${slope}:${rain}:${key}`);}});
check('wind bounds',()=>{for(let wind=0;wind<=1;wind+=.1)for(let canopy=0;canopy<=1;canopy+=.2)for(let humidity=0;humidity<=1;humidity+=.2){const s=windDrying({windExposure:wind,canopy,humidity});for(const key of ['ventilation','dry','shelter'])assert(finiteRange(s[key]),`${wind}:${canopy}:${humidity}:${key}`);}});
check('diagnostic suite',()=>{const report=runAllSeasonalDiagnostics();assert(report.summary.count>=64);assert(report.checks.profiles.ok);assert(report.checks.climateCoverage.ok);assert(report.checks.boundary.ok);assert(report.checks.determinism.ok);});
check('age accumulator',()=>{assert.equal(seasonalAgeAccumulator([]),0);const value=seasonalAgeAccumulator([{erosion:.8,frostWear:.6,crust:.4},{erosion:.7,frostWear:.5,crust:.3}]);assert(value>0&&value<1);});
check('canonical height immutability contract',()=>{for(const row of cases.slice(0,40)){const s=stateFor(row[1],row[2],{heightMeters:91});assert.equal(s.heightMeters,91);assert.equal(s.canonicalTerrainUntouched,true);}});
check('seasonal continuity sample',()=>{for(let day=1;day<360;day+=1){const a=stateFor(day,'temperate');const b=stateFor(day+1,'temperate');assert(Math.abs(a.seasonalAge-b.seasonalAge)<.34,`day ${day}`);assert(Math.abs(a.erosion-b.erosion)<.34,`erosion ${day}`);}});
check('wetland moisture response',()=>{const wet=stateFor(180,'wet-temperate',{moisture:.95,rainfall:.86});const dry=stateFor(180,'wet-temperate',{moisture:.25,rainfall:.28});assert(wet.mud>=dry.mud);assert(wet.moisture.value>=dry.moisture.value);});
check('dryland crust response',()=>{const wet=stateFor(205,'dry-temperate',{moisture:.68,dryDays:2});const dry=stateFor(205,'dry-temperate',{moisture:.18,dryDays:24});assert(dry.crust>=wet.crust);});
check('frozen profile response',()=>{const cold=stateFor(330,'alpine',{temperatureC:-9,frozenDays:28});const mild=stateFor(330,'alpine',{temperatureC:3,frozenDays:4});assert(cold.frostWear>=mild.frostWear);});

if(failures.length){console.error(`\n${failures.length} seasonal erosion checks failed`);for(const failure of failures)console.error(failure);process.exit(1);}
console.log(`\nSeasonal erosion regression suite passed: ${cases.length} parameterized cases + deterministic boundary checks.`);
