import type { EngineResult } from './types.js';

export type AssetKind = 'texture' | 'model' | 'animation' | 'audio' | 'shader' | 'data';
export type AssetState = 'declared' | 'queued' | 'loading' | 'resident' | 'stale' | 'failed' | 'evicted';
export type AssetPriority = 'critical' | 'high' | 'normal' | 'low' | 'prefetch';

export interface AssetDescriptor {
  readonly id: string;
  readonly url: string;
  readonly kind: AssetKind;
  readonly bytes: number;
  readonly priority: AssetPriority;
  readonly dependencies: readonly string[];
  readonly tags: readonly string[];
  readonly version: number;
  readonly optional: boolean;
}

export interface AssetRecord extends AssetDescriptor {
  readonly state: AssetState;
  readonly residentBytes: number;
  readonly lastUsedFrame: number;
  readonly failureCount: number;
  readonly generation: number;
}

export interface AssetBudget {
  readonly totalBytes: number;
  readonly criticalBytes: number;
  readonly highBytes: number;
  readonly normalBytes: number;
  readonly lowBytes: number;
  readonly maxConcurrentLoads: number;
}

export interface AssetLoadPlan {
  readonly load: readonly string[];
  readonly retain: readonly string[];
  readonly evict: readonly string[];
  readonly deferred: readonly string[];
  readonly estimatedBytes: number;
}

const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
const priorityRank=(p:AssetPriority):number=>({critical:5,high:4,normal:3,low:2,prefetch:1}[p]);
const stable=(ids:Iterable<string>):string[]=>[...ids].sort((a,b)=>a.localeCompare(b));

export class TypedAssetGraph {
  private readonly assets=new Map<string,AssetRecord>();
  private readonly dependents=new Map<string,Set<string>>();
  private readonly loading=new Set<string>();
  private disposed=false;
  private revision=0;

  public declare(descriptor:AssetDescriptor):EngineResult<AssetRecord>{
    if(this.disposed)return{ok:false,meta:{status:'disposed',code:'ASSET_GRAPH_DISPOSED'}};
    if(!descriptor.id||!descriptor.url||descriptor.bytes<0)return{ok:false,meta:{status:'invalid',code:'ASSET_DESCRIPTOR_INVALID'}};
    const current=this.assets.get(descriptor.id);
    if(current&&current.version>descriptor.version)return{ok:false,meta:{status:'rejected',code:'ASSET_VERSION_REGRESSION'}};
    const record:AssetRecord=Object.freeze({...descriptor,state:current?.state??'declared',residentBytes:current?.residentBytes??0,lastUsedFrame:current?.lastUsedFrame??0,failureCount:current?.failureCount??0,generation:(current?.generation??0)+1});
    this.assets.set(record.id,record);
    for(const dependency of record.dependencies){let set=this.dependents.get(dependency);if(!set){set=new Set();this.dependents.set(dependency,set);}set.add(record.id);}
    this.revision+=1;
    return{ok:true,value:record,meta:{status:'ok',code:'ASSET_DECLARED'}};
  }

  public get(id:string):AssetRecord|undefined{return this.assets.get(id);}
  public all():readonly AssetRecord[]{return Object.freeze(stable(this.assets.keys()).map(id=>this.assets.get(id)!).filter(Boolean));}

  public markQueued(id:string):boolean{return this.transition(id,'queued');}
  public markLoading(id:string):boolean{if(this.loading.size>=128)return false;const ok=this.transition(id,'loading');if(ok)this.loading.add(id);return ok;}
  public markResident(id:string,frame:number,bytes?:number):boolean{const current=this.assets.get(id);if(!current)return false;this.loading.delete(id);this.assets.set(id,Object.freeze({...current,state:'resident',residentBytes:Math.max(0,Math.floor(bytes??current.bytes)),lastUsedFrame:Math.max(0,Math.floor(frame))}));this.revision+=1;return true;}
  public markFailed(id:string):boolean{const current=this.assets.get(id);if(!current)return false;this.loading.delete(id);this.assets.set(id,Object.freeze({...current,state:'failed',failureCount:current.failureCount+1}));this.revision+=1;return true;}
  public touch(id:string,frame:number):boolean{const c=this.assets.get(id);if(!c)return false;this.assets.set(id,Object.freeze({...c,lastUsedFrame:Math.max(c.lastUsedFrame,Math.floor(frame))}));return true;}

