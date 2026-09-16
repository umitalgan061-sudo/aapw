import type { ActorSnapshot, FactionProfile, GoalDefinition, IntelligenceSnapshot, Stimulus, WorldEvent } from './types.js';
import { clamp01 } from './types.js';
import { decide } from './decision.js';
import { perceive, createPerceptionPolicy } from './perception.js';
import { WorldEventJournal, createWorldEvent } from './events.js';
import { buildRegionInterest, DeterministicInterestMap, defaultInterestPolicy } from './interest.js';
import { validateScenarioMatrix, ADVERSARIAL_CASES } from './adversarialMatrix.js';

export interface GateResult {readonly name:string;readonly passed:boolean;readonly checks:number;readonly failures:readonly string[];readonly warnings:readonly string[];readonly score:number;}
export interface ValidationReport {readonly passed:boolean;readonly gates:readonly GateResult[];readonly totalChecks:number;readonly failedChecks:number;readonly score:number;readonly digest:number;}

const gate=(name:string,checks:readonly boolean[],failures:readonly string[]=[],warnings:readonly string[]=[]):GateResult=>{const passed=checks.every(Boolean)&&failures.length===0;return Object.freeze({name,passed,checks:checks.length,failures:Object.freeze([...failures]),warnings:Object.freeze([...warnings]),score:checks.length?checks.filter(Boolean).length/checks.length:1});};
const digest=(text:string):number=>{let h=2166136261;for(let i=0;i<text.length;i+=1){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};

export function validateInputBoundaries():GateResult{
 const checks=[clamp01(-2)===0,clamp01(2)===1,clamp01(Number.NaN)===0,createPerceptionPolicy().maxStimuli===32];
 const failures=validateScenarioMatrix().map(e=>`matrix:${e}`);return gate('input-boundaries',checks,failures);
}
export function validatePerception(actor:ActorSnapshot,stimuli:readonly Stimulus[],tick:number):GateResult{
 const result=perceive(actor,stimuli,tick as never,createPerceptionPolicy());const ids=new Set<string>();const checks=[result.dropped>=0,result.observations.length<=32,result.memories.length===result.observations.length];for(const s of result.observations)checks.push(!ids.has(s.id),s.confidence>=0&&s.confidence<=1,s.salience>=0&&s.salience<=1),ids.add(s.id);return gate('perception-contract',checks);
}
export function validateDecision(actor:ActorSnapshot,faction:FactionProfile,goals:readonly GoalDefinition[],actors:readonly ActorSnapshot[],stimuli:readonly Stimulus[],tick:number):GateResult{
 const contextPerception=perceive(actor,stimuli,tick as never,createPerceptionPolicy());const r=decide(actor,faction,goals,tick as never,[],contextPerception.observations,actors);const checks=[r.actorId===actor.id,r.intents.every(i=>i.score>=0&&i.score<=1),r.intents.every(i=>Number(i.expiresTick)>=tick),r.intents.length<=4];return gate('decision-contract',checks);
}
export function validateEvents():GateResult{
 const journal=new WorldEventJournal();const origin={x:0,y:0,z:0};const first=createWorldEvent('validation:1','combat',1,origin,10,.8,{outcome:'defeat'});const duplicate=createWorldEvent('validation:1','combat',1,origin,10,.8);const second=createWorldEvent('validation:2','weather',2,origin,12,.5,{state:'storm'});const checks=[journal.append(first),!journal.append(duplicate),journal.append(second),journal.size===2,journal.query({kinds:['combat']}).length===1,journal.query({minIntensity:.9}).length===0];journal.dispose();checks.push(journal.size===0,!journal.append(second));return gate('event-journal-contract',checks);
}
export function validateInterest(actor:ActorSnapshot):GateResult{
 const map=new DeterministicInterestMap();map.upsert({id:'p1',position:actor.position,importance:1,tags:['critical'],available:true});map.upsert({id:'p2',position:{x:20,y:0,z:0},importance:.5,tags:['resource'],available:true});map.upsert({id:'p3',position:{x:200,y:0,z:0},importance:1,tags:['far'],available:true});const i=buildRegionInterest(actor,1 as never,map,defaultInterestPolicy(),42);const checks=[i.candidates.length<=24,i.candidates.every(c=>c.score>=0&&c.score<=1),i.candidates.every(c=>c.tags.length>=1),map.size===3];map.dispose();return gate('interest-contract',checks);
}
export function validateDeterminism(snapshotFactory:()=>IntelligenceSnapshot):GateResult{
 const a=snapshotFactory(),b=snapshotFactory();const sa=JSON.stringify(a),sb=JSON.stringify(b);return gate('snapshot-determinism',[sa===sb,a.tick===b.tick,a.version===b.version],[...(sa===sb?[]:['snapshot-digest-mismatch'])]);
}
export function validateAdversarialCoverage():GateResult{
 const failures:string[]=[];const checks=ADVERSARIAL_CASES.map(c=>{if(c.danger<0||c.danger>1){failures.push(c.id+':danger');return false;}if(!c.id.trim()){failures.push(c.id+':id');return false;}return true;});return gate('adversarial-matrix',checks,failures);
}
export function buildValidationReport(gates:readonly GateResult[]):ValidationReport{const total=gates.reduce((n,g)=>n+g.checks,0);const failed=gates.reduce((n,g)=>n+g.checks-Math.round(g.score*g.checks),0);const score=total?Math.max(0,(total-failed)/total):1;const signature=gates.map(g=>`${g.name}:${g.passed}:${g.checks}:${g.failures.join(',')}`).join('|');return Object.freeze({passed:gates.every(g=>g.passed),gates:Object.freeze([...gates]),totalChecks:total,failedChecks:failed,score,digest:digest(signature)});}
export function worldIntelligenceAcceptance(actor:ActorSnapshot,faction:FactionProfile,goals:readonly GoalDefinition[],actors:readonly ActorSnapshot[],stimuli:readonly Stimulus[]):ValidationReport{const gates=[validateInputBoundaries(),validatePerception(actor,stimuli,1),validateDecision(actor,faction,goals,actors,stimuli,1),validateEvents(),validateInterest(actor),validateAdversarialCoverage()];return buildValidationReport(gates);}

export function assertValidation(report:ValidationReport):void{if(!report.passed)throw new Error(`World intelligence validation failed: score=${report.score.toFixed(3)} digest=${report.digest}`);}
export function summarizeReport(report:ValidationReport):string{return [`passed=${report.passed}`,`score=${report.score.toFixed(3)}`,`checks=${report.totalChecks}`,`failed=${report.failedChecks}`,`digest=${report.digest}`,...report.gates.map(g=>`${g.name}=${g.passed?'pass':'fail'}`)].join('\n');}
