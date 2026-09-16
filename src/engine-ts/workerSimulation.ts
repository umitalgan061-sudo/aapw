import type { Disposable, EngineResult } from './coreTypes.ts';
import { err, ok } from './coreTypes.ts';
import { WasmHotPath, type TerrainBatch, type PointCloudBatch, type WasmHotPathCapabilities } from './wasmHotPath.ts';

export type SimulationWorkerCommand =
  | { readonly type: 'init'; readonly requestId: number; readonly seed: number; readonly wasmUrl?: string }
  | { readonly type: 'sample-height'; readonly requestId: number; readonly coordinates: ArrayBuffer; readonly seed: number }
  | { readonly type: 'transform-points'; readonly requestId: number; readonly points: ArrayBuffer; readonly originX: number; readonly originZ: number; readonly scale: number }
  | { readonly type: 'health'; readonly requestId: number }
  | { readonly type: 'dispose'; readonly requestId: number };

export type SimulationWorkerResponse =
  | { readonly type: 'ready'; readonly requestId: number; readonly capabilities: WasmHotPathCapabilities }
  | { readonly type: 'sample-height-result'; readonly requestId: number; readonly heights: ArrayBuffer; readonly backend: 'wasm' | 'typescript' }
  | { readonly type: 'transform-points-result'; readonly requestId: number; readonly points: ArrayBuffer; readonly backend: 'wasm' | 'typescript' }
  | { readonly type: 'health-result'; readonly requestId: number; readonly capabilities: WasmHotPathCapabilities; readonly queues: WorkerQueueStats }
  | { readonly type: 'error'; readonly requestId: number; readonly code: string; readonly message: string }
  | { readonly type: 'disposed'; readonly requestId: number };

export interface WorkerQueueStats { readonly received: number; readonly completed: number; readonly failed: number; readonly queued: number; readonly inFlight: number; readonly peakQueue: number; }
export interface SimulationWorkerOptions { readonly wasm?: WasmHotPath; readonly maxQueue?: number; readonly maxBatchSamples?: number; }

type PendingCommand = SimulationWorkerCommand;
const DEFAULT_MAX_QUEUE = 32;
const DEFAULT_MAX_BATCH = 16_384;
const makeQueueStats=(received:number,completed:number,failed:number,queued:number,inFlight:number,peakQueue:number):WorkerQueueStats=>Object.freeze({received,completed,failed,queued,inFlight,peakQueue});

export class SimulationWorkerHost implements Disposable {
  private readonly wasm:WasmHotPath; private readonly queue:PendingCommand[]=[]; private readonly maxQueue:number; private readonly maxBatchSamples:number; private processing=false; private disposed=false; private received=0; private completed=0; private failed=0; private peakQueue=0;
  public constructor(options:SimulationWorkerOptions={}){this.wasm=options.wasm??new WasmHotPath();this.maxQueue=Math.max(4,Math.trunc(options.maxQueue??DEFAULT_MAX_QUEUE));this.maxBatchSamples=Math.max(64,Math.trunc(options.maxBatchSamples??DEFAULT_MAX_BATCH));}
  public async dispatch(command:SimulationWorkerCommand):Promise<SimulationWorkerResponse>{if(this.disposed)return{type:'error',requestId:command.requestId,code:'WORKER_DISPOSED',message:'worker host disposed'};if(this.queue.length>=this.maxQueue){this.failed+=1;return{type:'error',requestId:command.requestId,code:'QUEUE_OVERFLOW',message:'simulation worker queue is full'};}this.received+=1;this.queue.push(command);this.peakQueue=Math.max(this.peakQueue,this.queue.length);return this.drainUntil(command.requestId);}
  public stats():WorkerQueueStats{return makeQueueStats(this.received,this.completed,this.failed,this.queue.length,this.processing?1:0,this.peakQueue);}
  public capabilities():WasmHotPathCapabilities{return this.wasm.capabilities();}
  public dispose():void{if(this.disposed)return;this.disposed=true;this.queue.length=0;this.wasm.dispose();}
  private async drainUntil(requestId:number):Promise<SimulationWorkerResponse>{let matching:SimulationWorkerResponse|undefined;if(this.processing){while(!matching&&!this.disposed)await new Promise(resolve=>setTimeout(resolve,0));return matching??{type:'error',requestId,code:'WORKER_DISPOSED',message:'worker host disposed'};}this.processing=true;try{while(this.queue.length>0&&!this.disposed){const command=this.queue.shift();if(!command)continue;const response=await this.handle(command);if(command.requestId===requestId)matching=response;}}finally{this.processing=false;}return matching??{type:'error',requestId,code:'REQUEST_NOT_COMPLETED',message:'request was not completed'};}
  private async handle(command:SimulationWorkerCommand):Promise<SimulationWorkerResponse>{try{switch(command.type){case'init':{const capabilities=await this.wasm.initialize();this.completed+=1;return{type:'ready',requestId:command.requestId,capabilities};}case'sample-height':{const coordinates=new Float32Array(command.coordinates);if(coordinates.length/2>this.maxBatchSamples)throw new Error(`batch exceeds ${this.maxBatchSamples} samples`);const result=this.wasm.sampleHeightBatch({coordinates,seed:command.seed} satisfies TerrainBatch);this.completed+=1;return{type:'sample-height-result',requestId:command.requestId,heights:result.heights.buffer,backend:result.backend};}case'transform-points':{const points=new Float32Array(command.points);if(points.length/2>this.maxBatchSamples)throw new Error(`batch exceeds ${this.maxBatchSamples} points`);const result=this.wasm.transformPoints({points,originX:command.originX,originZ:command.originZ,scale:command.scale} satisfies PointCloudBatch);this.completed+=1;return{type:'transform-points-result',requestId:command.requestId,points:result.points.buffer,backend:result.backend};}case'health':this.completed+=1;return{type:'health-result',requestId:command.requestId,capabilities:this.wasm.capabilities(),queues:this.stats()};case'dispose':this.completed+=1;this.dispose();return{type:'disposed',requestId:command.requestId};default:return assertNever(command);}}catch(error){this.failed+=1;return{type:'error',requestId:command.requestId,code:'COMMAND_FAILED',message:error instanceof Error?error.message:'simulation worker command failed'};}}
}
const assertNever=(value:never):never=>{throw new Error(`unhandled worker command ${(value as {readonly type:string}).type}`);};

