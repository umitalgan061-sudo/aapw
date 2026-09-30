/**
 * Final semantic adapter for traversal presentation consumers.
 *
 * This module deliberately contains no renderer/audio/VFX implementation. It only translates the stable
 * traversal contract into strongly named semantic packets so adapters do not need to know the internal
 * policy vocabulary or threshold constants.
 */
import { createPlayerTraversalPresentationContract } from './playerTraversalPresentationContract.js';
import { resolveTraversalContactPresentation } from './playerTraversalPresentationContactPolicy.js';
import { resolveTraversalSurfaceProfile, resolveTraversalSurfaceAudio } from './playerTraversalPresentationSurfacePolicy.js';
import { buildTraversalPresentationEventIntent } from './playerTraversalPresentationEventPolicy.js';
import { resolveTraversalAudioIntent, attenuateTraversalAudioForConfidence } from './playerTraversalPresentationAudioPolicy.js';
import { resolveTraversalVfxIntent, attenuateTraversalVfxForSurface } from './playerTraversalPresentationVfxPolicy.js';

export const PLAYER_TRAVERSAL_PRESENTATION_CONSUMER_SEMANTICS_VERSION='2026-09-15-v1';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp01(v){return Math.max(0,Math.min(1,finite(v)));}
function freeze(v){return Object.freeze(v);}

export function buildTraversalConsumerSemantics(presentation={}){
 const contract=createPlayerTraversalPresentationContract(presentation);
 const contact=resolveTraversalContactPresentation(presentation);
 const surface=resolveTraversalSurfaceProfile(contract.surfaceId);
 const surfaceAudio=resolveTraversalSurfaceAudio(presentation,contract.surfaceId);
 const event=buildTraversalPresentationEventIntent(contract);
 const audio=attenuateTraversalAudioForConfidence(resolveTraversalAudioIntent(contract),contract.confidence);
 const vfx=attenuateTraversalVfxForSurface(resolveTraversalVfxIntent(contract),contract.metrics.surfaceConfidence);
 return freeze({
  version:PLAYER_TRAVERSAL_PRESENTATION_CONSUMER_SEMANTICS_VERSION,
  contract,
  event:freeze({kind:event.kind,priority:event.priority,oneShot:event.oneShot,loop:event.loop,latencySeconds:event.latencySeconds}),
  animation:freeze({state:contract.state,phase:contract.phase,technique:contract.technique,traversalWeight:contract.channels.traversal,anticipationWeight:contract.channels.anticipation,commitmentWeight:contract.channels.commitment,contactWeight:contact.weight,impactWeight:contract.channels.impact}),
  audio:freeze({cue:audio.cue,state:audio.state,intensity:audio.intensity,confidence:audio.confidence,materialHint:surfaceAudio.audioMaterial}),
  vfx:freeze({effect:vfx.effect,state:vfx.state,weight:vfx.weight,contact:vfx.contact,impact:vfx.impact,confidence:vfx.confidence}),
  contact:freeze({band:contact.band,weight:contact.weight,softWeight:contact.softWeight,hardWeight:contact.hardWeight}),
  surface:freeze({id:contract.surfaceId,grip:surface.grip,impact:surface.impact,anticipation:surface.anticipation}),
  active:!['clear','cancelled'].includes(contract.state),
  terminal:['clear','blocked','cancelled'].includes(contract.state),
 });
}

export function selectTraversalSemanticChannel(semantics={},channel='animation'){
 if(channel==='animation')return semantics.animation??null;
 if(channel==='audio')return semantics.audio??null;
 if(channel==='vfx')return semantics.vfx??null;
 if(channel==='contact')return semantics.contact??null;
 if(channel==='surface')return semantics.surface??null;
 if(channel==='event')return semantics.event??null;
 return null;
}

export function validateTraversalConsumerSemantics(semantics={}){
 const errors=[];
 if(!semantics.contract)errors.push('contract');
 if(!semantics.animation)errors.push('animation');
 if(!semantics.audio)errors.push('audio');
 if(!semantics.vfx)errors.push('vfx');
 if(!semantics.contact)errors.push('contact');
 if(!semantics.surface)errors.push('surface');
 if(semantics.audio?.intensity<0||semantics.audio?.intensity>1)errors.push('audio-intensity');
 if(semantics.vfx?.weight<0||semantics.vfx?.weight>1)errors.push('vfx-weight');
 if(semantics.contact?.weight<0||semantics.contact?.weight>1)errors.push('contact-weight');
 return freeze({valid:errors.length===0,errors:freeze(errors)});
}

export function compareTraversalConsumerSemantics(a={},b={}){return JSON.stringify(a)===JSON.stringify(b);}

export function summarizeTraversalConsumerSemantics(semantics={}){
 return freeze({version:PLAYER_TRAVERSAL_PRESENTATION_CONSUMER_SEMANTICS_VERSION,state:semantics.contract?.state??'clear',technique:semantics.contract?.technique??null,event:semantics.contract?.event??'none',audioCue:semantics.audio?.cue??'none',vfxEffect:semantics.vfx?.effect??null,contactBand:semantics.contact?.band??'none',surface:semantics.surface?.id??'unknown',active:Boolean(semantics.active),terminal:Boolean(semantics.terminal)});
}

export function buildTraversalConsumerSemanticsFromCue(cue={}){
 const presentation={
  state:cue.state??'clear',phase:cue.phase??'idle',event:cue.event??'none',technique:cue.technique??null,confidence:clamp01(cue.confidence),terminal:Boolean(cue.terminal),elapsedSeconds:Math.max(0,finite(cue.elapsedSeconds)),surfaceId:typeof cue.surfaceId==='string'?cue.surfaceId:'unknown',obstacleId:typeof cue.obstacleId==='string'?cue.obstacleId:'',
  metrics:{distance:Math.max(0,finite(cue.distance)),height:finite(cue.height),width:Math.max(0,finite(cue.width)),approachSpeed:Math.max(0,finite(cue.approachSpeed)),verticalSpeed:finite(cue.verticalSpeed),traversalWeight:clamp01(cue.traversalWeight),surfaceConfidence:clamp01(cue.surfaceConfidence),footContactConfidence:clamp01(cue.footContactConfidence),impact:Math.max(0,finite(cue.impact))},
  channels:{traversal:clamp01(cue.traversal),anticipation:clamp01(cue.anticipation),commitment:clamp01(cue.commitment),contact:clamp01(cue.contact),impact:clamp01(cue.impactWeight),confidence:clamp01(cue.confidence)},
 };
 return buildTraversalConsumerSemantics(presentation);
}
