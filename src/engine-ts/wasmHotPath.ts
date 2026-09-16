import type { Result } from './coreTypes.ts';
import { err, ok, clamp } from './coreTypes.ts';

export const WASM_HOTPATH_CONTRACT_VERSION = 1 as const;
export const WASM_HOTPATH_DEFAULT_URL = '/wasm/aapw_hotpath.wasm';

export type WasmBackend = 'wasm' | 'typescript';

export interface WasmHotPathCapabilities { readonly backend: WasmBackend; readonly wasmAvailable: boolean; readonly contractVersion: number; readonly exports: readonly string[]; readonly reason?: string; }
export interface WasmHotPathOptions { readonly url?: string; readonly fetchImpl?: typeof fetch; readonly forceFallback?: boolean; readonly strict?: boolean; }
export interface TerrainBatch { readonly coordinates: Float32Array; readonly seed: number; }
export interface TerrainBatchResult { readonly heights: Float32Array; readonly backend: WasmBackend; readonly samples: number; }
export interface PointCloudBatch { readonly points: Float32Array; readonly originX: number; readonly originZ: number; readonly scale: number; }
export interface PointCloudResult { readonly points: Float32Array; readonly backend: WasmBackend; readonly pointsCount: number; }

interface HotPathExports {
  readonly memory?: WebAssembly.Memory;
  readonly sample_height?: (x: number, z: number, seed: number) => number;
  readonly sample_height_batch?: (ptr: number, count: number, seed: number) => number;
  readonly transform_points?: (ptr: number, count: number, ox: number, oz: number, scale: number) => number;
  readonly version?: () => number;
  readonly lod_factor?: (distance: number, near: number, far: number) => number;
  readonly distance_sq?: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number;
  readonly spatial_key?: (x: number, z: number) => number;
  readonly aabb_visible?: (minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number,cx:number,cy:number,cz:number,radius:number) => number;
  readonly bilinear_sample?: (h00: number, h10: number, h01: number, h11: number, tx: number, tz: number) => number;
  readonly quantize?: (value: number, step: number) => number;
}

interface LoadedModule { readonly backend: 'wasm'; readonly exports: HotPathExports; readonly bytes: number; }
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const i32 = (value: number): number => Math.trunc(finite(value));
const u32 = (value: number): number => i32(value) >>> 0;
const hashU32 = (input: number): number => { let x = u32(input); x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); return (x ^ (x >>> 16)) >>> 0; };
const hash2 = (x: number, z: number, seed: number): number => hashU32((u32(x) ^ hashU32((u32(z) + u32(seed)) >>> 0)) >>> 0);
const smooth = (t: number): number => { const x = clamp(finite(t), 0, 1); return x * x * (3 - 2 * x); };
const valueNoise = (x: number, z: number, seed: number): number => { const x0 = Math.floor(x); const z0 = Math.floor(z); const fx = x - x0; const fz = z - z0; const sx = smooth(fx); const sz = smooth(fz); const n00 = hash2(x0,z0,seed)/0xffffffff; const n10=hash2(x0+1,z0,seed)/0xffffffff; const n01=hash2(x0,z0+1,seed)/0xffffffff; const n11=hash2(x0+1,z0+1,seed)/0xffffffff; const nx0=n00+(n10-n00)*sx; const nx1=n01+(n11-n01)*sx; return (nx0+(nx1-nx0)*sz)*2-1; };

