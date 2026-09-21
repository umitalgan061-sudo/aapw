/** Adaptive asset streaming with priority queues, cancellation, stale-while-revalidate and memory bounds. */
export type StreamAssetKindV15='model'|'texture'|'audio'|'shader'|'data';
export type StreamPriorityV15=0|1|2|3|4|5;
export type StreamStateV15='declared'|'queued'|'loading'|'ready'|'stale'|'failed'|'evicted';
export interface StreamAssetV15<T=unknown>{readonly id:string;readonly url:string;readonly kind:StreamAssetKindV15;readonly priority:StreamPriorityV15;readonly expectedBytes:number;readonly maxBytes:number;readonly critical:boolean;readonly version:string;readonly tags:readonly string[];readonly value?:T;readonly state?:StreamStateV15;}
export interface StreamRecordV15<T=unknown>{readonly asset:StreamAssetV15<T>;readonly state:StreamStateV15;readonly bytes:number;readonly requestedAtMs:number;readonly readyAtMs?:number;readonly lastUsedAtMs:number;readonly failures:number;readonly generation:number;readonly error?:string;}
export interface StreamLoaderV15<T=unknown>{readonly load:(asset:StreamAssetV15<T>,signal:AbortSignal)=>Promise<{readonly value:T;readonly bytes:number}>;readonly release?:(value:T)=>void;}
export interface StreamBudgetV15{readonly maxResidentBytes:number;readonly maxConcurrent:number;readonly maxQueue:number;readonly retryLimit:number;}
export interface StreamFrameReportV15{readonly started:readonly string[];readonly completed:readonly string[];readonly failed:readonly string[];readonly evicted:readonly string[];readonly residentBytes:number;readonly activeLoads:number;readonly queued:number;}

const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;
const priorityWeight=(p:StreamPriorityV15)=>p*100;

interface PendingV15{readonly controller:AbortController;readonly promise:Promise<StreamRecordV15>;}

export class AssetStreamingV15<T=unknown>{
  readonly #budget:StreamBudgetV15;
  readonly #clock:()=>number;
  readonly #loader:StreamLoaderV15<T>;
  readonly #records=new Map<string,StreamRecordV15<T>>();
  readonly #pending=new Map<string,PendingV15>();
  readonly #queue=new Set<string>();
  #residentBytes=0;
  #activeLoads=0;
  #generation=0;

  constructor(loader:StreamLoaderV15<T>,options:{budget?:Partial<StreamBudgetV15>;clock?:()=>number}={}){
    this.#loader=loader;
    this.#clock=options.clock??(()=>Date.now());
    this.#budget=Object.freeze({maxResidentBytes:Math.max(8*1024*1024,Math.trunc(options.budget?.maxResidentBytes??512*1024*1024)),maxConcurrent:Math.max(1,Math.min(32,Math.trunc(options.budget?.maxConcurrent??6))),maxQueue:Math.max(16,Math.trunc(options.budget?.maxQueue??4096)),retryLimit:Math.max(0,Math.min(8,Math.trunc(options.budget?.retryLimit??2)))});
  }

