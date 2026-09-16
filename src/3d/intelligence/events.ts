import type { FactionId, TickNumber, Vec3, WorldEvent, WorldEventId, WorldEventKind } from './types.js';
import { clamp01, safeId } from './types.js';

export interface EventPolicy { readonly maxEvents:number; readonly maxPerTick:number; readonly minIntensity:number; readonly retentionTicks:number; readonly maxPayloadKeys:number; }
export interface EventQuery { readonly kinds?:readonly WorldEventKind[]; readonly faction?:FactionId; readonly sinceTick?:TickNumber; readonly untilTick?:TickNumber; readonly origin?:Vec3; readonly radius?:number; readonly tags?:readonly string[]; readonly minIntensity?:number; readonly limit?:number; }
export interface EventDelivery { readonly event:WorldEvent; readonly subscriberId:string; readonly deliveredTick:TickNumber; }
export interface EventSubscription { readonly id:string; readonly kinds?:readonly WorldEventKind[]; readonly tags?:readonly string[]; readonly radius?:number; readonly origin?:Vec3; readonly minIntensity?:number; readonly callback:(event:WorldEvent)=>void; }

export const defaultEventPolicy=():EventPolicy=>Object.freeze({maxEvents:1024,maxPerTick:64,minIntensity:0.01,retentionTicks:720,maxPayloadKeys:24});
const normalizePayload=(payload:Readonly<Record<string,string|number|boolean>>,max:number):Readonly<Record<string,string|number|boolean>>=>Object.freeze(Object.fromEntries(Object.entries(payload).sort(([a],[b])=>a.localeCompare(b)).slice(0,max)));
const validEvent=(event:WorldEvent,policy:EventPolicy):boolean=>Boolean(event.id&&event.kind&&Number.isSafeInteger(event.tick)&&Number(event.tick)>=0&&Number.isFinite(event.radius)&&event.radius>=0&&Number.isFinite(event.intensity)&&event.intensity>=policy.minIntensity);

