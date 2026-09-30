/**
 * Unified read-only traversal coordinator.
 *
 * It combines lane, route, risk, milestone, pacing and signal evidence into
 * one packet for callers that need a single boundary decision.
 */
import { createSettlementWorldCoverageTraversalPlan } from './settlementWorldCoverageTraversal.js';
import { createSettlementWorldCoverageTraversalRisk } from './settlementWorldCoverageTraversalRisk.js';
import { createSettlementWorldCoverageTraversalRoute } from './settlementWorldCoverageTraversalRoute.js';
import { createSettlementWorldCoverageTraversalMilestones } from './settlementWorldCoverageTraversalMilestones.js';
import { createSettlementWorldCoverageTraversalPacing } from './settlementWorldCoverageTraversalPacing.js';
import { createSettlementWorldCoverageTraversalSignals } from './settlementWorldCoverageTraversalSignals.js';
import { createSettlementWorldCoverageTraversalReplay } from './settlementWorldCoverageTraversalReplay.js';

export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_COORDINATOR_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_COORDINATOR_STATES = Object.freeze([
  'orient', 'prepare', 'commit', 'traverse', 'arrive', 'interact', 'depart', 'recover',
]);
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const freeze=(v,s=new Set())=>{if(!v||typeof v!=='object'||s.has(v))return v;s.add(v);Object.freeze(v);for(const x of Object.values(v))freeze(x,s);return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest=v=>{let h=2166136261,s=stable(v);for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
function stateFrom(plan,risk,pacing){if(pacing.state==='pause')return'recover';if(plan.stage==='far')return'orient';if(plan.stage==='approach')return'prepare';if(plan.stage==='threshold')return'commit';if(plan.stage==='inside'&&plan.transition.primaryService?.id)return'interact';if(plan.stage==='inside')return'arrive';if(plan.stage==='departure')return'depart';if(plan.stage==='resume')return'traverse';return risk.severity==='critical'?'recover':'traverse';}
function confidence(plan,risk,pacing,signals){const signal=c(signals.primary?.[0]?.score,.4);const riskFactor=1-c(risk.risk);const pace=pacing.state==='pause'?.2:pacing.rate;return Math.round(c(plan.readiness*.4+riskFactor*.28+pace*.12+signal*.2)*1000)/1000;}
function actionFor(state,risk){if(state==='recover')return'pause';if(state==='commit'&&risk.severity!=='critical')return'enter';if(state==='interact')return'service';if(state==='depart')return'return';return'navigate';}
export function createSettlementWorldCoverageTraversalCoordinator(options={}){
  const plan=createSettlementWorldCoverageTraversalPlan(options);
  const risk=createSettlementWorldCoverageTraversalRisk(options);
  const route=createSettlementWorldCoverageTraversalRoute(options,options.routeMode??'safe');
  const milestones=createSettlementWorldCoverageTraversalMilestones(options);
  const pacing=createSettlementWorldCoverageTraversalPacing(options);
  const signals=createSettlementWorldCoverageTraversalSignals(options);
  const replay=createSettlementWorldCoverageTraversalReplay(options);
  const state=stateFrom(plan,risk,pacing);
  const confidenceScore=confidence(plan,risk,pacing,signals);
  const payload={
    version:1,
    settlementId:plan.settlementId,
    state,
    action:actionFor(state,risk),
    stage:plan.stage,
    phase:plan.phase,
    routeMode:route.mode,
    lane:route.chosenLane,
    destination:route.destination,
    risk:{score:risk.risk,severity:risk.severity},
    pacing:{state:pacing.state,rate:pacing.rate,reasons:pacing.reasons},
    milestone:milestones.active,
    signals:signals.primary,
    confidence:confidenceScore,
    replayFingerprint:replay.fingerprint,
    mobile:Boolean(options.mobile),
    ownership:{readOnly:true,noActorSpawn:true,noMovementMutation:true,noSaveMutation:true,noGameplayMutation:true},
  };
  return freeze({...payload,fingerprint:digest(payload)});
}
export function validateSettlementWorldCoverageTraversalCoordinator(value){
  const s=value&&typeof value==='object'?value:{};
  const e=[];
  if(!s.settlementId)e.push('settlement-id');
  if(!SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_COORDINATOR_STATES.includes(s.state))e.push('state');
  if(!['pause','navigate','enter','service','return'].includes(s.action))e.push('action');
  if(s.confidence<0||s.confidence>1)e.push('confidence');
  if(!s.ownership?.readOnly||!s.ownership?.noActorSpawn)e.push('ownership');
  return freeze({ok:e.length===0,errors:e,state:s.state??'recover',action:s.action??'pause',confidence:s.confidence??0,fingerprint:s.fingerprint??digest(s)});
}
export function summarizeSettlementWorldCoverageTraversalCoordinator(options={}){const c0=createSettlementWorldCoverageTraversalCoordinator(options);return freeze({settlementId:c0.settlementId,state:c0.state,action:c0.action,stage:c0.stage,lane:c0.lane,risk:c0.risk.score,pacing:c0.pacing.state,confidence:c0.confidence,fingerprint:c0.fingerprint});}
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_COORDINATOR_API=Object.freeze({version:1,states:[...SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_COORDINATOR_STATES],create:'createSettlementWorldCoverageTraversalCoordinator',validate:'validateSettlementWorldCoverageTraversalCoordinator',summary:'summarizeSettlementWorldCoverageTraversalCoordinator'});
