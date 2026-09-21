/**
 * Bounded recorder for composite player presentation states.
 * Useful for debugging, replay capture and offline tuning without owning persistence.
 */
import { comparePlayerMotionPresentationState } from './playerMotionPresentationState.js';

export const PLAYER_MOTION_PRESENTATION_RECORDER_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function freeze(v){return Object.freeze(v);}
function clone(value){return value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):value;}

export function createPlayerMotionPresentationRecorder(options={}){
 const maxEntries=Math.max(1,Math.floor(finite(options.maxEntries,120)));
 let entries=[];
 let frame=0;
 let last=null;
 function record(state,clockSeconds=0){frame+=1;const entry=freeze({frame,clockSeconds:Math.max(0,finite(clockSeconds)),state:freeze(clone(state))});entries=[...entries,entry].slice(-maxEntries);last=state;return entry;}
 function snapshot(){return freeze({version:PLAYER_MOTION_PRESENTATION_RECORDER_VERSION,frame,entries:freeze(entries.slice()),last:clone(last)});}
 function reset(){entries=[];frame=0;last=null;return snapshot();}
 function exportRecords(){return freeze(entries.map(entry=>clone(entry)));}
 function importRecords(records=[]){entries=records.slice(-maxEntries).map(entry=>freeze(clone(entry)));frame=entries.length?entries[entries.length-1].frame:0;last=entries.length?entries[entries.length-1].state:null;return snapshot();}
 return freeze({record,snapshot,reset,exportRecords,importRecords});
}

export function compareMotionPresentationRecordStreams(a=[],b=[]){
 if(a.length!==b.length)return false;
 return a.every((entry,index)=>entry.frame===b[index].frame&&entry.clockSeconds===b[index].clockSeconds&&JSON.stringify(entry.state)===JSON.stringify(b[index].state));
}

export function findFirstMotionPresentationDivergence(a=[],b=[]){
 const count=Math.max(a.length,b.length);
 for(let index=0;index<count;index+=1){
  if(!a[index]||!b[index]||a[index].frame!==b[index].frame||!comparePlayerMotionPresentationState(a[index].state?.state,b[index].state?.state))return index;
 }
 return -1;
}

export function summarizeMotionPresentationRecording(records=[]){
 const domains={locomotion:0,traversal:0};
 const states={};
 for(const entry of records){const domain=entry.state?.domain;if(domains[domain]!=null)domains[domain]+=1;const state=entry.state?.traversal?.state??entry.state?.locomotion?.mode??'unknown';states[state]=(states[state]??0)+1;}
 return freeze({version:PLAYER_MOTION_PRESENTATION_RECORDER_VERSION,entries:records.length,domains:freeze(domains),states:freeze(states)});
}
