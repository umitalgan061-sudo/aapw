import type { AdaptiveQualityState, FrameId, QualityTier, Vector3Like } from './types';

export interface CameraLimits { readonly near:number;readonly far:number;readonly fovDegrees:number;readonly maxDpr:number;readonly minResolutionScale:number;readonly maxResolutionScale:number; }
export interface CameraPose { readonly position:Vector3Like;readonly target:Vector3Like;readonly up:Vector3Like; }
export interface CameraFrameState { readonly frameId:FrameId;readonly pose:CameraPose;readonly fovDegrees:number;readonly near:number;readonly far:number;readonly dpr:number;readonly resolutionScale:number;readonly jitter:{x:number;y:number};readonly projectionSignature:string; }
export interface CameraPolicyOptions { readonly limits?:Partial<CameraLimits>;readonly defaultQuality?:QualityTier; }

/** Modern camera policy with adaptive resolution, safe clipping and temporal jitter sequencing. */
export class CameraFramePolicy {
 private readonly limits:CameraLimits;private quality:QualityTier;private resolutionScale=1;private frame=0;private disposed=false;private lastSignature='';
 constructor(options:CameraPolicyOptions={}){const l=options.limits??{};this.limits={near:Math.max(.001,l.near??.05),far:Math.max(10,l.far??20000),fovDegrees:Math.min(150,Math.max(25,l.fovDegrees??70)),maxDpr:Math.min(3,Math.max(1,l.maxDpr??2)),minResolutionScale:Math.min(.95,Math.max(.35,l.minResolutionScale??.55)),maxResolutionScale:Math.min(1.5,Math.max(.7,l.maxResolutionScale??1))};this.quality=options.defaultQuality??'high';}
 public beginFrame(frameId:FrameId,pose:CameraPose,viewport:{width:number;height:number},quality:AdaptiveQualityState):CameraFrameState{this.ensure();this.frame=Number(frameId);this.quality=quality.tier;this.resolutionScale=Math.min(this.limits.maxResolutionScale,Math.max(this.limits.minResolutionScale,quality.resolutionScale));const dpr=Math.min(this.limits.maxDpr,Math.max(.5,typeof devicePixelRatio==='number'?devicePixelRatio:1))*this.resolutionScale;const jitter=halton2D(this.frame%16+1);const fov=quality.tier==='safe'?Math.min(this.limits.fovDegrees,68):this.limits.fovDegrees;const signature=JSON.stringify({frame:this.frame,viewport:{w:viewport.width,h:viewport.height},dpr:Number(dpr.toFixed(3)),fov,near:this.limits.near,far:this.limits.far,jitter});this.lastSignature=signature;return{frameId,pose:clonePose(pose),fovDegrees:fov,near:this.limits.near,far:this.limits.far,dpr,resolutionScale:this.resolutionScale,jitter,projectionSignature:hash(signature)};}
 public shouldUpdateProjection(previous:CameraFrameState|null,next:CameraFrameState):boolean{if(!previous)return true;return previous.projectionSignature!==next.projectionSignature||previous.fovDegrees!==next.fovDegrees||previous.near!==next.near||previous.far!==next.far;}
 public recommendedClipPlanes(bounds:{distance:number;radius:number}):{near:number;far:number}{const distance=Math.max(this.limits.near,bounds.distance),radius=Math.max(.01,bounds.radius);return{near:Math.max(this.limits.near,distance-radius*2),far:Math.min(this.limits.far,Math.max(distance+radius*2,this.limits.near+10))};}
 public qualityTier():QualityTier{return this.quality;}
 public lastProjectionSignature():string{return this.lastSignature;}
 public setResolutionScale(scale:number):number{this.ensure();this.resolutionScale=Math.min(this.limits.maxResolutionScale,Math.max(this.limits.minResolutionScale,Number.isFinite(scale)?scale:1));return this.resolutionScale;}
 private ensure():void{if(this.disposed)throw new Error('CAMERA_POLICY_DISPOSED');}
 public dispose():void{if(this.disposed)return;this.disposed=true;}
}

