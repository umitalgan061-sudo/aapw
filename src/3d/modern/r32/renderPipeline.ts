import {RuntimeError,TaskPriority,clampFinite} from './contracts.ts';

export type RenderPassKind='opaque'|'transparent'|'shadow'|'postprocess'|'ui'|'debug'|'compute'|'copy';
export type RenderResourceKind='texture'|'buffer'|'depth'|'uniform';
export type RenderPhase='prepare'|'geometry'|'lighting'|'effects'|'composite'|'overlay';
export interface RenderTargetSize{readonly width:number;readonly height:number;readonly scale:number;}
export interface RenderResourceDescriptor{readonly id:string;readonly kind:RenderResourceKind;readonly format:string;readonly width:number;readonly height:number;readonly samples:number;readonly persistent?:boolean;}
export interface RenderResource{readonly descriptor:RenderResourceDescriptor;readonly byteEstimate:number;readonly firstUse:number;readonly lastUse:number;}
export interface RenderPassContext{readonly frame:number;readonly deltaSeconds:number;readonly target:RenderTargetSize;readonly resources:ReadonlyMap<string,RenderResource>;readonly command:(name:string,payload?:unknown)=>void;}
export interface RenderPassResult{readonly submitted:boolean;readonly commands:number;readonly milliseconds:number;readonly bytesWritten:number;}
export interface RenderPass{readonly id:string;readonly phase:RenderPhase;readonly kind:RenderPassKind;readonly priority:TaskPriority;readonly reads?:readonly string[];readonly writes?:readonly string[];readonly after?:readonly string[];readonly enabled?:boolean;readonly estimatedMilliseconds:number;readonly execute:(context:RenderPassContext)=>RenderPassResult;}
export interface RenderPipelineOptions{readonly maxPasses:number;readonly maxCommands:number;readonly softMilliseconds:number;readonly hardMilliseconds:number;readonly maxTransientBytes:number;readonly clock:()=>number;}
export interface RenderFrameReport{readonly frame:number;readonly passCount:number;readonly executedPasses:number;readonly skippedPasses:number;readonly commandCount:number;readonly milliseconds:number;readonly transientBytes:number;readonly overSoftBudget:boolean;readonly overHardBudget:boolean;readonly executionOrder:readonly string[];}
interface PassEntry{readonly pass:RenderPass;registration:number;}
const DEFAULT:RenderPipelineOptions={maxPasses:128,maxCommands:8192,softMilliseconds:6,hardMilliseconds:10,maxTransientBytes:128*1024*1024,clock:()=>performance.now()};

export class RenderPipelineR32{
  readonly #options:RenderPipelineOptions;
  readonly #passes=new Map<string,PassEntry>();
  readonly #resources=new Map<string,RenderResourceDescriptor>();
  readonly #compiled:string[]=[];
  #registration=0;
  #dirty=true;
  #frame=0;
  #target:RenderTargetSize={width:1,height:1,scale:1};
  #lastReport:RenderFrameReport|null=null;

