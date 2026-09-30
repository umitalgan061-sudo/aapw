/** Deterministic stress helpers for traversal presentation pipelines. */
import { buildPlayerTraversalPresentationState } from './playerTraversalPresentationPolicy.js';
import { validateTraversalTimeline } from './playerTraversalPresentationTimeline.js';
import { createTraversalPresentationTelemetry } from './playerTraversalPresentationTelemetry.js';
import { validateTraversalPresentationQuality } from './playerTraversalPresentationQuality.js';

export const PLAYER_TRAVERSAL_PRESENTATION_STRESS_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
function freeze(v){return Object.freeze(v);}
function makeCue(i){
 const phase=i%12;
 const weight=[0,.2,.45,.65,.8,.95,.9,.7,.4,.15,0,.3][phase];
 const distance=[8,6,4,2.7,2.2,1.4,1.1,1.6,2.5,4,6,3][phase];
 const height=[0,0,0,.2,.4,.8,1.2,-.2,-.7,0,0,0][phase];
 return {traversalWeight:weight,traversalForwardDistance:distance,traversalHeight:height,grounded:phase!==6&&phase!==7,surfaceConfidence:.55+.45*((i%10)/10),footPlantConfidence:.6+.4*((i%5)/5),landingImpactMps:phase===8?2:0,elapsedSeconds:(phase%4)*.08,clockSeconds:i/60,deltaSeconds:1/60};
}

export function generateTraversalStressSequence(count=600){const total=Math.max(1,Math.floor(finite(count,600)));const rows=[];for(let i=0;i<total;i+=1)rows.push(makeCue(i));return freeze(rows);}

export function executeTraversalStressSequence(records=[]){
 let previous=null;const timeline=[];const telemetry=createTraversalPresentationTelemetry();const states=[];let minConfidence=1;let maxConfidence=0;let qualityTotal=0;
 for(const record of records){
  const state=buildPlayerTraversalPresentationState(previous,record);states.push(state);timeline.push({timestampSeconds:record.clockSeconds,state:state.state,phase:state.phase,event:state.event,progress:0,confidence:clamp01(state.confidence)});telemetry.observe(state);const quality=validateTraversalPresentationQuality(state,previous);qualityTotal+=quality.score;minConfidence=Math.min(minConfidence,state.confidence);maxConfidence=Math.max(maxConfidence,state.confidence);previous=state;
 }
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_STRESS_VERSION,count:records.length,states:freeze(states),timeline:freeze(timeline),timelineValid:validateTraversalTimeline(timeline).valid,telemetry:telemetry.snapshot(),averageQuality:records.length?qualityTotal/records.length:0,minConfidence,maxConfidence});
}

export function validateTraversalStressResult(result={}){const errors=[];if(result.count<1)errors.push('empty');if(!result.timelineValid)errors.push('timeline');if(result.minConfidence<0||result.maxConfidence>1)errors.push('confidence');if(result.averageQuality<0||result.averageQuality>1)errors.push('quality');return freeze({valid:errors.length===0,errors:freeze(errors)});}
