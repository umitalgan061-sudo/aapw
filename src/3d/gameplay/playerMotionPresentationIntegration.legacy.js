/**
 * Final composition boundary for player motion presentation.
 *
 * This module wires the composite state, contract, blend policy, consumer projections, recorder, telemetry
 * and health report into one deterministic update path. It still does not own player movement, collision,
 * traversal authorization, animation mixers, sound playback, VFX spawning or persistence.
 */
import { buildPlayerMotionPresentationState } from './playerMotionPresentationState.js';
import { createPlayerMotionPresentationContract } from './playerMotionPresentationContract.js';
import { blendPlayerMotionChannels } from './playerMotionPresentationBlendPolicy.js';
import { projectPlayerMotionPresentationState } from './playerMotionPresentationState.js';
import { createPlayerMotionPresentationRecorder } from './playerMotionPresentationRecorder.js';
import { createPlayerMotionPresentationTelemetry } from './playerMotionPresentationTelemetry.js';
import { evaluatePlayerPresentationHealth } from './playerPresentationHealth.js';
import { resolveTraversalAudioIntent } from './playerTraversalPresentationAudioPolicy.js';
import { resolveTraversalVfxIntent } from './playerTraversalPresentationVfxPolicy.js';
import { buildTraversalPresentationEventIntent } from './playerTraversalPresentationEventPolicy.js';

export const PLAYER_MOTION_PRESENTATION_INTEGRATION_VERSION='2026-09-15-v1';
function freeze(v){return Object.freeze(v);}
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}

export function createPlayerMotionPresentationIntegration(options={}){
 let previous=null;let tickIndex=0;let clockSeconds=0;
 const recorder=createPlayerMotionPresentationRecorder({maxEntries:options.maxEntries??120});
 const telemetry=createPlayerMotionPresentationTelemetry();
 function update(input={}){
  tickIndex+=1;clockSeconds=Math.max(clockSeconds,finite(input.clockSeconds,clockSeconds+finite(input.deltaSeconds,1/60)));
  const state=buildPlayerMotionPresentationState(previous,input);const contract=createPlayerMotionPresentationContract(state);const blend=blendPlayerMotionChannels(state);const projection=projectPlayerMotionPresentationState(state,{audio:options.audio!==false,vfx:options.vfx!==false});
  const audio=resolveTraversalAudioIntent(state.traversal);const vfx=resolveTraversalVfxIntent(state.traversal);const event=buildTraversalPresentationEventIntent(state.traversal);const health=evaluatePlayerPresentationHealth(state,previous,[]);
  recorder.record(state,clockSeconds);telemetry.observe(state);previous=state;
  return freeze({version:PLAYER_MOTION_PRESENTATION_INTEGRATION_VERSION,tickIndex,clockSeconds,state,contract,blend,projection,audio,vfx,event,health});
 }
 function snapshot(){return freeze({version:PLAYER_MOTION_PRESENTATION_INTEGRATION_VERSION,tickIndex,clockSeconds,state:previous,recording:recorder.snapshot(),telemetry:telemetry.snapshot()});}
 function reset(){previous=null;tickIndex=0;clockSeconds=0;recorder.reset();telemetry.reset();return snapshot();}
 return freeze({update,snapshot,reset});
}

export function validatePlayerMotionPresentationIntegration(snapshot={}){
 const errors=[];if(snapshot.tickIndex<0)errors.push('tick');if(snapshot.clockSeconds<0)errors.push('clock');if(snapshot.state&&!snapshot.contract)errors.push('contract');if(snapshot.recording&&!snapshot.recording.entries)errors.push('recording');if(snapshot.telemetry&&!Number.isFinite(snapshot.telemetry.samples))errors.push('telemetry');return freeze({valid:errors.length===0,errors:freeze(errors)});
}

export function summarizePlayerMotionPresentationIntegration(snapshot={}){return freeze({version:PLAYER_MOTION_PRESENTATION_INTEGRATION_VERSION,tickIndex:snapshot.tickIndex??0,clockSeconds:snapshot.clockSeconds??0,state:snapshot.state?.traversal?.state??'clear',domain:snapshot.state?.domain??'locomotion',samples:snapshot.telemetry?.samples??0,recorded:snapshot.recording?.entries?.length??0,valid:validatePlayerMotionPresentationIntegration(snapshot).valid});}
