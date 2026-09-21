import { seasonalForcingAtDay, normalizeDayOfYear, resolveSeasonalErosionState, applySurfaceMemory, seasonTransitionBlend } from './terrainSeasonalErosionCycle.js';
import { resolveTerrainSeasonalErosionStack, seasonalErosionCacheKey } from './terrainSeasonalErosionAdapter.js';
import { TERRAIN_SEASONAL_EROSION_DAILY_MATRIX } from './terrainSeasonalErosionDailyMatrix.js';
import { TERRAIN_SEASONAL_EROSION_RESPONSE_BOOK_POLICY } from './terrainSeasonalErosionResponseBook.js';

const freeze=v=>Object.freeze(v); const finite=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d; const c=v=>Math.max(0,Math.min(1,finite(v)));

export const TERRAIN_SEASONAL_EROSION_RUNTIME_POLICY=freeze({id:'terrain-seasonal-erosion-runtime-2026-09-15-v1',deterministic:true,renderOnly:true,canonicalHeightUnchanged:true,canonicalHydrologyUnchanged:true,canonicalCoastlineUnchanged:true,canonicalColliderUnchanged:true,canonicalVegetationPlacementUnchanged:true,frameBudgetMs:2.2,cacheVersion:1,materialKey:'terrain-seasonal-erosion-runtime-v1'});

function quantize(v,step=.05){return Math.round(finite(v)/step)*step;}
function phaseAtFrame(day,frame=0,fps=60){const safeDay=normalizeDayOfYear(day),minutes=Math.max(0,finite(frame)/Math.max(1,finite(fps)));return(safeDay-1+minutes/(24*60))/360;}
function daySignalFromPhase(phase){return(.5+.5*Math.sin((phase%1)*Math.PI*2-Math.PI/2));}

export function buildSeasonalRuntimeKey(input={}){
  const day=Math.floor(finite(input.dayOfYear,180));
  const hour=Math.floor(Math.max(0,finite(input.hourOfDay,12)))%24;
  const x=quantize(input.worldX,1); const z=quantize(input.worldZ,1);
  const climate=String(input.climate??'temperate').trim().toLowerCase();
  const substrate=String(input.substrate??'granite').trim().toLowerCase();
  return `${TERRAIN_SEASONAL_EROSION_RUNTIME_POLICY.cacheVersion}|${x}|${z}|${day}|${hour}|${climate}|${substrate}`;
}

export function createSeasonalRuntimeContext(input={}){
  const day=normalizeDayOfYear(input.dayOfYear??180);
  const forcing=seasonalForcingAtDay(day);
  const transition=seasonTransitionBlend(day);
  const frame=finite(input.frame,0); const fps=Math.max(1,finite(input.fps,60));
  const phase=phaseAtFrame(day,frame,fps);
  return freeze({
    dayOfYear:day,
    season:forcing.season,
    forcing,
    transition,
    phase,
    daySignal:daySignalFromPhase(phase),
    frame,
    fps,
    runtimeKey:buildSeasonalRuntimeKey({...input,dayOfYear:day}),
    canonicalTerrainUntouched:true,
  });
}

export function resolveSeasonalRuntimeSample(input={}){
  const normalized={...input,worldX:finite(input.worldX),worldZ:finite(input.worldZ),dayOfYear:normalizeDayOfYear(input.dayOfYear??180),moisture:input.moisture??.5,rainfall:input.rainfall??.5,windExposure:input.windExposure??.5,drainage:input.drainage??.5};
  const context=createSeasonalRuntimeContext(normalized);
  const result=resolveTerrainSeasonalErosionStack(normalized);
  return freeze({context,result,cacheKey:seasonalErosionCacheKey(normalized),runtimePolicyId:TERRAIN_SEASONAL_EROSION_RUNTIME_POLICY.id});
}

export function resolveSeasonalRuntimeMaterial(input={}){return resolveSeasonalRuntimeSample(input).result.material;}

export function updateSeasonalRuntime(previous,input={},deltaDays=1){
  const current=resolveSeasonalRuntimeSample(input);
  if(!previous)return current;
  const memory=applySurfaceMemory(previous.result.seasonal,current.result.seasonal,deltaDays);
  return freeze({...current,memory});
}

export function sampleRuntimeInterpolation(a,b,t=.5){
  const amount=c(t); const av=a?.result?.material??a?.material; const bv=b?.result?.material??b?.material;
  if(!av||!bv)throw new TypeError('runtime interpolation requires two material samples');
  const color={r:finite(av.color?.r)+(finite(bv.color?.r)-finite(av.color?.r))*amount,g:finite(av.color?.g)+(finite(bv.color?.g)-finite(av.color?.g))*amount,b:finite(av.color?.b)+(finite(bv.color?.b)-finite(av.color?.b))*amount};
  return freeze({color:freeze(color),roughness:finite(av.roughness)+(finite(bv.roughness)-finite(av.roughness))*amount,normalStrength:finite(av.normalStrength)+(finite(bv.normalStrength)-finite(av.normalStrength))*amount,specularDamping:finite(av.specularDamping)+(finite(bv.specularDamping)-finite(av.specularDamping))*amount,blend:amount});
}

