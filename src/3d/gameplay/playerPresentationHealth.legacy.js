/**
 * Health report for the composite player presentation pipeline.
 * Aggregates schema, diagnostics, blend, traversal and replay-facing signals into a single read-only report.
 */
import { validatePlayerMotionPresentationState } from './playerMotionPresentationState.js';
import { validatePlayerMotionPresentationContract } from './playerMotionPresentationContract.js';
import { validateTraversalPresentationQuality } from './playerTraversalPresentationQuality.js';
import { validatePlayerMotionTimeline } from './playerMotionPresentationTimeline.js';
import { guardTraversalPresentationState } from './playerTraversalPresentationGuards.js';
import { isTraversalPresentationEventPolicySafe } from './playerTraversalPresentationEventPolicy.js';

export const PLAYER_PRESENTATION_HEALTH_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}
function freeze(v){return Object.freeze(v);}

export function evaluatePlayerPresentationHealth(state={},previous=null,timeline=[]){
 const errors=[];const warnings=[];
 const stateReport=validatePlayerMotionPresentationState(state);
 const contract=state.traversalContract?validatePlayerMotionPresentationContract(state.traversalContract):{valid:false,errors:['missing-contract']};
 const quality=validateTraversalPresentationQuality(state.traversal??{},previous?.traversal??null);
 const timelineReport=validatePlayerMotionTimeline(timeline);
 const traversalGuard=guardTraversalPresentationState(state.traversal??{},previous?.traversal??null);
 const eventSafe=isTraversalPresentationEventPolicySafe(state.traversal?.event??'none');
 if(!stateReport.valid)errors.push(...stateReport.errors.map(e=>`state:${e}`));
 if(!contract.valid)errors.push(...contract.errors.map(e=>`contract:${e}`));
 if(!timelineReport.valid)errors.push(...timelineReport.errors.map(e=>`timeline:${e}`));
 if(!traversalGuard.safe)errors.push(...traversalGuard.issues.map(e=>`guard:${e}`));
 if(!eventSafe)errors.push('event-policy');
 if(quality.score<.68)warnings.push('quality-below-threshold');
 if(clamp01(state.channels?.confidence)<.5)warnings.push('low-composite-confidence');
 if(state.domain==='traversal'&&state.traversal?.state==='blocked'&&state.channels?.commitment>.2)warnings.push('blocked-commitment');
 const score=round(Math.max(0,1-errors.length*.18-warnings.length*.06)*.55+quality.score*.45);
 return freeze({version:PLAYER_PRESENTATION_HEALTH_VERSION,healthy:errors.length===0,score,errors:freeze(errors),warnings:freeze(warnings),state:stateReport,contract,timeline:timelineReport,quality,guard:traversalGuard,eventPolicySafe:eventSafe});
}

export function summarizePlayerPresentationHealth(report={}){return freeze({version:PLAYER_PRESENTATION_HEALTH_VERSION,healthy:Boolean(report.healthy),score:round(report.score),errors:report.errors?.length??0,warnings:report.warnings?.length??0});}
export function isPlayerPresentationHealthy(report,threshold=.7){return Boolean(report?.healthy)&&finite(report?.score)>=threshold;}
export function comparePlayerPresentationHealth(a,b){return JSON.stringify(summarizePlayerPresentationHealth(a))===JSON.stringify(summarizePlayerPresentationHealth(b));}
export function mergePlayerPresentationHealthReports(reports=[]){const errors=[],warnings=[];for(const report of reports){errors.push(...(report.errors??[]));warnings.push(...(report.warnings??[]));}const average=reports.length?reports.reduce((s,r)=>s+finite(r.score),0)/reports.length:0;return freeze({version:PLAYER_PRESENTATION_HEALTH_VERSION,healthy:errors.length===0,score:round(average),errors:freeze(errors),warnings:freeze(warnings)});}
