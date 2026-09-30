import {RuntimeError,asCommandId,stableHash} from './contracts.ts';
import type {CommandContext,CommandEnvelope,CommandExecutionOptions,CommandExecutionReceipt,CommandHandler,CommandId,CommandMiddleware,Tick} from './contracts.ts';

interface Receipt { readonly commandId:CommandId; readonly result:unknown; readonly durationMilliseconds:number; }
interface Entry { readonly type:string; readonly handler:CommandHandler<unknown,unknown>; }
interface QueueEntry { readonly command:CommandEnvelope<unknown>; readonly resolve:(v:CommandExecutionReceipt<unknown>)=>void; readonly reject:(e:unknown)=>void; }
export interface CommandBusStats { readonly executed:number;readonly failed:number;readonly duplicates:number;readonly rejected:number;readonly pending:number;readonly averageMilliseconds:number; }
export interface CommandBusOptions { readonly execution:CommandExecutionOptions;readonly receiptLimit:number;readonly queueLimit:number;readonly clock:()=>number; }
const DEFAULT_OPTIONS:CommandBusOptions={execution:{timeoutMilliseconds:1500,dedupe:true,retries:1},receiptLimit:512,queueLimit:256,clock:()=>performance.now()};

export class CommandBus {
  readonly #handlers=new Map<string,Entry>(); readonly #middleware:CommandMiddleware[]=[];
  readonly #receipts=new Map<CommandId,Receipt>(); readonly #receiptOrder:CommandId[]=[]; readonly #queue:QueueEntry[]=[];
  readonly #options:CommandBusOptions;
  readonly #stats={executed:0,failed:0,duplicates:0,rejected:0,totalMilliseconds:0};
  #draining=false;
  constructor(options:Partial<CommandBusOptions>={}){this.#options={...DEFAULT_OPTIONS,...options,execution:{...DEFAULT_OPTIONS.execution,...options.execution}};}
  register<TPayload,TResult>(type:string,handler:CommandHandler<TPayload,TResult>):()=>void {
    if(!type.trim()) throw new RuntimeError({code:'R32_COMMAND_TYPE',message:'Command type cannot be empty'});
    if(this.#handlers.has(type)) throw new RuntimeError({code:'R32_COMMAND_DUPLICATE_HANDLER',message:'Handler already registered for '+type});
    const entry={type,handler:handler as unknown as CommandHandler<unknown,unknown>};
    this.#handlers.set(type,entry);
    return ()=>{if(this.#handlers.get(type)===entry)this.#handlers.delete(type);};
  }
  use(middleware:CommandMiddleware):()=>void {
    if(!middleware.name.trim()) throw new RuntimeError({code:'R32_MIDDLEWARE_NAME',message:'Middleware name cannot be empty'});
    this.#middleware.push(middleware); return ()=>{const i=this.#middleware.indexOf(middleware);if(i>=0)this.#middleware.splice(i,1);};
  }
  create<TPayload>(type:string,payload:TPayload,tick:Tick,source='runtime',correlationId?:string):CommandEnvelope<TPayload>{
    const id=asCommandId('r32:'+stableHash({type,payload,tick,source,correlationId})+':'+String(tick));
    return {id,type,issuedAtTick:tick,source,payload,...(correlationId===undefined?{}:{correlationId})};
  }
  async dispatch<TPayload,TResult>(command:CommandEnvelope<TPayload>,tick:Tick,signal?:AbortSignal):Promise<CommandExecutionReceipt<TResult>>{
    if(this.#queue.length>=this.#options.queueLimit) {this.#stats.rejected+=1;throw new RuntimeError({code:'R32_COMMAND_QUEUE_FULL',message:'Command queue is full'});}
    const controller=new AbortController(); const linked=this.#link(controller.signal,signal);
    return new Promise((resolve,reject)=>{this.#queue.push({command:command as CommandEnvelope<unknown>,resolve:resolve as (v:CommandExecutionReceipt<unknown>)=>void,reject});void this.#drain(tick,linked);});
  }
  stats():CommandBusStats{const e=this.#stats.executed;return{executed:e,failed:this.#stats.failed,duplicates:this.#stats.duplicates,rejected:this.#stats.rejected,pending:this.#queue.length,averageMilliseconds:e?this.#stats.totalMilliseconds/e:0};}
  clearReceipts():void{this.#receipts.clear();this.#receiptOrder.length=0;}
  async flush(tick:Tick,signal?:AbortSignal):Promise<void>{await this.#drain(tick,signal);}
  #link(a:AbortSignal,b?:AbortSignal):AbortSignal{
    if(!b)return a; const c=new AbortController(); const abort=(r:unknown)=>{if(!c.signal.aborted)c.abort(r);};
    a.addEventListener('abort',()=>abort(a.reason),{once:true}); b.addEventListener('abort',()=>abort(b.reason),{once:true}); if(b.aborted)abort(b.reason); return c.signal;
  }
  async #drain(tick:Tick,signal?:AbortSignal):Promise<void>{
    if(this.#draining)return; this.#draining=true;
    try { while(this.#queue.length){const entry=this.#queue.shift();if(!entry)break;try{entry.resolve(await this.#execute(entry.command,tick,signal));}catch(error){entry.reject(error);}}}
    finally{this.#draining=false;if(this.#queue.length)void this.#drain(tick,signal);}
  }
  async #execute<TResult>(command:CommandEnvelope<unknown>,tick:Tick,signal?:AbortSignal):Promise<CommandExecutionReceipt<TResult>>{
    const duplicate=this.#receipts.get(command.id);
    if(duplicate&&this.#options.execution.dedupe){this.#stats.duplicates+=1;return{commandId:command.id,accepted:true,duplicate:true,durationMilliseconds:0,result:duplicate.result as TResult};}
    const entry=this.#handlers.get(command.type); if(!entry){this.#stats.failed+=1;throw new RuntimeError({code:'R32_COMMAND_UNHANDLED',message:'No handler registered for '+command.type});}
    const context:CommandContext={tick,source:command.source,signal:signal??new AbortController().signal}; const start=this.#options.clock();
    try{
      for(const middleware of this.#middleware)await middleware.before?.(command,context);
      const result=await this.#withTimeout(()=>entry.handler.handle(command,context),this.#options.execution.timeoutMilliseconds,context.signal);
      for(const middleware of [...this.#middleware].reverse())await middleware.after?.(command,result,context);
      const duration=Math.max(0,this.#options.clock()-start); this.#stats.executed+=1;this.#stats.totalMilliseconds+=duration;
      this.#store({commandId:command.id,result,durationMilliseconds:duration});
      return{commandId:command.id,accepted:true,duplicate:false,durationMilliseconds:duration,result:result as TResult};
    }catch(error){this.#stats.failed+=1;for(const middleware of [...this.#middleware].reverse())await middleware.onError?.(command,error,context);throw error;}
  }
  #store(receipt:Receipt):void{this.#receipts.set(receipt.commandId,receipt);this.#receiptOrder.push(receipt.commandId);while(this.#receiptOrder.length>this.#options.receiptLimit){const old=this.#receiptOrder.shift();if(old)this.#receipts.delete(old);}}
  async #withTimeout<T>(operation:()=>T|Promise<T>,timeout:number,signal:AbortSignal):Promise<T>{
    if(signal.aborted)throw signal.reason??new RuntimeError({code:'R32_ABORTED',message:'Command aborted'});
    let handle:ReturnType<typeof setTimeout>|undefined;
    const timeoutPromise=new Promise<never>((_,reject)=>{handle=setTimeout(()=>reject(new RuntimeError({code:'R32_COMMAND_TIMEOUT',message:'Command execution exceeded '+String(timeout)+'ms'})),timeout);});
    const abortPromise=new Promise<never>((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason??new RuntimeError({code:'R32_ABORTED',message:'Command aborted'})),{once:true});});
    try{return await Promise.race([Promise.resolve(operation()),timeoutPromise,abortPromise]);}finally{if(handle!==undefined)clearTimeout(handle);}
  }
}