  declare(asset:StreamAssetV15<T>):StreamRecordV15<T>{
    const id=asset.id.trim();
    if(!id)throw new Error('Stream asset id cannot be empty.');
    if(this.#records.has(id))throw new Error('Stream asset already declared: '+id);
    if(!/^https?:\/\//i.test(asset.url))throw new Error('Stream asset url must be absolute.');
    const normalized:ObjectConstructor extends never?never:StreamAssetV15<T>=Object.freeze({...asset,id,url:asset.url.trim(),expectedBytes:Math.max(0,Math.trunc(asset.expectedBytes)),maxBytes:Math.max(1,Math.trunc(asset.maxBytes)),tags:Object.freeze([...(asset.tags??[])]),version:asset.version.trim().slice(0,64)});
    const record=Object.freeze({asset:normalized,state:'declared' as const,bytes:0,requestedAtMs:this.#clock(),lastUsedAtMs:this.#clock(),failures:0,generation:++this.#generation});
    this.#records.set(id,record);
    return record;
  }

  request(id:string):Promise<StreamRecordV15<T>>{
    const current=this.#records.get(id);
    if(!current) return Promise.reject(new Error('Unknown stream asset: '+id));
    if(current.state==='ready'){this.#touch(id);return Promise.resolve(this.#records.get(id)!);}
    if(current.state==='loading'){return this.#pending.get(id)!.promise;}
    this.#records.set(id,Object.freeze({...current,state:'queued'}));
    if(this.#queue.size>=this.#budget.maxQueue) this.#dropLowestPriorityQueued();
    this.#queue.add(id);
    return new Promise<StreamRecordV15<T>>((resolve,reject)=>{
      queueMicrotask(()=>{
        const pending=this.#pending.get(id);
        if(pending){pending.promise.then(resolve,reject);return;}
        this.#pump();
        const now=this.#pending.get(id);
        if(now)now.promise.then(resolve,reject);else{const done=this.#records.get(id);if(done&&done.state==='ready')resolve(done);else reject(new Error('Stream request could not be started.'));}
      });
    });
  }

  async prefetch(ids:readonly string[]):Promise<void>{for(const id of ids)try{await this.request(id);}catch{} }
  touch(id:string):void{this.#touch(id);}
  markStale(id:string):boolean{const r=this.#records.get(id);if(!r||r.state!=='ready')return false;this.#records.set(id,Object.freeze({...r,state:'stale'}));return true;}
  cancel(id:string):boolean{const p=this.#pending.get(id);if(!p)return false;p.controller.abort();return true;}

  async processFrame():Promise<StreamFrameReportV15>{
    const started:string[]=[];const completed:string[]=[];const failed:string[]=[];const evicted:string[]=[];
    const beforeActive=this.#activeLoads;
    this.#pump();
    for(const id of this.#pending.keys()) if(!this.#records.get(id)||this.#records.get(id)?.state==='failed') failed.push(id);
    for(const [id,record] of this.#records){if(record.state==='ready'&&record.generation>this.#generation-2)completed.push(id);}
    const needed=Math.max(0,this.#residentBytes-this.#budget.maxResidentBytes);
    if(needed>0)evicted.push(...this.evictCold(needed));
    for(const id of this.#queue)started.push(id);
    return Object.freeze({started:Object.freeze(started),completed:Object.freeze(completed),failed:Object.freeze(failed),evicted:Object.freeze(evicted),residentBytes:this.#residentBytes,activeLoads:Math.max(beforeActive,this.#activeLoads),queued:this.#queue.size});
  }

  get(id:string):StreamRecordV15<T>|undefined{return this.#records.get(id);}
  records():readonly StreamRecordV15<T>[] {return Object.freeze([...this.#records.values()].sort((a,b)=>a.asset.priority===b.asset.priority?a.asset.id.localeCompare(b.asset.id):b.asset.priority-a.asset.priority));}
  residentBytes():number{return this.#residentBytes;}
  queued():number{return this.#queue.size;}
  activeLoads():number{return this.#activeLoads;}
  utilization():number{return this.#residentBytes/this.#budget.maxResidentBytes;}

  evictCold(targetBytes=0):readonly string[]{
    let freed=0;const result:string[]=[];
    const candidates=this.records().filter((record)=>record.state==='ready'&&!record.asset.critical).sort((a,b)=>this.#evictionScore(a)-this.#evictionScore(b));
    for(const record of candidates){if(freed>=targetBytes&&targetBytes>0)break;const current=this.#records.get(record.asset.id);if(!current)continue;this.#records.set(record.asset.id,Object.freeze({...current,state:'evicted',value:undefined,bytes:0}));this.#residentBytes=Math.max(0,this.#residentBytes-current.bytes);this.#loader.release?.(current.asset.value as T);freed+=current.bytes;result.push(record.asset.id);}
    return Object.freeze(result);
  }

  reset():void{for(const pending of this.#pending.values())pending.controller.abort();this.#pending.clear();this.#queue.clear();this.#records.clear();this.#residentBytes=0;this.#activeLoads=0;this.#generation=0;}

  #pump():void{
    while(this.#activeLoads<this.#budget.maxConcurrent){
      const id=[...this.#queue].map((key)=>this.#records.get(key)).filter((r):r is StreamRecordV15<T>=>Boolean(r)).sort((a,b)=>this.#rank(b)-this.#rank(a)||a.asset.id.localeCompare(b.asset.id))[0]?.asset.id;
      if(!id)break;this.#queue.delete(id);this.#start(id);
    }
  }

  #start(id:string):void{
    const record=this.#records.get(id);if(!record)return;this.#activeLoads+=1;const controller=new AbortController();
    this.#records.set(id,Object.freeze({...record,state:'loading',requestedAtMs:this.#clock()}));
    const promise=this.#loadWithRetry(id,controller.signal);this.#pending.set(id,{controller,promise});
    void promise.then(()=>{}).catch(()=>{}).finally(()=>{this.#activeLoads=Math.max(0,this.#activeLoads-1);this.#pending.delete(id);this.#pump();});
  }

  async #loadWithRetry(id:string,signal:AbortSignal):Promise<StreamRecordV15<T>>{
    const original=this.#records.get(id)!;let attempts=0;let lastError:string|undefined;
    while(attempts<=this.#budget.retryLimit){
      attempts+=1;
      try{
        const result=await this.#loader.load(original.asset,signal);
        if(result.bytes>original.asset.maxBytes)throw new Error('Asset exceeds maxBytes: '+id);
        this.#residentBytes+=Math.max(0,Math.trunc(result.bytes));
        const ready=Object.freeze({...original,state:'ready' as const,bytes:Math.max(0,Math.trunc(result.bytes)),readyAtMs:this.#clock(),lastUsedAtMs:this.#clock(),failures:attempts-1,generation:++this.#generation,value:result.value});
        this.#records.set(id,ready);this.#enforceMemory();return ready;
      }catch(error){lastError=error instanceof Error?error.message:String(error);if(signal.aborted)break;}
    }
    const failed=Object.freeze({...original,state:'failed' as const,failures:attempts,error:lastError,generation:++this.#generation});this.#records.set(id,failed);throw new Error(lastError??'Asset load failed: '+id);
  }

  #enforceMemory():void{if(this.#residentBytes<=this.#budget.maxResidentBytes)return;this.evictCold(this.#residentBytes-this.#budget.maxResidentBytes);}
  #touch(id:string):void{const record=this.#records.get(id);if(record)this.#records.set(id,Object.freeze({...record,lastUsedAtMs:this.#clock()}));}
  #rank(record:StreamRecordV15<T>):number{return priorityWeight(record.asset.priority)+(record.asset.critical?1000:0)+(record.state==='stale'?250:0)-(this.#clock()-record.lastUsedAtMs)*0.001;}
  #evictionScore(record:StreamRecordV15<T>):number{return this.#rank(record)+record.bytes*0.00001;}
  #dropLowestPriorityQueued():void{const id=[...this.#queue].map((key)=>this.#records.get(key)).filter((r):r is StreamRecordV15<T>=>Boolean(r)).sort((a,b)=>this.#rank(a)-this.#rank(b)||a.asset.id.localeCompare(b.asset.id))[0]?.asset.id;if(id)this.#queue.delete(id);}
}

export const makeStreamAssetV15=(input:Partial<StreamAssetV15>&Pick<StreamAssetV15,'id'|'url'|'kind'>):StreamAssetV15=>Object.freeze({id:input.id,url:input.url,kind:input.kind,priority:input.priority??2,expectedBytes:input.expectedBytes??0,maxBytes:input.maxBytes??16*1024*1024,critical:input.critical??false,version:input.version??'1',tags:Object.freeze([...(input.tags??[])])});
