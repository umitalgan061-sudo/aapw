/** Typed event router with bounded queues, wildcard diagnostics and listener isolation. */
export interface RuntimeEventV15<T=unknown>{readonly id:string;readonly type:string;readonly frame:number;readonly tick:number;readonly timestampMs:number;readonly payload:T;readonly source:string;}
export type EventHandlerV15<T=unknown>=(event:RuntimeEventV15<T>)=>void|Promise<void>;
export interface EventSubscriptionV15{readonly id:string;readonly type:string;readonly unsubscribe:()=>void;readonly delivered:number;}
export interface EventRouterOptionsV15{readonly capacity?:number;readonly maxHandlersPerType?:number;readonly now?:()=>number;}

const sanitize=(v:string,max=96)=>v.trim().slice(0,max);

interface HandlerEntry{readonly id:string;readonly type:string;readonly handler:EventHandlerV15;delivered:number;failures:number;}

export class RuntimeEventRouterV15{
  readonly #capacity:number;readonly #maxHandlers:number;readonly #now:()=>number;
  readonly #queue:RuntimeEventV15[]=[];readonly #handlers=new Map<string,Map<string,HandlerEntry>>();readonly #history:RuntimeEventV15[]=[];
  #sequence=0;#dropped=0;#dispatching=false;
  constructor(options:EventRouterOptionsV15={}){this.#capacity=Math.max(64,Math.trunc(options.capacity??4096));this.#maxHandlers=Math.max(1,Math.trunc(options.maxHandlersPerType??64));this.#now=options.now??(()=>Date.now());}

  subscribe<T>(type:string,handler:EventHandlerV15<T>):EventSubscriptionV15{
    const normalized=sanitize(type);if(!normalized)throw new Error('Event type is required.');
    let handlers=this.#handlers.get(normalized);if(!handlers){handlers=new Map();this.#handlers.set(normalized,handlers);}
    if(handlers.size>=this.#maxHandlers)throw new Error('Event handler capacity reached for '+normalized);
    const id='handler-'+(++this.#sequence);const entry:HandlerEntry={id,type:normalized,handler:handler as EventHandlerV15,delivered:0,failures:0};handlers.set(id,entry);
    return Object.freeze({id,type:normalized,unsubscribe:()=>{if(handlers?.get(id)===entry)handlers.delete(id);},get delivered(){return entry.delivered;}}) as EventSubscriptionV15;
  }

  emit<T>(type:string,payload:T,context:{frame?:number;tick?:number;source?:string;timestampMs?:number}={}):RuntimeEventV15<T>{
    const event=Object.freeze({id:'event-'+(++this.#sequence),type:sanitize(type),frame:Math.max(0,Math.trunc(context.frame??0)),tick:Math.max(0,Math.trunc(context.tick??0)),timestampMs:Math.max(0,Math.trunc(context.timestampMs??this.#now())),payload,source:sanitize(context.source??'runtime')}) as RuntimeEventV15<T>;
    if(this.#queue.length>=this.#capacity){this.#queue.shift();this.#dropped+=1;}this.#queue.push(event as RuntimeEventV15);this.#history.push(event as RuntimeEventV15);if(this.#history.length>this.#capacity)this.#history.shift();
    return event;
  }

  async dispatch(maxEvents=Infinity):Promise<number>{
    if(this.#dispatching)return 0;this.#dispatching=true;let delivered=0;
    try{while(this.#queue.length&&delivered<maxEvents){const event=this.#queue.shift()!;const handlers=[...(this.#handlers.get(event.type)?.values()??[]),...(this.#handlers.get('*')?.values()??[])].sort((a,b)=>a.id.localeCompare(b.id));for(const handler of handlers){try{await handler.handler(event);handler.delivered+=1;}catch{handler.failures+=1;}}delivered+=1;}}finally{this.#dispatching=false;}return delivered;
  }

  pending():number{return this.#queue.length;}
  dropped():number{return this.#dropped;}
  history(limit=256):readonly RuntimeEventV15[]{return Object.freeze(this.#history.slice(-Math.max(1,Math.trunc(limit))));}
  handlers():readonly Readonly<Record<string,unknown>>[]{const out:Readonly<Record<string,unknown>>[]=[];for(const [type,entries] of this.#handlers)for(const handler of entries.values())out.push(Object.freeze({id:handler.id,type,delivered:handler.delivered,failures:handler.failures}));return Object.freeze(out.sort((a,b)=>String(a.id).localeCompare(String(b.id))));}
  clear():void{this.#queue.length=0;this.#history.length=0;this.#dropped=0;}
  reset():void{this.clear();this.#handlers.clear();this.#sequence=0;}
}

export const runtimeEventNameV15=(domain:string,event:string):string=>sanitize(domain)+':'+sanitize(event);
