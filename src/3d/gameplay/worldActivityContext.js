/**
 * Deterministic, read-only environment activity context.
 *
 * This module converts existing traversal and terrain evidence into a bounded
 * set of ambient activity recommendations. It never spawns actors or edits
 * the world; callers may use the packet to select already-authored content.
 */
import { createSettlementWorldCoverageTraversalPlan } from './settlementWorldCoverageTraversal.js';

export const WORLD_ACTIVITY_CONTEXT_VERSION = 1;
export const WORLD_ACTIVITY_CONTEXT_LIMITS = Object.freeze({
  maxActivities: 12,
  maxSignals: 10,
  maxDistanceMeters: 240,
  mobileScale: 0.62,
});
export const WORLD_ACTIVITY_TYPES = Object.freeze([
  'travel', 'camp', 'trade', 'craft', 'guard', 'farm', 'gather', 'observe', 'rest', 'social', 'warning', 'quiet',
]);

const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const t=(v,d='')=>{const s=String(v??'').trim();return s?s.slice(0,120):d;};
const freeze=(v,s=new Set())=>{if(!v||typeof v!=='object'||s.has(v))return v;s.add(v);Object.freeze(v);for(const x of Object.values(v))freeze(x,s);return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest=v=>{let h=2166136261,s=stable(v);for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};

const STAGE_ACTIVITY=Object.freeze({
  far:['travel','observe','gather','quiet'],
  approach:['travel','observe','guard','gather'],
  threshold:['travel','guard','social','warning'],
  inside:['trade','craft','farm','social'],
  service:['trade','craft','social','rest'],
  departure:['travel','guard','gather','observe'],
  resume:['travel','rest','observe','quiet'],
});
const WEATHER_ACTIVITY=Object.freeze({
  clear:{travel:1,observe:1,gather:.92,rest:.72},
  cloud:{travel:.98,observe:.92,gather:.9,rest:.74},
  fog:{travel:.56,observe:.28,gather:.48,rest:.82},
  rain:{travel:.62,observe:.52,gather:.58,rest:.9},
  snow:{travel:.46,observe:.62,gather:.3,rest:.96},
  storm:{travel:.18,observe:.2,gather:.12,rest:1,warning:1},
  wind:{travel:.76,observe:.72,gather:.7,rest:.64},
  sleet:{travel:.42,observe:.48,gather:.24,rest:.94},
});
const LANE_ACTIVITY=Object.freeze({
  gateway:['travel','guard'], market:['trade','social'], tavern:['rest','social'], craft:['craft','trade'],
  farm:['farm','gather'], military:['guard','train'], stable:['travel','rest'], home:['rest','social'],
  river:['gather','observe'], ridge:['observe','travel'],
});

function weatherType(plan){return t(plan?.atmosphere?.weather?.type,'clear').toLowerCase();}
function weatherFactor(type,activity){return WEATHER_ACTIVITY[type]?.[activity]??.68;}
function activityWeight(activity,plan,lane,weather){
  const stage=plan.stage;
  const stageList=STAGE_ACTIVITY[stage]??['travel'];
  const stageBonus=stageList.includes(activity)?.18:0;
  const laneList=LANE_ACTIVITY[lane]??[];
  const laneBonus=laneList.includes(activity)?.14:0;
  const serviceBonus=plan.recommendedService?.serviceId==='market'&&activity==='trade'?.12:0;
  const risk= c(plan.risk?.risk??0);
  const riskPenalty=['travel','gather','observe'].includes(activity)?risk*.12:0;
  return c(.48+stageBonus+laneBonus+serviceBonus-riskPenalty)*weatherFactor(weather,activity);
}
function buildActivity(type,index,plan,lane,weather,mobile){
  const score=Math.round(activityWeight(type,plan,lane,weather)*1000)/1000;
  const maxDistance=Math.max(18,Math.min(WORLD_ACTIVITY_CONTEXT_LIMITS.maxDistanceMeters, n(plan.player?.distanceMeters,0)+36));
  const distance=Math.round(maxDistance*(.25+index*.11)*(mobile?WORLD_ACTIVITY_CONTEXT_LIMITS.mobileScale:1)*100)/100;
  return {
    id:`${plan.settlementId}:activity:${type}:${index+1}`,
    type,
    lane,
    score,
    priority:Math.round((score+(type==='warning'&&weather==='storm'?.18:0))*1000)/1000,
    distanceMeters:Math.min(WORLD_ACTIVITY_CONTEXT_LIMITS.maxDistanceMeters,distance),
    weather,
    semantic:plan.stage,
    mobile,
  };
}
function buildSignals(plan,activities,weather){
  const signals=[];
  if(plan.gatewayState==='available')signals.push({type:'entry',score:.96,copy:'Settlement entry is available'});
  if(plan.gatewayState==='blocked')signals.push({type:'warning',score:.82,copy:'Boundary access requires caution'});
  if(weather!=='clear')signals.push({type:'weather',score:weather==='storm'?1:.64,copy:`Weather: ${weather}`});
  if(plan.stage==='service')signals.push({type:'service',score:.88,copy:'Settlement service remains the focal activity'});
  for(const activity of activities.slice(0,4))signals.push({type:activity.type,score:activity.priority,copy:`Suggested activity: ${activity.type}`});
  return signals.sort((a,b)=>b.score-a.score||a.type.localeCompare(b.type)).slice(0,WORLD_ACTIVITY_CONTEXT_LIMITS.maxSignals);
}

export function createWorldActivityContext(options={}){
  const mobile=Boolean(options.mobile);
  const plan=createSettlementWorldCoverageTraversalPlan(options);
  const lanes=plan.lanes.filter(l=>l.eligible);
  const lane=lanes[0]?.lane??'gateway';
  const weather=weatherType(plan);
  const types=[...(LANE_ACTIVITY[lane]??[]),...(STAGE_ACTIVITY[plan.stage]??[])];
  if(weather==='storm')types.push('warning');
  if(weather==='snow'||weather==='sleet')types.push('rest');
  const unique=[...new Set(types)].filter(WORLD_ACTIVITY_TYPES.includes);
  const activities=unique.map((type,index)=>buildActivity(type,index,plan,lane,weather,mobile))
    .sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id))
    .slice(0,mobile?8:WORLD_ACTIVITY_CONTEXT_LIMITS.maxActivities);
  const signals=buildSignals(plan,activities,weather);
  const payload={
    version:WORLD_ACTIVITY_CONTEXT_VERSION,
    settlementId:plan.settlementId,
    stage:plan.stage,
    phase:plan.phase,
    lane,
    weather,
    mobile,
    activityCount:activities.length,
    activities,
    signals,
    topActivity:activities[0]?.type??'quiet',
    readiness:plan.summary.topScore,
    ownership:{readOnly:true,noActorSpawn:true,noWorldMutation:true,noSaveMutation:true,noTerrainMutation:true,noRoadMutation:true},
  };
  return freeze({...payload,fingerprint:digest(payload)});
}