export const sampleHeightTypeScript = (x: number, z: number, seed: number): number => { let frequency=0.0016; let amplitude=1; let total=0; let weight=0; for(let octave=0;octave<6;octave+=1){ total+=valueNoise(x*frequency,z*frequency,(u32(seed)+octave*0x9e37)>>>0)*amplitude; weight+=amplitude; amplitude*=0.5; frequency*=2.03; } const normalized=weight>0?total/weight:0; const broad=valueNoise(x*0.00055,z*0.00055,u32(seed)^0xA53C91D7); return 320+normalized*125+broad*55; };
export const lodFactorTypeScript=(distance:number,near:number,far:number):number=>{if(far<=near)return distance<=near?1:0;const t=clamp((finite(distance)-near)/(far-near),0,1);return 1-t*t*(3-2*t);};
export const distanceSquaredTypeScript=(ax:number,ay:number,az:number,bx:number,by:number,bz:number):number=>{const dx=ax-bx,dy=ay-by,dz=az-bz;return dx*dx+dy*dy+dz*dz;};
export const spatialKeyTypeScript=(cellX:number,cellZ:number):number=>hash2(i32(cellX),i32(cellZ),0xB5297A4D);
export const aabbVisibleTypeScript=(minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number,cx:number,cy:number,cz:number,radius:number):boolean=>{const px=Math.max(minX,Math.min(cx,maxX)),py=Math.max(minY,Math.min(cy,maxY)),pz=Math.max(minZ,Math.min(cz,maxZ));return distanceSquaredTypeScript(cx,cy,cz,px,py,pz)<=radius*radius;};
export const bilinearSampleTypeScript=(h00:number,h10:number,h01:number,h11:number,tx:number,tz:number):number=>{const x=clamp(finite(tx),0,1),z=clamp(finite(tz),0,1);return (h00+(h10-h00)*x)*(1-z)+(h01+(h11-h01)*x)*z;};
export const quantizeTypeScript=(value:number,step:number):number=>step>0?Math.round(value/step):0;

const wasmExports=(instance:WebAssembly.Instance):HotPathExports|null=>{const raw=instance.exports as unknown as Record<string,unknown>;const value=raw as HotPathExports;return raw && ('version' in raw) ? value : null;};
const bytesFromResponse=async(response:Response):Promise<Uint8Array>=>{if(!response.ok)throw new Error(`WASM fetch failed: ${response.status}`);return new Uint8Array(await response.arrayBuffer());};

