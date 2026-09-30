import { seasonalForcingAtDay, normalizeDayOfYear, resolveSeasonalErosionState } from './terrainSeasonalErosionCycle.js';
import { responseBookByClimate, responseBookByDominant } from './terrainSeasonalErosionResponseBook.js';

const freeze=v=>Object.freeze(v); const finite=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d; const c=v=>Math.max(0,Math.min(1,finite(v)));
export const TERRAIN_SEASONAL_EROSION_EVENT_POLICY=freeze({id:'terrain-seasonal-erosion-events-2026-09-15-v1',deterministic:true,renderOnly:true,canonicalHeightUnchanged:true,canonicalHydrologyUnchanged:true,canonicalCoastlineUnchanged:true,canonicalColliderUnchanged:true,canonicalVegetationPlacementUnchanged:true,eventCountTarget:12,minimumEventSpacingDays:7,materialKey:'terrain-seasonal-erosion-events-v1'});

export const TERRAIN_SEASONAL_EVENT_TYPES=freeze(['snowmelt','freeze-thaw','storm-runoff','saturation','drying','dust-deposition','crust-formation','channel-wash','surface-recovery','salt-wetness','thermal-spall','fines-settlement']);

function eventScore(type,state){const scores={snowmelt:state.snow.runoffPulse*1.12,'freeze-thaw':state.frostWear*1.15,'storm-runoff':state.pulse.pulse*1.08,saturation:state.mud*1.04,drying:state.drying.dry*1.06,'dust-deposition':state.deposition*.98,'crust-formation':state.crust*1.09,'channel-wash':state.pulse.rill*1.10,'surface-recovery':(1-state.seasonalAge)*.61,'salt-wetness':state.moisture.value*state.drying.shelter*.93,'thermal-spall':state.thaw.crack*1.02,'fines-settlement':state.deposition*(1-state.pulse.rill)*1.04};return c(scores[type]??0);}

export function rankSeasonalEvents(state){return freeze(TERRAIN_SEASONAL_EVENT_TYPES.map(type=>freeze({type,score:eventScore(type,state)})).sort((a,b)=>b.score-a.score));}

export function seasonalEventAt(input={},type=null){const state=resolveSeasonalErosionState(input);const ranked=rankSeasonalEvents(state);const selected=type?ranked.find(row=>row.type===type):ranked[0];return freeze({selected:selected??null,ranked,state});}

export function eventWindowForSeason(season='spring'){const windows={spring:['snowmelt','surface-recovery','channel-wash'],summer:['storm-runoff','dust-deposition','drying'],autumn:['saturation','fines-settlement','channel-wash'],winter:['freeze-thaw','salt-wetness','thermal-spall']};return freeze((windows[String(season).toLowerCase()]??windows.spring).slice());}

export function planSeasonalEvents({startDay=1,endDay=360,stepDays=14,input={}}={}){const rows=[];for(let day=startDay;day<=endDay;day+=Math.max(1,Math.floor(stepDays))){const sample=seasonalEventAt({...input,dayOfYear:normalizeDayOfYear(day)});const top=sample.ranked.slice(0,3);rows.push(freeze({dayOfYear:normalizeDayOfYear(day),season:sample.state.season,events:freeze(top),primary:top[0]?.type??'none'}));}return freeze(rows);}

export function detectTransitionEvents({startDay=1,endDay=360,input={},threshold=.16}={}){const rows=[];let previous=null;for(let day=startDay;day<=endDay;day+=1){const state=resolveSeasonalErosionState({...input,dayOfYear:day});const ranked=rankSeasonalEvents(state);const current=ranked[0];if(previous&&current.type!==previous.type&&Math.abs(current.score-previous.score)>=threshold)rows.push(freeze({dayOfYear:day,from:previous.type,to:current.type,scoreDelta:current.score-previous.score,season:state.season}));previous=current;}return freeze(rows);}

export function eventStrengthBuckets(rows=[]){const buckets={none:0,trace:0,light:0,moderate:0,strong:0};for(const row of rows){const s=c(row?.score);if(s<.05)buckets.none++;else if(s<.2)buckets.trace++;else if(s<.4)buckets.light++;else if(s<.7)buckets.moderate++;else buckets.strong++;}return freeze(buckets);}

export function summarizeSeasonalEvents(rows=[]){const totals=new Map();for(const row of rows){for(const event of row.events??[]){const v=totals.get(event.type)??{count:0,score:0};v.count++;v.score+=event.score;totals.set(event.type,v);}}return freeze([...totals].map(([type,v])=>freeze({type,count:v.count,meanScore:v.score/v.count})).sort((a,b)=>b.meanScore-a.meanScore));}

