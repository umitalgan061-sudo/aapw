import { clamp01, createScenarioV67, hashV67, normalizeSampleV67 } from './environmentRuntimeV67.js';
import { buildEnvironmentRuntimeV67 } from './environmentRuntimeIntegrationV67.js';

export const SCENARIO_LEDGER_V67=Object.freeze({id:'scenario-ledger-v67',version:67,deterministic:true,noWorldMutation:true});
export const V67_SCENARIOS=Object.freeze([
  {id:'clear-noon',clock:12,dayOfYear:180,precipitation:0.02,wind:0.18,visibility:0.94},
  {id:'summer-storm',clock:16,dayOfYear:210,precipitation:0.82,wind:0.72,visibility:0.42},
  {id:'winter-snow',clock:11,dayOfYear:28,precipitation:0.52,wind:0.48,visibility:0.66},
  {id:'autumn-fog',clock:7,dayOfYear:292,precipitation:0.24,wind:0.22,visibility:0.24},
  {id:'spring-runoff',clock:10,dayOfYear:105,precipitation:0.7,wind:0.32,visibility:0.62},
  {id:'dry-warm',clock:15,dayOfYear:226,precipitation:0.03,wind:0.44,visibility:0.9},
  {id:'cold-clear',clock:8,dayOfYear:338,precipitation:0.06,wind:0.28,visibility:0.88},
  {id:'wet-dusk',clock:19,dayOfYear:260,precipitation:0.58,wind:0.38,visibility:0.54},
]);

export const scenarioHashV67=(scenario={})=>hashV67(JSON.stringify(createScenarioV67(scenario)));
export const scenarioInputV67=(scenario={})=>createScenarioV67(scenario);
export const projectScenarioV67=(samples=[],scenario={})=>samples.map(sample=>({...normalizeSampleV67(sample),rain:scenario.precipitation,wind:scenario.wind,visibility:scenario.visibility}));
export const evaluateScenarioV67=(samples=[],scenario={})=>{
  const input=scenarioInputV67(scenario);
  const runtime=buildEnvironmentRuntimeV67({samples:projectScenarioV67(samples,input),clock:input.clock,dayOfYear:input.dayOfYear,seed:scenarioHashV67(input),weather:{precipitation:input.precipitation}});
  return {id:input.id,hash:scenarioHashV67(input),runtime,quality:runtime.quality??undefined};
};
export const scenarioRiskV67=(runtime={})=>clamp01((runtime.telemetry?.hazards?.summary?.mean??0)*.55+(1-(runtime.telemetry?.atmosphere?.summary?.meanVisibility??1))*.25+(runtime.telemetry?.continuity?.summary?.meanHealed?1-(runtime.telemetry.continuity.summary.meanHealed):0)*.2);
export const scenarioRankV67=(evaluations=[])=>evaluations.map(item=>({...item,risk:scenarioRiskV67(item.runtime)})).sort((a,b)=>a.risk-b.risk);
export const scenarioLedgerV67=(samples=[],scenarios=V67_SCENARIOS)=>{const evaluations=scenarios.map(s=>evaluateScenarioV67(samples,s));return{policy:SCENARIO_LEDGER_V67.id,evaluations,ranked:scenarioRankV67(evaluations)};};
export const scenarioPassV67=(evaluation={})=>scenarioRiskV67(evaluation.runtime)<.78&&Boolean(evaluation.runtime?.digest);
export const scenarioSummaryV67=(ledger={evaluations:[]})=>({scenarios:ledger.evaluations.length,passed:ledger.evaluations.filter(scenarioPassV67).length,failures:ledger.evaluations.filter(x=>!scenarioPassV67(x)).map(x=>x.id),hashes:ledger.evaluations.map(x=>x.hash)});
export const validateScenarioLedgerV67=(ledger={evaluations:[]})=>{const errors=[];if(!Array.isArray(ledger.evaluations))errors.push('evaluations');if(ledger.evaluations.some(x=>!x.id||!x.hash))errors.push('identity');if(ledger.evaluations.some(x=>!x.runtime?.digest))errors.push('digest');return{ok:errors.length===0,errors};};
export const ledgerTelemetryV67=(ledger={evaluations:[]})=>({policy:SCENARIO_LEDGER_V67.id,valid:validateScenarioLedgerV67(ledger).ok,summary:scenarioSummaryV67(ledger)});
