import type { EngineResult } from './types.js';

export const INPUT_KINDS=Object.freeze(['keyboard','pointer','touch','gamepad','xr','synthetic'] as const);
export type InputKind=(typeof INPUT_KINDS)[number];
export type InputPhase='start'|'update'|'end'|'cancel';

export interface InputVector{readonly x:number;readonly y:number;readonly z?:number;}
export interface InputSignal<T=unknown>{readonly id:number;readonly kind:InputKind;readonly action:string;readonly phase:InputPhase;readonly value:T;readonly timestamp:number;readonly source:string;readonly consumed:boolean;}
export interface InputBinding{readonly action:string;readonly kind:InputKind;readonly code:string;readonly scale:number;readonly deadZone:number;readonly priority:number;readonly enabled:boolean;}
export interface ActionState{readonly action:string;readonly value:number;readonly active:boolean;readonly pressedFrame:number;readonly releasedFrame:number;readonly source:string;}
export interface InputRouterOptions{readonly maxSignals?:number;readonly maxBindings?:number;readonly frameTime?:()=>number;readonly preventDefault?:boolean;}

const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
const dead=(v:number,d:number)=>Math.abs(v)<d?0:v;

export class TypedInputRouter{
 private readonly maxSignals:number;private readonly maxBindings:number;private readonly now:()=>number;private readonly preventDefault:boolean;
 private readonly bindings=new Map<string,InputBinding[]>();private readonly states=new Map<string,ActionState>();private readonly queue:InputSignal[]=[];private seq=0;private disposed=false;
 public constructor(options:InputRouterOptions={}){this.maxSignals=Math.max(64,Math.floor(options.maxSignals??4096));this.maxBindings=Math.max(16,Math.floor(options.maxBindings??512));this.now=options.frameTime??(()=>performance.now());this.preventDefault=options.preventDefault??false;}
 public bind(binding:InputBinding):EngineResult<void>{if(this.disposed)return{ok:false,meta:{status:'disposed',code:'INPUT_ROUTER_DISPOSED'}};if(!binding.action||!binding.code||binding.scale===0)return{ok:false,meta:{status:'invalid',code:'INPUT_BINDING_INVALID'}};const list=this.bindings.get(binding.code)??[];const total=[...this.bindings.values()].reduce((n,v)=>n+v.length,0);if(total>=this.maxBindings&&!list.some(x=>x.action===binding.action))return{ok:false,meta:{status:'overflow',code:'INPUT_BINDING_LIMIT'}};const next=list.filter(x=>!(x.action===binding.action&&x.kind===binding.kind));next.push(Object.freeze({...binding,scale:finite(binding.scale),deadZone:clamp(finite(binding.deadZone),0,0.99),priority:Math.floor(binding.priority)}));next.sort((a,b)=>b.priority-a.priority||a.action.localeCompare(b.action));this.bindings.set(binding.code,Object.freeze(next));return{ok:true,meta:{status:'ok',code:'INPUT_BOUND'}};}
 public unbind(action:string,code?:string):number{let removed=0;for(const [key,list] of this.bindings){const keep=list.filter(b=>!(b.action===action&&(!code||b.code===code)));removed+=list.length-keep.length;if(keep.length)this.bindings.set(key,Object.freeze(keep));else this.bindings.delete(key);}return removed;}
 public signal(kind:InputKind,action:string,value:number,phase:InputPhase,source='synthetic'):boolean{if(this.disposed||this.queue.length>=this.maxSignals)return false;const safe=clamp(finite(value),-1,1);this.queue.push(Object.freeze({id:++this.seq,kind,action,phase,value:safe,timestamp:this.now(),source,consumed:false}));return true;}
 public key(code:string,down:boolean,source='keyboard'):number{let count=0;for(const binding of this.bindings.get(code)??[]){if(binding.kind!=='keyboard'||!binding.enabled)continue;if(this.signal('keyboard',binding.action,down?binding.scale:0,down?'start':'end',source))count+=1;}return count;}
 public axis(code:string,value:number,source='gamepad'):number{let count=0;for(const binding of this.bindings.get(code)??[]){if(!binding.enabled)continue;const normalized=dead(clamp(value*binding.scale,-1,1),binding.deadZone);if(this.signal(binding.kind,binding.action,normalized,'update',source))count+=1;}return count;}
 public consume(frame:number):readonly InputSignal[]{if(this.disposed)return[];const output:InputSignal[]=[];while(this.queue.length&&output.length<this.maxSignals){const signal=this.queue.shift()!;const state=this.states.get(signal.action);const numeric=typeof signal.value==='number'?signal.value:0;this.states.set(signal.action,Object.freeze({action:signal.action,value:numeric,active:signal.phase!=='end'&&signal.phase!=='cancel'&&numeric!==0,pressedFrame:signal.phase==='start'?frame:state?.pressedFrame??-1,releasedFrame:signal.phase==='end'||signal.phase==='cancel'?frame:state?.releasedFrame??-1,source:signal.source}));output.push(signal);}return Object.freeze(output);}
 public action(action:string):ActionState{return this.states.get(action)??Object.freeze({action,value:0,active:false,pressedFrame:-1,releasedFrame:-1,source:'none'});}
 public snapshot():Readonly<Record<string,ActionState>>{const result:Record<string,ActionState>={};for(const key of [...this.states.keys()].sort())result[key]=this.states.get(key)!;return Object.freeze(result);}
 public applyPointer(code:string,value:number,phase:InputPhase,source='pointer'):number{return this.axis(code,value,source)|| (this.signal('pointer',code,value,phase,source)?1:0);}
 public applyTouch(action:string,x:number,y:number,phase:InputPhase,source='touch'):boolean{return this.signal('touch',action,clamp(Math.hypot(x,y),0,1),phase,source);}
 public applySynthetic(action:string,value:number,phase:InputPhase='update'):boolean{return this.signal('synthetic',action,value,phase,'synthetic');}
 public reset():void{this.queue.length=0;this.states.clear();}
 public dispose():void{if(this.disposed)return;this.disposed=true;this.reset();this.bindings.clear();}
}

