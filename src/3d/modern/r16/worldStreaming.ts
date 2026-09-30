import { digestValue, normalizeTick } from './deterministic.js';
import type { R16Result } from './types.js';

export type R16StreamResidency='unloaded'|'queued'|'loading'|'resident'|'stale'|'failed';
export interface R16StreamCell{
  readonly id:string;
  readonly distance:number;
  readonly importance:number;
  readonly bytes:number;
  readonly lastRequestedTick:number;
  readonly revision:number;
  readonly residency:R16StreamResidency;
  readonly pinned:boolean;
}
export interface R16StreamingBudget{
  readonly maxCells:number;
  readonly maxBytes:number;
  readonly maxLoadsPerTick:number;
  readonly maxUnloadsPerTick:number;
}
export interface R16StreamingDecision{
  readonly tick:number;
  readonly load:readonly string[];
  readonly unload:readonly string[];
  readonly retain:readonly string[];
  readonly deferred:readonly string[];
  readonly bytes:number;
  readonly digest:string;
}

export class R16WorldStreamingPlanner{
  readonly #budget:R16StreamingBudget;
  readonly #cells=new Map<string,R16StreamCell>();
  constructor(budget:R16StreamingBudget){
    this.#budget=Object.freeze({maxCells:Math.max(1,Math.trunc(budget.maxCells)),maxBytes:Math.max(1,Math.trunc(budget.maxBytes)),maxLoadsPerTick:Math.max(1,Math.trunc(budget.maxLoadsPerTick)),maxUnloadsPerTick:Math.max(1,Math.trunc(budget.maxUnloadsPerTick))});
  }
  register(cell:R16StreamCell):R16Result<void>{
    if(!cell.id||cell.id.length>128)return{ok:false,error:{code:'STREAM_CELL_ID',message:'Streaming cell id is invalid',retryable:false}};
    if(!Number.isFinite(cell.bytes)||cell.bytes<1||cell.bytes>this.#budget.maxBytes)return{ok:false,error:{code:'STREAM_CELL_BYTES',message:'Streaming cell byte size is invalid',retryable:false}};
    this.#cells.set(cell.id,Object.freeze({...cell,id:cell.id.slice(0,128),distance:Math.max(0,cell.distance),importance:Math.max(0,Math.min(1,cell.importance)),bytes:Math.trunc(cell.bytes),lastRequestedTick:normalizeTick(cell.lastRequestedTick),revision:Math.max(1,Math.trunc(cell.revision))}));
    return{ok:true,value:undefined};
  }
  request(id:string,tick:number,importance?:number):boolean{
    const cell=this.#cells.get(id);if(!cell)return false;
    this.#cells.set(id,Object.freeze({...cell,lastRequestedTick:normalizeTick(tick),importance:importance===undefined?cell.importance:Math.max(0,Math.min(1,importance)),residency:cell.residency==='resident'?'resident':'queued'}));return true;
  }
  plan(tick:number):R16StreamingDecision{
    const t=normalizeTick(tick);
    const candidates=[...this.#cells.values()].sort((a,b)=>a.distance-b.distance||b.importance-a.importance||Number(b.pinned)-Number(a.pinned)||a.id.localeCompare(b.id));
    let bytes=0;let loads=0;let unloads=0;const load:string[]=[],unload:string[]=[],retain:string[]=[],deferred:string[]=[];
    for(const cell of candidates){
      const active=cell.residency==='resident'||cell.residency==='loading';
      const wanted=cell.residency==='queued'||cell.pinned||cell.lastRequestedTick>=t-2;
      if(active&&bytes+cell.bytes<=this.#budget.maxBytes&&retain.length<this.#budget.maxCells){retain.push(cell.id);bytes+=cell.bytes;continue;}
      if(!active&&wanted&&loads<this.#budget.maxLoadsPerTick&&bytes+cell.bytes<=this.#budget.maxBytes){load.push(cell.id);bytes+=cell.bytes;loads++;continue;}
      if(active&&!wanted&&!cell.pinned&&unloads<this.#budget.maxUnloadsPerTick){unload.push(cell.id);unloads++;continue;}
      if(wanted)deferred.push(cell.id);
    }
    return Object.freeze({tick:t,load:Object.freeze(load),unload:Object.freeze(unload),retain:Object.freeze(retain),deferred:Object.freeze(deferred),bytes,digest:digestValue({tick:t,load,unload,retain,deferred,bytes})});
  }
  mark(id:string,residency:R16StreamResidency):boolean{const c=this.#cells.get(id);if(!c)return false;this.#cells.set(id,Object.freeze({...c,residency}));return true;}
  cell(id:string){return this.#cells.get(id)??null;}
  cells(){return Object.freeze([...this.#cells.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
  digest(){return digestValue(this.cells());}
  clear(){this.#cells.clear();}
}
