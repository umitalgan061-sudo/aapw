/** Diagnostic helpers for traversal presentation without console/network side effects. */
import { PLAYER_TRAVERSAL_PRESENTATION_EVENTS, PLAYER_TRAVERSAL_PRESENTATION_STATES } from './playerTraversalPresentationPolicy.js';
import { validateTraversalPresentationQuality } from './playerTraversalPresentationQuality.js';

export const PLAYER_TRAVERSAL_PRESENTATION_DIAGNOSTICS_VERSION = '2026-09-15-v1';
function finite(value, fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clamp01(value){return Math.max(0,Math.min(1,finite(value)));}
function round(value,digits=4){const f=10**digits;return Math.round(finite(value)*f)/f;}
function freeze(value){return Object.freeze(value);}

export function diagnoseTraversalPresentationState(current={}, previous=null){
 const quality=validateTraversalPresentationQuality(current,previous);
 const findings=[];
 if(!PLAYER_TRAVERSAL_PRESENTATION_STATES.includes(current.state)) findings.push({severity:'error',code:'STATE_UNKNOWN'});
 if(!PLAYER_TRAVERSAL_PRESENTATION_EVENTS.includes(current.event)) findings.push({severity:'error',code:'EVENT_UNKNOWN'});
 if(current.confidence<0.5) findings.push({severity:'warning',code:'LOW_CONFIDENCE',value:round(current.confidence)});
 if(current.state==='blocked'&&current.channels?.commitment>0.8) findings.push({severity:'warning',code:'BLOCKED_COMMITTED'});
 if(current.state==='clear'&&current.channels?.traversal>0.5) findings.push({severity:'warning',code:'CLEAR_ACTIVE'});
 if(previous&&previous.state!==current.state&&current.event==='none') findings.push({severity:'warning',code:'UNANNOUNCED_TRANSITION'});
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_DIAGNOSTICS_VERSION,quality,findings:freeze(findings)});
}

export function summarizeTraversalDiagnosticSeries(series=[]){
 const counts={error:0,warning:0};
 for(const report of series) for(const finding of report.findings??[]) counts[finding.severity]=(counts[finding.severity]??0)+1;
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_DIAGNOSTICS_VERSION,reports:series.length,errors:counts.error,warnings:counts.warning,healthy:counts.error===0});
}

export function buildTraversalDebugSnapshot(presentation={}){
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_DIAGNOSTICS_VERSION,state:presentation.state??'clear',phase:presentation.phase??'idle',event:presentation.event??'none',confidence:round(clamp01(presentation.confidence)),distance:round(presentation.metrics?.distance),height:round(presentation.metrics?.height),traversal:round(clamp01(presentation.channels?.traversal)),commitment:round(clamp01(presentation.channels?.commitment))});
}
