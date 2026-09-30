import { clampInt,digestValue } from './deterministic.js';
import type { R16Result } from './types.js';

export type R16InterestBand='near'|'mid'|'far'|'sleeping';
export interface R16InterestEntity{readonly id:string;readonly x:number;readonly y:number;readonly z:number;readonly importance:number;readonly active:boolean;}
export interface R16InterestBudget{readonly near:number;readonly mid:number;readonly far:number;readonly sleeping:number;}
export interface R16InterestDecision{readonly band:R16InterestBand;readonly ids:readonly string[];readonly deferred:readonly string[];readonly digest:string;}

const BAND_RANK:Readonly<Record<R16InterestBand,number>>=Object.freeze({near:3,mid:2,far:1,sleeping:0});

export class R16WorldInterest{
  readonly #bands:Readonly<{near:number;mid:number;far:number;sleeping:number}>;readonly #entities=new Map<string,R16InterestEntity>();
  constructor(budget:R16InterestBudget){this.#bands=Object.freeze({near:clampInt(budget.near,0,65536),mid:clampInt(budget.mid,0,65536),far:clampInt(budget.far,0,65536),sleeping:clampInt(budget.sleeping,0,65536)});}
  upsert(entity:R16InterestEntity):R16Result<void>{
    if(!entity.id||entity.id.length>96)return{ok:false,error:{code:'INTEREST_ID',message:'Interest entity id invalid',retryable:false}};
    if(![entity.x,entity.y,entity.z,entity.importance].every(Number.isFinite))return{ok:false,error:{code:'INTEREST_VECTOR',message:'Interest coordinates must be finite',retryable:false}};
    this.#entities.set(entity.id,Object.freeze({...entity,id:entity.id.slice(0,96),importance:Math.max(0,Math.min(1,entity.importance)),active:Boolean(entity.active)}));return{ok:true,value:undefined};
  }
  remove(id:string){return this.#entities.delete(id);}
  classify(origin:{x:number;y:number;z:number},thresholds:{near:number;mid:number;far:number}):ReadonlyMap<string,R16InterestBand>{
    const output=new Map<string,R16InterestBand>();const ordered=[...this.#entities.values()].sort((a,b)=>b.importance-a.importance||a.id.localeCompare(b.id));
    for(const e of ordered){const dx=e.x-origin.x,dy=e.y-origin.y,dz=e.z-origin.z,d=Math.hypot(dx,dy,dz);const band: R16InterestBand=d<=thresholds.near?'near':d<=thresholds.mid?'mid':d<=thresholds.far?'far':'sleeping';output.set(e.id,e.active?band:'sleeping');}
    return output;
  }
  decide(origin:{x:number;y:number;z:number},thresholds:{near:number;mid:number;far:number}):readonly R16InterestDecision[]{
    const classified=this.classify(origin,thresholds);const result:R16InterestDecision[]=[];
    for(const band of (['near','mid','far','sleeping'] as const)){
      const ids=[...classified.entries()].filter(([,value])=>value===band).map(([id])=>id);
      const limit=this.#bands[band];const accepted=ids.slice(0,limit);const deferred=ids.slice(limit);
      result.push(Object.freeze({band,ids:Object.freeze(accepted),deferred:Object.freeze(deferred),digest:digestValue({band,accepted,deferred})}));
    }
    return Object.freeze(result.sort((a,b)=>BAND_RANK[b.band]-BAND_RANK[a.band]));
  }
  get(id:string){return this.#entities.get(id)??null;}
  count(){return this.#entities.size;}
  digest(){return digestValue([...this.#entities.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
  clear(){this.#entities.clear();}
}
