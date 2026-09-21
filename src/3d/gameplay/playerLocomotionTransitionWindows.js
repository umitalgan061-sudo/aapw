/**
 * Deterministic timing windows that keep locomotion anticipation transitions visually stable.
 * Windows describe presentation blend timing only; gameplay and clip ownership stay external.
 */
import { PLAYER_LOCOMOTION_ANTICIPATION_MODES } from './playerLocomotionAnticipationPolicy.js';
export { PLAYER_LOCOMOTION_ANTICIPATION_MODES } from './playerLocomotionAnticipationPolicy.js';

export const PLAYER_LOCOMOTION_TRANSITION_WINDOW_VERSION = '2026-09-15-v1';
export const PLAYER_LOCOMOTION_TRANSITION_WINDOW_LIMITS = Object.freeze({ minSeconds: 0.04, maxSeconds: 0.42, maxDamping: 1, minDamping: 0.2, maxHistory: 20 });

const DEFAULT_WINDOWS = Object.freeze({
  'idle->start': 0.1, 'start->accelerate': 0.08, 'accelerate->cruise': 0.16, 'cruise->brake': 0.11,
  'brake->stop': 0.14, 'stop->idle': 0.09, 'cruise->strafe': 0.13, 'strafe->cruise': 0.12,
  'cruise->pivot': 0.18, 'pivot->cruise': 0.2, 'pivot->stop': 0.12, 'stop->turn-in-place': 0.1,
  'turn-in-place->start': 0.11, 'combat-advance->brake': 0.1, 'guard-walk->stop': 0.12,
  'dodge-recover->cruise': 0.18, 'stagger-recover->idle': 0.2,
});

