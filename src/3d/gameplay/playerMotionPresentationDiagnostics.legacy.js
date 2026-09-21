/** Composite diagnostics for the player motion presentation pipeline. */
import { PLAYER_MOTION_PRESENTATION_DOMAINS } from './playerMotionPresentationState.js';
import { diagnoseTraversalPresentationState } from './playerTraversalPresentationDiagnostics.js';

export const PLAYER_MOTION_PRESENTATION_DIAGNOSTICS_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
function freeze(v){return Object.freeze(v);}

export function diagnosePlayerMotionPresentation(state={},previous=null){
 const findings=[];
 if(state.version!==undefined&&typeof state.version!=='string')findings.push({severity:'error',code:'VERSION_TYPE'});
 if(!PLAYER_MOTION_PRESENTATION_DOMAINS.includes(state.domain))findings.push({severity:'error',code:'DOMAIN_UNKNOWN'});
 if(!state.locomotion)findings.push({severity:'error',code:'LOCOMOTION_MISSING'});
 if(!state.traversal)findings.push({severity:'error',code:'TRAVERSAL_MISSING'});
 for(const key of ['locomotion','traversal','anticipation','commitment','contact'])if(state.channels?.[key]<0||state.channels?.[key]>1)findings.push({severity:'error',code:`CHANNEL_${key.toUpperCase()}`});
 if(previous&&previous.domain!==state.domain)findings.push({severity:'info',code:'DOMAIN_SWITCH'});
 const traversalReport=diagnoseTraversalPresentationState(state.traversal??{},previous?.traversal??null);
 findings.push(...traversalReport.findings);
 return freeze({version:PLAYER_MOTION_PRESENTATION_DIAGNOSTICS_VERSION,findings:freeze(findings),traversal:traversalReport,healthy:findings.every(x=>x.severity!=='error')});
}

export function summarizePlayerMotionDiagnostics(reports=[]){
 const totals={error:0,warning:0,info:0};
 for(const report of reports)for(const finding of report.findings??[])totals[finding.severity]=(totals[finding.severity]??0)+1;
 return freeze({version:PLAYER_MOTION_PRESENTATION_DIAGNOSTICS_VERSION,reports:reports.length,errors:totals.error,warnings:totals.warning,info:totals.info,healthy:totals.error===0});
}

export function buildPlayerMotionHealthSnapshot(state={},diagnostics={}){
 return freeze({version:PLAYER_MOTION_PRESENTATION_DIAGNOSTICS_VERSION,domain:state.domain??'locomotion',healthy:Boolean(diagnostics.healthy),confidence:clamp01(state.channels?.confidence),traversalActive:state.traversal?.state!=='clear',findingCount:(diagnostics.findings??[]).length});
}
