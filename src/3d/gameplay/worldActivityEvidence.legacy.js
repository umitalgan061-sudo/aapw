/** Deterministic evidence reducer for world activity decisions. */
import { createWorldJourneyActivity } from './worldJourneyActivity.js';
import { createWorldActivitySchedule } from './worldActivityScheduler.js';
import { createWorldShelterContext } from './worldShelterContext.js';
export const WORLD_ACTIVITY_EVIDENCE_VERSION=1;
export const WORLD_ACTIVITY_EVIDENCE_LIMITS=Object.freeze({maxFactors:12,maxRecommendations:8,maxNotes:10});
export const WORLD_ACTIVITY_EVIDENCE_LEVELS=Object.freeze(['weak','moderate','strong','critical']);
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const t=(v,d='')=>{const s=String(v??'').trim();return s?s.slice(0,120):d;};
const freeze=(v,s=new Set())=>{if(!v||typeof v!=='object'||s.has(v))return v;s.add(v);Object.freeze(v);for(const x of Object.values(v))freeze(x,s);return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest=v=>{let h=2166136261,s=stable(v);for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
function level(score){if(score>=.86)return'critical';if(score>=.68)return'strong';if(score>=.44)return'moderate';return'weak';}
function factor(id,score,reason,source){return{id,score:Math.round(c(score)*1000)/1000,level:level(c(score)),reason:t(reason),source:t(source)};}
function buildFactors(journey,schedule,shelter){const f=[];f.push(factor('journey-confidence',journey.confidence,'Journey confidence','journey'));f.push(factor('cadence-pulse',journey.cadenceState==='urgent'?1:journey.cadenceState==='sheltered'?.72:journey.cadenceState==='active'?.68:.38,'Current cadence state','cadence'));f.push(factor('shelter-need',shelter.shelterNeed,'Environmental shelter pressure','shelter'));f.push(factor('visibility',shelter.visibility,'Environmental readability','shelter'));f.push(factor('schedule-priority',schedule.priority[0]?.priority??0.4,'Top scheduled activity','schedule'));for(const a of journey.activities.slice(0,5))f.push(factor(`activity:${a.type}`,a.score,`Candidate activity ${a.type}`,'activity'));return f.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,WORLD_ACTIVITY_EVIDENCE_LIMITS.maxFactors);}
function recommendations(factors,journey,schedule,shelter){const rows=[];const push=(type,score,reason)=>rows.push({type,score:Math.round(c(score)*1000)/1000,reason});if(shelter.shelterNeed>.72)push('shelter',shelter.shelterNeed,'Shelter pressure is elevated');if(journey.cadenceState==='urgent')push('pause',.94,'Cadence is urgent');if(schedule.priority[0])push(schedule.priority[0].type,schedule.priority[0].priority,'Top scheduled environmental activity');if(journey.mode==='arrival')push('enter',.9,'Settlement arrival is the current mode');if(journey.mode==='return')push('return',.84,'Return mode prioritizes gateway travel');if(!rows.length)push(journey.topActivity,.58,'Use the top deterministic activity');return rows.sort((a,b)=>b.score-a.score||a.type.localeCompare(b.type)).slice(0,WORLD_ACTIVITY_EVIDENCE_LIMITS.maxRecommendations);}
function notes(journey,schedule,shelter){const out=[];out.push(`mode=${journey.mode}`);out.push(`stage=${journey.stage}`);out.push(`lane=${journey.lane}`);out.push(`weather=${journey.weather}`);out.push(`shelter=${shelter.shelter}`);out.push(`window=${schedule.window}`);out.push(`cadence=${journey.cadenceState}`);out.push(`focus=${journey.focus}`);return out.slice(0,WORLD_ACTIVITY_EVIDENCE_LIMITS.maxNotes);}
export function createWorldActivityEvidence(options={}){const journey=createWorldJourneyActivity(options);const schedule=createWorldActivitySchedule(options);const shelter=createWorldShelterContext(options);const factors=buildFactors(journey,schedule,shelter);const recs=recommendations(factors,journey,schedule,shelter);const score=c(factors.reduce((s,x)=>s+x.score,0)/Math.max(1,factors.length));const p={version:1,settlementId:journey.settlementId,stage:journey.stage,mode:journey.mode,weather:journey.weather,evidenceScore:Math.round(score*1000)/1000,evidenceLevel:level(score),factors,recommendations:recs,notes:notes(journey,schedule,shelter),ownership:{readOnly:true,noWorldMutation:true,noActorSpawn:true,noSaveMutation:true,noEvidenceMutation:true}};return freeze({...p,fingerprint:digest(p)});}
export function validateWorldActivityEvidence(v){const s=v&&typeof v==='object'?v:{};const e=[];if(!WORLD_ACTIVITY_EVIDENCE_LEVELS.includes(s.evidenceLevel))e.push('level');if(s.evidenceScore<0||s.evidenceScore>1)e.push('score');if(!Array.isArray(s.factors)||s.factors.length>12)e.push('factor-cap');if(!Array.isArray(s.recommendations)||s.recommendations.length>8)e.push('recommendation-cap');if(!s.ownership?.readOnly||!s.ownership?.noWorldMutation)e.push('ownership');return freeze({ok:e.length===0,errors:e,fingerprint:s.fingerprint??digest(s)});}
export function summarizeWorldActivityEvidence(o={}){const x=createWorldActivityEvidence(o);return freeze({settlementId:x.settlementId,stage:x.stage,mode:x.mode,weather:x.weather,evidenceLevel:x.evidenceLevel,evidenceScore:x.evidenceScore,topRecommendation:x.recommendations[0]?.type??null,factorCount:x.factors.length,fingerprint:x.fingerprint});}
export const WORLD_ACTIVITY_EVIDENCE_API=Object.freeze({version:1,levels:[...WORLD_ACTIVITY_EVIDENCE_LEVELS],maxFactors:12,maxRecommendations:8,create:'createWorldActivityEvidence',validate:'validateWorldActivityEvidence',summary:'summarizeWorldActivityEvidence'});

/* Evidence rules are intentionally explicit so downstream systems do not infer
 * permissions from environmental scores. The packet is advisory only. */
const RULES=Object.freeze([
  ['storm',1,'pause','Weather can invalidate exposed travel'],
  ['fog',.72,'observe','Reduced visibility favors observation'],
  ['snow',.84,'shelter','Cold exposure favors shelter'],
  ['rain',.68,'shelter','Wetness favors shelter'],
  ['sleet',.82,'shelter','Mixed precipitation favors shelter'],
  ['night',.58,'observe','Night favors careful observation'],
  ['threshold',.82,'enter','Threshold favors arrival'],
  ['departure',.76,'return','Departure favors return'],
  ['resume',.74,'recover','Resume favors recovery'],
  ['service',.8,'service','Service stage favors service interaction'],
  ['inside',.72,'service','Inside stage favors settlement activity'],
  ['approach',.64,'travel','Approach favors route commitment'],
]);
export function resolveWorldActivityRule(key){const r=RULES.find(x=>x[0]===key);return r?Object.freeze({key:r[0],score:r[1],recommendation:r[2],reason:r[3]}):null;}
export function listWorldActivityRules(){return Object.freeze(RULES.map(([key,score,recommendation,reason])=>Object.freeze({key,score,recommendation,reason})));}
export function validateWorldActivityRules(){const errors=[];if(RULES.length!==12)errors.push('rule-count');if(RULES.some(r=>r[1]<0||r[1]>1))errors.push('rule-score');if(new Set(RULES.map(r=>r[0])).size!==RULES.length)errors.push('rule-duplicate');return freeze({ok:errors.length===0,errors,count:RULES.length});}