export class WorldEventJournal{
  readonly #events:WorldEvent[]=[];readonly #byId=new Map<string,WorldEvent>();readonly #policy:EventPolicy;readonly #subs=new Map<string,EventSubscription>();readonly #deliveries:EventDelivery[]=[];#disposed=false;#lastTick=0;
  constructor(policy=defaultEventPolicy()){this.#policy=Object.freeze({...policy});}
  append(event:WorldEvent):boolean{
    if(this.#disposed||!validEvent(event,this.#policy)||this.#byId.has(String(event.id)))return false;
    const perTick=this.#events.reduce((n,e)=>n+(Number(e.tick)===Number(event.tick)?1:0),0);if(perTick>=this.#policy.maxPerTick)return false;
    const normalized=Object.freeze({...event,tags:Object.freeze([...event.tags].sort()),payload:normalizePayload(event.payload,this.#policy.maxPayloadKeys)});this.#events.push(normalized);this.#byId.set(String(event.id),normalized);this.#lastTick=Math.max(this.#lastTick,Number(event.tick));while(this.#events.length>this.#policy.maxEvents){const old=this.#events.shift();if(old)this.#byId.delete(String(old.id));}this.#deliver(normalized);return true;
  }
  appendMany(events:readonly WorldEvent[]):number{let n=0;for(const e of events)n+=this.append(e)?1:0;return n;}
  get(id:WorldEventId|string):WorldEvent|undefined{return this.#byId.get(String(id));}
  query(q:EventQuery={}):readonly WorldEvent[]{if(this.#disposed)return [];let out=[...this.#events];if(q.kinds?.length)out=out.filter(e=>q.kinds!.includes(e.kind));if(q.faction)out=out.filter(e=>e.sourceFaction===q.faction);if(q.sinceTick!==undefined)out=out.filter(e=>Number(e.tick)>=Number(q.sinceTick));if(q.untilTick!==undefined)out=out.filter(e=>Number(e.tick)<=Number(q.untilTick));if(q.minIntensity!==undefined)out=out.filter(e=>e.intensity>=q.minIntensity!);if(q.tags?.length)out=out.filter(e=>q.tags!.every(t=>e.tags.includes(t)));if(q.origin&&q.radius!==undefined){const r2=q.radius*q.radius;out=out.filter(e=>(e.origin.x-q.origin!.x)**2+(e.origin.y-q.origin!.y)**2+(e.origin.z-q.origin!.z)**2<=r2);}out.sort((a,b)=>Number(b.tick)-Number(a.tick)||b.intensity-a.intensity||String(a.id).localeCompare(String(b.id)));return q.limit===undefined?Object.freeze(out):Object.freeze(out.slice(0,Math.max(0,Math.floor(q.limit))));}
  subscribe(sub:EventSubscription):()=>void{if(this.#disposed)return()=>{};if(!sub.id.trim())throw new TypeError('Subscription id required');this.#subs.set(sub.id,Object.freeze({...sub,kinds:sub.kinds?Object.freeze([...sub.kinds]):undefined,tags:sub.tags?Object.freeze([...sub.tags].sort()):undefined}));return()=>this.#subs.delete(sub.id);}
  prune(nowTick:TickNumber):number{if(this.#disposed)return 0;const cutoff=Number(nowTick)-this.#policy.retentionTicks;let removed=0;while(this.#events.length&&Number(this.#events[0]!.tick)<cutoff){const old=this.#events.shift()!;this.#byId.delete(String(old.id));removed+=1;}return removed;}
  values():readonly WorldEvent[]{return Object.freeze([...this.#events]);}
  deliveries():readonly EventDelivery[]{return Object.freeze([...this.#deliveries]);}
  clear():void{this.#events.length=0;this.#byId.clear();this.#deliveries.length=0;}
  dispose():void{this.#disposed=true;this.clear();this.#subs.clear();}
  get size():number{return this.#events.length;}
  #deliver(event:WorldEvent):void{for(const sub of this.#subs.values()){if(sub.kinds?.length&&!sub.kinds.includes(event.kind))continue;if(sub.tags?.length&&!sub.tags.every(t=>event.tags.includes(t)))continue;if(sub.minIntensity!==undefined&&event.intensity<sub.minIntensity)continue;if(sub.origin&&sub.radius!==undefined){const r2=sub.radius*sub.radius;if((event.origin.x-sub.origin.x)**2+(event.origin.y-sub.origin.y)**2+(event.origin.z-sub.origin.z)**2>r2)continue;}sub.callback(event);this.#deliveries.push(Object.freeze({event,subscriberId:sub.id,deliveredTick:event.tick}));while(this.#deliveries.length>this.#policy.maxEvents)this.#deliveries.shift();}}
}

export function createWorldEvent(id:string,kind:WorldEventKind,tick:number,origin:Vec3,radius:number,intensity:number,payload:Readonly<Record<string,string|number|boolean>>={},tags:readonly string[]=[]):WorldEvent{return Object.freeze({id:safeId<WorldEventId>(id,'WorldEventId'),kind,tick:tick as TickNumber,origin,radius:Math.max(0,radius),intensity:clamp01(intensity),tags:Object.freeze([...tags].sort()),payload:Object.freeze({...payload})});}
export function eventDigest(events:readonly WorldEvent[]):number{let h=2166136261;for(const e of [...events].sort((a,b)=>Number(a.tick)-Number(b.tick)||String(a.id).localeCompare(String(b.id)))){h^=String(e.id).length;h=Math.imul(h,16777619);h^=Number(e.tick)&0xffffffff;h=Math.imul(h,16777619);h^=Math.floor(e.intensity*1000000);h=Math.imul(h,16777619);}return h>>>0;}

export interface EventCoalescerOptions { readonly windowTicks:number; readonly maxMergedIntensity:number; }
export class EventCoalescer{
  readonly #options:EventCoalescerOptions;readonly #pending=new Map<string,WorldEvent>();
  constructor(options:EventCoalescerOptions={windowTicks:4,maxMergedIntensity:1}){this.#options=options;}
  offer(event:WorldEvent):WorldEvent|undefined{const key=`${event.kind}:${event.sourceFaction??''}:${event.tags.join(',')}`;const prior=this.#pending.get(key);if(prior&&Number(event.tick)-Number(prior.tick)<=this.#options.windowTicks){const merged=Object.freeze({...prior,tick:event.tick,intensity:clamp01(prior.intensity+event.intensity*this.#options.maxMergedIntensity),radius:Math.max(prior.radius,event.radius),origin:event.origin,payload:Object.freeze({...prior.payload,...event.payload})});this.#pending.set(key,merged);return undefined;}this.#pending.set(key,event);return prior;}
  flush():readonly WorldEvent[]{const out=[...this.#pending.values()].sort((a,b)=>Number(a.tick)-Number(b.tick)||String(a.id).localeCompare(String(b.id)));this.#pending.clear();return Object.freeze(out);}
}
