/** Bounded structured tracing with nested spans, counters, histograms and deterministic export. */
export type TraceSpanKindV15='internal'|'simulation'|'render'|'network'|'streaming'|'io';
export type TraceStatusV15='ok'|'error'|'cancelled';
export interface TraceSpanV15{readonly id:string;readonly parentId?:string;readonly name:string;readonly kind:TraceSpanKindV15;readonly startMs:number;readonly endMs:number;readonly durationMs:number;readonly frame:number;readonly tick:number;readonly status:TraceStatusV15;readonly tags:Readonly<Record<string,string|number|boolean>>;readonly attributes:Readonly<Record<string,string|number|boolean>>;}
export interface TraceCounterV15{readonly name:string;readonly value:number;readonly frame:number;readonly tick:number;readonly tags:Readonly<Record<string,string|number|boolean>>;}
export interface TraceHistogramV15{readonly name:string;readonly count:number;readonly min:number;readonly max:number;readonly average:number;readonly p50:number;readonly p95:number;readonly p99:number;}
export interface TraceSnapshotV15{readonly spans:readonly TraceSpanV15[];readonly counters:readonly TraceCounterV15[];readonly histograms:readonly TraceHistogramV15[];readonly dropped:number;readonly digest:string;}
export interface SpanHandleV15{readonly id:string;end(status?:TraceStatusV15):TraceSpanV15|undefined;setTag(key:string,value:string|number|boolean):void;setAttribute(key:string,value:string|number|boolean):void;}

const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;
const sanitize=(v:string,max=128)=>v.trim().slice(0,max);
const percentile=(values:readonly number[],p:number):number=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);const index=Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*p)-1));return sorted[index]??0;};

interface ActiveSpan{readonly id:string;readonly parentId?:string;readonly name:string;readonly kind:TraceSpanKindV15;readonly startMs:number;readonly frame:number;readonly tick:number;tags:Record<string,string|number|boolean>;attributes:Record<string,string|number|boolean>;}

export class TelemetryTraceV15{
  readonly #capacity:number;
  readonly #maxActive:number;
  readonly #now:()=>number;
  readonly #spans:TraceSpanV15[]=[];
  readonly #counters=new Map<string,TraceCounterV15>();
  readonly #histograms=new Map<string,number[]>();
  readonly #active=new Map<string,ActiveSpan>();
  #sequence=0;
  #dropped=0;