export class WasmHotPath implements Disposable {
  private module:LoadedModule|null=null; private initialized=false; private disposed=false; private readonly requestedUrl:string; private readonly fetchImpl:typeof fetch; private readonly forceFallback:boolean; private readonly strict:boolean; private reason='not initialized';
  public constructor(options:WasmHotPathOptions={}){this.requestedUrl=options.url??WASM_HOTPATH_DEFAULT_URL;this.fetchImpl=options.fetchImpl??globalThis.fetch.bind(globalThis);this.forceFallback=options.forceFallback??false;this.strict=options.strict??false;}
  public async initialize():Promise<WasmHotPathCapabilities>{if(this.disposed)throw new Error('wasm hot path disposed');if(this.initialized)return this.capabilities();this.initialized=true;if(this.forceFallback){this.reason='forced-typescript-fallback';return this.capabilities();}try{const response=await this.fetchImpl(this.requestedUrl,{cache:'force-cache'});const bytes=await bytesFromResponse(response);const result=await WebAssembly.instantiate(bytes,{});const exports=wasmExports(result.instance);if(!exports?.version||exports.version()!==WASM_HOTPATH_CONTRACT_VERSION)throw new Error('WASM hot path contract mismatch');this.module={backend:'wasm',exports,bytes:bytes.byteLength};this.reason='wasm-active';}catch(cause){this.module=null;this.reason=cause instanceof Error?cause.message:'unknown-wasm-failure';if(this.strict)throw new Error(this.reason);}return this.capabilities();}
  public capabilities():WasmHotPathCapabilities{const names=this.module?Object.keys(this.module.exports).sort():[];return Object.freeze({backend:this.module?'wasm':'typescript',wasmAvailable:Boolean(this.module),contractVersion:this.module?.exports.version?.()??0,exports:names,...(this.reason?{reason:this.reason}:{})});}
  public sampleHeight(x:number,z:number,seed:number):number{return this.module?.exports.sample_height?.(finite(x),finite(z),u32(seed))??sampleHeightTypeScript(x,z,seed);}
  public sampleHeightBatch(batch:TerrainBatch):TerrainBatchResult{const coordinates=batch.coordinates;if(coordinates.length%2!==0)return{heights:new Float32Array(),backend:'typescript',samples:0};const count=coordinates.length/2;const wasm=this.module?.exports;if(!wasm?.sample_height_batch||!wasm.memory){const heights=new Float32Array(count);for(let i=0;i<count;i+=1)heights[i]=this.sampleHeight(coordinates[i*2]??0,coordinates[i*2+1]??0,batch.seed);return{heights,backend:this.module?'wasm':'typescript',samples:count};}const input=new Float32Array(wasm.memory.buffer,0,coordinates.length);input.set(coordinates);const ptr=wasm.sample_height_batch(0,count,u32(batch.seed));const output=new Float32Array(wasm.memory.buffer,ptr,count);return{heights:new Float32Array(output),backend:'wasm',samples:count};}
  public transformPoints(batch:PointCloudBatch):PointCloudResult{const count=Math.floor(batch.points.length/2);const wasm=this.module?.exports;if(!wasm?.transform_points||!wasm.memory){const points=new Float32Array(batch.points.length);for(let i=0;i<count;i+=1){points[i*2]=finite(batch.originX)+(batch.points[i*2]??0)*finite(batch.scale,1);points[i*2+1]=finite(batch.originZ)+(batch.points[i*2+1]??0)*finite(batch.scale,1);}return{points,backend:this.module?'wasm':'typescript',pointsCount:count};}const input=new Float32Array(wasm.memory.buffer,0,batch.points.length);input.set(batch.points);const ptr=wasm.transform_points(0,count,finite(batch.originX),finite(batch.originZ),finite(batch.scale,1));const output=new Float32Array(wasm.memory.buffer,ptr,count*2);return{points:new Float32Array(output),backend:'wasm',pointsCount:count};}
  public lodFactor(distance:number,near:number,far:number):number{return this.module?.exports.lod_factor?.(distance,near,far)??lodFactorTypeScript(distance,near,far);}
  public distanceSquared(ax:number,ay:number,az:number,bx:number,by:number,bz:number):number{return this.module?.exports.distance_sq?.(ax,ay,az,bx,by,bz)??distanceSquaredTypeScript(ax,ay,az,bx,by,bz);}
  public spatialKey(cellX:number,cellZ:number):number{return this.module?.exports.spatial_key?.(i32(cellX),i32(cellZ))??spatialKeyTypeScript(cellX,cellZ);}
  public aabbVisible(minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number,cx:number,cy:number,cz:number,radius:number):boolean{return Boolean(this.module?.exports.aabb_visible?.(minX,minY,minZ,maxX,maxY,maxZ,cx,cy,cz,radius)??(aabbVisibleTypeScript(minX,minY,minZ,maxX,maxY,maxZ,cx,cy,cz,radius)?1:0));}
  public bilinearSample(h00:number,h10:number,h01:number,h11:number,tx:number,tz:number):number{return this.module?.exports.bilinear_sample?.(h00,h10,h01,h11,tx,tz)??bilinearSampleTypeScript(h00,h10,h01,h11,tx,tz);}
  public quantize(value:number,step:number):number{return this.module?.exports.quantize?.(value,step)??quantizeTypeScript(value,step);}
  public async warmup():Promise<Result<WasmHotPathCapabilities,string>>{try{return ok(await this.initialize());}catch(error){return err(error instanceof Error?error.message:'wasm warmup failed');}}
  public dispose():void{if(this.disposed)return;this.disposed=true;this.module=null;}
}
export const createWasmHotPath=async(options:WasmHotPathOptions={}):Promise<WasmHotPathCapabilities&{readonly runtime:WasmHotPath}>=>{const runtime=new WasmHotPath(options);const capabilities=await runtime.initialize();return Object.freeze({...capabilities,runtime});};
