/** Quality shedding policy for combat presentation under frame pressure. */
import type { CombatPresentationDevice } from './combatPresentationV1';
export type CombatPresentationQuality='cinematic'|'balanced'|'reduced';
export interface CombatPresentationQualityInput{readonly frameP95Ms:number;readonly pendingQueue:number;readonly droppedCues:number;readonly reducedMotion:boolean;readonly device:CombatPresentationDevice;}
export interface CombatPresentationQualityDecision{readonly quality:CombatPresentationQuality;readonly vfxScale:number;readonly cameraScale:number;readonly hapticScale:number;readonly audioScale:number;readonly preserveCritical:boolean;readonly reason:string;}

const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:min));
export function resolveCombatPresentationQuality(input:CombatPresentationQualityInput):CombatPresentationQualityDecision{
  const pressure=Math.max(clamp((input.frameP95Ms-12)/8),clamp(input.pendingQueue/64),clamp(input.droppedCues/12));
  const reduced=input.reducedMotion;
  if(pressure>=0.7)return Object.freeze({quality:'reduced',vfxScale:0.45,cameraScale:reduced?0.08:0.3,hapticScale:0.75,audioScale:0.8,preserveCritical:true,reason:'presentation-pressure-high'});
  if(pressure>=0.28||input.device==='touch')return Object.freeze({quality:'balanced',vfxScale:0.75,cameraScale:reduced?0.18:0.6,hapticScale:0.9,audioScale:0.9,preserveCritical:true,reason:pressure>=0.28?'presentation-pressure':'touch-budget'});
  return Object.freeze({quality:'cinematic',vfxScale:1,cameraScale:reduced?0.25:1,hapticScale:1,audioScale:1,preserveCritical:true,reason:'within-budget'});
}

export function applyCombatPresentationQuality(decision:CombatPresentationQualityDecision,cue:{readonly intensity:number;readonly priority:number}):Readonly<{intensity:number;cameraScale:number;hapticScale:number;audioScale:number;preserved:boolean}>{
  const critical=cue.priority>=3 && decision.preserveCritical;
  return Object.freeze({intensity:clamp(cue.intensity*(critical?Math.max(0.9,decision.vfxScale):decision.vfxScale)),cameraScale:decision.cameraScale,hapticScale:decision.hapticScale,audioScale:decision.audioScale,preserved:critical});
}