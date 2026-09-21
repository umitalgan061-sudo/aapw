/**
 * Thin integration facade combining velocity history, anticipation, timing and foot contact read models.
 * It is deliberately renderer-agnostic and writes to no gameplay authority.
 */
import { pushPlayerLocomotionVelocityHistory, createPlayerLocomotionVelocityHistory, resolvePlayerLocomotionHistoryPrediction, resolvePlayerLocomotionHistoryStability } from './playerLocomotionVelocityHistory.js';
import { resolvePlayerLocomotionAnticipationProfile } from './playerLocomotionAnticipationPolicy.js';
import { resolvePlayerLocomotionTemporalWindow, resolvePlayerLocomotionTemporalSample } from './playerLocomotionTemporalTuning.js';
import { resolvePlayerLocomotionTransitionEnvelope, resolvePlayerLocomotionTransitionSample } from './playerLocomotionTransitionWindows.js';
import { resolvePlayerLocomotionFootContactPresentation } from './playerLocomotionFootContactPolicy.js';
import { resolvePlayerLocomotionAnimationRequest } from './playerLocomotionAnimationBridge.js';

export const PLAYER_LOCOMOTION_ANTICIPATION_FACADE_VERSION='2026-09-15-v1';
function freeze(value){return Object.freeze(value);}
function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function round(v,digits=4){const f=10**digits;return Math.round(finite(v)*f)/f;}

export function createPlayerLocomotionAnticipationFacadeState(){return freeze({history:createPlayerLocomotionVelocityHistory(),previousProfile:null,mode:'idle',frameCount:0});}
export function resolvePlayerLocomotionFacadeObservation(input={},state=createPlayerLocomotionAnticipationFacadeState()){
  const nextHistory=pushPlayerLocomotionVelocityHistory(state.history,input);
  const prediction=resolvePlayerLocomotionHistoryPrediction(nextHistory,0.18);
  const stability=resolvePlayerLocomotionHistoryStability(nextHistory);
  const profile=resolvePlayerLocomotionAnticipationProfile({...input,planarSpeedMps:prediction.speedMps,turnRateDegreesPerSecond:finite(input.turnRateDegreesPerSecond, nextHistory.smoothedTurnRate)},state.previousProfile);
  const temporalWindow=resolvePlayerLocomotionTemporalWindow(state.mode,profile.mode,{confidence:profile.confidence,groundRisk:profile.groundRisk,speedDeltaMps:profile.speedDeltaMps,environment:profile.groundRisk>0.6?'unstable':profile.surfaceSlip>0.55?'slippery':profile.slopeClass==='steep'?'steep':'clear'});
  const temporalSample=resolvePlayerLocomotionTemporalSample({elapsedSeconds:0,windowSeconds:temporalWindow,mode:profile.mode,confidence:profile.confidence,directionWeight:1});
  const transition=resolvePlayerLocomotionTransitionEnvelope(state.mode,profile.mode,{surfaceSlip:profile.surfaceSlip,groundRisk:profile.groundRisk});
  const transitionSample=resolvePlayerLocomotionTransitionSample(transition,0);
  const foot=resolvePlayerLocomotionFootContactPresentation({phase:profile.phase,speedMps:profile.speedMps,playbackRate:profile.playbackRate,cadenceScale:profile.cadenceBias,surfaceConfidence:profile.surfaceConfidence,groundedConfidence:profile.contact.plant,surfaceSlip:profile.surfaceSlip});
  const animationRequest=resolvePlayerLocomotionAnimationRequest(input,state.previousProfile);
  return freeze({version:PLAYER_LOCOMOTION_ANTICIPATION_FACADE_VERSION,frameCount:state.frameCount+1,history:nextHistory,prediction,stability,profile,temporal:{windowSeconds:temporalWindow,sample:temporalSample},transition:{envelope:transition,sample:transitionSample},foot,animationRequest});
}
export function advancePlayerLocomotionAnticipationFacadeState(state=createPlayerLocomotionAnticipationFacadeState(),input={}){const observation=resolvePlayerLocomotionFacadeObservation(input,state);return freeze({history:observation.history,previousProfile:observation.profile,mode:observation.profile.mode,frameCount:observation.frameCount});}
export function updatePlayerLocomotionAnticipationFacade(state=createPlayerLocomotionAnticipationFacadeState(),input={}){const observation=resolvePlayerLocomotionFacadeObservation(input,state);const nextState=freeze({history:observation.history,previousProfile:observation.profile,mode:observation.profile.mode,frameCount:observation.frameCount});return freeze({state:nextState,observation});}
export function resolvePlayerLocomotionFacadeReadModel(observation={}){const profile=observation.profile??{};return freeze({version:PLAYER_LOCOMOTION_ANTICIPATION_FACADE_VERSION,frameCount:observation.frameCount??0,mode:profile.mode??'idle',direction:profile.anticipatedDirection??'forward',speedMps:round(profile.speedMps),prediction:observation.prediction??null,confidence:clamp(finite(profile.confidence),0,1),groundRisk:clamp(finite(profile.groundRisk),0,1),temporalProgress:clamp(finite(observation.temporal?.sample?.progress),0,1),transitionProgress:clamp(finite(observation.transition?.sample?.progress),0,1),footPhase:clamp(finite(observation.foot?.phase),0,1),footConfidence:clamp(finite(observation.foot?.confidence),0,1),animationFingerprint:observation.animationRequest?.fingerprint??''});}
export function createPlayerLocomotionAnticipationFacadeController({onObservation=null}={}){let state=createPlayerLocomotionAnticipationFacadeState();return freeze({update(input={}){const result=updatePlayerLocomotionAnticipationFacade(state,input);state=result.state;if(typeof onObservation==='function')onObservation(result.observation);return result;},read(){return freeze({frameCount:state.frameCount,mode:state.mode,historyLength:state.history.samples.length,profile:state.previousProfile});},reset(){state=createPlayerLocomotionAnticipationFacadeState();}});}
export function auditPlayerLocomotionAnticipationFacade(){const controller=createPlayerLocomotionAnticipationFacadeController();const result=controller.update({velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:3,deltaSeconds:1/60,surfaceConfidence:1,surfaceSlip:0});const read=resolvePlayerLocomotionFacadeReadModel(result.observation);return freeze({version:PLAYER_LOCOMOTION_ANTICIPATION_FACADE_VERSION,frameCount:read.frameCount,mode:read.mode,valid:Number.isFinite(read.speedMps),hasAnimationFingerprint:read.animationFingerprint.length>=8});}
