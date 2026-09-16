import type { AdaptiveQualityState, DeviceCapabilities, FrameMetrics, RuntimeError } from './types';

export interface DiagnosticsSnapshot { readonly timestamp:number;readonly frame:FrameMetrics;readonly quality:AdaptiveQualityState;readonly capabilities:DeviceCapabilities;readonly errors:readonly RuntimeError[];readonly warnings:readonly string[];readonly memory:MemoryDiagnostics; }
export interface MemoryDiagnostics { readonly jsHeapUsedBytes:number|null;readonly jsHeapLimitBytes:number|null;readonly residentAssetBytes:number;readonly heapPressure:number|null; }
export interface DiagnosticsOptions { readonly maxErrors?:number;readonly maxWarnings?:number;readonly now?:()=>number; }

/** Bounded runtime diagnostics suitable for a developer overlay and crash reports. */
export class RuntimeDiagnostics {
 private readonly maxErrors:number;private readonly maxWarnings:number;private readonly now:()=>number;private readonly errors:RuntimeError[]=[];private readonly warnings:string[]=[];private frame:FrameMetrics|null=null;private quality:AdaptiveQualityState|null=null;private capabilities:DeviceCapabilities|null=null;private residentAssetBytes=0;private disposed=false;
 constructor(options:DiagnosticsOptions={}){this.maxErrors=Math.max(8,Math.floor(options.maxErrors??64));this.maxWarnings=Math.max(8,Math.floor(options.maxWarnings??64));this.now=options.now??Date.now;}
 public setCapabilities(value:DeviceCapabilities):void{this.ensure();this.capabilities=value;}
 public recordFrame(frame:FrameMetrics,quality:AdaptiveQualityState,residentAssetBytes=0):void{this.ensure();this.frame=frame;this.quality=quality;this.residentAssetBytes=Math.max(0,residentAssetBytes);if(frame.cpuMs>16.7)this.warn('cpu-frame-budget');if(frame.gpuMs!==null&&frame.gpuMs>16.7)this.warn('gpu-frame-budget');if(frame.droppedTasks>0)this.warn('scheduler-deferred-work');}
 public error(error:RuntimeError):void{this.ensure();this.errors.push(error);if(this.errors.length>this.maxErrors)this.errors.shift();}
 public warn(message:string):void{this.ensure();const value=message.replace(/[^a-zA-Z0-9_.:-]/g,'_').slice(0,120);if(!value)return;this.warnings.push(value);if(this.warnings.length>this.maxWarnings)this.warnings.shift();}
 public memory():MemoryDiagnostics{const performanceMemory=(globalThis.performance as Performance&{memory?:{usedJSHeapSize:number;jsHeapSizeLimit:number}})?.memory;const used=performanceMemory?.usedJSHeapSize??null;const limit=performanceMemory?.jsHeapSizeLimit??null;return{jsHeapUsedBytes:used,jsHeapLimitBytes:limit,residentAssetBytes:this.residentAssetBytes,heapPressure:used!==null&&limit?used/limit:null};}
 public snapshot():DiagnosticsSnapshot{this.ensure();return{timestamp:this.now(),frame:this.frame??zeroFrame(),quality:this.quality??defaultQuality(),capabilities:this.capabilities??fallbackCapabilities(),errors:[...this.errors],warnings:[...this.warnings],memory:this.memory()};}
 public clear():void{this.errors.length=0;this.warnings.length=0;}
 private ensure():void{if(this.disposed)throw new Error('RUNTIME_DIAGNOSTICS_DISPOSED');}
 public dispose():void{if(this.disposed)return;this.clear();this.disposed=true;}
}
const zeroFrame=():FrameMetrics=>({frameId:0 as any,timestamp:0 as any,deltaMs:0,cpuMs:0,gpuMs:null,drawCalls:0,triangles:0,visibleObjects:0,activeAnimations:0,residentBytes:0,droppedTasks:0});
const defaultQuality=():AdaptiveQualityState=>({tier:'high',resolutionScale:1,shadowDistance:180,foliageDensity:1,effectsLevel:1,reason:'diagnostics-default'});
const fallbackCapabilities=():DeviceCapabilities=>({webgpu:false,webgl2:false,offscreenCanvas:false,sharedArrayBuffer:false,crossOriginIsolated:false,deviceMemoryGb:null,hardwareConcurrency:1,maxTextureSize:null,maxSamples:null,powerPreference:'default'});