function finite(value, fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function round(value,digits=4){const f=10**digits;return Math.round(finite(value)*f)/f;}
function freeze(value){return Object.freeze(value);}
function keyFor(from,to){return `${String(from??'idle')}->${String(to??'idle')}`;}

export function resolvePlayerLocomotionTransitionWindow(from='idle',to='idle',{ speedDeltaMps=0, turnWeight=0, surfaceSlip=0, confidence=1 }={}){
  const key=keyFor(from,to); const base=DEFAULT_WINDOWS[key]??(from===to?0:0.15);
  const speed=clamp(Math.abs(finite(speedDeltaMps))/8,0,1); const turn=clamp(finite(turnWeight),0,1); const slip=clamp(finite(surfaceSlip),0,1); const certainty=clamp(finite(confidence,1),0,1);
  const dynamics=1-speed*0.16+turn*0.1+slip*0.12+(1-certainty)*0.08;
  return round(clamp(base*dynamics,PLAYER_LOCOMOTION_TRANSITION_WINDOW_LIMITS.minSeconds,PLAYER_LOCOMOTION_TRANSITION_WINDOW_LIMITS.maxSeconds),4);
}

export function classifyPlayerLocomotionTransition(from='idle',to='idle'){
  if(from===to)return 'steady';
  if(to==='pivot'||from==='pivot')return 'pivot';
  if(to==='brake'||to==='stop')return 'deceleration';
  if(to==='start'||to==='accelerate')return 'acceleration';
  if(to==='dodge-recover'||to==='stagger-recover'||to==='recover'||from==='dodge-recover'||from==='stagger-recover'||from==='recover')return 'recovery';
  if(to==='guard-walk'||to==='combat-advance'||from==='guard-walk'||from==='combat-advance')return 'combat';
  return 'redirect';
}

export function resolvePlayerLocomotionTransitionEasing(kind='steady'){
  const curves={steady:0.5,acceleration:0.38,deceleration:0.62,pivot:0.72,recovery:0.58,combat:0.66,redirect:0.55};
  return round(clamp(curves[kind]??0.55,0.2,0.85));
}

export function resolvePlayerLocomotionTransitionProgress(elapsedSeconds=0,windowSeconds=0.1,{easing=0.5}={}){
  const duration=clamp(finite(windowSeconds,0.1),PLAYER_LOCOMOTION_TRANSITION_WINDOW_LIMITS.minSeconds,PLAYER_LOCOMOTION_TRANSITION_WINDOW_LIMITS.maxSeconds); const t=clamp(finite(elapsedSeconds)/duration,0,1); const curve=clamp(finite(easing,0.5),0.2,0.85);
  const shaped=t<0.5?0.5*((2*t)**(1+curve)):1-0.5*((2*(1-t))**(1+curve));
  return round(clamp(shaped,0,1));
}

export function resolvePlayerLocomotionTransitionEnvelope(from='idle',to='idle',context={}){
  const kind=classifyPlayerLocomotionTransition(from,to); const easing=resolvePlayerLocomotionTransitionEasing(kind); const duration=resolvePlayerLocomotionTransitionWindow(from,to,context);
  const damping=round(clamp(1-(context.surfaceSlip??0)*0.22-(context.groundRisk??0)*0.18,0.2,1));
  const priority=to==='pivot'||to==='brake'||to==='stop'?1:to==='start'||to==='accelerate'?0.84:to==='dodge-recover'||to==='stagger-recover'?0.92:0.7;
  return freeze({from,to,kind,durationSeconds:duration,easing,damping,priority,interruptible:!['pivot','stop'].includes(to)});
}

export function resolvePlayerLocomotionTransitionSample(envelope={},elapsedSeconds=0){
  const progress=resolvePlayerLocomotionTransitionProgress(elapsedSeconds,envelope.durationSeconds,{easing:envelope.easing});
  return freeze({progress,fromWeight:round((1-progress)*envelope.damping),toWeight:round(progress*envelope.priority),normalizedProgress:progress,complete:progress>=1});
}

export function resolvePlayerLocomotionTransitionHistory(history=[],entry={}){const next=[...(Array.isArray(history)?history:[]),freeze(entry)];return freeze(next.slice(-PLAYER_LOCOMOTION_TRANSITION_WINDOW_LIMITS.maxHistory));}

export function validatePlayerLocomotionTransitionEnvelope(envelope={}){
  const modesOk=PLAYER_LOCOMOTION_ANTICIPATION_MODES.includes(envelope.from)&&PLAYER_LOCOMOTION_ANTICIPATION_MODES.includes(envelope.to); const durationOk=Number.isFinite(envelope.durationSeconds)&&envelope.durationSeconds>=0.04&&envelope.durationSeconds<=0.42; const dampingOk=Number.isFinite(envelope.damping)&&envelope.damping>=0.2&&envelope.damping<=1; const priorityOk=Number.isFinite(envelope.priority)&&envelope.priority>=0&&envelope.priority<=1;
  return freeze({ok:modesOk&&durationOk&&dampingOk&&priorityOk,modesOk,durationOk,dampingOk,priorityOk});
}

export function createPlayerLocomotionTransitionController({onTransition=null}={}){
  let mode='idle';let elapsed=0;let envelope=resolvePlayerLocomotionTransitionEnvelope('idle','idle');let history=[];
  return freeze({
    update(nextMode='idle',deltaSeconds=1/60,context={}){const next=PLAYER_LOCOMOTION_ANTICIPATION_MODES.includes(nextMode)?nextMode:'idle';if(next!==mode){const previous=mode;mode=next;elapsed=0;envelope=resolvePlayerLocomotionTransitionEnvelope(previous,next,context);history=resolvePlayerLocomotionTransitionHistory(history,{from:previous,to:next,durationSeconds:envelope.durationSeconds});if(typeof onTransition==='function')onTransition(envelope);}else elapsed+=Math.max(0,finite(deltaSeconds));const sample=resolvePlayerLocomotionTransitionSample(envelope,elapsed);return freeze({mode,envelope,sample,history});},
    read(){return freeze({mode,elapsed,envelope,history});},reset(){mode='idle';elapsed=0;envelope=resolvePlayerLocomotionTransitionEnvelope('idle','idle');history=[];},
  });
}

export function auditPlayerLocomotionTransitionWindows(){const envelope=resolvePlayerLocomotionTransitionEnvelope('cruise','brake',{speedDeltaMps:-3,turnWeight:0.4,surfaceSlip:0.1,confidence:0.9});return freeze({version:PLAYER_LOCOMOTION_TRANSITION_WINDOW_VERSION,defaultCount:Object.keys(DEFAULT_WINDOWS).length,valid:validatePlayerLocomotionTransitionEnvelope(envelope).ok,immutable:Object.isFrozen(envelope),modes:PLAYER_LOCOMOTION_ANTICIPATION_MODES.length});}