export function evaluateDailyMatrixSample(index=0,input={}){
  const row=TERRAIN_SEASONAL_EROSION_DAILY_MATRIX[Math.max(0,Math.min(TERRAIN_SEASONAL_EROSION_DAILY_MATRIX.length-1,Math.floor(finite(index))))];
  const climate=input.climate??'temperate';
  return resolveSeasonalRuntimeSample({...input,dayOfYear:row[1],temperatureC:finite(input.temperatureC,11)+(row[3]-.5)*6,moisture:input.moisture??row[8],rainfall:input.rainfall??row[4],snowWeight:input.snowWeight??row[5],windExposure:input.windExposure??row[7],climate});
}

export function buildRuntimeProbeCatalog(points=[]){return freeze(points.map((point,index)=>{const sample=resolveSeasonalRuntimeSample(point);return freeze({index,id:point.id??`P${index+1}`,cacheKey:sample.cacheKey,dayOfYear:sample.context.dayOfYear,season:sample.context.season,material:sample.result.material,seasonalAge:sample.result.seasonal.seasonalAge,canonicalTerrainUntouched:sample.result.seasonal.canonicalTerrainUntouched});}));}

export function runtimeMaterialDelta(a,b){const first=a?.result?.material??a?.material;const second=b?.result?.material??b?.material;if(!first||!second)throw new TypeError('runtime material delta requires two samples');const channelDelta={r:finite(second.color?.r)-finite(first.color?.r),g:finite(second.color?.g)-finite(first.color?.g),b:finite(second.color?.b)-finite(first.color?.b)};const scalarDelta={roughness:finite(second.roughness)-finite(first.roughness),normalStrength:finite(second.normalStrength)-finite(first.normalStrength),specularDamping:finite(second.specularDamping)-finite(first.specularDamping)};const maxColor=Math.max(Math.abs(channelDelta.r),Math.abs(channelDelta.g),Math.abs(channelDelta.b));const maxScalar=Math.max(...Object.values(scalarDelta).map(Math.abs));return freeze({color:freeze(channelDelta),scalar:freeze(scalarDelta),maxColor,maxScalar,changed:maxColor>.001||maxScalar>.001});}

export function assertRuntimeBoundary(sample){const errors=[];if(sample?.result?.seasonal?.canonicalTerrainUntouched!==true)errors.push('terrain-boundary');if(sample?.result?.seasonal?.heightMeters===undefined)errors.push('height-field-missing');if(sample?.result?.seasonal?.slopeDegrees===undefined)errors.push('slope-field-missing');if(sample?.result?.policyId===undefined)errors.push('policy-missing');return freeze({ok:errors.length===0,errors:freeze(errors)});}

export function runtimeSeasonEnvelope({startDay=1,endDay=360,step=7,input={}}={}){const rows=[];for(let day=normalizeDayOfYear(startDay);day<=endDay;day+=Math.max(1,Math.floor(finite(step,7)))){const sample=resolveSeasonalRuntimeSample({...input,dayOfYear:day});rows.push(freeze({day,season:sample.context.season,forcing:sample.context.forcing,seasonalAge:sample.result.seasonal.seasonalAge,erosion:sample.result.seasonal.erosion,frostWear:sample.result.seasonal.frostWear,crust:sample.result.seasonal.crust}));}return freeze(rows);}

export function classifyRuntimeDominant(state){if(!state)return'none';const scores={snowmelt:state.snow.runoffPulse*1.05,freezeThaw:state.frostWear*1.10,rill:state.pulse.rill*1.05,saturation:state.mud*.96,drying:state.crust*1.08,deposition:state.deposition};return Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0];}

export function runtimeDominanceReport(input={}){const sample=resolveSeasonalRuntimeSample(input);return freeze({dominant:classifyRuntimeDominant(sample.result.seasonal),dayOfYear:sample.context.dayOfYear,season:sample.context.season,erosion:sample.result.seasonal.erosion,frostWear:sample.result.seasonal.frostWear,mud:sample.result.seasonal.mud,crust:sample.result.seasonal.crust,deposition:sample.result.seasonal.deposition,responseBookPolicy:TERRAIN_SEASONAL_EROSION_RESPONSE_BOOK_POLICY.id});}

export const TERRAIN_SEASONAL_EROSION_RUNTIME_CONTRACT=freeze({required:['worldX','worldZ','dayOfYear'],optional:['heightMeters','slopeDegrees','climate','substrate','moisture','rainfall','snowWeight','windExposure','drainage','canopy','temperatureC','frozenDays','dryDays'],outputs:['context','result','cacheKey','runtimePolicyId'],boundary:['canonicalHeightUnchanged','canonicalHydrologyUnchanged','canonicalCoastlineUnchanged','canonicalColliderUnchanged','canonicalVegetationPlacementUnchanged']});
