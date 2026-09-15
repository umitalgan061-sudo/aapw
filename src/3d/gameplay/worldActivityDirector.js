/** Unified read-only director for environmental activity presentation. */
import { createWorldActivityContext } from './worldActivityContext.js';
import { createWorldActivityCadence } from './worldActivityCadence.js';
import { createWorldActivitySchedule } from './worldActivityScheduler.js';
import { createWorldShelterContext } from './worldShelterContext.js';
import { createWorldActivityEvidence } from './worldActivityEvidence.js';
import { createWorldJourneyActivity } from './worldJourneyActivity.js';

export const WORLD_ACTIVITY_DIRECTOR_VERSION=1;
export const WORLD_ACTIVITY_DIRECTOR_STATES=Object.freeze(['explore','travel','interact','shelter','caution','recover']);
export const WORLD_ACTIVITY_DIRECTOR_LIMITS=Object.freeze({maxActions:8,maxSignals:8,maxFactors:8});

const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const t=(v,d='')=>{const s=String(v??'').trim();return s?s.slice(0,120):d;};
const freeze=(v,s=new Set())=>{if(!v||typeof v!=='object'||s.has(v))return v;s.add(v);Object.freeze(v);for(const x of Object.values(v))freeze(x,s);return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest=v=>{let h=2166136261,s=stable(v);for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};

function directorState(journey,shelter,cadence,evidence){
  if(shelter.shelterNeed>=.8)return'shelter';
  if(cadence.state==='urgent'||evidence.evidenceLevel==='critical')return'caution';
  if(cadence.state==='sheltered'||cadence.state==='recover')return'recover';
  if(journey.mode==='service'||journey.mode==='settlement')return'interact';
  if(journey.mode==='arrival'||journey.mode==='travel'||journey.mode==='return')return'travel';
  return'explore';
}
function actionScore(activity,evidence,schedule,state){
  const scheduled=schedule.priority.find(x=>x.type===activity.type)?.priority??0;
  const evidenceMatch=evidence.recommendations.find(x=>x.type===activity.type)?.score??0;
  const stateBonus=state==='shelter'&&activity.type==='rest'?.24:state==='interact'&&['trade','craft','social'].includes(activity.type)?.18:state==='travel'&&activity.type==='travel'?.16:state==='caution'&&activity.type==='warning'?.28:0;
  return c(activity.score*.52+scheduled*.18+evidenceMatch*.18+stateBonus*.12);
}
function buildActions(activity,evidence,schedule,state,mobile){
  return activity.activities.map((x,i)=>({
    id:`director:${x.id}`,
    rank:i+1,
    type:x.type,
    lane:x.lane,
    score:Math.round(actionScore(x,evidence,schedule,state)*1000)/1000,
    reason:evidence.recommendations.find(r=>r.type===x.type)?.reason??`Activity ${x.type} is available`,
    distanceMeters:x.distanceMeters,
    mobile,
  })).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,mobile?6:8);
}
function buildSignals(context,cadence,shelter,evidence){
  const rows=[
    {type:'activity',score:context.readiness,copy:`Top activity: ${context.topActivity}`},
    {type:'cadence',score:cadence.pulse,copy:`Cadence: ${cadence.state}`},
    {type:'shelter',score:shelter.shelterNeed,copy:`Shelter need: ${shelter.preferred}`},
    {type:'evidence',score:evidence.evidenceScore,copy:`Evidence: ${evidence.evidenceLevel}`},
  ];
  return rows.sort((a,b)=>b.score-a.score||a.type.localeCompare(b.type)).slice(0,WORLD_ACTIVITY_DIRECTOR_LIMITS.maxSignals);
}
function focusForState(state,journey){
  if(state==='shelter')return'find-shelter';
  if(state==='caution')return'observe-and-slow';
  if(state==='recover')return'recover-before-travel';
  if(state==='interact')return journey.focus==='follow-service'?'follow-service':'settlement-interaction';
  if(state==='travel')return'follow-route';
  return'explore-nearby';
}

export function createWorldActivityDirector(options={}){
  const mobile=Boolean(options.mobile);
  const context=createWorldActivityContext(options);
  const cadence=createWorldActivityCadence(options);
  const schedule=createWorldActivitySchedule(options);
  const shelter=createWorldShelterContext(options);
  const evidence=createWorldActivityEvidence(options);
  const journey=createWorldJourneyActivity(options);
  const state=directorState(journey,shelter,cadence,evidence);
  const actions=buildActions(context,evidence,schedule,state,mobile);
  const signals=buildSignals(context,cadence,shelter,evidence);
  const p={
    version:1,
    settlementId:context.settlementId,
    stage:context.stage,
    mode:journey.mode,
    state,
    focus:focusForState(state,journey),
    lane:context.lane,
    weather:context.weather,
    cadenceState:cadence.state,
    shelter:shelter.shelter,
    evidenceLevel:evidence.evidenceLevel,
    evidenceScore:evidence.evidenceScore,
    actions,
    signals,
    factors:evidence.factors.slice(0,WORLD_ACTIVITY_DIRECTOR_LIMITS.maxFactors),
    ownership:{readOnly:true,noWorldMutation:true,noActorSpawn:true,noMovementMutation:true,noSaveMutation:true,noUiMutation:true},
  };
  return freeze({...p,fingerprint:digest(p)});
}

export function validateWorldActivityDirector(v){
  const s=v&&typeof v==='object'?v:{};const e=[];
  if(!WORLD_ACTIVITY_DIRECTOR_STATES.includes(s.state))e.push('state');
  if(!s.focus)e.push('focus');
  if(!Array.isArray(s.actions)||s.actions.length>8)e.push('action-cap');
  if(!Array.isArray(s.signals)||s.signals.length>8)e.push('signal-cap');
  if(!Array.isArray(s.factors)||s.factors.length>8)e.push('factor-cap');
  if(s.actions?.some(a=>a.score<0||a.score>1))e.push('action-score');
  if(s.evidenceScore<0||s.evidenceScore>1)e.push('evidence-score');
  if(!s.ownership?.readOnly||!s.ownership?.noWorldMutation||!s.ownership?.noActorSpawn)e.push('ownership');
  return freeze({ok:e.length===0,errors:e,settlementId:s.settlementId??null,state:s.state??'explore',fingerprint:s.fingerprint??digest(s)});
}

export function summarizeWorldActivityDirector(o={}){const x=createWorldActivityDirector(o);return freeze({settlementId:x.settlementId,stage:x.stage,mode:x.mode,state:x.state,focus:x.focus,lane:x.lane,weather:x.weather,evidenceLevel:x.evidenceLevel,topAction:x.actions[0]?.type??null,actionCount:x.actions.length,signalCount:x.signals.length,fingerprint:x.fingerprint});}
export function replayWorldActivityDirector(o={}){const a=createWorldActivityDirector(o);const b=createWorldActivityDirector(JSON.parse(JSON.stringify(o)));return freeze({ok:a.fingerprint===b.fingerprint,firstFingerprint:a.fingerprint,secondFingerprint:b.fingerprint});}
export const WORLD_ACTIVITY_DIRECTOR_API=Object.freeze({version:1,states:[...WORLD_ACTIVITY_DIRECTOR_STATES],maxActions:8,maxSignals:8,create:'createWorldActivityDirector',validate:'validateWorldActivityDirector',summary:'summarizeWorldActivityDirector',replay:'replayWorldActivityDirector'});
