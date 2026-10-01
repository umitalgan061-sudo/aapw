/** Cross-device haptic transport for gamepad and touch presentation parity. */
import type { CombatHapticPulse, CombatPresentationDevice } from './combatPresentationV1';

export interface CombatGamepadActuator { readonly playEffect?: (type:string,params:Record<string,number>)=>Promise<void>|void; }
export interface CombatHapticSink { readonly vibrate?: (pattern:number|readonly number[])=>boolean|void; readonly gamepad?: CombatGamepadActuator; }
export interface CombatHapticDispatchResult { readonly device:CombatPresentationDevice; readonly pulses:number; readonly attempted:number; readonly delivered:number; readonly pattern:readonly number[]; readonly gamepadEffects:number; }

const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:min));
function patternFor(pulses:readonly CombatHapticPulse[]):number[]{const out:number[]=[];for(const pulse of pulses.slice(0,4)){out.push(Math.round(Math.max(1,pulse.durationMs)),Math.round(Math.max(0,pulse.durationMs*0.35)));}return out;}

export function createBrowserHapticSink(target:typeof globalThis=globalThis):CombatHapticSink{
  const candidate=target as typeof globalThis & { navigator?: Navigator & { vibrate?: (pattern:number|readonly number[])=>boolean } };
  const vibrate=typeof candidate.navigator?.vibrate==='function'?candidate.navigator.vibrate.bind(candidate.navigator):undefined;
  return typeof vibrate === 'function' ? Object.freeze({vibrate}) : Object.freeze({});
}

export async function dispatchCombatHapticPulses(pulses:readonly CombatHapticPulse[],device:CombatPresentationDevice,sink:CombatHapticSink):Promise<CombatHapticDispatchResult>{
  if(device==='keyboard'||device==='mouse'||pulses.length===0)return Object.freeze({device,pulses:pulses.length,attempted:0,delivered:0,pattern:Object.freeze([]),gamepadEffects:0});
  let delivered=0;let attempted=0;let gamepadEffects=0;
  const pattern=patternFor(pulses);
  if(typeof sink.vibrate==='function'){attempted+=1;try{const result=sink.vibrate(pattern);if(result!==false)delivered+=1;}catch{}}
  if(sink.gamepad?.playEffect){for(const pulse of pulses.slice(0,3)){attempted+=1;try{await sink.gamepad.playEffect('dual-rumble',{startDelay:0,duration:Math.round(pulse.durationMs),weakMagnitude:clamp(pulse.amplitude),strongMagnitude:clamp(pulse.amplitude*0.85)});gamepadEffects+=1;delivered+=1;}catch{}}}
  return Object.freeze({device,pulses:pulses.length,attempted,delivered,pattern:Object.freeze(pattern),gamepadEffects});
}

export function resolveHapticChannel(device:CombatPresentationDevice):'none'|'vibrate'|'gamepad'{return device==='touch'?'vibrate':device==='gamepad'?'gamepad':device==='keyboard'||device==='mouse'?'none':'vibrate';}
export function validateCombatHapticDispatch(result:CombatHapticDispatchResult):boolean{return result.attempted>=0&&result.delivered>=0&&result.delivered<=result.attempted&&result.pulses>=0&&result.gamepadEffects>=0&&result.pattern.every((value)=>Number.isFinite(value)&&value>=0);}