export interface SimulationWorkerClient extends Disposable { readonly ready:boolean; readonly backend:'wasm'|'typescript'; initialize():Promise<EngineResult<WasmHotPathCapabilities,string>>; sampleHeights(coordinates:Float32Array,seed:number):Promise<EngineResult<Float32Array,string>>; transformPoints(points:Float32Array,originX:number,originZ:number,scale:number):Promise<EngineResult<Float32Array,string>>; health():Promise<EngineResult<WorkerQueueStats,string>>; }
export interface WorkerTransport { postMessage(message:SimulationWorkerCommand,transfer?:Transferable[]):void; addEventListener(type:'message'|'error',listener:(event:MessageEvent|ErrorEvent)=>void):void; removeEventListener?(type:'message'|'error',listener:(event:MessageEvent|ErrorEvent)=>void):void; }

export class TypedSimulationWorkerClient implements SimulationWorkerClient {
  private readonly transport:WorkerTransport; private sequence=1; private waiting=new Map<number,(response:SimulationWorkerResponse)=>void>(); private disposed=false; private _ready=false; private _backend:'wasm'|'typescript'='typescript';
  public constructor(transport:WorkerTransport){this.transport=transport;this.transport.addEventListener('message',this.onMessage);this.transport.addEventListener('error',this.onError);}
  public get ready():boolean{return this._ready;} public get backend():'wasm'|'typescript'{return this._backend;}
  public initialize():Promise<EngineResult<WasmHotPathCapabilities,string>>{return this.request({type:'init',requestId:this.nextId(),seed:0}).then(response=>response.type==='ready'?ok(response.capabilities):responseToError(response));}
  public sampleHeights(coordinates:Float32Array,seed:number):Promise<EngineResult<Float32Array,string>>{const buffer=coordinates.slice().buffer;return this.request({type:'sample-height',requestId:this.nextId(),coordinates:buffer,seed},[buffer]).then(response=>response.type==='sample-height-result'?ok(new Float32Array(response.heights)):responseToError(response));}
  public transformPoints(points:Float32Array,originX:number,originZ:number,scale:number):Promise<EngineResult<Float32Array,string>>{const buffer=points.slice().buffer;return this.request({type:'transform-points',requestId:this.nextId(),points:buffer,originX,originZ,scale},[buffer]).then(response=>response.type==='transform-points-result'?ok(new Float32Array(response.points)):responseToError(response));}
  public health():Promise<EngineResult<WorkerQueueStats,string>>{return this.request({type:'health',requestId:this.nextId()}).then(response=>response.type==='health-result'?ok(response.queues):responseToError(response));}
  public dispose():void{if(this.disposed)return;this.disposed=true;for(const resolve of this.waiting.values())resolve({type:'error',requestId:0,code:'CLIENT_DISPOSED',message:'client disposed'});this.waiting.clear();this.transport.removeEventListener?.('message',this.onMessage);this.transport.removeEventListener?.('error',this.onError);}
  private nextId():number{return this.sequence++;}
  private request(command:SimulationWorkerCommand,transfer:Transferable[]=[]):Promise<SimulationWorkerResponse>{return new Promise(resolve=>{if(this.disposed){resolve({type:'error',requestId:command.requestId,code:'CLIENT_DISPOSED',message:'client disposed'});return;}this.waiting.set(command.requestId,resolve);try{this.transport.postMessage(command,transfer);}catch{this.waiting.delete(command.requestId);resolve({type:'error',requestId:command.requestId,code:'POST_FAILED',message:'worker postMessage failed'});}});}
  private readonly onMessage=(event:MessageEvent|ErrorEvent):void=>{if(!('data'in event))return;const response=event.data as SimulationWorkerResponse;if(!response||typeof response.requestId!=='number')return;const resolve=this.waiting.get(response.requestId);if(!resolve)return;this.waiting.delete(response.requestId);if(response.type==='ready'){this._ready=true;this._backend=response.capabilities.backend;}resolve(response);};
  private readonly onError=():void=>{for(const resolve of this.waiting.values())resolve({type:'error',requestId:0,code:'WORKER_ERROR',message:'worker transport error'});this.waiting.clear();this._ready=false;};
}

const responseToError=<T>(response:SimulationWorkerResponse):EngineResult<T,string>=>response.type==='error'?err(`${response.code}: ${response.message}`):err(`unexpected worker response: ${response.type}`);
export const runSimulationWorkerCommand=async(command:SimulationWorkerCommand,options:SimulationWorkerOptions={}):Promise<SimulationWorkerResponse>=>{const host=new SimulationWorkerHost(options);try{return await host.dispatch(command);}finally{if(command.type!=='dispose')host.dispose();}};
