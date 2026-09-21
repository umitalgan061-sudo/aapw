/**
 * Bounded traversal presentation recorder.
 * Records normalized semantic output only, never raw world objects.
 */
import { createPlayerTraversalPresentationContract } from './playerTraversalPresentationContract.js';
import { guardTraversalReplayRecord } from './playerTraversalPresentationGuards.js';

export const PLAYER_TRAVERSAL_PRESENTATION_RECORDER_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function freeze(v){return Object.freeze(v);}
function clone(v){return v&&typeof v==='object'?JSON.parse(JSON.stringify(v)):v;}

export function createPlayerTraversalPresentationRecorder(options={}){
 const maxEntries=Math.max(1,Math.floor(finite(options.maxEntries,180)));let entries=[];let sequence=0;
 function record(presentation={},clockSeconds=0){sequence+=1;const contract=createPlayerTraversalPresentationContract(presentation);const record=freeze({sequence,clockSeconds:Math.max(0,finite(clockSeconds)),contract});entries=[...entries,record].slice(-maxEntries);return record;}
 function snapshot(){return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_RECORDER_VERSION,sequence,count:entries.length,entries:freeze(entries.slice())});}
 function exportRecords(){return freeze(entries.map(clone));}
 function importRecords(records=[]){entries=records.slice(-maxEntries).map(entry=>freeze(clone(entry)));sequence=entries.at(-1)?.sequence??0;return snapshot();}
 function reset(){entries=[];sequence=0;return snapshot();}
 return freeze({record,snapshot,exportRecords,importRecords,reset});
}

export function validateTraversalRecording(records=[]){const errors=[];let sequence=0;let clock=-Infinity;for(const record of records){if(record.sequence<=sequence)errors.push('sequence');if(record.clockSeconds<clock)errors.push('clock');const guard=guardTraversalReplayRecord({state:record.contract?.state,phase:record.contract?.phase,event:record.contract?.event,confidence:record.contract?.confidence,clockSeconds:record.clockSeconds});if(!guard.valid)errors.push(...guard.errors);sequence=record.sequence;clock=record.clockSeconds;}return freeze({valid:errors.length===0,errors:freeze(errors)});}

export function compareTraversalRecordings(a=[],b=[]){return JSON.stringify(a)===JSON.stringify(b);}
export function summarizeTraversalRecording(records=[]){const states={};const events={};for(const record of records){const state=record.contract?.state??'clear';const event=record.contract?.event??'none';states[state]=(states[state]??0)+1;events[event]=(events[event]??0)+1;}return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_RECORDER_VERSION,count:records.length,states:freeze(states),events:freeze(events),valid:validateTraversalRecording(records).valid});}
