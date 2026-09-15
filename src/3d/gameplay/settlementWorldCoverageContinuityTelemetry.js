/** Deterministic read-only telemetry for settlement continuity transitions. */
import { createSettlementWorldCoverageContinuityExperience } from './settlementWorldCoverageContinuityExperience.js';

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_TELEMETRY_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_TELEMETRY_LIMITS = Object.freeze({ maxSamples: 24, maxEventName: 48, maxMetadataKeys: 12 });
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const t=(v,d='')=>{const s=String(v??'').trim();return s?s.slice(0,48):d;};
const c=v=>Math.max(0,Math.min(1,n(v)));
const freeze=(v,s=new Set())=>{if(!v||typeof v!=='object'||s.has(v))return v;s.add(v);Object.freeze(v);for(const x of Object.values(v))freeze(x,s);return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest=v=>{let h=2166136261,s=stable(v);for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
const STAGE_ORDER=Object.freeze(['far','approach','threshold','inside','service','departure','resume']);
const EVENT_TYPES=Object.freeze(['observe','approach','threshold','enter','service','exit','resume','warning']);
const stageIndex=s=>STAGE_ORDER.indexOf(s);
const eventType=e=>e.gatewayState==='blocked'?'warning':e.stage==='threshold'?'threshold':e.stage==='departure'?'exit':e.stage==='resume'?'resume':e.mode==='service'?'service':e.mode==='settle'?'enter':e.stage==='approach'?'approach':'observe';
const normalizeMetadata=(m={})=>Object.freeze(Object.fromEntries(Object.entries(m&&typeof m==='object'?m:{}).slice(0,12).map(([k,v])=>[t(k,'key'),t(v)])));
function createEvent(experience,index,previousStage){
  const type=eventType(experience),direction=stageIndex(experience.stage)>=stageIndex(previousStage)?'forward':'backward';
  return {sequence:index+1,id:`${experience.settlementId}:${type}:${index+1}`,type,stage:experience.stage,previousStage,direction,
    distanceMeters:Math.round(experience.player.distanceMeters*100)/100,readiness:c(experience.readiness),gatewayState:experience.gatewayState,mode:experience.mode,
    metadata:normalizeMetadata({road:experience.road.class,weather:experience.atmosphere.weather.type,mobile:experience.road.mobile,primarySign:experience.signage.primarySignId})};
}
function buildBuckets(events){const counts={};for(const event of events)counts[event.type]=(counts[event.type]??0)+1;return Object.freeze(counts);}
function buildStageSpan(events){if(!events.length)return null;const first=stageIndex(events[0].stage),last=stageIndex(events.at(-1).stage);return Object.freeze({from:events[0].stage,to:events.at(-1).stage,delta:last-first});}
function createReadinessBand(v){return v>=.8?'high':v>=.55?'medium':'low';}

export function createSettlementWorldCoverageContinuityTelemetry(options={},samples=[]){
  const experience=createSettlementWorldCoverageContinuityExperience(options);
  const input=Array.isArray(samples)?samples.slice(-24):[],previous=input.at(-1)?.stage??experience.stage;
  const events=input.map((sample,index)=>({...sample,sequence:index+1}));events.push(createEvent(experience,events.length,previous));
  const normalized=events.slice(-24);
  const payload={version:1,settlementId:experience.settlementId,stage:experience.stage,mode:experience.mode,gatewayState:experience.gatewayState,
    sampleCount:normalized.length,events:normalized,eventTypes:EVENT_TYPES.filter(type=>normalized.some(event=>event.type===type)),buckets:buildBuckets(normalized),
    stageSpan:buildStageSpan(normalized),readinessBand:createReadinessBand(experience.readiness),
    latest:{sequence:normalized.at(-1)?.sequence??0,type:normalized.at(-1)?.type??null,stage:normalized.at(-1)?.stage??null},
    ownership:{readOnly:true,noAnalyticsMutation:true,noSaveMutation:true,noGameplayMutation:true}};
  return freeze({...payload,fingerprint:digest(payload)});
}
export function appendSettlementWorldCoverageContinuityTelemetrySample(telemetry,options={}){
  const source=telemetry&&typeof telemetry==='object'?telemetry:{};return createSettlementWorldCoverageContinuityTelemetry(options,Array.isArray(source.events)?source.events:[]);
}
export function validateSettlementWorldCoverageContinuityTelemetry(telemetry){
  const source=telemetry&&typeof telemetry==='object'?telemetry:{},errors=[];
  if(!source.settlementId)errors.push('settlement-id');if(!STAGE_ORDER.includes(source.stage))errors.push('stage');
  if(source.sampleCount>24)errors.push('sample-cap');if(!source.ownership?.readOnly||!source.ownership?.noGameplayMutation)errors.push('ownership');
  if(!Array.isArray(source.events))errors.push('events');if(source.events?.some(e=>!EVENT_TYPES.includes(e.type)))errors.push('event-type');
  if(source.events?.some(e=>!STAGE_ORDER.includes(e.stage)))errors.push('event-stage');if(source.events?.some(e=>!Number.isFinite(e.sequence)))errors.push('event-sequence');
  if(source.events?.some(e=>e.metadata&&Object.keys(e.metadata).length>12))errors.push('metadata-cap');
  return freeze({ok:errors.length===0,errors,sampleCount:source.sampleCount??0,fingerprint:source.fingerprint??digest(source)});
}
export function summarizeSettlementWorldCoverageContinuityTelemetry(telemetry){
  const source=telemetry&&typeof telemetry==='object'?telemetry:{};return freeze({settlementId:t(source.settlementId,'unknown'),stage:t(source.stage,'far'),mode:t(source.mode,'orient'),
    gatewayState:t(source.gatewayState,'blocked'),sampleCount:n(source.sampleCount),readinessBand:t(source.readinessBand,'low'),eventTypes:Array.isArray(source.eventTypes)?[...source.eventTypes]:[],
    stageSpan:source.stageSpan??null,latest:source.latest??null,fingerprint:source.fingerprint??digest(source)});
}
export function measureSettlementWorldCoverageContinuityTelemetry(telemetry){
  const source=telemetry&&typeof telemetry==='object'?telemetry:{},events=Array.isArray(source.events)?source.events:[];
  const transitions=events.filter((event,index)=>index>0&&event.stage!==events[index-1].stage).length;
  const forward=events.filter(event=>event.direction==='forward').length;
  const backward=events.filter(event=>event.direction==='backward').length;
  const warningCount=events.filter(event=>event.type==='warning').length;
  const readiness=events.length?events.reduce((sum,event)=>sum+c(event.readiness),0)/events.length:0;
  return freeze({sampleCount:events.length,transitions,forward,backward,warningCount,averageReadiness:Math.round(readiness*1000)/1000,
    firstStage:events[0]?.stage??null,lastStage:events.at(-1)?.stage??null,settlementId:t(source.settlementId,'unknown'),fingerprint:digest({events,readiness})});
}
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_TELEMETRY_API=Object.freeze({version:1,maxSamples:24,eventTypes:[...EVENT_TYPES],stages:[...STAGE_ORDER],
  create:'createSettlementWorldCoverageContinuityTelemetry',append:'appendSettlementWorldCoverageContinuityTelemetrySample',validate:'validateSettlementWorldCoverageContinuityTelemetry',
  summary:'summarizeSettlementWorldCoverageContinuityTelemetry',measure:'measureSettlementWorldCoverageContinuityTelemetry'});
