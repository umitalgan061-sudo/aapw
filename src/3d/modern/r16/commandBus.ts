import { BoundedQueue } from './bounded.js';
import { digestValue, normalizeTick, sequenceId } from './deterministic.js';
import type { R16Command,R16CommandBusStats,R16CommandHandler,R16CommandReceipt,R16Result,R16RuntimeConfig,R16Source } from './types.js';

export class R16CommandBus{
  readonly #seed:number; readonly #maxCommandsPerTick:number; readonly #queue:BoundedQueue<R16Command>;
  readonly #handlers=new Map<string,R16CommandHandler>(); readonly #receipts=new Map<string,R16CommandReceipt>();
  #sequence=0; #stats={queued:0,accepted:0,applied:0,rejected:0,dropped:0};

  constructor(config:Pick<R16RuntimeConfig,'seed'|'maxCommandsPerTick'>){
    this.#seed=config.seed;this.#maxCommandsPerTick=Math.max(1,Math.trunc(config.maxCommandsPerTick));
    this.#queue=new BoundedQueue({capacity:this.#maxCommandsPerTick*4,dropOldest:true});
  }
  register<T>(handler:R16CommandHandler<T>):R16Result<void>{
    if(!handler.topic||this.#handlers.has(handler.topic))return{ok:false,error:{code:'COMMAND_HANDLER_INVALID',message:'Handler topic must be unique and non-empty',retryable:false}};
    this.#handlers.set(handler.topic,handler as R16CommandHandler);return{ok:true,value:undefined};
  }
  enqueue<T>(topic:string,payload:T,tick:number,source:R16Source,priority=0,deadlineTick=tick+120):R16Result<R16Command<T>>{
    const t=normalizeTick(tick);
    if(!topic||topic.length>96)return{ok:false,error:{code:'COMMAND_TOPIC_INVALID',message:'Command topic is invalid',retryable:false}};
    if(!this.#handlers.has(topic))return{ok:false,error:{code:'COMMAND_HANDLER_MISSING',message:'No handler registered for '+topic,retryable:false}};
    const command:R16Command<T>=Object.freeze({version:16,tick:t,seed:this.#seed,source,id:sequenceId('cmd',t,++this.#sequence,this.#seed),topic,payload,createdTick:t,deadlineTick:Math.max(t,Math.trunc(deadlineTick)),priority:Math.trunc(priority)});
    const push=this.#queue.push(command);this.#stats.queued++;
    if(!push.accepted){this.#stats.dropped++;return{ok:false,error:{code:'COMMAND_QUEUE_FULL',message:'Command queue is full',retryable:true}};}
    return{ok:true,value:command};
  }
  tick(tick:number):readonly R16CommandReceipt[]{
    const t=normalizeTick(tick),receipts:R16CommandReceipt[]=[];
    const pending=this.#queue.values().filter(c=>c.deadlineTick>=t).sort((a,b)=>b.priority-a.priority||a.createdTick-b.createdTick||a.id.localeCompare(b.id)).slice(0,this.#maxCommandsPerTick);
    this.#queue.clear();
    for(const command of pending){
      const handler=this.#handlers.get(command.topic);
      if(!handler){receipts.push(this.#receipt(command,'rejected',t,'handler-missing'));continue;}
      const applied=handler.apply(command);
      receipts.push(applied.ok?this.#receipt(command,'applied',t,null):this.#receipt(command,'rejected',t,applied.error.code));
    }
    return Object.freeze(receipts);
  }
  receipt(id:string):R16CommandReceipt|null{return this.#receipts.get(id)??null;}
  stats():R16CommandBusStats{return Object.freeze({...this.#stats,queued:this.#queue.size});}
  clear(){this.#queue.clear();this.#receipts.clear();this.#sequence=0;this.#stats={queued:0,accepted:0,applied:0,rejected:0,dropped:0};}
  #receipt(command:R16Command,status:'applied'|'rejected'|'dropped',tick:number|null,reason:string|null):R16CommandReceipt{
    if(status==='applied')this.#stats.applied++;else if(status==='rejected')this.#stats.rejected++;else this.#stats.dropped++;
    const receipt=Object.freeze({id:command.id,status,appliedTick:tick,digest:digestValue({id:command.id,status,tick,reason}),reason});
    this.#receipts.set(command.id,receipt);return receipt;
  }
}
