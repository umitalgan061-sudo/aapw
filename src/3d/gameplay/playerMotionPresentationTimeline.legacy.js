/**
 * Composite player motion presentation timeline.
 * Keeps locomotion and traversal presentation transitions aligned on one explicit clock.
 */
import { buildPlayerMotionPresentationState } from './playerMotionPresentationState.js';
import { resolvePlayerMotionBlendWeights } from './playerMotionPresentationBlendPolicy.js';

export const PLAYER_MOTION_PRESENTATION_TIMELINE_VERSION='2026-09-15-v1';
const MAX_DEFAULT=240;
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}
function freeze(v){return Object.freeze(v);}

export function createPlayerMotionPresentationTimeline(options={}){
 const maxEntries=Math.max(1,Math.floor(finite(options.maxEntries,MAX_DEFAULT)));let entries=[];let previous=null;
 function push(clockSeconds,input={}){
  const state=buildPlayerMotionPresentationState(previous,input);const blend=resolvePlayerMotionBlendWeights(state);const entry=freeze({clockSeconds:Math.max(0,finite(clockSeconds)),state,blend});entries=[...entries,entry].slice(-maxEntries);previous=state;return entry;
 }
 function snapshot(){return freeze({version:PLAYER_MOTION_PRESENTATION_TIMELINE_VERSION,entries:freeze(entries.slice()),count:entries.length});}
 function reset(){entries=[];previous=null;return snapshot();}
 return freeze({push,snapshot,reset});
}

export function calculatePlayerMotionDomainDurations(entries=[]){
 const durations={locomotion:0,traversal:0};
 for(let i=1;i<entries.length;i+=1){const delta=Math.max(0,finite(entries[i].clockSeconds)-finite(entries[i-1].clockSeconds));const domain=entries[i-1].state?.domain;if(durations[domain]!==undefined)durations[domain]+=delta;}
 return freeze(Object.fromEntries(Object.entries(durations).map(([k,v])=>[k,round(v)])));
}

export function calculatePlayerMotionStateDurations(entries=[]){
 const durations={};
 for(let i=1;i<entries.length;i+=1){const state=entries[i-1].state?.traversal?.state??entries[i-1].state?.locomotion?.mode??'unknown';const delta=Math.max(0,finite(entries[i].clockSeconds)-finite(entries[i-1].clockSeconds));durations[state]=(durations[state]??0)+delta;}
 return freeze(Object.fromEntries(Object.entries(durations).map(([k,v])=>[k,round(v)])));
}

export function countPlayerMotionDomainSwitches(entries=[]){let count=0;for(let i=1;i<entries.length;i+=1)if(entries[i].state?.domain!==entries[i-1].state?.domain)count+=1;return count;}
export function summarizePlayerMotionTimeline(entries=[]){const durations=calculatePlayerMotionDomainDurations(entries);const stateDurations=calculatePlayerMotionStateDurations(entries);return freeze({version:PLAYER_MOTION_PRESENTATION_TIMELINE_VERSION,count:entries.length,durationSeconds:round(entries.length?finite(entries.at(-1).clockSeconds)-finite(entries[0].clockSeconds):0),domainDurations:durations,stateDurations,switches:countPlayerMotionDomainSwitches(entries)});}

export function validatePlayerMotionTimeline(entries=[]){const errors=[];let previous=-Infinity;for(let i=0;i<entries.length;i+=1){const time=finite(entries[i]?.clockSeconds);if(time<previous)errors.push(`clock:${i}`);previous=time;if(!entries[i]?.state)errors.push(`state:${i}`);const b=entries[i]?.blend;if(b&&(b.weights?.locomotion<0||b.weights?.locomotion>1||b.weights?.traversal<0||b.weights?.traversal>1))errors.push(`blend:${i}`);}return freeze({valid:errors.length===0,errors:freeze(errors)});}

export function chooseMotionTimelineEntryAt(entries=[],clockSeconds=0){if(!entries.length)return null;const target=finite(clockSeconds);return entries.reduce((closest,entry)=>Math.abs(entry.clockSeconds-target)<Math.abs(closest.clockSeconds-target)?entry:closest,entries[0]);}
