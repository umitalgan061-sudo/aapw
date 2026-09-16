import { type AssetStreamingV4 } from './assetStreamingV4';

export type AssetKindV6='model'|'texture'|'audio'|'shader'|'json'|'binary';
export type AssetStateV6='registered'|'queued'|'loading'|'resident'|'evicting'|'evicted'|'failed';
export interface AssetRecordV6{readonly id:string;readonly url:string;readonly kind:AssetKindV6;readonly bytes:number;readonly priority:number;readonly optional:boolean;readonly digest:string;readonly state:AssetStateV6;readonly loadedAt:number;readonly lastUsedAt:number;readonly failures:number;readonly tags:readonly string[];}
export interface AssetRuntimeConfigV6{readonly maxResidentBytes?:number;readonly maxResidentAssets?:number;readonly maxFailures?:number;readonly now?:()=>number;}
export interface AssetRuntimeMetricsV6{readonly registered:number;readonly queued:number;readonly loading:number;readonly resident:number;readonly failed:number;readonly residentBytes:number;readonly cacheHits:number;readonly cacheMisses:number;readonly evictions:number;readonly retries:number;}
export interface AssetResidencyPlanV6{readonly load:readonly string[];readonly retain:readonly string[];readonly evict:readonly string[];readonly skipped:readonly string[];readonly totalBytes:number;}

const defaults:Required<Pick<AssetRuntimeConfigV6,'maxResidentBytes'|'maxResidentAssets'|'maxFailures'>>={maxResidentBytes:768*1024*1024,maxResidentAssets:4096,maxFailures:3};
const finite=(value:unknown,fallback=0):number=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const clamp=(value:number,min:number,max:number):number=>Math.max(min,Math.min(max,value));