export interface ShakeImpulse { readonly amplitude:number;readonly frequency:number;readonly durationSeconds:number;readonly decay:'linear'|'smooth'|'exponential'; }
export class CameraShakeMixer {
 private readonly impulses:ShakeImpulse[]=[];private elapsed=0;private disposed=false;
 public add(impulse:ShakeImpulse):void{this.ensure();if(impulse.amplitude<=0||impulse.frequency<=0||impulse.durationSeconds<=0)return;this.impulses.push({...impulse});}
 public sample(deltaSeconds:number):Vector3Like{this.ensure();this.elapsed+=Math.max(0,deltaSeconds);let x=0,y=0,z=0;for(const impulse of this.impulses){const t=this.elapsed%impulse.durationSeconds;const ratio=1-t/impulse.durationSeconds;const decay=impulse.decay==='linear'?ratio:impulse.decay==='smooth'?ratio*ratio*(3-2*ratio):ratio*ratio;const phase=t*impulse.frequency*6.28318530718;const amplitude=impulse.amplitude*decay;x+=Math.sin(phase*1.07)*amplitude;y+=Math.cos(phase*.83)*amplitude;z+=Math.sin(phase*.59)*amplitude*.5;}for(let i=this.impulses.length-1;i>=0;i-=1)if(this.elapsed>=this.impulses[i]!.durationSeconds)this.impulses.splice(i,1);return{x,y,z};}
 public clear():void{this.impulses.length=0;this.elapsed=0;}
 public size():number{return this.impulses.length;}
 private ensure():void{if(this.disposed)throw new Error('CAMERA_SHAKE_DISPOSED');}public dispose():void{if(this.disposed)return;this.clear();this.disposed=true;}
}

export interface LpvSample { readonly position:Vector3Like;readonly importance:number;readonly visible:boolean; }
export interface ExposureState { readonly target:number;readonly current:number;readonly adaptationSpeed:number;readonly changed:boolean; }
export class ExposureController {
 private target=1;private current=1;private readonly speed:number;private disposed=false;
 constructor(adaptationSpeed=.08){this.speed=Math.min(1,Math.max(.001,adaptationSpeed));}
 public setTarget(value:number):void{this.ensure();this.target=Math.min(4,Math.max(.05,Number.isFinite(value)?value:1));}
 public update(deltaSeconds:number):ExposureState{this.ensure();const blend=1-Math.exp(-this.speed*Math.max(0,deltaSeconds)*60);const before=this.current;this.current+=(this.target-this.current)*blend;return{target:this.target,current:this.current,adaptationSpeed:this.speed,changed:Math.abs(before-this.current)>1e-5};}
 public value():number{return this.current;}
 private ensure():void{if(this.disposed)throw new Error('EXPOSURE_CONTROLLER_DISPOSED');}public dispose():void{this.disposed=true;}
}

export interface FramingResult { readonly distance:number;readonly radius:number;readonly fits:boolean; }
export const frameSphere=(fovDegrees:number,aspect:number,radius:number,margin=1.15):FramingResult=>{const r=Math.max(.01,radius)*Math.max(1,margin),vertical=Math.max(1,fovDegrees)*Math.PI/180,horizontal=2*Math.atan(Math.tan(vertical/2)*Math.max(.01,aspect));const limiting=Math.min(vertical,horizontal);const distance=r/Math.max(.01,Math.tan(limiting/2));return{distance,radius:r,fits:true};};
export const damp=(current:number,target:number,sharpness:number,deltaSeconds:number):number=>current+(target-current)*(1-Math.exp(-Math.max(0,sharpness)*Math.max(0,deltaSeconds)));
const clonePose=(pose:CameraPose):CameraPose=>({position:{...pose.position},target:{...pose.target},up:{...pose.up}});
const halton=(index:number,base:number):number=>{let value=0,fraction=1/base,n=index;while(n>0){value+=(n%base)*fraction;n=Math.floor(n/base);fraction/=base;}return value;};
const halton2D=(index:number):{x:number;y:number}=>({x:halton(index,2)-.5,y:halton(index,3)-.5});
const hash=(value:string):string=>{let h=2166136261;for(let i=0;i<value.length;i+=1)h=Math.imul(h^value.charCodeAt(i),16777619);return(h>>>0).toString(16).padStart(8,'0');};
