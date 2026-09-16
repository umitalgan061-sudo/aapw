import type { Disposable, RendererBackend } from './types';

export type RenderCommandKind='clear'|'draw'|'compute'|'copy'|'barrier'|'custom';
export interface RenderCommand{readonly id:string;readonly kind:RenderCommandKind;readonly pass:string;readonly costMs:number;readonly drawCalls:number;readonly dependencies:readonly string[];readonly optional:boolean;readonly enabled?:boolean;readonly execute?:()=>void|Promise<void>;}
export interface CompiledCommands{readonly commands:readonly RenderCommand[];readonly estimatedGpuMs:number;readonly drawCalls:number;readonly signature:string;readonly skipped:readonly string[];readonly backend:RendererBackend;}
export interface CommandBufferBudget{readonly maxGpuMs:number;readonly maxDrawCalls:number;readonly maxCommands:number;}

/** Deterministic command-buffer builder that can feed WebGPU or WebGL2 backend adapters. */
export class RenderCommandBuffer implements Disposable{
 private readonly backend:RendererBackend;private budget:CommandBufferBudget;private readonly commands=new Map<string,RenderCommand>();private disposed=false;
 constructor(backend:RendererBackend,budget:Partial<CommandBufferBudget>={}){this.backend=backend;this.budget={maxGpuMs:budget.maxGpuMs??12,maxDrawCalls:budget.maxDrawCalls??1800,maxCommands:budget.maxCommands??4096};}
 public configure(budget:Partial<CommandBufferBudget>):void{this.ensure();this.budget={...this.budget,...budget};}
 public push(command:RenderCommand):void{this.ensure();if(this.commands.has(command.id))throw new Error(`COMMAND_REDEFINED:${command.id}`);this.commands.set(command.id,{...command,dependencies:[...command.dependencies]});}
 public remove(id:string):boolean{this.ensure();return this.commands.delete(id);}
 public clear():void{this.ensure();this.commands.clear();}
 public compile():CompiledCommands{this.ensure();if(this.commands.size>this.budget.maxCommands)throw new Error('COMMAND_COUNT_LIMIT');const ordered=this.topological();const selected:RenderCommand[]=[];const skipped:string[]=[];let gpu=0;let draws=0;const enabled=new Set<string>();for(const command of ordered){if(command.enabled===false){skipped.push(command.id);continue;}const deps=command.dependencies.every(id=>enabled.has(id));const within=gpu+Math.max(0,command.costMs)<=this.budget.maxGpuMs&&draws+Math.max(0,command.drawCalls)<=this.budget.maxDrawCalls;if(!deps||(!within&&command.optional)){skipped.push(command.id);continue;}if(!within)throw new Error(`REQUIRED_COMMAND_BUDGET:${command.id}`);selected.push(command);enabled.add(command.id);gpu+=Math.max(0,command.costMs);draws+=Math.max(0,command.drawCalls);}return{commands:selected,estimatedGpuMs:gpu,drawCalls:draws,signature:this.signature(selected),skipped,backend:this.backend};}
 public async submit(compiled=this.compile()):Promise<void>{this.ensure();for(const command of compiled.commands)await command.execute?.();}
 public size():number{return this.commands.size;}
 public ids():readonly string[]{return[...this.commands.keys()].sort();}
 private topological():RenderCommand[]{const result:RenderCommand[]=[];const state=new Map<string,0|1|2>();const visit=(id:string):void=>{const status=state.get(id)??0;if(status===2)return;if(status===1)throw new Error(`COMMAND_GRAPH_CYCLE:${id}`);const command=this.commands.get(id);if(!command)throw new Error(`COMMAND_DEPENDENCY_MISSING:${id}`);state.set(id,1);for(const dep of[...command.dependencies].sort())visit(dep);state.set(id,2);result.push(command);};for(const command of this.commands.values())visit(command.id);return result;}
 private signature(commands:readonly RenderCommand[]):string{const text=JSON.stringify({backend:this.backend,budget:this.budget,commands:commands.map(command=>({id:command.id,kind:command.kind,pass:command.pass,costMs:command.costMs,drawCalls:command.drawCalls,dependencies:[...command.dependencies].sort()}))});let hash=2166136261;for(let i=0;i<text.length;i+=1)hash=Math.imul(hash^text.charCodeAt(i),16777619);return(hash>>>0).toString(16).padStart(8,'0');}
 private ensure():void{if(this.disposed)throw new Error('RENDER_COMMAND_BUFFER_DISPOSED');}
 public dispose():void{if(this.disposed)return;this.commands.clear();this.disposed=true;}
}

export interface IndirectDraw{readonly meshId:string;readonly instanceCount:number;readonly firstInstance:number;readonly materialKey:string;}
export class IndirectDrawPlanner{
 public plan(draws:readonly IndirectDraw[],maxInstances=8192):readonly IndirectDraw[]{let used=0;return[...draws].sort((a,b)=>a.materialKey.localeCompare(b.materialKey)||a.meshId.localeCompare(b.meshId)||a.firstInstance-b.firstInstance).filter(draw=>{const count=Math.max(0,Math.floor(draw.instanceCount));if(used+count>maxInstances)return false;used+=count;return true;}).map(draw=>({...draw,instanceCount:Math.max(0,Math.floor(draw.instanceCount))}));}
 public totalInstances(draws:readonly IndirectDraw[]):number{return draws.reduce((sum,draw)=>sum+Math.max(0,Math.floor(draw.instanceCount)),0);}
 public groupByMaterial(draws:readonly IndirectDraw[]):Readonly<Record<string,readonly IndirectDraw[]>>{const groups:Record<string,IndirectDraw[]>={};for(const draw of draws){const group=groups[draw.materialKey]??(groups[draw.materialKey]=[]);group.push({...draw});}for(const key of Object.keys(groups))groups[key]!.sort((a,b)=>a.meshId.localeCompare(b.meshId)||a.firstInstance-b.firstInstance);return groups;}
}

export interface BarrierResource{readonly id:string;readonly write:boolean;readonly stage:'vertex'|'fragment'|'compute'|'copy';}
export interface ResourceBarrierPlan{readonly resources:readonly string[];readonly barriers:readonly BarrierResource[];}
export const buildBarriers=(resources:readonly BarrierResource[]):ResourceBarrierPlan=>{const unique=new Map<string,BarrierResource>();for(const resource of resources){const previous=unique.get(resource.id);if(!previous||resource.write||previous.stage!==resource.stage)unique.set(resource.id,{...resource});}const barriers=[...unique.values()].sort((a,b)=>a.id.localeCompare(b.id)||a.stage.localeCompare(b.stage));return{resources:barriers.map(b=>b.id),barriers};};

export interface GpuTimestampSample{readonly name:string;readonly start:number;readonly end:number;}
export class GpuTimestampRing{
 private readonly capacity:number;private readonly samples:GpuTimestampSample[]=[];
 constructor(capacity=256){this.capacity=Math.max(16,Math.floor(capacity));}
 public push(sample:GpuTimestampSample):void{if(!Number.isFinite(sample.start)||!Number.isFinite(sample.end)||sample.end<sample.start)return;this.samples.push({...sample});if(this.samples.length>this.capacity)this.samples.shift();}
 public duration(name:string):number{const values=this.samples.filter(s=>s.name===name).map(s=>s.end-s.start);return values.reduce((a,b)=>a+b,0)/Math.max(1,values.length);}
 public latest():readonly GpuTimestampSample[]{return this.samples.slice(-64);}
 public clear():void{this.samples.length=0;}
}
