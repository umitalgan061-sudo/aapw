import { digestValue } from './deterministic.js';
import type { R16Result } from './types.js';

export interface R16AssetManifestEntry {
  readonly id: string;
  readonly url: string;
  readonly kind: 'model'|'texture'|'audio'|'shader'|'data';
  readonly bytes: number;
  readonly digest: string;
  readonly required: boolean;
}
export interface R16AssetManifest {
  readonly version: 16;
  readonly entries: readonly R16AssetManifestEntry[];
  readonly digest: string;
}
export interface R16AssetValidation {
  readonly accepted: boolean;
  readonly id: string;
  readonly bytes: number;
  readonly reason: string|null;
  readonly digest: string;
}

export class R16AssetIntegrityRegistry {
  readonly #entries = new Map<string,R16AssetManifestEntry>();
  register(entry:R16AssetManifestEntry):R16Result<void> {
    if(!entry.id||entry.id.length>128)return{ok:false,error:{code:'ASSET_ID',message:'Asset id invalid',retryable:false}};
    if(!entry.url||entry.url.includes('data:')||entry.url.includes('javascript:'))return{ok:false,error:{code:'ASSET_URL',message:'Asset URL is not allowed',retryable:false}};
    if(!Number.isInteger(entry.bytes)||entry.bytes<1||entry.bytes>512*1024*1024)return{ok:false,error:{code:'ASSET_BYTES',message:'Asset bytes outside safe range',retryable:false}};
    if(!/^[a-f0-9]{8,128}$/i.test(entry.digest))return{ok:false,error:{code:'ASSET_DIGEST',message:'Asset digest invalid',retryable:false}};
    if(this.#entries.has(entry.id))return{ok:false,error:{code:'ASSET_DUPLICATE',message:'Asset already registered',retryable:false}};
    this.#entries.set(entry.id,Object.freeze({...entry,id:entry.id.slice(0,128),url:entry.url.slice(0,2048),bytes:Math.trunc(entry.bytes),digest:entry.digest.toLowerCase()}));
    return{ok:true,value:undefined};
  }
  validateBytes(id:string,data:ArrayBuffer|Uint8Array):R16AssetValidation{
    const entry=this.#entries.get(id);if(!entry)return Object.freeze({accepted:false,id,bytes:data.byteLength,reason:'missing-manifest',digest:''});
    const bytes=new Uint8Array(data instanceof ArrayBuffer?data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
    const digest=digestValue(Array.from(bytes));
    const accepted=bytes.byteLength===entry.bytes&&digest===entry.digest;
    return Object.freeze({accepted,id,bytes:bytes.byteLength,reason:accepted?null:(bytes.byteLength!==entry.bytes?'size-mismatch':'digest-mismatch'),digest});
  }
  manifest():R16AssetManifest{
    const entries=Object.freeze([...this.#entries.values()].sort((a,b)=>a.id.localeCompare(b.id)));
    return Object.freeze({version:16,entries,digest:digestValue(entries)});
  }
  get(id:string){return this.#entries.get(id)??null;}clear(){this.#entries.clear();}
}
