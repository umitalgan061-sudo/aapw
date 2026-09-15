/**
 * Composite policy entrypoint for player motion presentation.
 * This file deliberately delegates to specialized state/blend/contract layers so callers have one stable import.
 */
import { buildPlayerMotionPresentationState, projectPlayerMotionPresentationState, validatePlayerMotionPresentationState } from './playerMotionPresentationState.js';
import { createPlayerMotionPresentationContract, validatePlayerMotionPresentationContract } from './playerMotionPresentationContract.js';
import { blendPlayerMotionChannels } from './playerMotionPresentationBlendPolicy.js';
import { resolveTraversalAudioIntent } from './playerTraversalPresentationAudioPolicy.js';
import { resolveTraversalVfxIntent } from './playerTraversalPresentationVfxPolicy.js';
import { buildTraversalPresentationEventIntent } from './playerTraversalPresentationEventPolicy.js';
import { resolveTraversalContactPresentation } from './playerTraversalPresentationContactPolicy.js';

export const PLAYER_MOTION_PRESENTATION_POLICY_VERSION='2026-09-15-v1';
function freeze(v){return Object.freeze(v);}

export function resolvePlayerMotionPresentation(previous=null,input={}){
 const state=buildPlayerMotionPresentationState(previous,input);
 const contract=createPlayerMotionPresentationContract(state);
 const blend=blendPlayerMotionChannels(state);
 const projection=projectPlayerMotionPresentationState(state);
 const traversal=state.traversal;
 return freeze({version:PLAYER_MOTION_PRESENTATION_POLICY_VERSION,state,contract,blend,projection,audio:resolveTraversalAudioIntent(traversal),vfx:resolveTraversalVfxIntent(traversal),event:buildTraversalPresentationEventIntent(traversal),contact:resolveTraversalContactPresentation(traversal)});
}

export function validatePlayerMotionPresentation(packet={}){
 const state=validatePlayerMotionPresentationState(packet.state??{});
 const contract=validatePlayerMotionPresentationContract(packet.contract??{});
 const errors=[];if(!state.valid)errors.push(...state.errors.map(e=>`state:${e}`));if(!contract.valid)errors.push(...contract.errors.map(e=>`contract:${e}`));if(!packet.blend)errors.push('blend');if(!packet.projection)errors.push('projection');
 return freeze({valid:errors.length===0,errors:freeze(errors),state,contract});
}

export function comparePlayerMotionPresentationPackets(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export function selectDominantPlayerPresentation(packet={}){return packet.blend?.dominant??packet.state?.domain??'locomotion';}
export function selectPlayerPresentationProgress(packet={}){return Math.max(packet.blend?.weights?.traversal??0,packet.blend?.weights?.locomotion??0);}
export function projectPlayerPresentationForConsumer(packet={},consumer='animation'){
 if(consumer==='animation')return packet.projection?.animation??null;
 if(consumer==='audio')return packet.audio??null;
 if(consumer==='vfx')return packet.vfx??null;
 if(consumer==='contact')return packet.contact??null;
 return packet.state??null;
}
