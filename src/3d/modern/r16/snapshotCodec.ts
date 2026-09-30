import { digestValue, stableValue } from './deterministic.js';
import type { R16Result, R16StateSnapshot } from './types.js';

export interface R16SnapshotCodecPolicy {
  readonly schema: 'aapw-r16-snapshot';
  readonly version: 16;
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxKeysPerObject: number;
  readonly maxArrayLength: number;
  readonly maxStringLength: number;
}
export interface R16EncodedSnapshot {
  readonly schema: 'aapw-r16-snapshot';
  readonly version: 16;
  readonly revision: number;
  readonly tick: number;
  readonly payload: string;
  readonly digest: string;
}

export const R16_SNAPSHOT_CODEC_POLICY:R16SnapshotCodecPolicy=Object.freeze({
  schema:'aapw-r16-snapshot',
  version:16,
  maxBytes:2*1024*1024,
  maxDepth:32,
  maxKeysPerObject:512,
  maxArrayLength:1024,
  maxStringLength:65536,
});

export class R16SnapshotCodec{
  readonly #policy:R16SnapshotCodecPolicy;
  constructor(policy:Partial<R16SnapshotCodecPolicy>={}){this.#policy=Object.freeze({...R16_SNAPSHOT_CODEC_POLICY,...policy});}
  encode(snapshot:R16StateSnapshot):R16Result<R16EncodedSnapshot>{
    if(snapshot.version!==16||snapshot.revision<0||snapshot.tick<0)return{ok:false,error:{code:'SNAPSHOT_HEADER',message:'Snapshot header is invalid',retryable:false}};
    const sanitized=sanitize(snapshot.state,0,this.#policy);
    if(!sanitized.ok)return sanitized;
    const body={schema:this.#policy.schema,version:16,revision:Math.trunc(snapshot.revision),tick:Math.trunc(snapshot.tick),state:sanitized.value};
    const payload=JSON.stringify(body);
    if(payload.length>this.#policy.maxBytes)return{ok:false,error:{code:'SNAPSHOT_BYTES',message:'Snapshot exceeds codec byte budget',retryable:true}};
    const digest=digestValue(body);
    return{ok:true,value:Object.freeze({...body,payload,digest}) as R16EncodedSnapshot};
  }
  decode(encoded:R16EncodedSnapshot):R16Result<R16StateSnapshot>{
    if(!encoded||encoded.schema!==this.#policy.schema||encoded.version!==16||encoded.payload.length>this.#policy.maxBytes)return{ok:false,error:{code:'SNAPSHOT_ENVELOPE',message:'Encoded snapshot envelope is invalid',retryable:false}};
    let body:unknown;
    try{body=JSON.parse(encoded.payload);}catch{return{ok:false,error:{code:'SNAPSHOT_JSON',message:'Snapshot payload is not valid JSON',retryable:false}};}
    if(!isRecord(body)||body.schema!==this.#policy.schema||body.version!==16)return{ok:false,error:{code:'SNAPSHOT_SCHEMA',message:'Snapshot schema mismatch',retryable:false}};
    const expected=digestValue(body);
    if(expected!==encoded.digest)return{ok:false,error:{code:'SNAPSHOT_DIGEST',message:'Snapshot digest mismatch',retryable:false}};
    const state=isRecord(body.state)?body.state:{};
    const snapshot:R16StateSnapshot=Object.freeze({version:16,revision:toInt(body.revision),tick:toInt(body.tick),state:Object.freeze(state),digest:expected,createdAtTick:toInt(body.tick)});
    return{ok:true,value:snapshot};
  }
  canonical(value:unknown):string{return stableValue(sanitizeOrNull(value,0,this.#policy));}
}
function sanitize(value:unknown,depth:number,policy:R16SnapshotCodecPolicy):R16Result<unknown>{
  if(depth>policy.maxDepth)return{ok:false,error:{code:'SNAPSHOT_DEPTH',message:'Snapshot depth limit exceeded',retryable:false}};
  if(value===null||typeof value==='boolean')return{ok:true,value};
  if(typeof value==='number')return{ok:true,value:Number.isFinite(value)?value:0};
  if(typeof value==='string')return value.length<=policy.maxStringLength?{ok:true,value}:{ok:false,error:{code:'SNAPSHOT_STRING',message:'Snapshot string limit exceeded',retryable:false}};
  if(typeof value==='bigint')return{ok:true,value:value.toString()};
  if(Array.isArray(value)){
    if(value.length>policy.maxArrayLength)return{ok:false,error:{code:'SNAPSHOT_ARRAY',message:'Snapshot array limit exceeded',retryable:false}};
    const out=[];for(const item of value){const child=sanitize(item,depth+1,policy);if(!child.ok)return child;out.push(child.value);}return{ok:true,value:Object.freeze(out)};
  }
  if(typeof value==='object'&&value!==null){
    const entries=Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b));
    if(entries.length>policy.maxKeysPerObject)return{ok:false,error:{code:'SNAPSHOT_KEYS',message:'Snapshot object key limit exceeded',retryable:false}};
    const out:Record<string,unknown>={};
    for(const[key,item]of entries){const child=sanitize(item,depth+1,policy);if(!child.ok)return child;out[key.slice(0,128)]=child.value;}
    return{ok:true,value:Object.freeze(out)};
  }
  return{ok:false,error:{code:'SNAPSHOT_TYPE',message:'Unsupported snapshot value type',retryable:false}};
}
function sanitizeOrNull(value:unknown,depth:number,policy:R16SnapshotCodecPolicy):unknown{const r=sanitize(value,depth,policy);return r.ok?r.value:null;}
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function toInt(value:unknown):number{const n=typeof value==='number'?value:Number(value);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):0;}
