/** Animation-ready impact reaction intent derived from combat presentation cues. */
import type { CombatPresentationCue } from './combatPresentationV1';
type CombatReactionCue = Pick<CombatPresentationCue, 'id' | 'semantic' | 'intensity' |  'direction' | 'damageType'>;
import { getCombatDamageTypeProfile } from './combatPresentationDamageTypeV1';
import { normalize3, type Vec3 } from './deterministicMath';

export interface CombatReactionInput { readonly cue: CombatReactionCue; readonly targetForward?: Vec3; readonly targetVelocity?: Vec3; readonly targetPoiseRatio?: number; readonly targetGrounded?: boolean; }
export interface CombatReactionIntent { readonly cueId:string; readonly intensity:number; readonly recoilMeters:number; readonly recoilDirection:Readonly<Vec3>; readonly upperBodyAdditive:number; readonly lowerBodyStability:number; readonly pelvisCorrectionWeight:number; readonly footPlantWeight:number; readonly staggerLikelihood:number; readonly attackCancelRecommended:boolean; readonly animationLayer:'impact'|'stagger'|'death'|'dodge'; readonly damageFamily:string; readonly materialResponse:string; }

const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:min));
export function resolveCombatReactionIntent(input:CombatReactionInput):CombatReactionIntent{
  const {cue}=input; const p=getCombatDamageTypeProfile(cue.damageType as never);
  const targetForward=normalize3(input.targetForward??{x:0,y:0,z:1});
  const approach=normalize3(cue.direction);
  const reactionDirection=approach.x===0&&approach.y===0&&approach.z===0?{x:-targetForward.x,y:0,z:-targetForward.z}:{x:-approach.x,y:-approach.y,z:-approach.z};
  const poiseRatio=clamp(Number.isFinite(input.targetPoiseRatio??1)?Number(input.targetPoiseRatio):1);
  const grounded=input.targetGrounded!==false;
  const stagger=cue.semantic==='stagger'||(cue.poiseDamage??0)>0 && poiseRatio<0.2;
  const death=cue.semantic==='death';
  const dodge=cue.semantic==='dodge';
  const magnitude=clamp(cue.intensity*(0.7+Math.max(0,p.recoilBias-0.5)*0.4));
  const velocity=input.targetVelocity??{x:0,y:0,z:0};
  const velocityWeight=clamp(Math.hypot(velocity.x,velocity.y,velocity.z)/8);
  return Object.freeze({cueId:cue.id,intensity:Number(cue.intensity.toFixed(4)),recoilMeters:Number((magnitude*(0.06+velocityWeight*0.02)).toFixed(4)),recoilDirection:Object.freeze(reactionDirection),upperBodyAdditive:Number(clamp(magnitude*(stagger?1.0:0.72)).toFixed(4)),lowerBodyStability:Number(clamp((grounded?1:0.65)*(1-magnitude*0.45)).toFixed(4)),pelvisCorrectionWeight:Number(clamp(grounded?0.35+magnitude*0.35:0.12).toFixed(4)),footPlantWeight:Number(clamp(grounded?0.85-magnitude*0.25:0.2).toFixed(4)),staggerLikelihood:Number(clamp((1-poiseRatio)*0.7+(stagger?0.55:0)).toFixed(4)),attackCancelRecommended:death||stagger,animationLayer:death?'death':stagger?'stagger':dodge?'dodge':'impact',damageFamily:p.family,materialResponse:p.materialResponse});
}

export function validateCombatReactionIntent(intent:CombatReactionIntent):boolean{
  return intent.cueId.length>0&&Number.isFinite(intent.intensity)&&intent.intensity>=0&&intent.intensity<=1&&Number.isFinite(intent.recoilMeters)&&intent.recoilMeters>=0&&intent.recoilDirection.x===intent.recoilDirection.x&&intent.upperBodyAdditive>=0&&intent.upperBodyAdditive<=1&&intent.lowerBodyStability>=0&&intent.lowerBodyStability<=1&&intent.pelvisCorrectionWeight>=0&&intent.pelvisCorrectionWeight<=1&&intent.footPlantWeight>=0&&intent.footPlantWeight<=1&&intent.staggerLikelihood>=0&&intent.staggerLikelihood<=1;
}