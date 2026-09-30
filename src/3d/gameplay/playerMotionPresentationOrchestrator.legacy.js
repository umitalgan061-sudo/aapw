/**
 * Consumer-oriented orchestrator for the composite player presentation state.
 *
 * The orchestrator is deliberately not an authority. It composes state, contract, audio/VFX intents,
 * blend weights and diagnostics into a single immutable packet that downstream adapters can consume.
 * No renderer, mixer, player transform or physics dependency is introduced here.
 */
import { buildPlayerMotionPresentationState, projectPlayerMotionPresentationState } from './playerMotionPresentationState.js';
import { createPlayerMotionPresentationContract } from './playerMotionPresentationContract.js';
import { blendPlayerMotionChannels } from './playerMotionPresentationBlendPolicy.js';
import { resolveTraversalAudioIntent, attenuateTraversalAudioForConfidence } from './playerTraversalPresentationAudioPolicy.js';
import { resolveTraversalVfxIntent, attenuateTraversalVfxForSurface } from './playerTraversalPresentationVfxPolicy.js';
import { buildTraversalPresentationEventIntent } from './playerTraversalPresentationEventPolicy.js';
import { guardTraversalPresentationState, enforceTraversalConsumerSafety } from './playerTraversalPresentationGuards.js';
import { diagnosePlayerMotionPresentation } from './playerMotionPresentationDiagnostics.js';

export const PLAYER_MOTION_PRESENTATION_ORCHESTRATOR_VERSION='2026-09-15-v1';
function freeze(value){return Object.freeze(value);}

export function buildPlayerPresentationPacket(previous=null,input={},options={}){
 const state=buildPlayerMotionPresentationState(previous,input);
 const guard=guardTraversalPresentationState(state.traversal,previous?.traversal??null);
 const traversal=guard.presentation;
 const safeState=freeze({...state,traversal});
 const contract=createPlayerMotionPresentationContract(safeState);
 const blend=blendPlayerMotionChannels(safeState);
 const audio=attenuateTraversalAudioForConfidence(resolveTraversalAudioIntent(traversal),traversal.confidence);
 const vfx=attenuateTraversalVfxForSurface(resolveTraversalVfxIntent(traversal),traversal.metrics?.surfaceConfidence);
 const event=buildTraversalPresentationEventIntent(traversal);
 const baseProjection=projectPlayerMotionPresentationState(safeState,{audio:false,vfx:false});
 const diagnostics=diagnosePlayerMotionPresentation(safeState,previous);
 const packet=freeze({version:PLAYER_MOTION_PRESENTATION_ORCHESTRATOR_VERSION,state:safeState,contract,blend,audio,vfx,event,projection:baseProjection,diagnostics});
 return enforceTraversalConsumerSafety(packet);
}

export function createPlayerPresentationOrchestrator(options={}){
 let previous=null;let frame=0;
 function update(input={}){frame+=1;const packet=buildPlayerPresentationPacket(previous,input,options);previous=packet.state;return freeze({frame,packet});}
 function snapshot(){return freeze({version:PLAYER_MOTION_PRESENTATION_ORCHESTRATOR_VERSION,frame,state:previous});}
 function reset(){previous=null;frame=0;return snapshot();}
 return freeze({update,snapshot,reset});
}

export function summarizePlayerPresentationPacket(packet={}){
 return freeze({version:PLAYER_MOTION_PRESENTATION_ORCHESTRATOR_VERSION,domain:packet.state?.domain??'locomotion',locomotionMode:packet.contract?.locomotion?.mode??'idle',traversalState:packet.contract?.traversal?.state??'clear',traversalEvent:packet.contract?.traversal?.event??'none',blendDomain:packet.blend?.dominant??'locomotion',confidence:packet.contract?.channels?.confidence??0,audioCue:packet.audio?.cue??'none',vfxEffect:packet.vfx?.effect??null,healthy:Boolean(packet.diagnostics?.healthy)});
}

export function comparePlayerPresentationPackets(a,b){return JSON.stringify(summarizePlayerPresentationPacket(a))===JSON.stringify(summarizePlayerPresentationPacket(b));}
