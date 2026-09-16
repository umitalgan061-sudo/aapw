import type { ActorSnapshot, DecisionContext, FactionProfile, GoalDefinition, InterestCandidate, Intent, GoalKind, IntentKind } from './types.js';
import { clamp01, distanceSq } from './types.js';

export interface UtilityCurve { readonly id:string; readonly evaluate:(x:number)=>number; }
export const linear=(slope=1,intercept=0):UtilityCurve=>Object.freeze({id:`linear:${slope}:${intercept}`,evaluate:(x)=>clamp01(slope*x+intercept)});
export const inverse=(falloff=1):UtilityCurve=>Object.freeze({id:`inverse:${falloff}`,evaluate:(x)=>1-clamp01(Math.pow(clamp01(x),Math.max(0.01,falloff)))});
export const threshold=(thresholdValue=0.5,softness=0.1):UtilityCurve=>Object.freeze({id:`threshold:${thresholdValue}:${softness}`,evaluate:(x)=>{const d=(x-thresholdValue)/Math.max(0.0001,softness);return 1/(1+Math.exp(-d));}});
export const bell=(center=0.5,width=0.25):UtilityCurve=>Object.freeze({id:`bell:${center}:${width}`,evaluate:(x)=>Math.exp(-Math.pow((x-center)/Math.max(0.0001,width),2))});

export interface UtilityTerm { readonly id:string; readonly weight:number; readonly curve:UtilityCurve; readonly sample:(ctx:DecisionContext)=>number; }
export interface UtilityScore { readonly goalId:string; readonly raw:number; readonly normalized:number; readonly terms:readonly {readonly id:string;readonly sample:number;readonly contribution:number}[]; readonly gated:boolean; readonly reasons:readonly string[]; }

export function evaluateTerms(ctx:DecisionContext,terms:readonly UtilityTerm[]):{value:number;terms:readonly {id:string;sample:number;contribution:number}[]} {
  let total=0;let weight=0;const rows=[] as {id:string;sample:number;contribution:number}[];
  for(const term of terms){const sample=clamp01(term.sample(ctx));const contribution=sample*term.curve.evaluate(sample)*Number.isFinite(term.weight)?term.weight:0;total+=contribution;weight+=Math.abs(term.weight);rows.push({id:term.id,sample,contribution});}
  return {value:weight?total/weight:0,terms:rows};
}

const healthRatio=(a:ActorSnapshot)=>a.maxHealth>0?clamp01(a.health/a.maxHealth):0;
const staminaRatio=(a:ActorSnapshot)=>a.maxStamina>0?clamp01(a.stamina/a.maxStamina):0;
const nearbyDanger=(ctx:DecisionContext)=>{let danger=ctx.danger;for(const other of ctx.nearbyActors){const d=Math.sqrt(distanceSq(ctx.actor.position,other.position));if(d<24&&other.alive&&other.faction!==ctx.actor.faction)danger+=clamp01((24-d)/24)*0.2;}return clamp01(danger);};

export const standardTerms=(kind:GoalKind):readonly UtilityTerm[]=>{
  const common:UtilityTerm[]=[
    {id:'health',weight:1.2,curve:inverse(1.2),sample:(c)=>1-healthRatio(c.actor)},
    {id:'stamina',weight:0.45,curve:linear(),sample:(c)=>1-staminaRatio(c.actor)},
    {id:'danger',weight:1,curve:linear(),sample:(c)=>nearbyDanger(c)},
    {id:'alertness',weight:0.4,curve:linear(),sample:(c)=>c.actor.stance==='alert'||c.actor.stance==='hostile'?0.8:0.2},
    {id:'time',weight:0.2,curve:bell(0.5,0.5),sample:(c)=>c.timeOfDay},
  ];
  const extras:Record<GoalKind,UtilityTerm[]>={
    survive:[{id:'low-health',weight:2,curve:threshold(0.35,0.15),sample:c=>1-healthRatio(c.actor)}],
    investigate:[{id:'recent-stimulus',weight:1.5,curve:linear(),sample:c=>c.stimuli.length?Math.max(...c.stimuli.map(s=>s.salience)):0}],
    patrol:[{id:'territory',weight:0.9,curve:linear(),sample:c=>c.faction.territoryTags.length?0.7:0.25}],
    hunt:[{id:'hostile-presence',weight:1.4,curve:threshold(0.25,0.2),sample:c=>c.nearbyActors.some(a=>a.alive&&a.faction!==c.actor.faction)?1:0}],
    gather:[{id:'resource-memory',weight:1.2,curve:linear(),sample:c=>c.memories.some(m=>m.kind==='resource')?0.85:0}],
    protect:[{id:'ally-presence',weight:1.2,curve:linear(),sample:c=>c.nearbyActors.some(a=>a.faction===c.actor.faction&&a.alive)?0.8:0}],
    flee:[{id:'extreme-danger',weight:2.2,curve:threshold(0.5,0.12),sample:c=>nearbyDanger(c)}],
    assist:[{id:'ally-low-health',weight:1.5,curve:inverse(1),sample:c=>c.nearbyActors.filter(a=>a.faction===c.actor.faction&&a.alive).reduce((v,a)=>Math.max(v,1-healthRatio(a)),0)}],
    rest:[{id:'need-rest',weight:1.1,curve:linear(),sample:c=>1-staminaRatio(c.actor)}],
    travel:[{id:'mobility',weight:0.5,curve:linear(),sample:c=>staminaRatio(c.actor)}],
    idle:[{id:'calmness',weight:0.7,curve:inverse(1),sample:c=>nearbyDanger(c)}],
  };
  return Object.freeze([...common,...extras[kind]]);
};