export const finite=(v:number,fallback=0):number=>Number.isFinite(v)?v:fallback;
export const createTypedInputRouter=(options:InputRouterOptions={}):TypedInputRouter=>new TypedInputRouter(options);

export const DEFAULT_GAME_BINDINGS:readonly InputBinding[]=Object.freeze([
 {action:'move.forward',kind:'keyboard',code:'KeyW',scale:1,deadZone:0,priority:10,enabled:true},
 {action:'move.back',kind:'keyboard',code:'KeyS',scale:1,deadZone:0,priority:10,enabled:true},
 {action:'move.left',kind:'keyboard',code:'KeyA',scale:1,deadZone:0,priority:10,enabled:true},
 {action:'move.right',kind:'keyboard',code:'KeyD',scale:1,deadZone:0,priority:10,enabled:true},
 {action:'move.forward',kind:'keyboard',code:'ArrowUp',scale:1,deadZone:0,priority:9,enabled:true},
 {action:'move.back',kind:'keyboard',code:'ArrowDown',scale:1,deadZone:0,priority:9,enabled:true},
 {action:'move.left',kind:'keyboard',code:'ArrowLeft',scale:1,deadZone:0,priority:9,enabled:true},
 {action:'move.right',kind:'keyboard',code:'ArrowRight',scale:1,deadZone:0,priority:9,enabled:true},
 {action:'camera.primary',kind:'pointer',code:'Primary',scale:1,deadZone:0,priority:5,enabled:true},
 {action:'camera.secondary',kind:'pointer',code:'Secondary',scale:1,deadZone:0,priority:5,enabled:true},
] as const);
