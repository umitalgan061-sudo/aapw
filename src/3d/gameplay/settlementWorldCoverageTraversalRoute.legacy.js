/** Deterministic route resolution over existing traversal lanes. */
import { createSettlementWorldCoverageTraversalPlan, selectSettlementWorldCoverageTraversalLane } from './settlementWorldCoverageTraversal.js';
import { createSettlementWorldCoverageTraversalRisk } from './settlementWorldCoverageTraversalRisk.js';
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_ROUTE_VERSION=1;
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_ROUTE_MODES=Object.freeze(['safe','direct','service','return','explore']);
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const freeze=(v,s=new Set())=>{if(!v||typeof v!=='object'||s.has(v))return v;s.add(v);Object.freeze(v);for(const x of Object.values(v))freeze(x,s);return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest=v=>{let h=2166136261,s=stable(v);for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
const modeRule=Object.freeze({safe:{risk:0.72,serviceBias:0,directBias:-.12},direct:{risk:.18,serviceBias:0,directBias:.22},service:{risk:.42,serviceBias:.25,directBias:.04},return:{risk:.5,serviceBias:-.04,directBias:.12},explore:{risk:.9,serviceBias:-.08,directBias:-.1}});
function scoreLane(lane,mode,risk,experience){
  const rule=modeRule[mode]??modeRule.safe;
  const riskPenalty=risk.risk*rule.risk;
  const serviceBonus=experience.recommendedService?.serviceId===lane.serviceId?rule.serviceBias:0;
  const directBonus=lane.lane==='gateway'?rule.directBias:0;
  const phaseBonus=lane.phase==='return'&&mode==='return'?.16:0;
  return Math.round(c(lane.score-riskPenalty+serviceBonus+directBonus+phaseBonus)*1000)/1000;
}
function destinationFor(mode,lane,experience){
  if(mode==='service')return lane.serviceId;
  if(mode==='return')return 'gateway';
  if(mode==='explore')return lane.lane;
  return lane.lane==='gateway'?'gateway':experience.route?.id??lane.lane;
}
export function createSettlementWorldCoverageTraversalRoute(options={},mode='safe'){
  const normalizedMode=SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_ROUTE_MODES.includes(mode)?mode:'safe';
  const plan=createSettlementWorldCoverageTraversalPlan(options);
  const risk=createSettlementWorldCoverageTraversalRisk(options);
  const scored=plan.lanes.map(lane=>({...lane,routeScore:scoreLane(lane,normalizedMode,risk,plan)})).sort((a,b)=>b.routeScore-a.routeScore||a.lane.localeCompare(b.lane));
  const preferred=selectSettlementWorldCoverageTraversalLane({lanes:scored},options.lane);
  const chosen=scored.find(x=>x.lane===preferred?.lane)??scored[0]??null;
  const payload={version:SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_ROUTE_VERSION,settlementId:plan.settlementId,mode:normalizedMode,stage:plan.stage,chosenLane:chosen?.lane??null,destination:chosen?destinationFor(normalizedMode,chosen,plan):null,risk:{score:risk.risk,severity:risk.severity},alternatives:scored.slice(0,5).map(x=>({lane:x.lane,score:x.routeScore,role:x.role})),route:chosen?{lane:chosen.lane,role:chosen.role,serviceId:chosen.serviceId,phase:chosen.phase,waypointCount:chosen.waypoints.length}:null,ownership:{readOnly:true,noPathMutation:true,noRoadMutation:true,noNavMeshMutation:true}};
  return freeze({...payload,fingerprint:digest(payload)});
}
export function validateSettlementWorldCoverageTraversalRoute(route){
  const s=route&&typeof route==='object'?route:{};const e=[];
  if(!s.settlementId)e.push('settlement-id');
  if(!SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_ROUTE_MODES.includes(s.mode))e.push('mode');
  if(s.risk?.score<0||s.risk?.score>1)e.push('risk');
  if(!Array.isArray(s.alternatives)||s.alternatives.length>5)e.push('alternative-cap');
  if(!s.ownership?.readOnly||!s.ownership?.noPathMutation)e.push('ownership');
  return freeze({ok:e.length===0,errors:e,chosenLane:s.chosenLane??null,fingerprint:s.fingerprint??digest(s)});
}
export function summarizeSettlementWorldCoverageTraversalRoute(options={},mode='safe'){
  const r=createSettlementWorldCoverageTraversalRoute(options,mode);return freeze({settlementId:r.settlementId,mode:r.mode,stage:r.stage,chosenLane:r.chosenLane,destination:r.destination,risk:r.risk.score,alternatives:r.alternatives.map(x=>x.lane),fingerprint:r.fingerprint});
}
export function compareSettlementWorldCoverageTraversalRoutes(options={}){
  const rows=SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_ROUTE_MODES.map(mode=>createSettlementWorldCoverageTraversalRoute(options,mode));
  return freeze({settlementId:rows[0]?.settlementId??null,choices:rows.map(r=>({mode:r.mode,lane:r.chosenLane,risk:r.risk.score,destination:r.destination,fingerprint:r.fingerprint}))});
}
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_ROUTE_API=Object.freeze({version:1,modes:[...SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_ROUTE_MODES],create:'createSettlementWorldCoverageTraversalRoute',validate:'validateSettlementWorldCoverageTraversalRoute',summary:'summarizeSettlementWorldCoverageTraversalRoute',compare:'compareSettlementWorldCoverageTraversalRoutes'});