export function climateEventGuidance(climate='temperate'){const rows=responseBookByClimate(climate);const dominant=new Map();for(const row of rows){dominant.set(row.dominant,(dominant.get(row.dominant)??0)+1);}return freeze([...dominant].map(([type,count])=>freeze({type,count})).sort((a,b)=>b.count-a.count));}

export function dominantEventGuidance(dominant='rain'){return freeze(responseBookByDominant(dominant).map(row=>freeze({id:row.id,climate:row.climate,substrate:row.substrate,erosion:row.erosion,frost:row.frost,crust:row.crust,notes:row.notes})));}

export function eventMaterialIntent(eventType='rain'){const map={snowmelt:{roughness:-.03,albedo:-.01,normal:.04},'freeze-thaw':{roughness:.05,albedo:.01,normal:.06},'storm-runoff':{roughness:.03,albedo:-.02,normal:.05},saturation:{roughness:-.06,albedo:-.03,normal:.01},drying:{roughness:.04,albedo:.02,normal:.01},'dust-deposition':{roughness:.01,albedo:.015,normal:.005},'crust-formation':{roughness:.06,albedo:.025,normal:.02},'channel-wash':{roughness:.03,albedo:-.015,normal:.07},'surface-recovery':{roughness:-.01,albedo:.005,normal:-.01},'salt-wetness':{roughness:-.04,albedo:-.015,normal:.02},'thermal-spall':{roughness:.07,albedo:.01,normal:.08},'fines-settlement':{roughness:.01,albedo:-.005,normal:.025}};return freeze(map[eventType]??map['storm-runoff']);}

export function buildEventTimeline({years=3,startDay=1,input={}}={}){const timeline=[];for(let year=0;year<Math.max(1,Math.floor(years));year++){for(let day=startDay;day<=360;day+=15){const actualDay=day;const state=resolveSeasonalErosionState({...input,dayOfYear:actualDay,frozenDays:finite(input.frozenDays,0)+year,dryDays:finite(input.dryDays,0)+year});const event=rankSeasonalEvents(state)[0];timeline.push(freeze({year:year+1,dayOfYear:actualDay,season:state.season,type:event.type,score:event.score,age:state.seasonalAge}));}}return freeze(timeline);}

export function eventRecurrenceMap(timeline=[]){const recurrence=new Map();for(const row of timeline){const key=`${row.season}:${row.type}`;recurrence.set(key,(recurrence.get(key)??0)+1);}return freeze([...recurrence].map(([key,count])=>{const [season,type]=key.split(':');return freeze({season,type,count});}).sort((a,b)=>b.count-a.count));}

export function validateEventPlan(plan=[]){const errors=[];for(let i=0;i<plan.length;i++){const row=plan[i];if(!row?.season)errors.push(`row-${i}:season`);if(!row?.primary)errors.push(`row-${i}:primary`);if(!Array.isArray(row?.events)||row.events.length===0)errors.push(`row-${i}:events`);for(const event of row.events??[])if(!(event.score>=0&&event.score<=1))errors.push(`row-${i}:${event.type}:score`);}return freeze({ok:errors.length===0,errors:freeze(errors),policyId:TERRAIN_SEASONAL_EROSION_EVENT_POLICY.id});}

export function eventTransitionSignature(input={}){const transition=detectTransitionEvents(input);return freeze({count:transition.length,first:transition[0]??null,last:transition.at(-1)??null,policyId:TERRAIN_SEASONAL_EROSION_EVENT_POLICY.id});}

export function buildSeasonalEventManifest(input={}){const plan=planSeasonalEvents(input);const transitions=detectTransitionEvents(input);const summary=summarizeSeasonalEvents(plan);return freeze({version:1,policyId:TERRAIN_SEASONAL_EROSION_EVENT_POLICY.id,plan,transitions,summary,validation:validateEventPlan(plan),eventTypes:TERRAIN_SEASONAL_EVENT_TYPES});}

export function compareEventPlans(a=[],b=[]){const types=new Set([...a,...b].map(row=>row.primary));const deltas={};for(const type of types){const ac=a.filter(row=>row.primary===type).length;const bc=b.filter(row=>row.primary===type).length;deltas[type]=bc-ac;}return freeze({deltas:freeze(deltas),different:Object.values(deltas).some(value=>value!==0)});}
