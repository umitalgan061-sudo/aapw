/** Renderer-agnostic spatial audio intent for combat presentation consumers. */
import type { Vec3 } from './deterministicMath';

export interface CombatListenerPose { readonly position: Vec3; readonly forward: Vec3; readonly up?: Vec3; }
export interface CombatSpatialAudioConfig { readonly maxDistanceMeters:number; readonly rolloff:number; readonly stereoPanGain:number; readonly minVolume:number; readonly occlusionFloor:number; }
export interface CombatSpatialAudioState { readonly distanceMeters:number; readonly attenuation:number; readonly pan:number; readonly occlusion:number; readonly volumeMultiplier:number; readonly virtualPosition:Readonly<Vec3>; readonly spatialized:true; }

const DEFAULT:CombatSpatialAudioConfig=Object.freeze({maxDistanceMeters:18,rolloff:1.15,stereoPanGain:0.9,minVolume:0.04,occlusionFloor:0.25});
const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,finite(v,min)));
const length=(v:Vec3)=>Math.hypot(v.x,v.y,v.z);
const normalize=(v:Vec3):Vec3=>{const l=length(v);return l>1e-8?{x:v.x/l,y:v.y/l,z:v.z/l}:{x:0,y:0,z:1};};
const dot=(a:Vec3,b:Vec3)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a:Vec3,b:Vec3):Vec3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});

export function resolveCombatSpatialAudio(position:Vec3, listener:CombatListenerPose, occlusion=0, config:Partial<CombatSpatialAudioConfig>={}):CombatSpatialAudioState{
  const cfg=Object.freeze({...DEFAULT,...config});
  const delta={x:finite(position.x)-finite(listener.position.x),y:finite(position.y)-finite(listener.position.y),z:finite(position.z)-finite(listener.position.z)};
  const distance=length(delta);
  const direction=normalize(delta);
  const forward=normalize(listener.forward);
  const up=normalize(listener.up??{x:0,y:1,z:0});
  let right=normalize(cross(forward,up));
  if(length(right)<1e-8) right={x:1,y:0,z:0};
  const pan=clamp(dot(direction,right)*cfg.stereoPanGain,-1,1);
  const normalizedDistance=clamp(distance/Math.max(0.001,cfg.maxDistanceMeters));
  const attenuation=Math.max(cfg.minVolume,1-Math.pow(normalizedDistance,cfg.rolloff));
  const safeOcclusion=clamp(occlusion);
  const occlusionFactor=Math.max(cfg.occlusionFloor,1-safeOcclusion*0.75);
  return Object.freeze({distanceMeters:Number(distance.toFixed(3)),attenuation:Number(attenuation.toFixed(4)),pan:Number(pan.toFixed(4)),occlusion:Number(safeOcclusion.toFixed(4)),volumeMultiplier:Number((attenuation*occlusionFactor).toFixed(4)),virtualPosition:Object.freeze({x:Number(position.x.toFixed(3)),y:Number(position.y.toFixed(3)),z:Number(position.z.toFixed(3))}),spatialized:true});
}

export function applySpatialAudioToVolume(baseVolume:number,state:CombatSpatialAudioState):number{return Number(clamp(baseVolume*state.volumeMultiplier).toFixed(4));}
export function validateCombatSpatialAudio(state:CombatSpatialAudioState):boolean{return state.spatialized===true&&state.distanceMeters>=0&&state.attenuation>=0&&state.attenuation<=1&&state.pan>=-1&&state.pan<=1&&state.occlusion>=0&&state.occlusion<=1&&state.volumeMultiplier>=0&&state.volumeMultiplier<=1;}