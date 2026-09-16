import type { CapabilitySnapshot, EngineResult, FrameCommand } from './types.js';
import { ENTITY_ID, EVENT_NAME, FRAME_ID, SEQUENCE, TICK_ID } from './types.js';
import { RuntimeKernel } from './runtime.js';

export const APP_PHASES = Object.freeze(['boot','loading','world','simulation','render','ui','shutdown'] as const);
export type AppPhase = (typeof APP_PHASES)[number];
export interface AppClock { readonly frame:number; readonly tick:number; readonly deltaSeconds:number; readonly elapsedSeconds:number; }
export interface AppFrameStats { readonly frameMs:number; readonly cpuMs:number; readonly gpuMs:number; readonly drawCalls:number; readonly triangles:number; readonly visibleObjects:number; readonly textureBytes:number; }
export interface AppFault { readonly id:string; readonly phase:AppPhase; readonly severity:'warning'|'error'|'fatal'; readonly code:string; readonly message:string; readonly frame:number; readonly recoverable:boolean; }
export interface AppSnapshot { readonly revision:number; readonly seed:number; readonly phase:AppPhase; readonly clock:AppClock; readonly stats:AppFrameStats; readonly health:Readonly<Record<string,unknown>>; }
export interface LegacyHandle { readonly name:string; readonly loaded:boolean; readonly dispose?:()=>void; }
export interface TsFirstOptions { readonly runtime?:RuntimeKernel; readonly seed?:number; readonly maxFaults?:number; readonly maxCommandsPerFrame?:number; readonly legacy?:readonly LegacyHandle[]; }

const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;

