/**
 * Consumer adapter for traversal presentation intents.
 * Keeps animation, audio and VFX packet construction consistent and validates each projection before it
 * leaves gameplay. No renderer objects are created here.
 */
import { buildPlayerTraversalConsumerPacket } from './playerTraversalPresentationBridge.js';
import { buildTraversalPresentationEventIntent } from './playerTraversalPresentationEventPolicy.js';
import { resolveTraversalAudioIntent, attenuateTraversalAudioForConfidence } from './playerTraversalPresentationAudioPolicy.js';
import { resolveTraversalVfxIntent, attenuateTraversalVfxForSurface } from './playerTraversalPresentationVfxPolicy.js';
import { createPlayerTraversalPresentationContract } from './playerTraversalPresentationContract.js';
import { enforceTraversalConsumerSafety } from './playerTraversalPresentationGuards.js';

export const PLAYER_TRAVERSAL_PRESENTATION_CONSUMER_ADAPTER_VERSION='2026-09-15-v1';
function freeze(v){return Object.freeze(v);}

export function createTraversalConsumerAdapter(options={}){
  const audioEnabled=options.audio!==false;
  const vfxEnabled=options.vfx!==false;
  const debugEnabled=options.debug!==false;
  function adapt(presentation={}){
    const contract=createPlayerTraversalPresentationContract(presentation);
    const packet=buildPlayerTraversalConsumerPacket(contract,{audio:audioEnabled,vfx:vfxEnabled,debug:debugEnabled});
    const audio=audioEnabled?attenuateTraversalAudioForConfidence(resolveTraversalAudioIntent(presentation),presentation.confidence):null;
    const vfx=vfxEnabled?attenuateTraversalVfxForSurface(resolveTraversalVfxIntent(presentation),presentation.metrics?.surfaceConfidence):null;
    const event=buildTraversalPresentationEventIntent(presentation);
    return enforceTraversalConsumerSafety(freeze({version:PLAYER_TRAVERSAL_PRESENTATION_CONSUMER_ADAPTER_VERSION,packet,contract,audio,vfx,event}));
  }
  function projectAnimation(presentation={}){return adapt(presentation).packet.animation;}
  function projectAudio(presentation={}){return adapt(presentation).audio;}
  function projectVfx(presentation={}){return adapt(presentation).vfx;}
  function projectDebug(presentation={}){return adapt(presentation).packet.debug;}
  return freeze({adapt,projectAnimation,projectAudio,projectVfx,projectDebug});
}

export function compareTraversalConsumerAdapterOutputs(adapter,a,b){return JSON.stringify(adapter.adapt(a))===JSON.stringify(adapter.adapt(b));}
export function validateTraversalConsumerAdapterOutput(output={}){const errors=[];if(!output.contract)errors.push('contract');if(output.packet&&!output.packet.valid)errors.push('packet');if(output.audio&&typeof output.audio.cue!=='string')errors.push('audio');if(output.vfx&&output.vfx.weight<0)errors.push('vfx');return freeze({valid:errors.length===0,errors:freeze(errors)});}
export function selectTraversalConsumerChannels(output={},options={}){return freeze({animation:options.animation===false?null:output.packet?.animation??null,audio:options.audio===false?null:output.audio??output.packet?.audio??null,vfx:options.vfx===false?null:output.vfx??output.packet?.vfx??null,debug:options.debug===false?null:output.packet?.debug??null});}
