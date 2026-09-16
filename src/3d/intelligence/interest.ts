import type { ActorSnapshot, InterestCandidate, InterestTier, RegionInterest, TickNumber, WorldEvent, Vec3 } from './types.js';
import { clamp01, distanceSq } from './types.js';

export interface InterestPoint { readonly id:string; readonly position:Vec3; readonly importance:number; readonly tags:readonly string[]; readonly available:boolean; readonly dynamic?:boolean; }
export interface InterestPolicy { readonly radius:number; readonly criticalRadius:number; readonly maxCandidates:number; readonly maxPoints:number; readonly visibleWeight:number; readonly dangerWeight:number; readonly freshnessWeight:number; }
export interface InterestSource { list(center:Vec3,radius:number):readonly InterestPoint[]; }
export const defaultInterestPolicy=():InterestPolicy=>Object.freeze({radius:96,criticalRadius:18,maxCandidates:24,maxPoints:512,visibleWeight:0.4,dangerWeight:0.3,freshnessWeight:0.3});

const tier=(score:number,radius:number,critical:number):InterestTier=>score>=0.86||radius<=critical?'critical':score>=0.62?'high':score>=0.32?'normal':score>=0.12?'low':'sleeping';
const reason=(point:InterestPoint,actor:ActorSnapshot,d:number):string=>{const tags=point.tags.join(',');return `${tags||'interest'}:${d.toFixed(1)}:${actor.stance}`;};
function candidate(actor:ActorSnapshot,point:InterestPoint,policy:InterestPolicy,dist:number,seed:number):InterestCandidate{const distanceScore=1-clamp01(dist/policy.radius);const tagScore=clamp01(point.importance);const dynamicScore=point.dynamic?0.12:0;const jitter=((seed%97)/97)*0.0001;const score=clamp01(distanceScore*policy.visibleWeight+tagScore*policy.dangerWeight+(0.5+dynamicScore)*policy.freshnessWeight+jitter);return Object.freeze({id:point.id,position:point.position,score,tier:tier(score,dist,policy.criticalRadius),reason:reason(point,actor,dist),tags:Object.freeze([...point.tags])});}

export class DeterministicInterestMap implements InterestSource{
  readonly #points=new Map<string,InterestPoint>();#disposed=false;
  upsert(point:InterestPoint):void{if(this.#disposed||!point.id)return;this.#points.set(point.id,Object.freeze({...point,tags:Object.freeze([...point.tags])}));}
  remove(id:string):boolean{if(this.#disposed)return false;return this.#points.delete(id);}
  list(center:Vec3,radius:number):readonly InterestPoint[]{if(this.#disposed)return [];const r=Math.max(0,radius),r2=r*r;return [...this.#points.values()].filter(p=>p.available&&distanceSq(p.position,center)<=r2).sort((a,b)=>b.importance-a.importance||a.id.localeCompare(b.id));}
  clear():void{this.#points.clear();}
  dispose():void{this.#disposed=true;this.clear();}
  get size():number{return this.#points.size;}
}

export function buildRegionInterest(actor:ActorSnapshot,tick:TickNumber,source:InterestSource,policy=defaultInterestPolicy(),seed=0):RegionInterest{
  const points=source.list(actor.position,policy.radius).slice(0,policy.maxPoints);const candidates=points.map((p,i)=>candidate(actor,p,policy,Math.sqrt(distanceSq(actor.position,p.position)),seed+i)).filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,policy.maxCandidates);const high=candidates.filter(c=>c.tier==='critical'||c.tier==='high').length;const tierValue:InterestTier=high>=3?'critical':high>=1?'high':candidates.length?'normal':'sleeping';return Object.freeze({actorId:actor.id,tick,center:actor.position,radius:policy.radius,tier:tierValue,candidates:Object.freeze(candidates)});
}

export interface InterestSubscription { readonly actorId:string; readonly radius:number; readonly tags:readonly string[]; readonly callback:(interest:RegionInterest)=>void; }
export class InterestBroker{
  readonly #subscriptions=new Map<string,InterestSubscription>();readonly #source:InterestSource;#disposed=false;
  constructor(source:InterestSource){this.#source=source;}
  subscribe(s:InterestSubscription):()=>void{if(this.#disposed)return()=>{};this.#subscriptions.set(s.actorId,Object.freeze({...s,tags:Object.freeze([...s.tags])}));return()=>this.#subscriptions.delete(s.actorId);}
  publish(actors:readonly ActorSnapshot[],tick:TickNumber,policy=defaultInterestPolicy(),seed=0):number{if(this.#disposed)return 0;let emitted=0;for(const actor of actors){const s=this.#subscriptions.get(String(actor.id));if(!s)continue;const p={...policy,radius:Math.min(policy.radius,s.radius),maxCandidates:policy.maxCandidates};const interest=buildRegionInterest(actor,tick,this.#source,p,seed);const filtered=s.tags.length?Object.freeze({...interest,candidates:Object.freeze(interest.candidates.filter(c=>s.tags.some(tag=>c.tags.includes(tag))))}):interest;s.callback(filtered);emitted+=1;}return emitted;}
  clear():void{this.#subscriptions.clear();}
  dispose():void{this.#disposed=true;this.clear();}
}

export interface HeatSample { readonly position:Vec3; readonly intensity:number; readonly tick:TickNumber; readonly radius:number; readonly category:string; }
export class WorldHeatmap{
  readonly #samples:HeatSample[]=[];readonly #max:number;#disposed=false;
  constructor(max=256){this.#max=Math.max(1,Math.floor(max));}
  add(sample:HeatSample):void{if(this.#disposed)return;this.#samples.push(Object.freeze({...sample,intensity:clamp01(sample.intensity)}));while(this.#samples.length>this.#max)this.#samples.shift();}
  sample(position:Vec3,tick:TickNumber,decay=0.03):number{if(this.#disposed)return 0;let total=0;for(const s of this.#samples){const d=Math.sqrt(distanceSq(position,s.position));if(d>s.radius)continue;const age=Math.max(0,Number(tick)-Number(s.tick));total+=s.intensity*(1-d/Math.max(0.001,s.radius))*Math.pow(1-clamp01(decay),age);}return clamp01(total);}
  byCategory(category:string):readonly HeatSample[]{return Object.freeze(this.#samples.filter(s=>s.category===category));}
  clear():void{this.#samples.length=0;}
  dispose():void{this.#disposed=true;this.clear();}
}

export function eventToHeat(event:WorldEvent):HeatSample{return Object.freeze({position:event.origin,intensity:event.intensity,tick:event.tick,radius:event.radius,category:event.kind});}
export function rankInterest(interest:RegionInterest,limit=8):readonly InterestCandidate[]{return Object.freeze([...interest.candidates].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,Math.max(0,Math.floor(limit))));}
