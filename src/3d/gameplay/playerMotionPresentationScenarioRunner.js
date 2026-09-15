/**
 * Scenario runner for the composite player motion presentation layer.
 * Runs explicit input sequences through the production orchestrator and records semantic checkpoints.
 */
import { createPlayerPresentationOrchestrator } from './playerMotionPresentationOrchestrator.js';
import { createPlayerMotionPresentationContract, validatePlayerMotionPresentationContract } from './playerMotionPresentationContract.js';
import { blendPlayerMotionChannels } from './playerMotionPresentationBlendPolicy.js';
import { diagnosePlayerMotionPresentation } from './playerMotionPresentationDiagnostics.js';
import { createPlayerMotionPresentationTelemetry } from './playerMotionPresentationTelemetry.js';

export const PLAYER_MOTION_PRESENTATION_SCENARIO_RUNNER_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}function freeze(v){return Object.freeze(v);}

export function runPlayerMotionPresentationScenario(steps=[],options={}){
 const orchestrator=createPlayerPresentationOrchestrator(options);const telemetry=createPlayerMotionPresentationTelemetry();const rows=[];let previous=null;let clock=0;
 for(let i=0;i<steps.length;i+=1){const input={...steps[i],clockSeconds:finite(steps[i]?.clockSeconds,clock+finite(steps[i]?.deltaSeconds,1/60))};clock=Math.max(clock,input.clockSeconds);const result=orchestrator.update(input);const state=result.packet.state;const contract=createPlayerMotionPresentationContract(state);const blend=blendPlayerMotionChannels(state);const diagnostics=diagnosePlayerMotionPresentation(state,previous);const timelineEntry={clockSeconds:clock,state:state.traversal?.state??'clear',domain:state.domain,event:state.traversal?.event??'none',confidence:state.channels?.confidence??0,blend};telemetry.observe(state);rows.push(freeze({index:i,clockSeconds:clock,state,contract,contractValid:validatePlayerMotionPresentationContract(contract).valid,blend,diagnostics,timelineEntry}));previous=state;}
 return freeze({version:PLAYER_MOTION_PRESENTATION_SCENARIO_RUNNER_VERSION,count:rows.length,rows:freeze(rows),finalState:previous,telemetry:telemetry.snapshot(),healthy:rows.every(x=>x.contractValid&&x.diagnostics.healthy)});
}

export function comparePlayerMotionScenarioRuns(first={},second={}){return JSON.stringify(first.rows??[])===JSON.stringify(second.rows??[]);}
export function summarizePlayerMotionScenario(result={}){const domains={locomotion:0,traversal:0};const states={};for(const row of result.rows??[]){domains[row.state?.domain??'locomotion']=(domains[row.state?.domain??'locomotion']??0)+1;const state=row.state?.traversal?.state??'clear';states[state]=(states[state]??0)+1;}return freeze({version:PLAYER_MOTION_PRESENTATION_SCENARIO_RUNNER_VERSION,count:result.count??0,domains:freeze(domains),states:freeze(states),healthy:Boolean(result.healthy)});}

export function assertScenarioStateSequence(result={},expected=[]){const observed=(result.rows??[]).map(row=>row.state?.traversal?.state??'clear');return observed.length===expected.length&&observed.every((value,index)=>value===expected[index]);}
