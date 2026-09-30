import { resolveSeasonalErosionState, seasonalForcingAtDay, freezeThawState, snowpackState, runoffPulse, windDrying } from './terrainSeasonalErosionCycle.js';
import { TERRAIN_SEASONAL_EROSION_PROFILES } from './terrainSeasonalErosionProfiles.js';

const freeze=v=>Object.freeze(v); const finite=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d; const c=v=>Math.max(0,Math.min(1,finite(v)));
export const TERRAIN_SEASONAL_DIAGNOSTIC_POLICY=freeze({id:'terrain-seasonal-erosion-diagnostics-2026-09-15-v1',deterministic:true,renderOnly:true,maxContinuityDelta:.34,maxMaterialDelta:.28,minimumScenarioCount:64,policySource:'terrain-seasonal-erosion-cycle-2026-09-15-v1'});

export const TERRAIN_SEASONAL_DIAGNOSTIC_CASES=freeze([
['spring-cold',60,'subarctic',-2,.71,.62,.24,.38],
['spring-cool',72,'temperate',5,.63,.58,.31,.47],
['spring-mild',84,'oceanic',10,.77,.70,.28,.52],
['spring-wet',90,'wet-temperate',8,.94,.82,.19,.42],
['spring-dry',78,'dry-temperate',11,.34,.32,.21,.71],
['spring-highland',88,'highland',2,.66,.64,.46,.58],
['spring-alpine',82,'alpine',-1,.74,.69,.62,.55],
['spring-mediterranean',81,'mediterranean',13,.42,.36,.18,.68],
['spring-volcanic',76,'volcanic',7,.55,.52,.35,.63],
['summer-cool',150,'subarctic',8,.58,.54,.36,.49],
['summer-mild',168,'temperate',16,.49,.47,.44,.57],
['summer-wet',174,'oceanic',17,.73,.69,.34,.45],
['summer-marsh',180,'wet-temperate',18,.92,.86,.16,.37],
['summer-dry',190,'dry-temperate',25,.25,.20,.11,.81],
['summer-highland',165,'highland',12,.52,.49,.51,.63],
['summer-alpine',174,'alpine',8,.57,.61,.67,.59],
['summer-mediterranean',182,'mediterranean',29,.29,.23,.14,.76],
['summer-volcanic',160,'volcanic',18,.47,.42,.41,.70],
['late-summer-1',210,'temperate',20,.43,.38,.48,.60],
['late-summer-2',218,'dry-temperate',27,.22,.19,.09,.84],
['late-summer-3',224,'oceanic',18,.69,.61,.31,.52],
['late-summer-4',232,'wet-temperate',17,.90,.78,.18,.41],
['late-summer-5',240,'highland',11,.49,.44,.55,.66],
['late-summer-6',248,'alpine',6,.53,.54,.71,.64],
['autumn-cool',255,'subarctic',1,.72,.71,.44,.42],
['autumn-wet',270,'temperate',9,.68,.73,.36,.48],
['autumn-oceanic',285,'oceanic',13,.78,.77,.27,.46],
['autumn-marsh',288,'wet-temperate',10,.95,.90,.13,.35],
['autumn-dry',276,'dry-temperate',16,.38,.43,.16,.72],
['autumn-highland',264,'highland',4,.63,.66,.54,.56],
['autumn-alpine',270,'alpine',0,.70,.72,.67,.49],
['autumn-mediterranean',294,'mediterranean',18,.37,.45,.14,.73],
['autumn-volcanic',279,'volcanic',9,.59,.61,.36,.65],
['winter-mild',300,'oceanic',6,.72,.69,.31,.44],
['winter-rain',315,'temperate',3,.67,.74,.38,.48],
['winter-cold',330,'subarctic',-8,.81,.82,.55,.39],
['winter-frozen',342,'highland',-9,.69,.77,.63,.52],
['winter-alpine',348,'alpine',-13,.76,.86,.79,.47],
['winter-wet',320,'wet-temperate',2,.96,.89,.17,.33],
['winter-dry',336,'dry-temperate',2,.28,.35,.19,.71],
['winter-mediterranean',312,'mediterranean',8,.41,.50,.16,.68],
['winter-volcanic',324,'volcanic',1,.54,.63,.39,.66],
['thaw-front-1',22,'subarctic',-1,.77,.70,.52,.44],
['thaw-front-2',35,'subarctic',2,.74,.73,.49,.46],
['thaw-front-3',48,'highland',1,.68,.67,.61,.53],
['thaw-front-4',62,'alpine',0,.72,.74,.70,.54],
['thaw-front-5',76,'temperate',3,.63,.66,.41,.56],
['thaw-front-6',92,'oceanic',7,.74,.71,.29,.49],
['thaw-front-7',104,'wet-temperate',8,.91,.84,.19,.40],
['thaw-front-8',116,'dry-temperate',10,.31,.33,.18,.74],
['storm-1',132,'oceanic',15,.78,.81,.32,.45],
['storm-2',141,'oceanic',16,.75,.78,.31,.50],
['storm-3',151,'wet-temperate',17,.94,.89,.17,.38],
['storm-4',161,'temperate',15,.63,.76,.43,.55],
['storm-5',171,'highland',11,.58,.71,.53,.60],
['storm-6',201,'dry-temperate',24,.31,.42,.13,.80],
['storm-7',221,'mediterranean',28,.27,.35,.10,.78],
['storm-8',241,'volcanic',18,.48,.65,.39,.70],
['frost-1',302,'highland',-3,.71,.76,.65,.55],
['frost-2',308,'highland',-1,.69,.74,.61,.56],
['frost-3',314,'alpine',-6,.75,.81,.75,.49],
['frost-4',320,'alpine',-3,.74,.84,.77,.47],
['frost-5',326,'subarctic',-7,.80,.82,.54,.41],
['frost-6',332,'subarctic',-4,.79,.84,.58,.43],
['frost-7',338,'temperate',-2,.61,.73,.44,.57],
['frost-8',344,'oceanic',0,.70,.75,.32,.48],
['drying-1',200,'dry-temperate',26,.21,.24,.16,.86],
['drying-2',210,'dry-temperate',28,.19,.22,.13,.88],
['drying-3',220,'mediterranean',30,.24,.28,.11,.82],
['drying-4',230,'mediterranean',31,.21,.24,.09,.86],
['drying-5',240,'temperate',24,.33,.35,.29,.77],
['drying-6',250,'highland',19,.40,.44,.44,.70],
['drying-7',260,'oceanic',18,.57,.60,.28,.58],
['drying-8',270,'wet-temperate',17,.83,.80,.19,.46],
['shelter-1',135,'temperate',16,.62,.55,.81,.18],
['shelter-2',145,'temperate',16,.61,.57,.84,.20],
['shelter-3',155,'oceanic',17,.72,.66,.79,.21],
['shelter-4',165,'wet-temperate',17,.91,.80,.82,.16],
['shelter-5',175,'highland',12,.59,.52,.73,.24],
['shelter-6',185,'alpine',9,.55,.50,.76,.22],
['shelter-7',195,'mediterranean',25,.27,.23,.69,.29],
['shelter-8',205,'volcanic',18,.45,.39,.71,.26],
]);

