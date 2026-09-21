/** Render graph with pass dependencies, resource lifetimes and deterministic culling. */
export type RenderPassKindV15='shadow'|'depth'|'opaque'|'transparent'|'post'|'ui'|'present';
export interface RenderResourceV15{readonly id:string;readonly bytes:number;readonly format:string;readonly transient:boolean;readonly external:boolean;}
export interface RenderPassV15{readonly id:string;readonly kind:RenderPassKindV15;readonly priority:number;readonly dependsOn:readonly string[];readonly reads:readonly string[];readonly writes:readonly string[];readonly enabled:()=>boolean;readonly execute:(context:RenderPassContextV15)=>void;}
export interface RenderPassContextV15{readonly frame:number;readonly tick:number;readonly qualityScale:number;readonly resources:ReadonlyMap<string,RenderResourceV15>;}
export interface RenderGraphReportV15{readonly order:readonly string[];readonly executed:readonly string[];readonly skipped:readonly string[];readonly failed:readonly string[];readonly peakTransientBytes:number;readonly drawCalls:number;readonly passes:number;readonly durationMs:number;}

const passOrder=(a:RenderPassV15,b:RenderPassV15)=>a.priority-b.priority||a.id.localeCompare(b.id);

export class RenderGraphV15{
  readonly #passes=new Map<string,RenderPassV15>();readonly #resources=new Map<string,RenderResourceV15>();#qualityScale=1;
  addResource(resource:RenderResourceV15):()=>void{if(this.#resources.has(resource.id))throw new Error('Render resource already exists: '+resource.id);this.#resources.set(resource.id,Object.freeze({...resource,bytes:Math.max(0,Math.trunc(resource.bytes))}));return()=>this.#resources.delete(resource.id);}
  addPass(pass:RenderPassV15):()=>void{if(this.#passes.has(pass.id))throw new Error('Render pass already exists: '+pass.id);for(const resource of [...pass.reads,...pass.writes])if(!this.#resources.has(resource))throw new Error('Render pass references unknown resource: '+resource);this.#passes.set(pass.id,Object.freeze({...pass,dependsOn:Object.freeze([...pass.dependsOn]),reads:Object.freeze([...pass.reads]),writes:Object.freeze([...pass.writes])}));return()=>this.#passes.delete(pass.id);}
  removePass(id:string):boolean{return this.#passes.delete(id);}
  setQualityScale(scale:number):void{this.#qualityScale=Math.min(1,Math.max(.5,Number.isFinite(scale)?scale:1));}
  qualityScale():number{return this.#qualityScale;}
  validate():readonly string[]{const errors:string[]=[];for(const pass of this.#passes.values())for(const dep of pass.dependsOn)if(!this.#passes.has(dep))errors.push(pass.id+' depends on missing pass '+dep);try{this.order();}catch(error){errors.push(error instanceof Error?error.message:String(error));}return Object.freeze([...new Set(errors)]);}
  order():readonly RenderPassV15[]{const pending=new Map(this.#passes);const result:RenderPassV15[]=[];while(pending.size){const ready=[...pending.values()].filter(p=>p.dependsOn.every(id=>result.some(done=>done.id===id))).sort(passOrder);if(!ready.length)throw new Error('Render graph contains a dependency cycle.');for(const pass of ready){result.push(pass);pending.delete(pass.id);}}return Object.freeze(result);}

  execute(frame:number,tick:number):RenderGraphReportV15{
    const started=typeof performance!=='undefined'?performance.now():Date.now();const executed:string[]=[];const skipped:string[]=[];const failed:string[]=[];const resources=this.#resources;let transient=0,peak=0,drawCalls=0;
    for(const pass of this.order()){if(!pass.enabled()){skipped.push(pass.id);continue;}try{pass.execute(Object.freeze({frame,tick,qualityScale:this.#qualityScale,resources}));executed.push(pass.id);drawCalls+=1;for(const id of pass.writes){const r=resources.get(id);if(r?.transient)transient+=r.bytes;}peak=Math.max(peak,transient);}catch{failed.push(pass.id);} }
    const released=new Set<string>();for(const pass of this.order()){for(const id of pass.reads){const usedLater=this.order().some(other=>other.id!==pass.id&&other.reads.includes(id)&&this.order().indexOf(other)>this.order().indexOf(pass));if(!usedLater){const r=resources.get(id);if(r?.transient&&!released.has(id)){transient=Math.max(0,transient-r.bytes);released.add(id);}}}}
    const duration=Math.max(0,(typeof performance!=='undefined'?performance.now():Date.now())-started);return Object.freeze({order:Object.freeze(this.order().map(p=>p.id)),executed:Object.freeze(executed),skipped:Object.freeze(skipped),failed:Object.freeze(failed),peakTransientBytes:peak,drawCalls,passes:this.#passes.size,durationMs:duration});
  }

  resources():readonly RenderResourceV15[]{return Object.freeze([...this.#resources.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
  passes():readonly RenderPassV15[]{return Object.freeze([...this.order()]);}
  reset():void{this.#passes.clear();this.#resources.clear();this.#qualityScale=1;}
}

export const estimateTransientMemoryV15=(resources:readonly RenderResourceV15[]):number=>resources.filter(r=>r.transient&&!r.external).reduce((sum,r)=>sum+r.bytes,0);
export const renderPassEnabledForQualityV15=(scale:number,minimum:number):boolean=>Math.max(0,Math.min(1,scale))>=Math.max(0,Math.min(1,minimum));