export function validateWorldActivityContext(value){
  const s=value&&typeof value==='object'?value:{};const e=[];
  if(!s.settlementId)e.push('settlement-id');
  if(!WORLD_ACTIVITY_TYPES.includes(s.topActivity))e.push('top-activity');
  if(!Array.isArray(s.activities)||s.activities.length>WORLD_ACTIVITY_CONTEXT_LIMITS.maxActivities)e.push('activity-cap');
  if(!Array.isArray(s.signals)||s.signals.length>WORLD_ACTIVITY_CONTEXT_LIMITS.maxSignals)e.push('signal-cap');
  if(s.activities?.some(a=>a.score<0||a.score>1))e.push('score-range');
  if(s.activities?.some(a=>a.distanceMeters<0||a.distanceMeters>WORLD_ACTIVITY_CONTEXT_LIMITS.maxDistanceMeters))e.push('distance-range');
  if(!s.ownership?.readOnly||!s.ownership?.noWorldMutation||!s.ownership?.noActorSpawn)e.push('ownership');
  return freeze({ok:e.length===0,errors:e,fingerprint:s.fingerprint??digest(s),activityCount:s.activities?.length??0});
}

export function summarizeWorldActivityContext(options={}){
  const cxt=createWorldActivityContext(options);
  return freeze({settlementId:cxt.settlementId,stage:cxt.stage,phase:cxt.phase,lane:cxt.lane,weather:cxt.weather,topActivity:cxt.topActivity,activityCount:cxt.activityCount,signalCount:cxt.signals.length,readiness:cxt.readiness,fingerprint:cxt.fingerprint});
}

export const WORLD_ACTIVITY_CONTEXT_API=Object.freeze({version:1,types:[...WORLD_ACTIVITY_TYPES],maxActivities:12,maxSignals:10,create:'createWorldActivityContext',validate:'validateWorldActivityContext',summary:'summarizeWorldActivityContext'});
