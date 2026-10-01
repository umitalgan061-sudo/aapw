/** Presentation-only camera focus adapter; target selection remains owned by the existing combat targeting director. */
import type { Vec3 } from './deterministicMath';

export interface CombatFocusTarget { readonly id:string; readonly position:Vec3; readonly priority?:number; readonly healthRatio?:number; readonly distanceMeters?:number; readonly angleRadians?:number; readonly locked?:boolean; readonly targetable?:boolean; }
export interface CombatFocusConfig { readonly maxDistanceMeters:number; readonly maxFocusTargets:number; readonly lockBonus:number; readonly distanceWeight:number; readonly angleWeight:number; readonly priorityWeight:number; readonly healthWeight:number; readonly focusDamping:number; }
export interface CombatFocusResult { readonly targetId:string|null; readonly focusPoint:Readonly<Vec3>; readonly weight:number; readonly framingDistanceMeters:number; readonly yawBias:number; readonly pitchBias:number; readonly targetCount:number; readonly candidates:readonly Readonly<{id:string;score:number;weight:number}>[]; }

const DEFAULT:CombatFocusConfig=Object.freeze({maxDistanceMeters:20,maxFocusTargets:8,lockBonus:8,distanceWeight:4,angleWeight:2,priorityWeight:3,healthWeight:1,focusDamping:0.18});
const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,finite(v,min)));
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

export function resolveCombatCameraFocus(playerPosition:Vec3,playerForward:Vec3,targets:readonly CombatFocusTarget[],config:Partial<CombatFocusConfig>={}):CombatFocusResult{
  const cfg=Object.freeze({...DEFAULT,...config});
  const pf={x:finite(playerForward.x),y:finite(playerForward.y),z:finite(playerForward.z)};
  const plen=Math.hypot(pf.x,pf.z)||1; const fx=pf.x/plen,fz=pf.z/plen;
  const candidates=targets.filter(t=>t.targetable!==false).map(t=>{const d=t.distanceMeters??distance(playerPosition,t.position);const angle=t.angleRadians??Math.acos(clamp((t.position.x-playerPosition.x)*fx+(t.position.z-playerPosition.z)*fz,-1,1));const distTerm=1-clamp(d/Math.max(0.001,cfg.maxDistanceMeters));const angleTerm=1-clamp(angle/Math.PI);const score=(t.locked?cfg.lockBonus:0)+finite(t.priority)*cfg.priorityWeight+distTerm*cfg.distanceWeight+angleTerm*cfg.angleWeight+clamp(finite(t.healthRatio,1))*cfg.healthWeight;return {target:t,d,angle,score};}).filter(c=>c.d<=cfg.maxDistanceMeters).sort((a,b)=>b.score-a.score||a.d-b.d||a.angle-b.angle||a.target.id.localeCompare(b.target.id)).slice(0,cfg.maxFocusTargets);
  const winner=candidates[0]; if(!winner)return Object.freeze({targetId:null,focusPoint:Object.freeze({...playerPosition}),weight:0,framingDistanceMeters:0,yawBias:0,pitchBias:0,targetCount:0,candidates:Object.freeze([])});
  const total=Math.max(0.0001,candidates.reduce((sum,c)=>sum+Math.max(0,c.score),0));
  const weight=clamp(winner.score/total);
  const focusPoint=Object.freeze({x:(playerPosition.x+winner.target.position.x)*0.5,y:(playerPosition.y+winner.target.position.y)*0.5,z:(playerPosition.z+winner.target.position.z)*0.5});
  const yawBias=clamp(winner.angle/(Math.PI*0.75),-1,1);
  const pitchBias=clamp((winner.target.position.y-playerPosition.y)/Math.max(1,winner.d),-0.35,0.35);
  return Object.freeze({targetId:winner.target.id,focusPoint,weight:Math.round(weight*10000)/10000,framingDistanceMeters:Math.round(Math.max(2,winner.d*1.15)*1000)/1000,yawBias:Math.round(yawBias*10000)/10000,pitchBias:Math.round(pitchBias*10000)/10000,targetCount:candidates.length,candidates:Object.freeze(candidates.map(c=>Object.freeze({id:c.target.id,score:Math.round(c.score*10000)/10000,weight:Math.round((Math.max(0,c.score)/total)*10000)/10000}))) });
}

export function smoothCombatCameraFocus(previous:CombatFocusResult,current:CombatFocusResult,alpha:number):CombatFocusResult{
  const t=clamp(alpha);
  const focusPoint=Object.freeze({x:previous.focusPoint.x+(current.focusPoint.x-previous.focusPoint.x)*t,y:previous.focusPoint.y+(current.focusPoint.y-previous.focusPoint.y)*t,z:previous.focusPoint.z+(current.focusPoint.z-previous.focusPoint.z)*t});
  return Object.freeze({...current,focusPoint,weight:previous.weight+(current.weight-previous.weight)*t,framingDistanceMeters:previous.framingDistanceMeters+(current.framingDistanceMeters-previous.framingDistanceMeters)*t,yawBias:previous.yawBias+(current.yawBias-previous.yawBias)*t,pitchBias:previous.pitchBias+(current.pitchBias-previous.pitchBias)*t});
}

export function validateCombatCameraFocus(result:CombatFocusResult):boolean{return (result.targetId===null||result.targetId.length>0)&&Number.isFinite(result.weight)&&result.weight>=0&&result.weight<=1&&Number.isFinite(result.framingDistanceMeters)&&result.framingDistanceMeters>=0&&Number.isFinite(result.yawBias)&&Number.isFinite(result.pitchBias)&&Number.isFinite(result.focusPoint.x)&&Number.isFinite(result.focusPoint.y)&&Number.isFinite(result.focusPoint.z)&&result.candidates.length<=8;}