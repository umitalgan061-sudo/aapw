/**
 * Batch processing helpers for offline traversal presentation analysis.
 *
 * Batch helpers intentionally share the same runtime policy functions as live ticks. They are useful for
 * fixture corpora, balancing reports and deterministic regression jobs without introducing a second evaluator.
 */
import { buildPlayerTraversalPresentationState } from './playerTraversalPresentationPolicy.js';
import { buildTraversalTimelineEntry, validateTraversalTimeline } from './playerTraversalPresentationTimeline.js';
import { createTraversalPresentationTelemetry } from './playerTraversalPresentationTelemetry.js';
import { validateTraversalPresentationQuality } from './playerTraversalPresentationQuality.js';
import { diagnoseTraversalPresentationState } from './playerTraversalPresentationDiagnostics.js';
import { buildTraversalPresentationEventIntent } from './playerTraversalPresentationEventPolicy.js';

export const PLAYER_TRAVERSAL_PRESENTATION_BATCH_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}
function freeze(v){return Object.freeze(v);}

export function processTraversalPresentationBatch(cues=[]){
 let previous=null;const states=[];const timeline=[];const diagnostics=[];const quality=[];const eventIntents=[];const telemetry=createTraversalPresentationTelemetry();
 for(const cue of cues){const state=buildPlayerTraversalPresentationState(previous,cue);states.push(state);timeline.push(buildTraversalTimelineEntry(previous,cue));diagnostics.push(diagnoseTraversalPresentationState(state,previous));quality.push(validateTraversalPresentationQuality(state,previous));eventIntents.push(buildTraversalPresentationEventIntent(state));telemetry.observe(state);previous=state;}
 const averageQuality=quality.length?quality.reduce((sum,row)=>sum+row.score,0)/quality.length:0;
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_BATCH_VERSION,count:cues.length,states:freeze(states),timeline:freeze(timeline),diagnostics:freeze(diagnostics),quality:freeze(quality),eventIntents:freeze(eventIntents),telemetry:telemetry.snapshot(),timelineValid:validateTraversalTimeline(timeline).valid,averageQuality:round(averageQuality),finalState:previous});
}

export function summarizeTraversalBatch(result={}){
 const states={};const events={};for(const state of result.states??[]){states[state.state]=(states[state.state]??0)+1;events[state.event]=(events[state.event]??0)+1;}
 const errors=(result.diagnostics??[]).reduce((sum,row)=>sum+(row.findings??[]).filter(f=>f.severity==='error').length,0);
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_BATCH_VERSION,count:result.count??0,states:freeze(states),events:freeze(events),averageQuality:round(result.averageQuality),diagnosticErrors:errors,timelineValid:Boolean(result.timelineValid),healthy:errors===0&&Boolean(result.timelineValid)});
}

export function compareTraversalBatches(first={},second={}){return JSON.stringify(summarizeTraversalBatch(first))===JSON.stringify(summarizeTraversalBatch(second));}
export function sliceTraversalBatchResult(result={},start=0,end=Infinity){const s=Math.max(0,Math.floor(finite(start)));const e=Math.min(result.states?.length??0,Math.floor(finite(end,result.states?.length??0)));return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_BATCH_VERSION,count:Math.max(0,e-s),states:freeze((result.states??[]).slice(s,e)),timeline:freeze((result.timeline??[]).slice(s,e)),diagnostics:freeze((result.diagnostics??[]).slice(s,e)),quality:freeze((result.quality??[]).slice(s,e))});}

export function findTraversalBatchAnomalies(result={}){
 const rows=[];for(let i=0;i<(result.diagnostics?.length??0);i+=1){const report=result.diagnostics[i];if((report.findings??[]).length)rows.push(freeze({index:i,state:result.states?.[i]?.state,findings:freeze(report.findings.slice())}));}
 return freeze(rows);
}
