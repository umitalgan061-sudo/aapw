/** Deterministic read-only traversal milestone projection. */
import { createSettlementWorldCoverageTraversalPlan } from './settlementWorldCoverageTraversal.js';
import { createSettlementWorldCoverageTraversalRisk } from './settlementWorldCoverageTraversalRisk.js';
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_MILESTONE_VERSION=1;
export const SETTLEMENT_WORLD_COVERAGE_TRAVESTRY_MILESTONES=Object.freeze([
  'world-seen','approach-start','route-committed','gateway-visible','threshold-reached','service-reached','settlement-active','departure-ready','gateway-crossed','resume-ready',
]);
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const freeze=(v,s=new Set())=>{if(!v||typeof v!=='object'||s.has(v))return v;s.add(v);Object.freeze(v);for(const x of Object.values(v))freeze(x,s);return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest=v=>{let h=2166136261,s=stable(v);for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
const stageMilestone=Object.freeze({far:'world-seen',approach:'approach-start',threshold:'threshold-reached',inside:'settlement-active',service:'service-reached',departure:'departure-ready',resume:'resume-ready'});
function confidence(stage,risk,readiness){const stageBase={far:.42,approach:.58,threshold:.82,inside:.94,service:1,departure:.76,resume:.7}[stage]??.4;return Math.round(c(stageBase*.48+c(readiness)*.32+(1-risk)*.2)*1000)/1000;}
function buildMarker(name,index,plan,risk){
  const confidenceScore=confidence(plan.stage,risk.risk,plan.readiness??.5);
  return {id:`${plan.settlementId}:milestone:${name}`,name,index,stage:plan.stage,confidence:confidenceScore,active:name===stageMilestone[plan.stage],recoverable:name!=='gateway-crossed'||risk.severity!=='critical',distanceMeters:n(plan.player?.distanceMeters,0),worldChunkKey:plan.context.worldChunkKey,ownerChunkKey:plan.context.ownerChunkKey};
}
export function createSettlementWorldCoverageTraversalMilestones(options={}){
  const plan=createSettlementWorldCoverageTraversalPlan(options);const risk=createSettlementWorldCoverageTraversalRisk(options);
  const markers=SETTLEMENT_WORLD_COVERAGE_TRAVESTRY_MILESTONES.map((name,index)=>buildMarker(name,index,plan,risk));
  const active=markers.find(m=>m.active)??markers[0];
  const recoverable=markers.filter(m=>m.recoverable).slice(-4);
  const payload={version:1,settlementId:plan.settlementId,stage:plan.stage,active,markers,recoverable,riskSeverity:risk.severity,ownership:{readOnly:true,noSaveMutation:true,noCheckpointMutation:true}};
  return freeze({...payload,fingerprint:digest(payload)});
}
export function validateSettlementWorldCoverageTraversalMilestones(value){const s=value&&typeof value==='object'?value:{};const e=[];if(!s.settlementId)e.push('settlement-id');if(!Array.isArray(s.markers)||s.markers.length!==SETTLEMENT_WORLD_COVERAGE_TRAVESTRY_MILESTONES.length)e.push('marker-count');if(s.markers?.some(m=>!SETTLEMENT_WORLD_COVERAGE_TRAVESTRY_MILESTONES.includes(m.name)))e.push('vocabulary');if(s.markers?.some(m=>m.confidence<0||m.confidence>1))e.push('confidence');if(!s.ownership?.readOnly||!s.ownership?.noSaveMutation)e.push('ownership');return freeze({ok:e.length===0,errors:e,active:s.active?.name??null,fingerprint:s.fingerprint??digest(s)});}
export function summarizeSettlementWorldCoverageTraversalMilestones(options={}){const m=createSettlementWorldCoverageTraversalMilestones(options);return freeze({settlementId:m.settlementId,stage:m.stage,active:m.active.name,confidence:m.active.confidence,recoverable:m.recoverable.map(x=>x.name),riskSeverity:m.riskSeverity,fingerprint:m.fingerprint});}
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_MILESTONE_API=Object.freeze({version:1,count:SETTLEMENT_WORLD_COVERAGE_TRAVESTRY_MILESTONES.length,milestones:[...SETTLEMENT_WORLD_COVERAGE_TRAVESTRY_MILESTONES],create:'createSettlementWorldCoverageTraversalMilestones',validate:'validateSettlementWorldCoverageTraversalMilestones',summary:'summarizeSettlementWorldCoverageTraversalMilestones'});
