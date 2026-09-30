/** Strict TypeScript closed-loop render-scale governor with hysteresis and dwell. */
export type DynamicResolutionTier='quality'|'balanced'|'performance'|'survival';
export type DynamicResolutionDirection='up'|'down'|'hold';
export interface DynamicResolutionPolicy{readonly id:string;readonly minScale:number;readonly maxScale:number;readonly defaultScale:number;readonly targetFrameMs:number;readonly criticalFrameMs:number;readonly hysteresisMs:number;readonly smoothingAlpha:number;readonly upscaleStep:number;readonly downscaleStep:number;readonly minDwellFrames:number;readonly maxDwellFrames:number;readonly thermalPenaltyScale:number;readonly dataSaverScale:number;}
export interface DynamicResolutionOptions{readonly policy?:Partial<DynamicResolutionPolicy>;readonly initialScale?:number;readonly initialFrameMs?:number;}
export interface DynamicResolutionInput{readonly frameMs?:number;readonly thermalPressure?:number;readonly visibility?:'visible'|'hidden'|string;readonly saveData?:boolean;readonly reducedMotion?:boolean;}
export interface DynamicResolutionSnapshot{readonly scale:number;readonly tier:DynamicResolutionTier;readonly smoothedFrameMs:number;readonly targetFrameMs:number;readonly direction:DynamicResolutionDirection;readonly dwellFrames:number;readonly frame:number;readonly forced:boolean;}
export interface DynamicResolutionGovernor{readonly update:(input?:DynamicResolutionInput)=>DynamicResolutionSnapshot;readonly snapshot:()=>DynamicResolutionSnapshot;readonly setForcedScale:(value?:number|null)=>DynamicResolutionSnapshot;readonly reset:()=>void;readonly scale:number;readonly tier:DynamicResolutionTier;}
const freeze=Object.freeze;
const finite=(value:unknown,fallback=0):number=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value:unknown,min:number,max:number):number=>Math.min(max,Math.max(min,finite(value,min)));
export const DYNAMIC_RESOLUTION_TIERS:readonly DynamicResolutionTier[]=freeze(['quality','balanced','performance','survival']);
export const DYNAMIC_RESOLUTION_POLICY:Readonly<DynamicResolutionPolicy>=freeze({id:'dynamic-resolution-governor-2026-09-v1',minScale:.55,maxScale:1,defaultScale:.85,targetFrameMs:16.67,criticalFrameMs:33.33,hysteresisMs:1.25,smoothingAlpha:.12,upscaleStep:.03,downscaleStep:.05,minDwellFrames:15,maxDwellFrames:90,thermalPenaltyScale:.9,dataSaverScale:.92});
function tierFor(scale:number,policy:DynamicResolutionPolicy):DynamicResolutionTier{if(scale<=policy.minScale+.04)return'survival';if(scale<=.72)return'performance';if(scale<=.9)return'balanced';return'quality';}
export function createDynamicResolutionGovernor(options:DynamicResolutionOptions={}):DynamicResolutionGovernor{
 const policy=freeze({...DYNAMIC_RESOLUTION_POLICY,...(options.policy??{})});
 let scale=clamp(options.initialScale??policy.defaultScale,policy.minScale,policy.maxScale),smoothedFrameMs=finite(options.initialFrameMs,policy.targetFrameMs),lastDirection:DynamicResolutionDirection='hold',dwellFrames=0,frame=0,forcedScale:number|null=null;
 const snapshot=():DynamicResolutionSnapshot=>freeze({scale:Number(scale.toFixed(4)),tier:tierFor(scale,policy),smoothedFrameMs:Number(smoothedFrameMs.toFixed(3)),targetFrameMs:policy.targetFrameMs,direction:lastDirection,dwellFrames,frame,forced:forcedScale!==null});
 const setForcedScale=(value:number|null=null):DynamicResolutionSnapshot=>{forcedScale=value===null?null:clamp(value,policy.minScale,policy.maxScale);if(forcedScale!==null)scale=forcedScale;return snapshot();};
 const update=(input:DynamicResolutionInput={}):DynamicResolutionSnapshot=>{
  frame+=1;dwellFrames+=1;
  const frameMs=Math.max(0,finite(input.frameMs,policy.targetFrameMs));smoothedFrameMs+=(frameMs-smoothedFrameMs)*clamp(policy.smoothingAlpha,.01,1);
  if(forcedScale!==null)return snapshot();
  const thermal=clamp(input.thermalPressure),visibility=input.visibility==='hidden'?.75:1,dataSaver=input.saveData?policy.dataSaverScale:1,pressureBudget=policy.targetFrameMs*visibility*dataSaver;
  const highPressure=smoothedFrameMs>pressureBudget+policy.hysteresisMs||thermal>=.75;
  const lowPressure=smoothedFrameMs<policy.targetFrameMs-policy.hysteresisMs&&thermal<.5;
  if(highPressure&&dwellFrames>=policy.minDwellFrames){const thermalScale=thermal>=.9?policy.thermalPenaltyScale:1;scale=clamp(scale-policy.downscaleStep*thermalScale,policy.minScale,policy.maxScale);lastDirection='down';dwellFrames=0;}
  else if(lowPressure&&dwellFrames>=Math.max(policy.minDwellFrames,Math.floor(policy.maxDwellFrames/2))){scale=clamp(scale+policy.upscaleStep,policy.minScale,policy.maxScale);lastDirection='up';dwellFrames=0;}
  else lastDirection='hold';
  return snapshot();
 };
 const reset=():void=>{scale=clamp(options.initialScale??policy.defaultScale,policy.minScale,policy.maxScale);smoothedFrameMs=finite(options.initialFrameMs,policy.targetFrameMs);lastDirection='hold';dwellFrames=0;frame=0;forcedScale=null;};
 return freeze({update,snapshot,setForcedScale,reset,get scale(){return scale;},get tier(){return tierFor(scale,policy);}}) as DynamicResolutionGovernor;
}
export interface DynamicResolutionRecommendationInput{readonly gpuMs?:number;readonly cpuMs?:number;readonly targetFrameMs?:number;readonly currentScale?:number;readonly thermalPressure?:number;}
export interface DynamicResolutionRecommendation{readonly pressure:number;readonly recommendedScale:number;readonly scaleDelta:number;}
export function recommendDynamicResolution({gpuMs=0,cpuMs=0,targetFrameMs=16.67,currentScale=.85,thermalPressure=0}:DynamicResolutionRecommendationInput={}):DynamicResolutionRecommendation{
 const total=Math.max(finite(gpuMs),finite(cpuMs),0),pressure=total/Math.max(1,finite(targetFrameMs,16.67)),thermal=clamp(thermalPressure);let scaleDelta=0;
 if(pressure>1.15||thermal>.8)scaleDelta=-.05;else if(pressure>1.02)scaleDelta=-.025;else if(pressure<.8&&thermal<.4)scaleDelta=.02;
 return freeze({pressure:Number(pressure.toFixed(3)),recommendedScale:Number(clamp(currentScale+scaleDelta,.55,1).toFixed(3)),scaleDelta});
}
