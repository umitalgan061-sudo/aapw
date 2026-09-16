import type { WorldSnapshot } from './types';
import { stableHash } from './eventBus';

export interface EncodedWorld { readonly bytes: Uint8Array; readonly hash: string; readonly schemaVersion:number; readonly entityCount:number; }
export interface DecodePolicy { readonly maxBytes:number; readonly maxEntities:number; readonly expectedSchemaVersion:number; }
export interface CodecResult<T> { readonly ok:true;readonly value:T } | { readonly ok:false;readonly error:string };

/** Deterministic, size-guarded snapshot codec for saves, worker transfer and replay checkpoints. */
export class WorldStateCodec {
  private readonly policy:DecodePolicy;
  public constructor(policy:Partial<DecodePolicy>={}){this.policy={maxBytes:policy.maxBytes??5*1024*1024,maxEntities:policy.maxEntities??100_000,expectedSchemaVersion:policy.expectedSchemaVersion??1};}
  public encode(snapshot:WorldSnapshot):EncodedWorld{if(snapshot.schemaVersion!==this.policy.expectedSchemaVersion)throw new Error(`WORLD_SCHEMA_UNSUPPORTED:${snapshot.schemaVersion}`);if(snapshot.entities.length>this.policy.maxEntities)throw new Error('WORLD_ENTITY_LIMIT');const json=JSON.stringify(snapshot);const bytes=new TextEncoder().encode(json);if(bytes.byteLength>this.policy.maxBytes)throw new Error('WORLD_SNAPSHOT_TOO_LARGE');return{bytes,hash:stableHash(json).toString(16).padStart(8,'0'),schemaVersion:snapshot.schemaVersion,entityCount:snapshot.entities.length};}
  public decode(bytes:Uint8Array):CodecResult<WorldSnapshot>{if(bytes.byteLength>this.policy.maxBytes)return{ok:false,error:'WORLD_SNAPSHOT_TOO_LARGE'};try{const parsed=JSON.parse(new TextDecoder().decode(bytes)) as WorldSnapshot;if(parsed.schemaVersion!==this.policy.expectedSchemaVersion)return{ok:false,error:'WORLD_SCHEMA_UNSUPPORTED'};if(!Array.isArray(parsed.entities)||parsed.entities.length>this.policy.maxEntities)return{ok:false,error:'WORLD_ENTITY_LIMIT'};if(!parsed.revision||!parsed.capturedAt||typeof parsed.seed!=='number')return{ok:false,error:'WORLD_HEADER_INVALID'};return{ok:true,value:parsed};}catch{return{ok:false,error:'WORLD_DECODE_FAILED'};}}
  public clone(snapshot:WorldSnapshot):WorldSnapshot{const encoded=this.encode(snapshot);const decoded=this.decode(encoded.bytes);if(!decoded.ok)throw new Error(decoded.error);return decoded.value;}
  public verify(snapshot:WorldSnapshot):{readonly valid:boolean;readonly hash:string;readonly bytes:number}{try{const encoded=this.encode(snapshot);return{valid:true,hash:encoded.hash,bytes:encoded.bytes.byteLength};}catch{return{valid:false,hash:'',bytes:0};}}
}

export interface ReplayEvent { readonly tick:number; readonly type:string; readonly payload:unknown; }
export interface ReplaySegment { readonly seed:number; readonly startTick:number; readonly endTick:number; readonly events:readonly ReplayEvent[]; readonly checksum:string; }

/** Compact replay recorder with deterministic canonical event ordering. */
export class ReplayRecorder {
  private readonly seed:number; private readonly events:ReplayEvent[]=[]; private recording=false; private startTick=0; private disposed=false;
  public constructor(seed:number){this.seed=seed>>>0;}
  public start(tick=0):void{this.ensure();this.events.length=0;this.startTick=tick;this.recording=true;}
  public push(event:ReplayEvent):void{this.ensure();if(!this.recording)return;if(!Number.isInteger(event.tick)||event.tick<this.startTick)throw new RangeError('REPLAY_TICK_INVALID');this.events.push({tick:event.tick,type:event.type,payload:event.payload});}
  public stop(endTick=this.events.at(-1)?.tick??this.startTick):ReplaySegment{this.ensure();this.recording=false;const events=[...this.events].sort((a,b)=>a.tick-b.tick||a.type.localeCompare(b.type)||JSON.stringify(a.payload).localeCompare(JSON.stringify(b.payload)));const checksum=stableHash(JSON.stringify(events)).toString(16).padStart(8,'0');return{seed:this.seed,startTick:this.startTick,endTick,events,checksum};}
  public size():number{return this.events.length;}
  private ensure():void{if(this.disposed)throw new Error('REPLAY_RECORDER_DISPOSED');}
  public dispose():void{if(this.disposed)return;this.events.length=0;this.disposed=true;}
}
