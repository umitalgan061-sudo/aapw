/** Consumer-facing deterministic bridge from anticipation policy to animation channels. */
import {
  PLAYER_DIRECTIONAL_DIRECTIONS,
  resolvePlayerDirectionalFingerprint,
  resolvePlayerDirectionalFullPresentation,
} from './playerDirectionalLocomotionPolicy.js';
import {
  PLAYER_LOCOMOTION_ANTICIPATION_VERSION,
  resolvePlayerLocomotionAnticipationProfile,
} from './playerLocomotionAnticipationPolicy.js';

export const PLAYER_LOCOMOTION_ANTICIPATION_BRIDGE_VERSION = '2026-09-15-v1';
export const PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS = Object.freeze([
  'idle','forward','forwardRight','right','backRight','back','backLeft','left','forwardLeft',
  'start','accelerate','cruise','brake','stop','strafe','pivot','recover',
]);
const CHANNEL_MAP = Object.freeze({ forward:'forward','forward-right':'forwardRight',right:'right','back-right':'backRight',back:'back','back-left':'backLeft',left:'left','forward-left':'forwardLeft' });
function finite(value, fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function round(value,digits=4){const f=10**digits;return Math.round(finite(value)*f)/f;}
function freeze(value){return Object.freeze(value);}

export function normalizePlayerLocomotionAnimationDirectionalWeights(weights={}){
  const result=Object.fromEntries(PLAYER_DIRECTIONAL_DIRECTIONS.map((d)=>[d,0]));
  for(const d of PLAYER_DIRECTIONAL_DIRECTIONS) result[d]=clamp(finite(weights[d]),0,1);
  const sum=Object.values(result).reduce((a,b)=>a+b,0);
  if(sum<=0) result.forward=1;
  else for(const d of PLAYER_DIRECTIONAL_DIRECTIONS) result[d]=round(result[d]/sum);
  return freeze(result);
}

export function resolvePlayerLocomotionChannelWeights(profile={}){
  const channels=Object.fromEntries(PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS.map((c)=>[c,0]));
  const directional=normalizePlayerLocomotionAnimationDirectionalWeights(profile.anticipatedBlendWeights);
  for(const d of PLAYER_DIRECTIONAL_DIRECTIONS) channels[CHANNEL_MAP[d]]=directional[d];
  const mode=String(profile.mode??'idle');
  const modeValue={ start:profile.startWeight,accelerate:profile.startWeight,cruise:1,brake:profile.brakeWeight,stop:profile.brakeWeight,strafe:Math.max(profile.startWeight??0,(profile.brakeWeight??0)*0.25),pivot:profile.pivotWeight,recover:profile.recoveryWeight }[mode];
  if(channels[mode]!==undefined) channels[mode]=Math.max(channels[mode],round(clamp(finite(modeValue),0,1)));
  return freeze(channels);
}

export function resolvePlayerLocomotionChannelEnvelope(profile={}){
  const confidence=clamp(finite(profile.confidence,1),0,1);
  const groundRisk=clamp(finite(profile.groundRisk),0,1);
  const damping=clamp(0.72+confidence*0.28-groundRisk*0.18,0.5,1);
  return freeze({ directional:round(damping), gait:round(clamp(damping*(profile.mode==='pivot'?0.84:1),0.5,1)), contact:round(clamp(finite(profile.contact?.plant)*damping,0,1)), anticipation:round(clamp(0.45+finite(profile.lookAheadSeconds)*1.2,0,1)), confidence, groundRisk, primaryDirection:String(profile.anticipatedDirection??'forward') });
}

export function resolvePlayerLocomotionAnimationRequest(input={},previous=null){
  const directional=resolvePlayerDirectionalFullPresentation(input,previous?.semanticState??'idle');
  const profile=resolvePlayerLocomotionAnticipationProfile(input,previous);
  const channels=resolvePlayerLocomotionChannelWeights(profile);
  const envelope=resolvePlayerLocomotionChannelEnvelope(profile);
  return freeze({ version:PLAYER_LOCOMOTION_ANTICIPATION_BRIDGE_VERSION, anticipationVersion:PLAYER_LOCOMOTION_ANTICIPATION_VERSION, semanticState:profile.semanticState, mode:profile.mode, presentDirection:directional.dominantDirection, anticipatedDirection:profile.anticipatedDirection, channels, envelope, playbackRate:profile.playbackRate, phase:profile.phase, footPlant:profile.contact.plant, confidence:profile.confidence, fingerprint:resolvePlayerDirectionalFingerprint({semanticState:profile.semanticState,mode:profile.mode,channels,envelope,playbackRate:profile.playbackRate}) });
}

export function validatePlayerLocomotionAnimationRequest(request={}){
  const channels=Object.values(request.channels??{});
  const channelsOk=channels.length===PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS.length&&channels.every(Number.isFinite)&&channels.every((v)=>v>=0&&v<=1);
  const phaseOk=Number.isFinite(request.phase)&&request.phase>=0&&request.phase<1;
  const rateOk=Number.isFinite(request.playbackRate)&&request.playbackRate>=0.72&&request.playbackRate<=1.35;
  const confidenceOk=Number.isFinite(request.confidence)&&request.confidence>=0&&request.confidence<=1;
  const directionOk=PLAYER_DIRECTIONAL_DIRECTIONS.includes(request.anticipatedDirection);
  return freeze({ok:channelsOk&&phaseOk&&rateOk&&confidenceOk&&directionOk,channelsOk,phaseOk,rateOk,confidenceOk,directionOk});
}

export function createPlayerLocomotionAnimationRequestController({onRequest=null}={}){
  let previous=null;let frameCount=0;let lastFingerprint='';
  return freeze({
    update(input={}){const request=resolvePlayerLocomotionAnimationRequest(input,previous);frameCount+=1;previous=freeze({planarSpeedMps:input.planarSpeedMps,semanticState:request.semanticState,directionAngleRadians:0,phase:request.phase,turnRateDegreesPerSecond:input.turnRateDegreesPerSecond,surfaceConfidence:input.surfaceConfidence,surfaceSlip:input.surfaceSlip});if(typeof onRequest==='function'&&request.fingerprint!==lastFingerprint)onRequest(request);lastFingerprint=request.fingerprint;return freeze({request,frameCount});},
    read(){return freeze({frameCount,lastFingerprint});},
    reset(){previous=null;frameCount=0;lastFingerprint='';},
  });
}
export function resolvePlayerLocomotionChannelCapabilities(){return Object.freeze(['explicit-eight-way','start-stop-channels','pivot-channel','contact-envelope','ground-risk-damping','immutable-request','deterministic-fingerprint','consumer-only']);}
export function auditPlayerLocomotionAnimationBridge(){const request=resolvePlayerLocomotionAnimationRequest({velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:3.5,deltaSeconds:1/60,surfaceConfidence:1,surfaceSlip:0});return freeze({version:PLAYER_LOCOMOTION_ANTICIPATION_BRIDGE_VERSION,channelCount:PLAYER_LOCOMOTION_ANTICIPATION_CHANNELS.length,valid:validatePlayerLocomotionAnimationRequest(request).ok,immutable:Object.isFrozen(request)&&Object.isFrozen(request.channels),fingerprintLength:request.fingerprint.length});}
