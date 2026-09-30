/**
 * Higher-level report helpers for traversal presentation batch runs.
 * Keeps reporting deterministic and independent from the runtime transport/persistence layer.
 */
import { processTraversalPresentationBatch } from './playerTraversalPresentationBatch.js';
import { buildTraversalPerformanceReport } from './playerTraversalPresentationMetrics.js';
import { summarizeTraversalCalibration } from './playerTraversalPresentationCalibration.js';

export const PLAYER_TRAVERSAL_PRESENTATION_BATCH_REPORT_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}function freeze(v){return Object.freeze(v);}

export function buildTraversalPresentationBatchReport(cues=[]){
 const batch=processTraversalPresentationBatch(cues);
 const performance=buildTraversalPerformanceReport(batch.timeline);
 const summary=summarizeTraversalCalibration({count:batch.count,passed:batch.count,failed:0,valid:true});
 const eventCounts={};for(const state of batch.states)eventCounts[state.event]=(eventCounts[state.event]??0)+1;
 const stateCounts={};for(const state of batch.states)stateCounts[state.state]=(stateCounts[state.state]??0)+1;
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_BATCH_REPORT_VERSION,count:batch.count,stateCounts:freeze(stateCounts),eventCounts:freeze(eventCounts),averageQuality:round(batch.averageQuality),performance,calibration:summary,telemetry:batch.telemetry,timelineValid:batch.timelineValid,healthy:batch.timelineValid&&performance.summary?.blockedRate<.75});
}

export function compareTraversalPresentationBatchReports(first={},second={}){return JSON.stringify(first)===JSON.stringify(second);}
export function summarizeTraversalPresentationBatchReport(report={}){return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_BATCH_REPORT_VERSION,count:report.count??0,averageQuality:round(report.averageQuality),timelineValid:Boolean(report.timelineValid),blockedRate:round(report.performance?.summary?.blockedRate),activeRate:round(report.performance?.summary?.activeRate),healthy:Boolean(report.healthy)});}
export function findTraversalPresentationBatchHotspots(report={}){const rows=[];const states=report.stateCounts??{};for(const [state,count] of Object.entries(states))if(count>Math.max(3,(report.count??0)*.35))rows.push(freeze({state,count,ratio:round(count/Math.max(1,report.count))}));return freeze(rows);}
