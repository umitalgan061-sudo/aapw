/** Multi-source spatial interest planner for players, cameras, quests and network peers. */
export type InterestSourceKindV15='player'|'camera'|'network'|'quest'|'editor';
export interface InterestSourceV15{readonly id:string;readonly kind:InterestSourceKindV15;readonly x:number;readonly z:number;readonly radius:number;readonly weight:number;readonly enabled:boolean;}
export interface InterestCellV15{readonly x:number;readonly z:number;readonly distance:number;readonly priority:number;readonly visible:boolean;}
export interface InterestPlanV15{readonly cells:readonly InterestCellV15[];readonly loads:readonly InterestCellV15[];readonly unloads:readonly InterestCellV15[];readonly deferred:readonly InterestCellV15[];readonly resident:readonly string[];}
export interface InterestBudgetV15{readonly maxCells:number;readonly maxLoads:number;readonly maxUnloads:number;readonly chunkSize:number;readonly nearRadius:number;readonly farRadius:number;}

const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;
const key=(x:number,z:number)=>x+':'+z;
const distance=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);

export class InterestStreamingV15{
  readonly #sources=new Map<string,InterestSourceV15>();readonly #resident=new Set<string>();readonly #budget:InterestBudgetV15;
  #frame=0;
  constructor(budget:Partial<InterestBudgetV15>={}){this.#budget=Object.freeze({maxCells:Math.max(32,Math.trunc(budget.maxCells??4096)),maxLoads:Math.max(1,Math.trunc(budget.maxLoads??32)),maxUnloads:Math.max(1,Math.trunc(budget.maxUnloads??16)),chunkSize:Math.max(1,finite(budget.chunkSize??32)),nearRadius:Math.max(1,finite(budget.nearRadius??3)),farRadius:Math.max(1,finite(budget.farRadius??7))});}
  upsertSource(source:InterestSourceV15):InterestSourceV15{const normalized=Object.freeze({...source,x:finite(source.x),z:finite(source.z),radius:Math.max(0,finite(source.radius)),weight:Math.max(0,finite(source.weight)),enabled:Boolean(source.enabled)});this.#sources.set(source.id,normalized);return normalized;}
  removeSource(id:string):boolean{return this.#sources.delete(id);}
  sources():readonly InterestSourceV15[]{return Object.freeze([...this.#sources.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
  markResident(x:number,z:number,resident=true):void{const k=key(Math.trunc(x),Math.trunc(z));if(resident)this.#resident.add(k);else this.#resident.delete(k);}
  resident():readonly string[]{return Object.freeze([...this.#resident].sort());}

  plan(cameraX:number,cameraZ:number):InterestPlanV15{
    this.#frame+=1;const cells=new Map<string,InterestCellV15>();
    for(const source of this.#sources.values()){if(!source.enabled)continue;const centerX=Math.floor(source.x/this.#budget.chunkSize);const centerZ=Math.floor(source.z/this.#budget.chunkSize);const radius=Math.max(1,Math.ceil((source.radius+this.#budget.chunkSize*1.5)/this.#budget.chunkSize));
      for(let x=centerX-radius;x<=centerX+radius;x+=1)for(let z=centerZ-radius;z<=centerZ+radius;z+=1){const worldX=x*this.#budget.chunkSize;const worldZ=z*this.#budget.chunkSize;const d=distance({x:worldX,z:worldZ},source);if(d>source.radius+this.#budget.chunkSize*1.5)continue;const id=key(x,z);const priority=source.weight/(1+d/Math.max(1,this.#budget.chunkSize));const previous=cells.get(id);cells.set(id,previous?Object.freeze({...previous,priority:previous.priority+priority}):Object.freeze({x,z,distance:d,priority,visible:d<=this.#budget.chunkSize*this.#budget.nearRadius}));if(cells.size>=this.#budget.maxCells)break;}
    }
    const ordered=[...cells.values()].sort((a,b)=>b.priority-a.priority||a.distance-b.distance||a.x-b.x||a.z-b.z);
    const desired=new Set(ordered.map((cell)=>key(cell.x,cell.z)));
    const loads=ordered.filter((cell)=>!this.#resident.has(key(cell.x,cell.z))).slice(0,this.#budget.maxLoads);
    const unloads=[...this.#resident].filter((id)=>!desired.has(id)).map((id)=>{const [x,z]=id.split(':').map(Number);return Object.freeze({x:x??0,z:z??0,distance:distance({x:(x??0)*this.#budget.chunkSize,z:(z??0)*this.#budget.chunkSize},{x:cameraX,z:cameraZ}),priority:0,visible:false});}).sort((a,b)=>b.distance-a.distance).slice(0,this.#budget.maxUnloads);
    const deferred=ordered.filter((cell)=>!loads.some((item)=>item.x===cell.x&&item.z===cell.z)).slice(this.#budget.maxCells>loads.length?loads.length:0,loads.length+64);
    return Object.freeze({cells:Object.freeze(ordered),loads:Object.freeze(loads),unloads:Object.freeze(unloads),deferred:Object.freeze(deferred),resident:this.resident()});
  }

  commit(plan:InterestPlanV15):void{for(const cell of plan.loads)this.#resident.add(key(cell.x,cell.z));for(const cell of plan.unloads)this.#resident.delete(key(cell.x,cell.z));}
  clearResident():void{this.#resident.clear();}
  frame():number{return this.#frame;}
  budget():InterestBudgetV15{return this.#budget;}
}

export const parseCellKeyV15=(value:string):{readonly x:number;readonly z:number}|undefined=>{const parts=value.split(':').map(Number);return Number.isFinite(parts[0])&&Number.isFinite(parts[1])?Object.freeze({x:Math.trunc(parts[0]!),z:Math.trunc(parts[1]!) }):undefined;};