function scalarCase(row){const [id,day,climate,temp,moisture,rainfall,wind,drainage]=row;return {id,day,climate,temp,moisture,rainfall,wind,drainage};}
export function diagnosticCaseRows(){return TERRAIN_SEASONAL_DIAGNOSTIC_CASES.map(scalarCase);}

export function runSeasonalDiagnosticCase(row){const item=scalarCase(row);const state=resolveSeasonalErosionState({worldX:item.day*13.1,worldZ:item.day*-7.7,dayOfYear:item.day,heightMeters:70,slopeDegrees:9,moisture:item.moisture,rainfall:item.rainfall,windExposure:item.wind,drainage:item.drainage,climate:item.climate,temperatureC:item.temp,snowWeight:item.climate==='alpine'?0.82:.26,canopy:item.wind<.35?.72:.38,frozenDays:item.temp<0?18:4,dryDays:item.temp>22?12:2});return freeze({id:item.id,input:item,state});}

export function runSeasonalDiagnosticSuite(){return freeze(TERRAIN_SEASONAL_DIAGNOSTIC_CASES.map(runSeasonalDiagnosticCase));}

export function summarizeDiagnosticSuite(rows=runSeasonalDiagnosticSuite()){const seasons=new Map();let maxErosion=0,maxFrost=0,maxAge=0,minMoisture=1,maxMoisture=0;for(const row of rows){const s=row.state;const entry=seasons.get(s.season)??{count:0,erosion:0,frost:0,age:0};entry.count++;entry.erosion+=s.erosion;entry.frost+=s.frostWear;entry.age+=s.seasonalAge;seasons.set(s.season,entry);maxErosion=Math.max(maxErosion,s.erosion);maxFrost=Math.max(maxFrost,s.frostWear);maxAge=Math.max(maxAge,s.seasonalAge);minMoisture=Math.min(minMoisture,s.moisture.value);maxMoisture=Math.max(maxMoisture,s.moisture.value);}return freeze({count:rows.length,maxErosion,maxFrost,maxAge,minMoisture,maxMoisture,bySeason:freeze([...seasons].map(([season,v])=>freeze({season,count:v.count,meanErosion:v.erosion/v.count,meanFrost:v.frost/v.count,meanAge:v.age/v.count})))});}

export function checkBoundaryInvariants(rows=runSeasonalDiagnosticSuite()){const errors=[];for(const row of rows){const s=row.state;if(s.canonicalTerrainUntouched!==true)errors.push(`${row.id}:canonical`);if(s.heightMeters!==70)errors.push(`${row.id}:height`);if(s.profile===undefined)errors.push(`${row.id}:profile`);for(const key of ['erosion','frostWear','deposition','mud','crust','seasonalAge'])if(!(Number.isFinite(s[key])&&s[key]>=0&&s[key]<=1))errors.push(`${row.id}:${key}`);}return freeze({ok:errors.length===0,errors:freeze(errors)});}

