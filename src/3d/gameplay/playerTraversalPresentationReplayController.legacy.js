/**
 * Stateful replay controller for traversal presentation.
 * Uses explicit record timestamps and provides pause/resume/seek semantics without ambient time.
 */
import { buildPlayerTraversalPresentationState } from './playerTraversalPresentationPolicy.js';
import { buildTraversalTimelineEntry } from './playerTraversalPresentationTimeline.js';
import { createPlayerTraversalPresentationContract } from './playerTraversalPresentationContract.js';
import { guardTraversalReplayRecord } from './playerTraversalPresentationGuards.js';

export const PLAYER_TRAVERSAL_PRESENTATION_REPLAY_CONTROLLER_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}function freeze(v){return Object.freeze(v);}

export function createTraversalPresentationReplayController(records=[],options={}){
 let cursor=0;let playing=false;let previous=null;let outputs=[];const loop=Boolean(options.loop);
 function emit(index){const record=records[index];if(!record)return null;const cue=record.cue??record;const state=buildPlayerTraversalPresentationState(previous,cue);const timeline=buildTraversalTimelineEntry(previous,cue);const contract=createPlayerTraversalPresentationContract(state);const output=freeze({index,clockSeconds:Math.max(0,finite(record.clockSeconds??cue.clockSeconds)),state,timeline,contract,valid:guardTraversalReplayRecord({state:state.state,phase:state.phase,event:state.event,confidence:state.confidence,clockSeconds:cue.clockSeconds}).valid});previous=state;outputs=[...outputs,output];return output;}
 function step(){if(!records.length)return null;if(cursor>=records.length){if(loop){cursor=0;previous=null;}else{playing=false;return null;}}const output=emit(cursor);cursor+=1;return output;}
 function play(){playing=true;return step();}
 function pause(){playing=false;return snapshot();}
 function seek(index){cursor=Math.max(0,Math.min(records.length,Math.floor(finite(index))));previous=null;outputs=[];for(let i=0;i<cursor;i+=1)emit(i);return snapshot();}
 function reset(){cursor=0;playing=false;previous=null;outputs=[];return snapshot();}
 function snapshot(){return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_REPLAY_CONTROLLER_VERSION,cursor,playing,loop,count:records.length,outputs:freeze(outputs.slice()),current:previous});}
 function tick(){return playing?step():null;}
 return freeze({step,play,pause,seek,reset,snapshot,tick});
}

export function validateTraversalReplayControllerSnapshot(snapshot={}){const errors=[];if(snapshot.cursor<0)errors.push('cursor');if(snapshot.cursor>(snapshot.count??0))errors.push('cursor-range');for(let i=1;i<(snapshot.outputs?.length??0);i+=1)if(snapshot.outputs[i].index<=snapshot.outputs[i-1].index)errors.push(`order:${i}`);return freeze({valid:errors.length===0,errors:freeze(errors)});}
export function replayControllerDeterminism(records=[]){const first=createTraversalPresentationReplayController(records).snapshot();const a=createTraversalPresentationReplayController(records);const b=createTraversalPresentationReplayController(records);for(let i=0;i<records.length;i+=1){a.step();b.step();}return freeze({same:JSON.stringify(a.snapshot())===JSON.stringify(b.snapshot()),initial:validateTraversalReplayController(first).valid});}
