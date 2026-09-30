/** Deterministic read-only traversal risk analysis for settlement/world travel. */
import { createSettlementWorldCoverageTraversalPlan } from './settlementWorldCoverageTraversal.js';

export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_RISK_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_RISK_LIMITS = Object.freeze({ maxFactors: 10, maxRecommendations: 8, warningAt: 0.58, criticalAt: 0.78 });
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_RISK_FACTORS = Object.freeze([
  'visibility','slope','water','weather','distance','gateway','road','fatigue','cold','navigation',
]);
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const t=(v,d='')=>{const s=String(v??'').trim();return s?s.slice(0,120):d;};
const freeze=(v,s=new Set())=>{if(!v||typeof v!=='object'||s.has(v))return v;s.add(v);Object.freeze(v);for(const x of Object.values(v))freeze(x,s);return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest=v=>{let h=2166136261,s=stable(v);for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};

const severity=r=>r>=.78?'critical':r>=.58?'warning':'normal';
function factorRows(experience,options){
  const weather=experience.atmosphere.weather;
  const surface=options.surface??{};
  const slope=c(n(surface.slopeDegrees,0)/40);
  const water=surface.isWater?1:0;
  const distance=c(n(experience.player.distanceMeters,0)/220);
  const visibility=1-c(weather.visibility);
  const road=1-c(experience.road.score);
  const gateway=experience.gatewayState==='blocked'?1:experience.gatewayState==='approach-only'?.42:0;
  const fatigue=c(n(options.player?.fatigue,0)/100);
  const temperature=n(weather.temperature,14);
  const cold=c((6-temperature)/18);
  const navigation=experience.signage.readableCount>0?0.12:0.78;
  return [
    ['visibility',visibility,.17],['slope',slope,.09],['water',water,.08],['weather',c(weather.intensity),.13],
    ['distance',distance,.11],['gateway',gateway,.09],['road',road,.1],['fatigue',fatigue,.08],['cold',cold,.07],['navigation',navigation,.08],
  ].map(([id,value,weight])=>({id,value:c(value),weight,contribution:Math.round(c(value)*weight*10000)/10000}));
}
function buildRecommendations(rows,experience){
  const recommendations=[];
  const add=(id,score,copy)=>recommendations.push({id,score:Math.round(c(score)*1000)/1000,copy});
  const by=Object.fromEntries(rows.map(r=>[r.id,r]));
  if(by.visibility?.value>.55)add('slow-down',by.visibility.contribution+.35,'Reduce traversal pace in low visibility');
  if(by.slope?.value>.5)add('avoid-steep',by.slope.contribution+.3,'Prefer a lower-grade approach lane');
  if(by.water?.value>.5)add('avoid-water','0.7'.trim()*1,'Prefer a dry route');
  if(by.weather?.value>.55)add('weather-window',by.weather.contribution+.3,'Wait for a clearer weather window');
  if(by.gateway?.value>.5)add('gateway-check',by.gateway.contribution+.32,'Re-check settlement access before committing');
  if(by.fatigue?.value>.55)add('rest',by.fatigue.contribution+.36,'Use a rest-oriented service before departure');
  if(by.cold?.value>.55)add('warmth',by.cold.contribution+.32,'Seek shelter or warmth before long travel');
  if(by.navigation?.value>.55)add('wayfinding',by.navigation.contribution+.28,'Use the most readable route cue');
  if(experience.stage==='departure')add('return-focus',.64,'Keep the return lane as the primary route');
  return recommendations.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_RISK_LIMITS.maxRecommendations);
}
function computeRisk(rows){
  const score=c(rows.reduce((sum,row)=>sum+row.contribution,0)*1.18);
  return Math.round(score*1000)/1000;
}
export function createSettlementWorldCoverageTraversalRisk(options={}){
  const plan=createSettlementWorldCoverageTraversalPlan(options);
  const rows=factorRows(plan,options).slice(0,SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_RISK_LIMITS.maxFactors);
  const risk=computeRisk(rows);
  const recommendations=buildRecommendations(rows,plan);
  const payload={version:SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_RISK_VERSION,settlementId:plan.settlementId,stage:plan.stage,phase:plan.phase,risk,severity:severity(risk),factors:rows,recommendations,topLane:plan.summary.topLane,ownership:{readOnly:true,noPathMutation:true,noNavMeshMutation:true,noGameplayMutation:true}};
  return freeze({...payload,fingerprint:digest(payload)});
}
export function validateSettlementWorldCoverageTraversalRisk(risk){
  const source=risk&&typeof risk==='object'?risk:{};const errors=[];
  if(!source.settlementId)errors.push('settlement-id');
  if(source.risk<0||source.risk>1)errors.push('risk-range');
  if(!['normal','warning','critical'].includes(source.severity))errors.push('severity');
  if(!Array.isArray(source.factors)||source.factors.length>SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_RISK_LIMITS.maxFactors)errors.push('factor-cap');
  if(source.factors?.some(f=>!SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_RISK_FACTORS.includes(f.id)))errors.push('factor-vocabulary');
  if(source.recommendations?.length>SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_RISK_LIMITS.maxRecommendations)errors.push('recommendation-cap');
  if(!source.ownership?.readOnly||!source.ownership?.noPathMutation)errors.push('ownership');
  return freeze({ok:errors.length===0,errors,risk:source.risk??0,severity:source.severity??'normal',fingerprint:source.fingerprint??digest(source)});
}
export function summarizeSettlementWorldCoverageTraversalRisk(options={}){
  const r=createSettlementWorldCoverageTraversalRisk(options);return freeze({settlementId:r.settlementId,risk:r.risk,severity:r.severity,topFactor:r.factors.slice().sort((a,b)=>b.contribution-a.contribution)[0]?.id??null,recommendations:r.recommendations.slice(0,3).map(x=>x.id),topLane:r.topLane,fingerprint:r.fingerprint});
}
export const SETTLEMENT_WORLD_COVERAGE_TRAVERSAL_RISK_API=Object.freeze({version:1,factorCount:10,maxRecommendations:8,create:'createSettlementWorldCoverageTraversalRisk',validate:'validateSettlementWorldCoverageTraversalRisk',summary:'summarizeSettlementWorldCoverageTraversalRisk'});