export function checkDeterminism(rows=TERRAIN_SEASONAL_DIAGNOSTIC_CASES){const errors=[];for(const row of rows){const a=runSeasonalDiagnosticCase(row);const b=runSeasonalDiagnosticCase(row);if(JSON.stringify(a.state)!==JSON.stringify(b.state))errors.push(`${row[0]}:state`);}return freeze({ok:errors.length===0,errors:freeze(errors)});}

export function checkForcingBounds(){const errors=[];for(let day=1;day<=360;day+=3){const f=seasonalForcingAtDay(day);for(const [key,value] of Object.entries(f))if(typeof value==='number'&&(value<0||value>1)&&!['phase'].includes(key))errors.push(`forcing:${day}:${key}`);}return freeze({ok:errors.length===0,errors:freeze(errors)});}

export function checkFreezeThawMonotonicity(){const errors=[];const substrates=['granite','schist','shale','limestone','basalt','tuff'];for(const substrate of substrates){let previous=-1;for(let temp=-10;temp<=10;temp+=.5){const state=freezeThawState({temperatureC:temp,humidity:.74,substrate});if(state.cycle+1e-6<previous)errors.push(`${substrate}:cycle:${temp}`);previous=state.cycle;}}return freeze({ok:errors.length===0,errors:freeze(errors)});}

export function checkSnowmeltWindow(){const errors=[];let peak=0;let peakDay=1;for(let day=1;day<=360;day+=1){const value=snowpackState({dayOfYear:day,snowfall:.82,temperatureC:null}).runoffPulse;if(value>peak){peak=value;peakDay=day;}}if(peakDay<35||peakDay>150)errors.push(`snowmelt-peak:${peakDay}`);return freeze({ok:errors.length===0,errors:freeze(errors),peakDay,peak});}

export function checkRunoffBounds(){const errors=[];for(let slope=0;slope<=55;slope+=1)for(let rain=0;rain<=1;rain+=.1){const r=runoffPulse({rainfall:rain,slopeDegrees:slope,drainage:.5,snowmelt:.2});for(const key of ['concentrated','retention','rill','sheet','pulse'])if(r[key]<0||r[key]>1)errors.push(`${slope}:${rain}:${key}`);}return freeze({ok:errors.length===0,errors:freeze(errors)});}

export function checkWindDryingBounds(){const errors=[];for(let wind=0;wind<=1;wind+=.05)for(let canopy=0;canopy<=1;canopy+=.1)for(let humidity=0;humidity<=1;humidity+=.1){const d=windDrying({windExposure:wind,canopy,humidity});for(const key of ['ventilation','dry','shelter'])if(d[key]<0||d[key]>1)errors.push(`${wind}:${canopy}:${humidity}:${key}`);}return freeze({ok:errors.length===0,errors:freeze(errors)});}

export function checkProfileIntegrity(){const errors=[];for(const p of TERRAIN_SEASONAL_EROSION_PROFILES){if(!p.id)errors.push('missing-id');if(!p.climate)errors.push(`${p.id}:climate`);if(!p.substrate)errors.push(`${p.id}:substrate`);for(const key of ['saturation','drainage','exposure','erosion','frostWear','crust','mudTint','mossRetention','dustRetention'])if(p[key]<0||p[key]>1)errors.push(`${p.id}:${key}`);if(p.rainfallMm<0||p.snowfallMm<0||p.freezeCycles<0)errors.push(`${p.id}:forcing`);}return freeze({ok:errors.length===0,errors:freeze(errors),count:TERRAIN_SEASONAL_EROSION_PROFILES.length});}

export function checkClimateCoverage(){const required=['subarctic','cold-oceanic','temperate','mild-oceanic','wet-temperate','dry-temperate','mediterranean','highland','alpine','volcanic'];const present=new Set(TERRAIN_SEASONAL_EROSION_PROFILES.map(p=>p.climate));const missing=required.filter(v=>!present.has(v));return freeze({ok:missing.length===0,missing:freeze(missing)});}

export function runAllSeasonalDiagnostics(){const suite=runSeasonalDiagnosticSuite();const checks={boundary:checkBoundaryInvariants(suite),determinism:checkDeterminism(),forcing:checkForcingBounds(),freezeThaw:checkFreezeThawMonotonicity(),snowmelt:checkSnowmeltWindow(),runoff:checkRunoffBounds(),windDrying:checkWindDryingBounds(),profiles:checkProfileIntegrity(),climateCoverage:checkClimateCoverage()};const failed=Object.entries(checks).filter(([,v])=>!v.ok).map(([name])=>name);return freeze({ok:failed.length===0,failed:freeze(failed),checks:freeze(checks),summary:summarizeDiagnosticSuite(suite)});}