export class TsFirstApplication {
 public readonly runtime:RuntimeKernel;public readonly capabilities:CapabilitySnapshot;
 private phase:AppPhase='boot';private revision=0;private disposed=false;private readonly seed:number;private readonly maxFaults:number;private readonly maxCommands:number;private readonly legacy:readonly LegacyHandle[];private faults:AppFault[]=[];
 private clock:AppClock=Object.freeze({frame:0,tick:0,deltaSeconds:0,elapsedSeconds:0});
 private stats:AppFrameStats=Object.freeze({frameMs:0,cpuMs:0,gpuMs:0,drawCalls:0,triangles:0,visibleObjects:0,textureBytes:0});
 public constructor(o:TsFirstOptions={}){this.runtime=o.runtime??new RuntimeKernel({telemetrySamples:8192,eventQueue:8192,commandHistory:8192});this.capabilities=this.runtime.capabilities;this.seed=Math.trunc(o.seed??0xA4F12026);this.maxFaults=Math.max(16,Math.floor(o.maxFaults??256));this.maxCommands=Math.max(32,Math.floor(o.maxCommandsPerFrame??2048));this.legacy=Object.freeze([...(o.legacy??[])]);this.runtime.initialize();this.transition('loading');}
 public get currentPhase(){return this.phase;}public get faultLog(){return this.faults;}public get currentRevision(){return this.revision;}
 public submit(command:FrameCommand):EngineResult<void>{if(this.disposed)return{ok:false,meta:{status:'disposed',code:'TS_FIRST_DISPOSED'}};if(command.id<0)return this.fail('COMMAND_INVALID','Negative sequence id',true);const r=this.runtime.submitCommand(command);if(!r.ok)this.record('COMMAND_REJECTED',r.meta.message??r.meta.code,'warning',true);return r;}
 public emit(name:string,payload:unknown):boolean{return!this.disposed&&Boolean(name)&&this.runtime.events.publish(EVENT_NAME(name),payload);}
 public advance(deltaSeconds:number):AppSnapshot{if(this.disposed)return this.capture();const delta=clamp(finite(deltaSeconds),0,.25);try{const frame=this.runtime.advance({deltaSeconds:delta});this.clock=Object.freeze({frame:Number(frame.frame.frame),tick:Number(frame.frame.tick),deltaSeconds:delta,elapsedSeconds:this.clock.elapsedSeconds+delta});this.stats=Object.freeze({...this.stats,frameMs:delta*1000,cpuMs:delta*1000});this.revision++;if(this.phase==='loading')this.transition('world');if(this.phase==='world')this.transition('simulation');return this.capture();}catch(e){this.record('FRAME_ADVANCE_FAILED',e instanceof Error?e.message:String(e),'error',true);return this.capture();}}
 public transition(next:AppPhase):boolean{if(this.disposed||next===this.phase)return false;const allowed:Readonly<Record<AppPhase,readonly AppPhase[]>>={boot:['loading','shutdown'],loading:['world','shutdown'],world:['simulation','shutdown'],simulation:['render','shutdown'],render:['ui','shutdown'],ui:['world','simulation','shutdown'],shutdown:[]};if(!allowed[this.phase].includes(next)){this.record('INVALID_PHASE_TRANSITION',`${this.phase}->${next}`,'warning',true);return false;}const from=this.phase;this.phase=next;this.revision++;this.emit('app:phase',{from,to:next,revision:this.revision});return true;}
 public setFrameStats(s:Partial<AppFrameStats>):void{if(this.disposed)return;this.stats=Object.freeze({frameMs:clamp(finite(s.frameMs??this.stats.frameMs),0,1000),cpuMs:clamp(finite(s.cpuMs??this.stats.cpuMs),0,1000),gpuMs:clamp(finite(s.gpuMs??this.stats.gpuMs),0,1000),drawCalls:Math.max(0,Math.floor(finite(s.drawCalls??this.stats.drawCalls))),triangles:Math.max(0,Math.floor(finite(s.triangles??this.stats.triangles))),visibleObjects:Math.max(0,Math.floor(finite(s.visibleObjects??this.stats.visibleObjects))),textureBytes:Math.max(0,Math.floor(finite(s.textureBytes??this.stats.textureBytes)))});}
 public drainCommands(limit=this.maxCommands):readonly FrameCommand[]{return Object.freeze([...this.runtime.commandBuffer.drain(Math.max(1,Math.min(this.maxCommands,Math.floor(limit))))]);}
 public capture():AppSnapshot{return Object.freeze({revision:this.revision,seed:this.seed,phase:this.phase,clock:this.clock,stats:this.stats,health:this.runtime.health});}
 public record(code:string,message:string,severity:AppFault['severity']='error',recoverable=false):AppFault{const f:AppFault=Object.freeze({id:`fault-${this.revision+this.faults.length+1}`,phase:this.phase,severity,code,message,frame:this.clock.frame,recoverable});this.faults=[...this.faults.slice(-(this.maxFaults-1)),f];return f;}
 public fail(code:string,message:string,recoverable:boolean):EngineResult<void>{this.record(code,message,recoverable?'error':'fatal',recoverable);return{ok:false,meta:{status:recoverable?'rejected':'invalid',code,message}};}
 public healthScore():number{let score=1;for(const f of this.faults)score-=f.severity==='fatal'?.35:f.severity==='error'?.08:.01;return clamp(score,0,1);}
 public diagnostics(){return Object.freeze({phase:this.phase,revision:this.revision,seed:this.seed,frame:this.clock.frame,tick:this.clock.tick,healthScore:this.healthScore(),faults:this.faults.length,webgpu:this.capabilities.webgpu,webgl2:this.capabilities.webgl2,legacy:this.legacy.filter(x=>x.loaded).map(x=>x.name)});}
 public dispose():void{if(this.disposed)return;this.disposed=true;for(const module of this.legacy){try{module.dispose?.();}catch(e){this.record('LEGACY_DISPOSE_FAILED',String(e),'warning',true);}}this.runtime.dispose();this.phase='shutdown';this.revision++;}
}

export const createTsFirstApplication=(o:TsFirstOptions={})=>new TsFirstApplication(o);
export const makeFrameCommand=(id:number,entity:string,tick:number,payload:Record<string,unknown>={}):FrameCommand=>({kind:'ts-first-frame',version:1,revision:1,id:SEQUENCE(Math.max(0,id|0)),entity:ENTITY_ID(entity),issuedAtTick:TICK_ID(Math.max(0,tick|0)),priority:0,type:'frame',payload:Object.freeze({...payload})});
export const identity={frame:(n:number)=>FRAME_ID(n),tick:(n:number)=>TICK_ID(n),sequence:(n:number)=>SEQUENCE(n)} as const;