  constructor(options:{capacity?:number;maxActive?:number;clock?:()=>number}={}){this.#capacity=Math.max(128,Math.trunc(options.capacity??8192));this.#maxActive=Math.max(16,Math.trunc(options.maxActive??256));this.#now=options.clock??(()=>Date.now());}

  start(name:string,kind:TraceSpanKindV15,context:{frame:number;tick:number;parentId?:string;tags?:Readonly<Record<string,string|number|boolean>>}):SpanHandleV15|undefined{
    if(this.#active.size>=this.#maxActive)return undefined;
    const id='span-'+(++this.#sequence);
    const active:ActiveSpan={id,name:sanitize(name),kind,startMs:this.#now(),frame:Math.max(0,Math.trunc(context.frame)),tick:Math.max(0,Math.trunc(context.tick)),...(context.parentId?{parentId:context.parentId}:{}),tags:{...(context.tags??{})},attributes:{}};
    this.#active.set(id,active);
    return {id,end:(status='ok')=>this.#end(id,status),setTag:(key,value)=>{const span=this.#active.get(id);if(span)span.tags[sanitize(key)]=value;},setAttribute:(key,value)=>{const span=this.#active.get(id);if(span)span.attributes[sanitize(key)]=value;}};
  }

  scoped<T>(name:string,kind:TraceSpanKindV15,context:{frame:number;tick:number;parentId?:string;tags?:Readonly<Record<string,string|number|boolean>>},work:()=>T):T{
    const span=this.start(name,kind,context);
    try{const value=work();span?.end('ok');return value;}catch(error){span?.end('error');throw error;}
  }

  async scopedAsync<T>(name:string,kind:TraceSpanKindV15,context:{frame:number;tick:number;parentId?:string;tags?:Readonly<Record<string,string|number|boolean>>},work:()=>Promise<T>):Promise<T>{
    const span=this.start(name,kind,context);
    try{const value=await work();span?.end('ok');return value;}catch(error){span?.end('error');throw error;}
  }

  counter(name:string,delta=1,context:{frame?:number;tick?:number;tags?:Readonly<Record<string,string|number|boolean>>}={}):void{
    const key=sanitize(name)+'|'+JSON.stringify(context.tags??{});
    const previous=this.#counters.get(key);
    const value=(previous?.value??0)+finite(delta);
    const record=Object.freeze({name:sanitize(name),value,frame:Math.max(0,Math.trunc(context.frame??0)),tick:Math.max(0,Math.trunc(context.tick??0)),tags:Object.freeze({...context.tags})});
    this.#counters.set(key,record);
  }

  gauge(name:string,value:number,context:{frame?:number;tick?:number;tags?:Readonly<Record<string,string|number|boolean>>}={}):void{this.counter(name,0,context);const keys=[...this.#counters.keys()].filter((key)=>key.startsWith(sanitize(name)+'|'));for(const key of keys){const p=this.#counters.get(key);if(p)this.#counters.set(key,Object.freeze({...p,value:finite(value)}));}}

  observe(name:string,value:number):void{const key=sanitize(name);const list=this.#histograms.get(key)??[];list.push(finite(value));if(list.length>512)list.shift();this.#histograms.set(key,list);}

  endSpan(id:string,status:TraceStatusV15='ok'):TraceSpanV15|undefined{return this.#end(id,status);}

  snapshot():TraceSnapshotV15{
    const histograms:TraceHistogramV15[]=[];
    for(const [name,values] of this.#histograms){histograms.push(Object.freeze({name,count:values.length,min:values.length?Math.min(...values):0,max:values.length?Math.max(...values):0,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:0,p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99)}));}
    const counters=[...this.#counters.values()].sort((a,b)=>a.name.localeCompare(b.name)||JSON.stringify(a.tags).localeCompare(JSON.stringify(b.tags)));
    const digestInput=JSON.stringify({spans:this.#spans.slice(-256),counters,histograms});
    let hash=2166136261;for(let i=0;i<digestInput.length;i+=1){hash^=digestInput.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return Object.freeze({spans:Object.freeze([...this.#spans]),counters:Object.freeze(counters),histograms:Object.freeze(histograms.sort((a,b)=>a.name.localeCompare(b.name))),dropped:this.#dropped,digest:(hash>>>0).toString(16).padStart(8,'0')});
  }

  activeSpans():number{return this.#active.size;}
  recent(limit=128):readonly TraceSpanV15[]{return Object.freeze(this.#spans.slice(-Math.max(1,Math.trunc(limit))));}
  clear():void{this.#spans.length=0;this.#counters.clear();this.#histograms.clear();this.#active.clear();this.#sequence=0;this.#dropped=0;}

  #end(id:string,status:TraceStatusV15):TraceSpanV15|undefined{
    const active=this.#active.get(id);if(!active)return undefined;this.#active.delete(id);
    const end=this.#now();const span=Object.freeze({id:active.id,...(active.parentId?{parentId:active.parentId}:{}),name:active.name,kind:active.kind,startMs:active.startMs,endMs:end,durationMs:Math.max(0,end-active.startMs),frame:active.frame,tick:active.tick,status,tags:Object.freeze({...active.tags}),attributes:Object.freeze({...active.attributes})});
    if(this.#spans.length>=this.#capacity){this.#spans.shift();this.#dropped+=1;}this.#spans.push(span);this.observe('span:'+active.name,span.durationMs);return span;
  }
}

export const traceDigestV15=(snapshot:TraceSnapshotV15):string=>snapshot.digest;