  public dependencyOrder(rootIds:readonly string[]):readonly string[]{
    const visited=new Set<string>();const active=new Set<string>();const result:string[]=[];
    const visit=(id:string):void=>{if(visited.has(id))return;if(active.has(id))throw new Error(`ASSET_CYCLE:${id}`);active.add(id);const asset=this.assets.get(id);if(asset)for(const dep of stable(asset.dependencies))visit(dep);active.delete(id);visited.add(id);result.push(id);};
    for(const id of stable(rootIds))visit(id);return Object.freeze(result);
  }

  public closure(rootIds:readonly string[]):readonly AssetRecord[]{return Object.freeze(this.dependencyOrder(rootIds).map(id=>this.assets.get(id)!).filter(Boolean));}

  public plan(requested:readonly string[],budget:AssetBudget,frame:number):AssetLoadPlan{
    const candidates=this.closure(requested).filter(asset=>asset.state!=='resident'||asset.stale).sort((a,b)=>priorityRank(b.priority)-priorityRank(a.priority)||b.lastUsedFrame-a.lastUsedFrame||a.id.localeCompare(b.id));
    const resident=this.all().filter(a=>a.state==='resident');
    let used=resident.reduce((s,a)=>s+a.residentBytes,0);const load:string[]=[];const deferred:string[]=[];const critical:string[]=[];
    for(const asset of candidates){const bytes=Math.max(0,asset.bytes);if(asset.priority==='critical')critical.push(asset.id);if(load.length>=budget.maxConcurrentLoads){deferred.push(asset.id);continue;}if(used+bytes<=budget.totalBytes||asset.priority==='critical'){load.push(asset.id);used+=bytes;}else deferred.push(asset.id);}
    const requestedSet=new Set(this.closure(requested).map(a=>a.id));const retain=resident.filter(a=>requestedSet.has(a.id)||frame-a.lastUsedFrame<120).map(a=>a.id);
    const retainSet=new Set(retain);const evict=resident.filter(a=>!retainSet.has(a.id)&&a.priority!=='critical').sort((a,b)=>a.lastUsedFrame-b.lastUsedFrame||a.id.localeCompare(b.id)).map(a=>a.id);
    return Object.freeze({load:Object.freeze(stable(load)),retain:Object.freeze(stable(retain)),evict:Object.freeze(stable(evict)),deferred:Object.freeze(stable([...deferred,...critical.filter(id=>!load.includes(id))])),estimatedBytes:used});
  }

  public evict(id:string):boolean{const c=this.assets.get(id);if(!c||c.priority==='critical')return false;this.assets.set(id,Object.freeze({...c,state:'evicted',residentBytes:0}));this.revision+=1;return true;}
  public garbageCollect(frame:number,maxAge=600):readonly string[]{const evicted:string[]=[];for(const asset of this.all()){if(asset.state!=='resident'||asset.priority==='critical')continue;if(frame-asset.lastUsedFrame>maxAge&&this.dependents.get(asset.id)?.size!==undefined){continue;}if(this.evict(asset.id))evicted.push(asset.id);}return Object.freeze(stable(evicted));}

  public snapshot():Readonly<{revision:number;assets:readonly AssetRecord[];loading:readonly string[]}>{return Object.freeze({revision:this.revision,assets:this.all(),loading:Object.freeze(stable(this.loading))});}
  public dispose():void{if(this.disposed)return;this.disposed=true;this.assets.clear();this.dependents.clear();this.loading.clear();}
  private transition(id:string,next:AssetState):boolean{const c=this.assets.get(id);if(!c)return false;const allowed:Record<AssetState,readonly AssetState[]>= {declared:['queued','failed'],queued:['loading','declared'],loading:['resident','failed','queued'],resident:['stale','evicted'],stale:['loading','evicted','resident'],failed:['queued','evicted'],evicted:['queued','declared']};if(!allowed[c.state].includes(next))return false;this.assets.set(id,Object.freeze({...c,state:next}));this.revision+=1;return true;}
}

export const createAssetGraph=():TypedAssetGraph=>new TypedAssetGraph();