export class TypedAssetRuntimeV6{
 readonly maxResidentBytes:number;readonly maxResidentAssets:number;readonly maxFailures:number;readonly source?:AssetStreamingV4;
 #now:()=>number;#records=new Map<string,AssetRecordV6>();#metrics:AssetRuntimeMetricsV6=Object.freeze({registered:0,queued:0,loading:0,resident:0,failed:0,residentBytes:0,cacheHits:0,cacheMisses:0,evictions:0,retries:0});
 constructor(options:AssetRuntimeConfigV6={},source?:AssetStreamingV4){this.maxResidentBytes=Math.max(1024*1024,finite(options.maxResidentBytes,defaults.maxResidentBytes));this.maxResidentAssets=Math.max(1,Math.trunc(finite(options.maxResidentAssets,defaults.maxResidentAssets)));this.maxFailures=Math.max(1,Math.trunc(finite(options.maxFailures,defaults.maxFailures)));this.#now=options.now??(()=>performance.now());this.source=source;}
 register(input:Omit<AssetRecordV6,'state'|'loadedAt'|'lastUsedAt'|'failures'>):AssetRecordV6{if(!input.id.trim())throw new Error('asset id required');if(!Number.isFinite(input.bytes)||input.bytes<0)throw new Error('invalid asset bytes');const existing=this.#records.get(input.id);const record:Object&AssetRecordV6=Object.freeze({...input,state:existing?.state??'registered',loadedAt:existing?.loadedAt??0,lastUsedAt:existing?.lastUsedAt??0,failures:existing?.failures??0,tags:Object.freeze([...new Set(input.tags)].slice(0,32))});this.#records.set(input.id,record);this.#recount();return record;}
 registerMany(entries:readonly Omit<AssetRecordV6,'state'|'loadedAt'|'lastUsedAt'|'failures'>[]):readonly AssetRecordV6[]{return Object.freeze(entries.map(entry=>this.register(entry)));}
 state(id:string):AssetStateV6{return this.#records.get(id)?.state??'failed';}
 record(id:string):AssetRecordV6|null{return this.#records.get(id)??null;}
 queue(id:string):boolean{const record=this.#records.get(id);if(!record)return false;if(record.state==='resident'||record.state==='loading')return true;this.#records.set(id,Object.freeze({...record,state:'queued',lastUsedAt:this.#now()}));this.#recount();return true;}
 queueMany(ids:readonly string[]):number{let count=0;for(const id of ids)if(this.queue(id))count+=1;return count;}
 markLoading(id:string):boolean{const record=this.#records.get(id);if(!record)return false;this.#records.set(id,Object.freeze({...record,state:'loading',lastUsedAt:this.#now()}));this.#recount();return true;}
 markResident(id:string,loadedAt=this.#now()):boolean{const record=this.#records.get(id);if(!record)return false;this.#records.set(id,Object.freeze({...record,state:'resident',loadedAt,lastUsedAt:loadedAt,failures:0}));this.#recount();this.evictIfNeeded();return true;}
 markUsed(id:string,at=this.#now()):boolean{const record=this.#records.get(id);if(!record||record.state!=='resident')return false;this.#records.set(id,Object.freeze({...record,lastUsedAt:at}));return true;}
 markFailed(id:string):boolean{const record=this.#records.get(id);if(!record)return false;const failures=record.failures+1;this.#records.set(id,Object.freeze({...record,state:failures>=this.maxFailures?'failed':'queued',failures,lastUsedAt:this.#now()}));this.#metrics=Object.freeze({...this.#metrics,retries:this.#metrics.retries+(failures<this.maxFailures?1:0)});this.#recount();return true;}
 touchFromScene(ids:readonly string[]):void{for(const id of ids)this.markUsed(id);}
 plan(required:readonly string[],prefetch:readonly string[]=[]):AssetResidencyPlanV6{const requiredSet=new Set(required);const prefetchSet=new Set(prefetch);const load:string[]=[];const retain:string[]=[];const evict:string[]=[];const skipped:string[]=[];for(const record of this.#records.values()){if(record.state==='failed'){skipped.push(record.id);continue;}if(requiredSet.has(record.id)||prefetchSet.has(record.id)){retain.push(record.id);if(record.state!=='resident'&&record.state!=='loading')load.push(record.id);}else if(record.state==='resident'){evict.push(record.id);}}
load.sort((a,b)=>this.#priority(b)-this.#priority(a)||a.localeCompare(b));retain.sort((a,b)=>this.#priority(b)-this.#priority(a)||a.localeCompare(b));evict.sort((a,b)=>this.#ageScore(b)-this.#ageScore(a)||a.localeCompare(b));const totalBytes=retain.reduce((sum,id)=>sum+this.#records.get(id)!.bytes,0);return Object.freeze({load:Object.freeze(load),retain:Object.freeze(retain),evict:Object.freeze(evict),skipped:Object.freeze(skipped),totalBytes});}
 applyPlan(plan:AssetResidencyPlanV6):void{for(const id of plan.load)this.queue(id);for(const id of plan.evict)this.evict(id);this.evictIfNeeded();}
 evict(id:string):boolean{const record=this.#records.get(id);if(!record||record.state!=='resident')return false;this.#records.set(id,Object.freeze({...record,state:'evicted'}));this.#metrics=Object.freeze({...this.#metrics,evictions:this.#metrics.evictions+1});this.#recount();return true;}
 evictIfNeeded():void{while(this.#residentCount()>this.maxResidentAssets||this.#residentBytes()>this.maxResidentBytes){const candidates=[...this.#records.values()].filter(record=>record.state==='resident').sort((a,b)=>this.#evictionScore(b)-this.#evictionScore(a)||a.id.localeCompare(b.id));const victim=candidates[0];if(!victim)break;this.evict(victim.id);}}
 records():readonly AssetRecordV6[]{return Object.freeze([...this.#records.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
 metrics():AssetRuntimeMetricsV6{return this.#metrics;}
 reset():void{this.#records.clear();this.#metrics=Object.freeze({registered:0,queued:0,loading:0,resident:0,failed:0,residentBytes:0,cacheHits:0,cacheMisses:0,evictions:0,retries:0});}
 #priority(id:string):number{return this.#records.get(id)?.priority??0;}
 #ageScore(record:AssetRecordV6):number{return this.#now()-record.lastUsedAt;}
 #evictionScore(record:AssetRecordV6):number{return (record.optional?2:0)-record.priority*0.01+this.#ageScore(record)*0.0001;}
 #residentCount():number{let count=0;for(const record of this.#records.values())if(record.state==='resident')count+=1;return count;}
 #residentBytes():number{let bytes=0;for(const record of this.#records.values())if(record.state==='resident')bytes+=record.bytes;return bytes;}
 #recount():void{let queued=0,loading=0,resident=0,failed=0,residentBytes=0;for(const record of this.#records.values()){if(record.state==='queued')queued+=1;if(record.state==='loading')loading+=1;if(record.state==='resident'){resident+=1;residentBytes+=record.bytes;}if(record.state==='failed')failed+=1;}this.#metrics=Object.freeze({...this.#metrics,registered:this.#records.size,queued,loading,resident,failed,residentBytes});}
}

export function buildAssetRecordV6(id:string,url:string,kind:AssetKindV6,bytes:number,priority=0,optional=false,digest=''):Omit<AssetRecordV6,'state'|'loadedAt'|'lastUsedAt'|'failures'>{return Object.freeze({id,url,kind,bytes:Math.max(0,Math.trunc(bytes)),priority:Math.trunc(priority),optional,digest,tags:Object.freeze([])});}
export function assetPlanBudgetV6(records:readonly AssetRecordV6[],maxBytes:number):readonly string[]{const sorted=[...records].sort((a,b)=>(b.priority-a.priority)||a.id.localeCompare(b.id));const result:string[]=[];let bytes=0;for(const record of sorted){if(record.state==='failed')continue;if(bytes+record.bytes>maxBytes&&record.optional)continue;if(bytes+record.bytes>maxBytes)break;result.push(record.id);bytes+=record.bytes;}return Object.freeze(result);}
