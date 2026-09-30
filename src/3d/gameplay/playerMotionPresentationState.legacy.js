/**
 * Composite player motion presentation state.
 *
 * Combines the existing locomotion animation request with traversal presentation intent. The composite
 * is presentation-only: locomotion/traversal gameplay systems remain authoritative over movement and
 * action validity. This layer only establishes deterministic consumer precedence and channels.
 */
import { resolvePlayerLocomotionAnimationRequest, validatePlayerLocomotionAnimationRequest } from './playerLocomotionAnimationBridge.js';
import { buildPlayerTraversalPresentationState } from './playerTraversalPresentationPolicy.js';
import { createPlayerTraversalPresentationContract } from './playerTraversalPresentationContract.js';
import { guardTraversalPresentationState } from './playerTraversalPresentationGuards.js';

export const PLAYER_MOTION_PRESENTATION_STATE_VERSION='2026-09-15-v1';
export const PLAYER_MOTION_PRESENTATION_DOMAINS=Object.freeze(['locomotion','traversal','contact','recovery','confidence']);
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function clamp01(v){return clamp(finite(v),0,1);}
function round(v,d=4){const f=10**d;return Math.round(finite(v)*f)/f;}
function freeze(v){return Object.freeze(v);}

const TRAVERSAL_STATES=new Set(['vault','climb','drop','land','blocked','recover','cancelled','prepare','approach']);

export function resolvePlayerMotionPresentationPrecedence(locomotion={},traversal={}){
 const traversalActive=TRAVERSAL_STATES.has(traversal.state);
 const traversalPriority={blocked:100,cancelled:98,land:92,vault:88,climb:88,drop:88,recover:80,prepare:58,approach:45};
 const locomotionPriority={recover:72,stop:42,brake:38,pivot:34,cruise:28,accelerate:26,start:24,idle:5};
 const traversalScore=traversalActive?(traversalPriority[traversal.state]??40):0;
 const locomotionScore=locomotionPriority[locomotion.mode]??20;
 return freeze({domain:traversalScore>=locomotionScore?'traversal':'locomotion',traversalScore,locomotionScore,reason:traversalScore>=locomotionScore?'traversal-priority':'locomotion-priority'});
}

export function buildPlayerMotionPresentationState(previous=null,input={}){
 const locomotion=resolvePlayerLocomotionAnimationRequest(input,previous?.locomotion);
 const traversal=buildPlayerTraversalPresentationState(previous?.traversal,input);
 const guarded=guardTraversalPresentationState(traversal,previous?.traversal);
 const safeTraversal=guarded.presentation;
 const contract=createPlayerTraversalPresentationContract(safeTraversal);
 const precedence=resolvePlayerMotionPresentationPrecedence(locomotion,safeTraversal);
 const locomotionValidation=validatePlayerLocomotionAnimationRequest(locomotion);
 const channels=freeze({
  locomotion:round(precedence.domain==='locomotion'?1:.45),
  traversal:round(precedence.domain==='traversal'?clamp01(contract.channels.traversal):clamp01(contract.channels.traversal*.65)),
  anticipation:round(clamp01(Math.max(contract.channels.anticipation,locomotion.envelope?.anticipation??0))),
  commitment:round(clamp01(Math.max(contract.channels.commitment,precedence.domain==='traversal'?contract.channels.traversal:0))),
  contact:round(clamp01(Math.max(contract.channels.contact,locomotion.footPlant??0))),
  confidence:round(clamp01((contract.confidence+locomotion.confidence)/2)),
 });
 return freeze({version:PLAYER_MOTION_PRESENTATION_STATE_VERSION,domain:precedence.domain,reason:precedence.reason,locomotion,locomotionValid:locomotionValidation.ok,traversal:safeTraversal,traversalContract:contract,precedence,channels});
}

export function projectPlayerMotionPresentationState(state={},options={}){
 const p=state;return freeze({
  animation:freeze({locomotion:p.locomotion,traversal:p.traversal.state,traversalPhase:p.traversal.phase,traversalTechnique:p.traversal.technique,domain:p.domain,channels:p.channels}),
  audio:options.audio===false?null:freeze({locomotion:p.locomotion.mode,traversal:p.traversal.event,blocked:p.traversal.state==='blocked',confidence:p.channels.confidence}),
  vfx:options.vfx===false?null:freeze({traversal:p.traversal.event,state:p.traversal.state,weight:p.channels.traversal,impact:p.traversal.channels.impact}),
 });
}

export function comparePlayerMotionPresentationState(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export function validatePlayerMotionPresentationState(state={}){const errors=[];if(state.version!==PLAYER_MOTION_PRESENTATION_STATE_VERSION)errors.push('version');if(!state.locomotion)errors.push('locomotion');if(!state.traversal)errors.push('traversal');if(!['locomotion','traversal'].includes(state.domain))errors.push('domain');for(const key of PLAYER_MOTION_PRESENTATION_DOMAINS.slice(0,3))if(state.channels?.[key]<0||state.channels?.[key]>1)errors.push(`channel:${key}`);return freeze({valid:errors.length===0,errors:freeze(errors)});}

export function createPlayerMotionPresentationController(options={}){
 let previous=null;let tickIndex=0;
 function update(input={}){tickIndex+=1;const state=buildPlayerMotionPresentationState(previous,input);previous=state;return freeze({tickIndex,state,projection:projectPlayerMotionPresentationState(state,options)});}
 function reset(){previous=null;tickIndex=0;return freeze({reset:true,version:PLAYER_MOTION_PRESENTATION_STATE_VERSION});}
 function snapshot(){return freeze({version:PLAYER_MOTION_PRESENTATION_STATE_VERSION,tickIndex,state:previous});}
 return freeze({update,reset,snapshot});
}
