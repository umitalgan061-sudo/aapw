import { digestValue,normalizeTick,safeJsonSize } from './deterministic.js';
import type { R16PeerBudget,R16ReplicationAck,R16ReplicationDelta,R16ReplicationEntity,R16Result,R16RuntimeConfig } from './types.js';

export class R16ReplicationLedger{
  readonly #maxEntities:number;readonly #maxDeltas:number;readonly #maxBytes:number;
  readonly #entities=new Map<string,R16ReplicationEntity>();readonly #accepted=new Map<string,number>();
  #tick=-1;#tickBytes=0;#tickDeltas=0;
  constructor(config:Pick<R16RuntimeConfig,'maxReplicationEntities'|'maxReplicationDeltasPerTick'|'maxReplicationBytesPerTick'>){
    this.#maxEntities=Math.max(1,Math.trunc(config.maxReplicationEntities));this.#maxDeltas=Math.max(1,Math.trunc(config.maxReplicationDeltasPerTick));this.#maxBytes=Math.max(1024,Math.trunc(config.maxReplicationBytesPerTick));
  }
  upsert(entity:R16ReplicationEntity):R16Result<void>{
    if(!entity.entityId||entity.entityId.length>96)return{ok:false,error:{code:'REPL_ENTITY_ID',message:'Entity id is invalid',retryable:false}};
    if(!Number.isInteger(entity.revision)||entity.revision<0)return{ok:false,error:{code:'REPL_REVISION',message:'Revision is invalid',retryable:false}};
    const current=this.#entities.get(entity.entityId);
    if(!current&&this.#entities.size>=this.#maxEntities)return{ok:false,error:{code:'REPL_ENTITY_CAP',message:'Entity capacity reached',retryable:true}};
    if(current&&entity.revision<=current.revision)return{ok:false,error:{code:'REPL_STALE',message:'Revision is stale',retryable:false}};
    this.#entities.set(entity.entityId,freezeEntity(entity));return{ok:true,value:undefined};
  }
  remove(entityId:string,revision:number):R16Result<void>{
    const current=this.#entities.get(entityId);if(!current)return{ok:false,error:{code:'REPL_MISSING',message:'Entity is not tracked',retryable:false}};
    if(revision<=current.revision)return{ok:false,error:{code:'REPL_STALE_REMOVE',message:'Removal revision is stale',retryable:false}};
    this.#entities.delete(entityId);return{ok:true,value:undefined};
  }
  beginTick(tick:number){const t=normalizeTick(tick);if(t!==this.#tick){this.#tick=t;this.#tickBytes=0;this.#tickDeltas=0;}}
  delta(entityId:string,changed:Readonly<Record<string,unknown>>,removed:readonly string[]):R16Result<R16ReplicationDelta>{
    const entity=this.#entities.get(entityId);if(!entity)return{ok:false,error:{code:'REPL_MISSING',message:'Entity is not tracked',retryable:false}};
    if(this.#tickDeltas>=this.#maxDeltas)return{ok:false,error:{code:'REPL_DELTA_CAP',message:'Delta budget reached',retryable:true}};
    const normalized=Object.freeze(Object.fromEntries(Object.entries(changed).sort(([a],[b])=>a.localeCompare(b))));
    const removedKeys=Object.freeze([...new Set(removed.map(x=>String(x).slice(0,96)))].sort());
    const checksum=digestValue({tick:this.#tick,entityId,revision:entity.revision,changed:normalized,removed:removedKeys});
    const value:R16ReplicationDelta=Object.freeze({tick:this.#tick,entityId,revision:entity.revision,changed:normalized,removed:removedKeys,checksum});
    const bytes=safeJsonSize(value);if(this.#tickBytes+bytes>this.#maxBytes)return{ok:false,error:{code:'REPL_BYTE_CAP',message:'Byte budget reached',retryable:true}};
    this.#tickBytes+=bytes;this.#tickDeltas++;return{ok:true,value};
  }
  accept(delta:R16ReplicationDelta):R16ReplicationAck{
    const last=this.#accepted.get(delta.entityId)??-1;
    const checksum=digestValue({tick:delta.tick,entityId:delta.entityId,revision:delta.revision,changed:delta.changed,removed:delta.removed});
    if(checksum!==delta.checksum)return Object.freeze({entityId:delta.entityId,acceptedRevision:last,rejected:true,reason:'checksum-mismatch'});
    if(delta.revision<=last)return Object.freeze({entityId:delta.entityId,acceptedRevision:last,rejected:true,reason:'stale-revision'});
    this.#accepted.set(delta.entityId,delta.revision);return Object.freeze({entityId:delta.entityId,acceptedRevision:delta.revision,rejected:false,reason:null});
  }
  peerBudget(peer:R16PeerBudget,tick:number):readonly R16ReplicationDelta[]{
    this.beginTick(tick);const result:R16ReplicationDelta[]=[];
    for(const entity of [...this.#entities.values()].sort((a,b)=>a.entityId.localeCompare(b.entityId)).slice(0,Math.max(0,Math.trunc(peer.maxEntities)))){
      if(result.length>=peer.maxDeltasPerTick)break;const delta=this.delta(entity.entityId,entity.components,[]);
      if(!delta.ok)break;const nextBytes=result.reduce((sum,x)=>sum+safeJsonSize(x),0)+safeJsonSize(delta.value);if(nextBytes>peer.maxBytesPerTick)break;result.push(delta.value);
    }
    return Object.freeze(result);
  }
  entity(entityId:string){return this.#entities.get(entityId)??null;}count(){return this.#entities.size;}
  digest(){return digestValue({entities:[...this.#entities.values()].sort((a,b)=>a.entityId.localeCompare(b.entityId)),accepted:[...this.#accepted.entries()].sort(([a],[b])=>a.localeCompare(b))});}
  clear(){this.#entities.clear();this.#accepted.clear();this.#tick=-1;this.#tickBytes=0;this.#tickDeltas=0;}
}
function freezeEntity(e:R16ReplicationEntity):R16ReplicationEntity{
  return Object.freeze({
    ...e,entityId:e.entityId.slice(0,96),revision:Math.max(0,Math.trunc(e.revision)),
    components:Object.freeze(Object.fromEntries(Object.entries(e.components).sort(([a],[b])=>a.localeCompare(b)))),
    position:e.position?Object.freeze([...e.position] as [number,number,number]):undefined,
    rotation:e.rotation?Object.freeze([...e.rotation] as [number,number,number,number]):undefined,
    velocity:e.velocity?Object.freeze([...e.velocity] as [number,number,number]):undefined,
  });
}