  constructor(options:Partial<RenderPipelineOptions>={}){this.#options={...DEFAULT,...options};}
  get target():RenderTargetSize{return this.#target;}
  registerPass(pass:RenderPass):()=>void{
    if(!pass.id.trim())throw new RuntimeError({code:'R32_RENDER_PASS_ID',message:'Render pass id cannot be empty'});
    if(this.#passes.has(pass.id))throw new RuntimeError({code:'R32_RENDER_PASS_DUP',message:'Render pass already registered: '+pass.id});
    if(this.#passes.size>=this.#options.maxPasses)throw new RuntimeError({code:'R32_RENDER_PASS_LIMIT',message:'Render pass limit exceeded'});
    this.#passes.set(pass.id,{pass,registration:++this.#registration});this.#dirty=true;
    return()=>{if(this.#passes.delete(pass.id))this.#dirty=true;};
  }
  registerResource(descriptor:RenderResourceDescriptor):()=>void{
    if(descriptor.width<=0||descriptor.height<=0||descriptor.samples<1)throw new RuntimeError({code:'R32_RENDER_RESOURCE_DIMENSIONS',message:'Render resource dimensions are invalid'});
    if(this.#resources.has(descriptor.id))throw new RuntimeError({code:'R32_RENDER_RESOURCE_DUP',message:'Render resource already registered: '+descriptor.id});
    this.#resources.set(descriptor.id,descriptor);this.#dirty=true;return()=>{this.#resources.delete(descriptor.id);this.#dirty=true;};
  }
  resize(width:number,height:number,scale=1):RenderTargetSize{
    const normalizedWidth=Math.max(1,Math.floor(width)),normalizedHeight=Math.max(1,Math.floor(height)),normalizedScale=clampFinite(scale,.25,2);
    this.#target={width:normalizedWidth,height:normalizedHeight,scale:normalizedScale};return this.#target;
  }
  compile():readonly string[]{
    const entries=[...this.#passes.values()].filter(e=>e.pass.enabled!==false);
    const indegree=new Map<string,number>(),edges=new Map<string,Set<string>>();
    for(const entry of entries){indegree.set(entry.pass.id,0);edges.set(entry.pass.id,new Set());}
    const addEdge=(from:string,to:string)=>{if(from===to||!indegree.has(from)||!indegree.has(to))return;if(edges.get(from)?.has(to))return;edges.get(from)?.add(to);indegree.set(to,(indegree.get(to)??0)+1);};
    for(const entry of entries){
      for(const dep of entry.pass.after??[])addEdge(dep,entry.pass.id);
      const reads=new Set(entry.pass.reads??[]);
      for(const other of entries){
        if(other.pass.id===entry.pass.id)continue;
        const writes=other.pass.writes??[];
        if(writes.some(resource=>reads.has(resource)))addEdge(other.pass.id,entry.pass.id);
      }
    }
    const ready=entries.filter(e=>(indegree.get(e.pass.id)??0)===0).sort((a,b)=>this.#compare(a,b)).map(e=>e.pass.id);
    const order:string[]=[];
    while(ready.length){const id=ready.shift()!;order.push(id);for(const next of edges.get(id)??[]){const left=(indegree.get(next)??0)-1;indegree.set(next,left);if(left===0)ready.push(next);}ready.sort((a,b)=>this.#compare(this.#passes.get(a)!,this.#passes.get(b)!));}
    if(order.length!==entries.length)throw new RuntimeError({code:'R32_RENDER_CYCLE',message:'Render graph contains a dependency cycle',recoverable:false});
    this.#compiled.length=0;this.#compiled.push(...order);this.#dirty=false;return this.#compiled.slice();
  }
  inspect():readonly {id:string;phase:RenderPhase;kind:RenderPassKind;estimatedMilliseconds:number;enabled:boolean;}[]{
    return [...this.#passes.values()].sort((a,b)=>this.#compare(a,b)).map(e=>({id:e.pass.id,phase:e.pass.phase,kind:e.pass.kind,estimatedMilliseconds:e.pass.estimatedMilliseconds,enabled:e.pass.enabled!==false}));
  }
  execute(deltaSeconds:number):RenderFrameReport{
    if(this.#dirty)this.compile();
    this.#frame+=1;
    const start=this.#options.clock();let commands=0;let executed=0;let skipped=0;const order:string[]=[];const commandLog:string[]=[];
    const resources=this.#allocateResources();
    const context:RenderPassContext={frame:this.#frame,deltaSeconds:Math.max(0,deltaSeconds),target:this.#target,resources,command:(name,payload)=>{if(commands>=this.#options.maxCommands)throw new RuntimeError({code:'R32_RENDER_COMMAND_LIMIT',message:'Render command limit exceeded'});commands+=1;commandLog.push(payload===undefined?name:name+':'+String(payload));}};
    for(const id of this.#compiled){
      const entry=this.#passes.get(id);if(!entry||entry.pass.enabled===false){skipped+=1;continue;}
      const projected=(this.#options.clock()-start)+entry.pass.estimatedMilliseconds;
      if(projected>this.#options.hardMilliseconds){skipped+=1;continue;}
      const result=entry.pass.execute(context);executed+=Number(result.submitted);if(!result.submitted)skipped+=1;order.push(id);
      commands+=Math.max(0,result.commands-1);
    }
    const milliseconds=Math.max(0,this.#options.clock()-start);
    const transientBytes=[...resources.values()].filter(r=>!r.descriptor.persistent).reduce((sum,r)=>sum+r.byteEstimate,0);
    this.#lastReport={frame:this.#frame,passCount:this.#compiled.length,executedPasses:executed,skippedPasses:skipped,commandCount:commands,milliseconds,transientBytes,overSoftBudget:milliseconds>this.#options.softMilliseconds,overHardBudget:milliseconds>this.#options.hardMilliseconds,executionOrder:order};
    if(commandLog.length>this.#options.maxCommands)throw new RuntimeError({code:'R32_RENDER_COMMANDS',message:'Command log exceeded budget'});
    return this.#lastReport;
  }
  lastReport():RenderFrameReport|null{return this.#lastReport;}
  invalidate():void{this.#dirty=true;}
  clearTransientResources():void{for(const [id,resource] of this.#resources)if(!resource.persistent)this.#resources.delete(id);this.#dirty=true;}
  #allocateResources():Map<string,RenderResource>{
    const lifetimes=new Map<string,{first:number;last:number;descriptor:RenderResourceDescriptor}>();
    this.#compiled.forEach((passIndex,id)=>{const pass=this.#passes.get(id)?.pass;if(!pass)return;for(const resourceId of [...(pass.reads??[]),...(pass.writes??[])]){const descriptor=this.#resources.get(resourceId);if(!descriptor)continue;const current=lifetimes.get(resourceId);if(current){lifetimes.set(resourceId,{...current,last:passIndex});}else lifetimes.set(resourceId,{first:passIndex,last:passIndex,descriptor});}});
    const resources=new Map<string,RenderResource>();
    for(const [id,life] of lifetimes){const bytes=this.#estimateBytes(life.descriptor);resources.set(id,{descriptor:life.descriptor,byteEstimate:bytes,firstUse:life.first,lastUse:life.last});}
    const transient=[...resources.values()].filter(r=>!r.descriptor.persistent).reduce((sum,r)=>sum+r.byteEstimate,0);
    if(transient>this.#options.maxTransientBytes)throw new RuntimeError({code:'R32_RENDER_TRANSIENT_BUDGET',message:'Transient render resource budget exceeded',metadata:{bytes:transient,limit:this.#options.maxTransientBytes}});
    return resources;
  }
  #estimateBytes(d:RenderResourceDescriptor):number{const channels=d.format.includes('rgba')?4:d.format.includes('rg')?2:1;const depth=d.kind==='depth'?4:channels;return d.width*d.height*depth*Math.max(1,d.samples);}
  #compare(a:PassEntry|undefined,b:PassEntry|undefined):number{
    if(!a||!b)return 0;
    const phaseRank:Record<RenderPhase,number>={prepare:0,geometry:1,lighting:2,effects:3,composite:4,overlay:5};
    const phase=(phaseRank[a.pass.phase]??0)-(phaseRank[b.pass.phase]??0);if(phase)return phase;
    const priority=a.pass.priority.localeCompare(b.pass.priority);if(priority)return priority;
    const cost=a.pass.estimatedMilliseconds-b.pass.estimatedMilliseconds;if(cost)return cost;return a.registration-b.registration;
  }
  dispose():void{this.#passes.clear();this.#resources.clear();this.#compiled.length=0;this.#dirty=true;this.#lastReport=null;}
}

export interface RenderPreset{readonly id:string;readonly scale:number;readonly msBudget:number;readonly maxTransientBytes:number;readonly enabledPasses:readonly string[];}
export const R32_RENDER_PRESETS:readonly RenderPreset[]=[
  {id:'cinematic',scale:1,msBudget:10,maxTransientBytes:256*1024*1024,enabledPasses:['*']},
  {id:'high',scale:.9,msBudget:9,maxTransientBytes:192*1024*1024,enabledPasses:['*']},
  {id:'balanced',scale:.8,msBudget:7.5,maxTransientBytes:128*1024*1024,enabledPasses:['*']},
  {id:'performance',scale:.7,msBudget:5.5,maxTransientBytes:96*1024*1024,enabledPasses:['*']},
  {id:'mobile',scale:.6,msBudget:4.5,maxTransientBytes:64*1024*1024,enabledPasses:['geometry','lighting','composite','ui']},
];

export function chooseRenderPreset(deviceMemoryGb:number,coarsePointer:boolean):RenderPreset{
  if(coarsePointer||deviceMemoryGb<4)return R32_RENDER_PRESETS.find(p=>p.id==='mobile')!;
  if(deviceMemoryGb<8)return R32_RENDER_PRESETS.find(p=>p.id==='balanced')!;
  if(deviceMemoryGb<12)return R32_RENDER_PRESETS.find(p=>p.id==='high')!;
  return R32_RENDER_PRESETS.find(p=>p.id==='cinematic')!;
}

export function createMinimalRenderPipeline():RenderPipelineR32{
  const pipeline=new RenderPipelineR32();
  pipeline.registerPass({id:'prepare',phase:'prepare',kind:'copy',priority:'critical',writes:['frame'],estimatedMilliseconds:.2,execute:()=>({submitted:true,commands:1,milliseconds:.2,bytesWritten:0})});
  pipeline.registerPass({id:'geometry',phase:'geometry',kind:'opaque',priority:'high',after:['prepare'],reads:['frame'],writes:['color','depth'],estimatedMilliseconds:2,execute:c=>{c.command('draw-geometry');return{submitted:true,commands:1,milliseconds:2,bytesWritten:1024};}});
  pipeline.registerPass({id:'lighting',phase:'lighting',kind:'compute',priority:'high',after:['geometry'],reads:['color','depth'],writes:['lit'],estimatedMilliseconds:2,execute:c=>{c.command('shade');return{submitted:true,commands:1,milliseconds:2,bytesWritten:1024};}});
  pipeline.registerPass({id:'composite',phase:'composite',kind:'postprocess',priority:'normal',after:['lighting'],reads:['lit'],writes:['screen'],estimatedMilliseconds:1,execute:c=>{c.command('composite');return{submitted:true,commands:1,milliseconds:1,bytesWritten:1024};}});
  return pipeline;
}