export function scoreGoal(ctx:DecisionContext,goal:GoalDefinition):UtilityScore {
  if(goal.prerequisites.some(p=>!ctx.actor.tags.includes(p)))return Object.freeze({goalId:goal.id,raw:0,normalized:0,terms:[],gated:true,reasons:['prerequisite-missing']});
  const evaluated=evaluateTerms(ctx,standardTerms(goal.kind));
  const priority=clamp01(goal.priority/100);
  const raw=evaluated.value*(0.55+0.45*priority);
  const reasons:string[]=[];
  if(ctx.actor.stance==='disabled')reasons.push('actor-disabled');
  if(goal.kind==='flee'&&nearbyDanger(ctx)<0.1)reasons.push('danger-low');
  return Object.freeze({goalId:goal.id,raw,normalized:clamp01(raw),terms:Object.freeze(evaluated.terms),gated:ctx.actor.stance==='disabled',reasons:Object.freeze(reasons)});
}

export function rankGoals(ctx:DecisionContext,goals:readonly GoalDefinition[],limit=8):readonly UtilityScore[]{
  return Object.freeze([...goals].map(g=>scoreGoal(ctx,g)).filter(s=>!s.gated).sort((a,b)=>b.normalized-a.normalized||a.goalId.localeCompare(b.goalId)).slice(0,Math.max(0,Math.floor(limit))));
}

export interface IntentAction { readonly kind:IntentKind; readonly base:number; readonly gate:(ctx:DecisionContext)=>boolean; readonly target:(ctx:DecisionContext)=>ActorSnapshot|undefined; }
const actionForGoal=(goal:GoalKind):IntentAction=>{
  switch(goal){
    case 'flee':return {kind:'flee',base:0.92,gate:c=>c.actor.alive,target:()=>undefined};
    case 'hunt':return {kind:'attack',base:0.78,gate:c=>c.actor.alive&&c.actor.stance!=='afraid',target:c=>c.nearbyActors.filter(a=>a.alive&&a.faction!==c.actor.faction).sort((a,b)=>distanceSq(c.actor.position,a.position)-distanceSq(c.actor.position,b.position)||String(a.id).localeCompare(String(b.id)))[0]};
    case 'protect':case 'assist':return {kind:'follow',base:0.65,gate:c=>c.actor.alive,target:c=>c.nearbyActors.filter(a=>a.alive&&a.faction===c.actor.faction&&a.id!==c.actor.id).sort((a,b)=>(1-healthRatio(a))-(1-healthRatio(b))||String(a.id).localeCompare(String(b.id)))[0]};
    case 'investigate':return {kind:'move',base:0.6,gate:c=>c.actor.alive,target:()=>undefined};
    case 'patrol':case 'travel':return {kind:'move',base:0.5,gate:c=>c.actor.alive,target:()=>undefined};
    case 'gather':return {kind:'interact',base:0.48,gate:c=>c.actor.alive,target:()=>undefined};
    case 'rest':return {kind:'wait',base:0.4,gate:c=>c.actor.alive,target:()=>undefined};
    case 'survive':return {kind:'defend',base:0.72,gate:c=>c.actor.alive,target:()=>undefined};
    default:return {kind:'wait',base:0.1,gate:c=>c.actor.alive,target:()=>undefined};
  }
};

export function intentFromGoal(ctx:DecisionContext,goal:GoalDefinition,score:number,expiresTick:number):Intent|undefined{
  const action=actionForGoal(goal.kind);if(!action.gate(ctx))return undefined;const target=action.target(ctx);
  const stimulusPosition=ctx.stimuli.sort((a,b)=>b.salience-a.salience||b.intensity-a.intensity)[0]?.position;
  const position=target?.position??stimulusPosition;
  return Object.freeze({actorId:ctx.actor.id,kind:action.kind,score:clamp01(score*action.base),...(position?{position}:{}),...(target?{targetId:target.id}:{}),goalId:goal.id as never,reason:`goal:${goal.kind}`,expiresTick:expiresTick as never});
}

export function factionBias(faction:FactionProfile,kind:GoalKind):number{return faction.preferredGoals.includes(kind)?0.18:0;}
export function adjustFactionScores(ctx:DecisionContext,scores:readonly UtilityScore[],goals:readonly GoalDefinition[]):readonly UtilityScore[]{
  const byId=new Map(goals.map(g=>[g.id,g]));return Object.freeze(scores.map(s=>{const g=byId.get(s.goalId);if(!g)return s;const bonus=factionBias(ctx.faction,g.kind);return Object.freeze({...s,raw:s.raw+bonus,normalized:clamp01(s.normalized+bonus),reasons:Object.freeze([...s.reasons,...(bonus?['faction-preference']:[])])});}).sort((a,b)=>b.normalized-a.normalized||a.goalId.localeCompare(b.goalId)));
}
