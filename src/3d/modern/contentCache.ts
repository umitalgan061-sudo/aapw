import type { AssetId, Disposable } from './types';
import { stableHash } from './eventBus';

export interface CacheEntry<T=unknown>{readonly key:string;readonly assetId:AssetId;readonly value:T;readonly bytes:number;readonly createdAt:number;lastAccess:number;readonly checksum:string;}
export interface CacheStats{readonly entries:number;readonly bytes:number;readonly budgetBytes:number;readonly hits:number;readonly misses:number;readonly evictions:number;}
export interface CacheOptions{readonly byteBudget:number;readonly entryBudget:number;readonly now?:()=>number;}

/** In-memory content-addressed cache with LRU eviction and integrity hashes. */
export class ContentAddressedCache<T=unknown> implements Disposable{
  private readonly byteBudget:number;private readonly entryBudget:number;private readonly now:()=>number;private readonly entries=new Map<string,CacheEntry<T>>();private hits=0;private misses=0;private evictions=0;private bytes=0;private disposed=false;
  public constructor(options:CacheOptions){this.byteBudget=Math.max(1024,Math.floor(options.byteBudget));this.entryBudget=Math.max(8,Math.floor(options.entryBudget));this.now=options.now??Date.now;}
  public makeKey(assetId:AssetId,version:string,variant:string):string{return `${assetId}:${version}:${variant}`;}
  public get(key:string):T|undefined{this.ensure();const entry=this.entries.get(key);if(!entry){this.misses+=1;return undefined;}entry.lastAccess=this.now();this.hits+=1;return entry.value;}
  public set(key:string,assetId:AssetId,value:T,bytes:number):void{this.ensure();if(!key)throw new Error('CACHE_KEY_REQUIRED');const size=Math.max(0,Math.floor(bytes));if(size>this.byteBudget)throw new Error('CACHE_ENTRY_TOO_LARGE');const existing=this.entries.get(key);if(existing)this.bytes-=existing.bytes;const time=this.now();const entry:CacheEntry<T>={key,assetId,value,bytes:size,createdAt:existing?.createdAt??time,lastAccess:time,checksum:stableHash(JSON.stringify(value)).toString(16).padStart(8,'0')};this.entries.set(key,entry);this.bytes+=size;this.trim();}
  public has(key:string):boolean{this.ensure();return this.entries.has(key);}
  public delete(key:string):boolean{this.ensure();const entry=this.entries.get(key);if(!entry)return false;this.entries.delete(key);this.bytes-=entry.bytes;return true;}
  public invalidateAsset(assetId:AssetId):number{this.ensure();let removed=0;for(const[key,entry]of this.entries)if(entry.assetId===assetId){this.entries.delete(key);this.bytes-=entry.bytes;removed+=1;}return removed;}
  public stats():CacheStats{return{entries:this.entries.size,bytes:this.bytes,budgetBytes:this.byteBudget,hits:this.hits,misses:this.misses,evictions:this.evictions};}
  public keys():readonly string[]{return[...this.entries.keys()].sort();}
  public verify(key:string):boolean{const entry=this.entries.get(key);if(!entry)return false;return stableHash(JSON.stringify(entry.value)).toString(16).padStart(8,'0')===entry.checksum;}
  public clear():void{this.entries.clear();this.bytes=0;}
  private trim():void{while(this.bytes>this.byteBudget||this.entries.size>this.entryBudget){const oldest=[...this.entries.values()].sort((a,b)=>a.lastAccess-b.lastAccess||a.key.localeCompare(b.key))[0];if(!oldest)break;this.entries.delete(oldest.key);this.bytes-=oldest.bytes;this.evictions+=1;}}
  private ensure():void{if(this.disposed)throw new Error('CONTENT_CACHE_DISPOSED');}
  public dispose():void{if(this.disposed)return;this.clear();this.disposed=true;}
}

export interface CompressionResult{readonly bytes:Uint8Array;readonly compressed:boolean;readonly originalBytes:number;readonly finalBytes:number;readonly algorithm:'gzip'|'deflate'|'none';}

/** Browser-native compression when available, with a deterministic no-op fallback. */
export const compressBytes=async(input:Uint8Array,algorithm:'gzip'|'deflate'='gzip'):Promise<CompressionResult>=>{if(typeof CompressionStream==='undefined')return{bytes:input,compressed:false,originalBytes:input.byteLength,finalBytes:input.byteLength,algorithm:'none'};const stream=new CompressionStream(algorithm);const writer=stream.writable.getWriter();await writer.write(input);await writer.close();const buffer=await new Response(stream.readable).arrayBuffer();const bytes=new Uint8Array(buffer);return{bytes,compressed:true,originalBytes:input.byteLength,finalBytes:bytes.byteLength,algorithm};};

export const decompressBytes=async(input:Uint8Array,algorithm:'gzip'|'deflate'):Promise<Uint8Array>=>{if(typeof DecompressionStream==='undefined')throw new Error('DECOMPRESSION_UNAVAILABLE');const stream=new DecompressionStream(algorithm);const writer=stream.writable.getWriter();await writer.write(input);await writer.close();return new Uint8Array(await new Response(stream.readable).arrayBuffer());};
