import type { Disposable } from './types';

export interface AsyncGateStats{readonly active:number;readonly queued:number;readonly completed:number;readonly rejected:number;readonly capacity:number;}
export interface AsyncGateOptions{readonly capacity:number;readonly maxQueue?:number;}
interface Waiter<T>{readonly run:()=>Promise<T>;readonly resolve:(value:T)=>void;readonly reject:(error:unknown)=>void;}

/** Deterministic bounded concurrency primitive for asset/network/worker workloads. */
export class AsyncGate implements Disposable{
 private readonly capacity:number;private readonly maxQueue:number;private readonly queue:Array<Waiter<unknown>>=[];private activeCount=0;private completedCount=0;private rejectedCount=0;private disposed=false;
 constructor(options:AsyncGateOptions){this.capacity=Math.max(1,Math.floor(options.capacity));this.maxQueue=Math.max(0,Math.floor(options.maxQueue??this.capacity*8));}
 public run<T>(task:()=>Promise<T>):Promise<T>{this.ensure();if(this.activeCount<this.capacity)return this.start(task);if(this.queue.length>=this.maxQueue){this.rejectedCount+=1;return Promise.reject(new Error('ASYNC_GATE_QUEUE_FULL'));}return new Promise<T>((resolve,reject)=>{this.queue.push({run:task,resolve:resolve as (value:unknown)=>void,reject});});}
 private start<T>(task:()=>Promise<T>):Promise<T>{this.activeCount+=1;return Promise.resolve().then(task).then(value=>{this.completedCount+=1;return value;},error=>{throw error;}).finally(()=>{this.activeCount-=1;this.pump();});}
 private pump():void{while(!this.disposed&&this.activeCount<this.capacity&&this.queue.length){const waiter=this.queue.shift();if(!waiter)break;this.start(waiter.run).then(waiter.resolve,waiter.reject);}}
 public drain():Promise<void>{return new Promise(resolve=>{const check=()=>{if(this.activeCount===0&&this.queue.length===0){resolve();return;}queueMicrotask(check);};check();});}
 public stats():AsyncGateStats{return{active:this.activeCount,queued:this.queue.length,completed:this.completedCount,rejected:this.rejectedCount,capacity:this.capacity};}
 public cancelQueued(reason='ASYNC_GATE_CANCELLED'):void{const queued=this.queue.splice(0);this.rejectedCount+=queued.length;for(const waiter of queued)waiter.reject(new Error(reason));}
 public resize(capacity:number):void{this.ensure();this.capacity=Math.max(1,Math.floor(capacity));this.pump();}
 private ensure():void{if(this.disposed)throw new Error('ASYNC_GATE_DISPOSED');}
 public dispose():void{if(this.disposed)return;this.cancelQueued();this.disposed=true;}
}

export interface RetryPolicy{readonly attempts:number;readonly baseDelayMs:number;readonly maxDelayMs:number;readonly jitter?:number;readonly shouldRetry?:(error:unknown,attempt:number)=>boolean;}
export const withRetry=async<T>(task:(attempt:number)=>Promise<T>,policy:RetryPolicy):Promise<T>=>{const attempts=Math.max(1,Math.floor(policy.attempts));const base=Math.max(0,policy.baseDelayMs),max=Math.max(base,policy.maxDelayMs),jitter=Math.max(0,Math.min(1,policy.jitter??0));let last:unknown=new Error('RETRY_FAILED');for(let attempt=1;attempt<=attempts;attempt+=1){try{return await task(attempt);}catch(error){last=error;if(attempt===attempts||policy.shouldRetry?.(error,attempt)===false)break;const exponential=Math.min(max,base*Math.pow(2,attempt-1));const randomOffset=jitter?exponential*jitter*(Math.random()*2-1):0;await delay(Math.max(0,exponential+randomOffset));}}throw last;};
export const delay=(ms:number):Promise<void>=>new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));

export interface Deferred<T>{readonly promise:Promise<T>;readonly resolve:(value:T)=>void;readonly reject:(error:unknown)=>void;}
export const deferred=<T>():Deferred<T>=>{let resolve!: (value:T)=>void;let reject!: (error:unknown)=>void;const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};};

export interface AbortableTask<T>{readonly run:(signal:AbortSignal)=>Promise<T>;readonly timeoutMs?:number;}
export const runAbortable=async<T>(task:AbortableTask<T>):Promise<T>=>{const controller=new AbortController();const timeout=task.timeoutMs===undefined?null:setTimeout(()=>controller.abort(),Math.max(1,task.timeoutMs));try{return await task.run(controller.signal);}finally{if(timeout!==null)clearTimeout(timeout);}};
