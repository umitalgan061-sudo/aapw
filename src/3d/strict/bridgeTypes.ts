import type { CameraCollisionCandidate } from './cameraRuntime.ts';
export interface LegacyVectorLike { readonly x:number; readonly y:number; readonly z:number; }
export interface LegacyEulerLike { readonly x?:number; readonly y?:number; readonly z?:number; }
export interface LegacyGamepadLike { readonly connected?:boolean; readonly index?:number; readonly mapping?:string; readonly axes?:readonly number[]; readonly buttons?:readonly { readonly pressed?:boolean; readonly value?:number }[]; }
export interface LegacyInputApi { readonly getAxes?:()=>{readonly forward?:number;readonly strafe?:number;readonly running?:boolean;readonly guarding?:boolean;readonly jumpRequested?:boolean;readonly lockOnRequested?:boolean;readonly lookX?:number;readonly lookY?:number;readonly cameraZoom?:number}; readonly dispose?:()=>void; }
export interface LegacyAssetApi { readonly loadModel?: (url:string,options?:Record<string,unknown>)=>Promise<unknown>; readonly loadTexture?: (url:string)=>Promise<unknown>; readonly disposeObject3D?: (object:unknown)=>void; }
export interface LegacyRenderApi { readonly getRendererBackend?:()=>string; readonly getPixelRatio?:()=>number; readonly getSize?:()=>{readonly width:number;readonly height:number}; }
export interface LegacyRuntimeContext { readonly input?:LegacyInputApi; readonly assets?:LegacyAssetApi; readonly render?:LegacyRenderApi; readonly canvas?:unknown; }
export type LegacyCollisionCandidate = CameraCollisionCandidate;