import { digestValue,normalizeTick } from './deterministic.js';
import type { R16Result } from './types.js';

export type R16AssetPriority='critical'|'near'|'mid'|'far'|'prefetch';
export interface R16AssetRecord{readonly id:string;readonly bytes:number;readonly priority:R16AssetPriority;readonly revision:number;readonly lastUsedTick:number;readonly pinned:boolean;readonly resident:boolean;}
export interface R16ResidencyBudget{readonly maxBytes:number;readonly maxAssets:number;readonly maxCriticalBytes:number;}
export interface R16ResidencyPlan{readonly load:readonly string[];readonly evict:readonly string[];readonly retainedBytes:number;readonly projectedBytes:number;readonly digest:string;}

const rank:Readonly<Record<R16AssetPriority,number>>=Object.freeze({critical:100,near:80,mid:60,far:30,prefetch:10});

export class R16AssetResidency{
  readonly #budget:R16ResidencyBudget;readonly #assets=new Map<string,R16AssetRecord>();
  constructor(budget:R16ResidencyBudget){this.#budget=Object.freeze({maxBytes:Math.max(1,budget.maxBytes),maxAssets:Math.max(1,budget.maxAssets),maxCriticalBytes:Math.max(0,budget.maxCriticalBytes)});}
  register(id:string,bytes:number,priority:R16AssetPriority,tick:number,revision=1,pinned=false):R16Result<R16AssetRecord>{
    if(!id||id.length>128)return{ok:false,error:{code:'ASSET_ID',message:'Asset id invalid',retryable:false}};
    if(!Number.isFinite(bytes)||bytes<1||bytes>this.#budget.maxBytes)return{ok:false,error:{code:'ASSET_BYTES',message:'Asset byte size invalid',retryable:false}};
    const existing=this.#assets.get(id);
    if(existing&&revision<existing.revision)return{ok:false,error:{code:'ASSET_REVISION',message:'Asset revision is stale',retryable:false}};
    const value:R16AssetRecord=Object.freeze({id:id.slice(0,128),bytes:Math.trunc(bytes),priority,revision:Math.max(1,Math.trunc(revision)),lastUsedTick:normalizeTick(tick),pinned,resident:true});
    this.#assets.set(value.id,value);return{ok:true,value};
  }
  touch(id:string,tick:number,priority?:R16AssetPriority):boolean{
    const asset=this.#assets.get(id);if(!asset)return false;this.#assets.set(id,Object.freeze({...asset,lastUsedTick:normalizeTick(tick),priority:priority??asset.priority}));return true;
  }
  plan(requested:readonly string[],tick:number):R16ResidencyPlan{
    const wanted=[...new Set(requested)].filter(id=>this.#assets.has(id));const keep=new Set(wanted);
    for(const asset of [...this.#assets.values()].filter(a=>a.pinned||a.priority==='critical'))keep.add(asset.id);
    const ordered=[...this.#assets.values()].sort((a,b)=>rank[b.priority]-rank[a.priority]||Number(b.pinned)-Number(a.pinned)||b.lastUsedTick-a.lastUsedTick||a.id.localeCompare(b.id));
    let bytes=0,criticalBytes=0;const load:string[]=[],evict:string[]=[];
    for(const asset of ordered){
      const mustKeep=keep.has(asset.id);const critical=asset.priority==='critical';
      if((mustKeep||bytes+asset.bytes<=this.#budget.maxBytes)&&(criticalBytes+(critical?asset.bytes:0)<=this.#budget.maxCriticalBytes||!critical)){
        bytes+=asset.bytes;if(critical)criticalBytes+=asset.bytes;if(!asset.resident)load.push(asset.id);
      }else if(asset.resident&&!asset.pinned)evict.push(asset.id);
    }
    const projected=bytes;const retained=ordered.filter(a=>!evict.includes(a.id)).reduce((s,a)=>s+a.bytes,0);
    return Object.freeze({load:Object.freeze(load.sort()),evict:Object.freeze(evict.sort()),retainedBytes:retained,projectedBytes:projected,digest:digestValue({tick:normalizeTick(tick),load,evict,retained,projected})});
  }
  markEvicted(id:string):boolean{const a=this.#assets.get(id);if(!a)return false;this.#assets.set(id,Object.freeze({...a,resident:false}));return true;}
  markLoaded(id:string,tick:number):boolean{const a=this.#assets.get(id);if(!a)return false;this.#assets.set(id,Object.freeze({...a,resident:true,lastUsedTick:normalizeTick(tick)}));return true;}
  totalBytes(){return [...this.#assets.values()].filter(a=>a.resident).reduce((s,a)=>s+a.bytes,0);}
  list(){return Object.freeze([...this.#assets.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
  clear(){this.#assets.clear();}
}
