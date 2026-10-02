import{hashBytes}from'./hash';
export interface AssetManifestEntry{readonly id:string;readonly url:string;readonly bytes:number;readonly digest:number;readonly version:string;readonly required:boolean;}
export interface AssetValidation{readonly accepted:boolean;readonly reason:string;readonly bytes:number;readonly digest:number;}
export class AssetIntegrityRegistry{
 #entries=new Map<string,AssetManifestEntry>();readonly maxBytes:number;
 constructor(maxBytes=256*1024*1024){this.maxBytes=Math.max(1024*1024,Math.trunc(maxBytes));}
 register(entry:AssetManifestEntry){if(!entry.id||!entry.url||entry.bytes<0||entry.bytes>this.maxBytes||this.#entries.has(entry.id))return false;try{const url=new URL(entry.url);if(url.protocol!=='https:')return false;}catch{return false;}this.#entries.set(entry.id,Object.freeze({...entry}));return true;}
 validate(id:string,data:Uint8Array):AssetValidation{const entry=this.#entries.get(id);const digest=hashBytes(data);if(!entry)return Object.freeze({accepted:false,reason:'unknown',bytes:data.byteLength,digest});if(data.byteLength!==entry.bytes)return Object.freeze({accepted:false,reason:'size-mismatch',bytes:data.byteLength,digest});if(digest!==entry.digest)return Object.freeze({accepted:false,reason:'digest-mismatch',bytes:data.byteLength,digest});return Object.freeze({accepted:true,reason:'ok',bytes:data.byteLength,digest});}
 get(id:string){return this.#entries.get(id)??null;}entries(){return Object.freeze([...this.#entries.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
 requiredMissing(loaded:ReadonlySet<string>){return Object.freeze([...this.#entries.values()].filter(e=>e.required&&!loaded.has(e.id)).map(e=>e.id).sort());}
 digest(){return hashBytes(new TextEncoder().encode(JSON.stringify(this.entries())));}clear(){this.#entries.clear();}
}
