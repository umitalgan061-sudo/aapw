import { digestValue } from './deterministic.js';
import type { R16Result } from './types.js';

export interface R16CacheItem{readonly id:string;readonly bytes:number;readonly className:'geometry'|'texture'|'audio'|'shader'|'data';readonly priority:number;readonly lastUsedTick:number;readonly pinned:boolean;readonly resident:boolean;}
export interface R16CacheBudget{readonly maxBytes:number;readonly maxItems:number;readonly maxPinnedBytes:number;}
export interface R16CachePlan{readonly evict:readonly string[];readonly retained:readonly string[];readonly retainedBytes:number;readonly projectedBytes:number;readonly digest:string;}

export class R16CacheCoordinator{
  readonly #budget:R16CacheBudget;readonly #items=new Map<string,R16CacheItem>();
  constructor(budget:R16CacheBudget){this.#budget=Object.freeze({maxBytes:Math.max(1,Math.trunc(budget.maxBytes)),maxItems:Math.max(1,Math.trunc(budget.maxItems)),maxPinnedBytes:Math.max(0,Math.trunc(budget.maxPinnedBytes))});}
  register(item:Omit<R16CacheItem,'resident'>&Partial<Pick<R16CacheItem,'resident'>>):R16Result<void>{
    if(!item.id||item.id.length>128||item.bytes<1||item.bytes>this.#budget.maxBytes)return{ok:false,error:{code:'CACHE_ITEM_INVALID',message:'Cache item is invalid',retryable:false}};
    this.#items.set(item.id,Object.freeze({...item,id:item.id.slice(0,128),bytes:Math.trunc(item.bytes),priority:Math.trunc(item.priority),lastUsedTick:Math.max(0,Math.trunc(item.lastUsedTick)),resident:item.resident??true}));return{ok:true,value:undefined};
  }
  touch(id:string,tick:number,priority?:number):boolean{const item=this.#items.get(id);if(!item)return false;this.#items.set(id,Object.freeze({...item,lastUsedTick:Math.max(0,Math.trunc(tick)),priority:priority===undefined?item.priority:Math.trunc(priority)}));return true;}
  plan():R16CachePlan{
    const resident=[...this.#items.values()].filter(i=>i.resident).sort((a,b)=>b.priority-a.priority||Number(b.pinned)-Number(a.pinned)||b.lastUsedTick-a.lastUsedTick||a.id.localeCompare(b.id));
    let bytes=0,pinnedBytes=0;const retained:string[]=[],evict:string[]=[];
    for(const item of resident){
      if(item.pinned&&pinnedBytes+item.bytes<=this.#budget.maxPinnedBytes&&bytes+item.bytes<=this.#budget.maxBytes&&retained.length<this.#budget.maxItems){retained.push(item.id);bytes+=item.bytes;pinnedBytes+=item.bytes;continue;}
      if(bytes+item.bytes<=this.#budget.maxBytes&&retained.length<this.#budget.maxItems){retained.push(item.id);bytes+=item.bytes;continue;}
      if(!item.pinned)evict.push(item.id);else retained.push(item.id);
    }
    return Object.freeze({evict:Object.freeze(evict.sort()),retained:Object.freeze(retained.sort()),retainedBytes:bytes,projectedBytes:bytes,digest:digestValue({retained,evict,bytes,pinnedBytes})});
  }
  setResident(id:string,resident:boolean):boolean{const item=this.#items.get(id);if(!item)return false;this.#items.set(id,Object.freeze({...item,resident}));return true;}
  get(id:string){return this.#items.get(id)??null;}list(){return Object.freeze([...this.#items.values()].sort((a,b)=>a.id.localeCompare(b.id)));}bytes(){return[...this.#items.values()].filter(i=>i.resident).reduce((s,i)=>s+i.bytes,0);}clear(){this.#items.clear();}
}
