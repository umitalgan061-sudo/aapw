/** Worker-friendly execution broker with bounded concurrency and cancellation. */
export type WorkerTaskPriorityV15=0|1|2|3|4|5;
export type WorkerTaskStatusV15='queued'|'running'|'completed'|'failed'|'cancelled'|'timeout';
export interface WorkerTaskV15<TInput=unknown,TOutput=unknown>{readonly id:string;readonly priority:WorkerTaskPriorityV15;readonly input:TInput;readonly timeoutMs:number;readonly transferable?:readonly ArrayBuffer[];readonly run:(input:TInput,signal:AbortSignal)=>Promise<TOutput>|TOutput;}
export interface WorkerResultV15<T=unknown>{readonly id:string;readonly status:Exclude<WorkerTaskStatusV15,'queued'|'running'>;readonly durationMs:number;readonly output?:T;readonly error?:string;}
export interface WorkerBrokerMetricsV15{readonly queued:number;readonly running:number;readonly completed:number;readonly failed:number;readonly cancelled:number;readonly timedOut:number;readonly averageDurationMs:number;}
export interface WorkerBrokerOptionsV15{readonly concurrency?:number;readonly maxQueue?:number;readonly now?:()=>number;}

const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;

interface InternalTask extends WorkerTaskV15{readonly sequence:number;readonly controller:AbortController;}

export class WorkerExecutionV15<TInput=unknown,TOutput=unknown>{
  readonly #concurrency:number;readonly #maxQueue:number;readonly #now:()=>number;
  readonly #queue=new Map<string,InternalTask>();readonly #running=new Map<string,InternalTask>();readonly #results:WorkerResultV15<TOutput>[]=[];
  #sequence=0;#completed=0;#failed=0;#cancelled=0;#timedOut=0;#durationTotal=0;#disposed=false;
  constructor(options:WorkerBrokerOptionsV15={}){this.#concurrency=Math.max(1,Math.min(32,Math.trunc(options.concurrency??4)));this.#maxQueue=Math.max(16,Math.trunc(options.maxQueue??2048));this.#now=options.now??(()=>Date.now());}

  enqueue(task:WorkerTaskV15<TInput,TOutput>):boolean{if(this.#disposed)throw new Error('Worker broker is disposed.');if(!task.id.trim()||this.#queue.has(task.id)||this.#running.has(task.id))return false;if(this.#queue.size>=this.#maxQueue)return false;const internal=Object.assign({},task,{sequence:++this.#sequence,timeoutMs:Math.max(1,Math.trunc(task.timeoutMs)),controller:new AbortController()});this.#queue.set(task.id,internal);this.#pump();return true;}
  cancel(id:string):boolean{const queued=this.#queue.get(id);if(queued){this.#queue.delete(id);queued.controller.abort();this.#cancelled+=1;this.#record({id,status:'cancelled',durationMs:0});return true;}const running=this.#running.get(id);if(running){running.controller.abort();return true;}return false;}
  async flush():Promise<readonly WorkerResultV15<TOutput>[]> { while(this.#queue.size||this.#running.size) await new Promise<void>((resolve)=>queueMicrotask(resolve)); return this.results(); }
  results():readonly WorkerResultV15<TOutput>[] {return Object.freeze([...this.#results]);}
  metrics():WorkerBrokerMetricsV15{return Object.freeze({queued:this.#queue.size,running:this.#running.size,completed:this.#completed,failed:this.#failed,cancelled:this.#cancelled,timedOut:this.#timedOut,averageDurationMs:this.#completed+this.#failed+this.#timedOut?this.#durationTotal/(this.#completed+this.#failed+this.#timedOut):0});}
  clearResults():void{this.#results.length=0;}
  dispose():void{this.#disposed=true;for(const task of this.#queue.values())task.controller.abort();for(const task of this.#running.values())task.controller.abort();this.#queue.clear();}
  reset():void{this.dispose();this.#disposed=false;this.#results.length=0;this.#sequence=0;this.#completed=0;this.#failed=0;this.#cancelled=0;this.#timedOut=0;this.#durationTotal=0;}

  #pump():void{while(!this.#disposed&&this.#running.size<this.#concurrency&&this.#queue.size){const task=[...this.#queue.values()].sort((a,b)=>b.priority-a.priority||a.sequence-b.sequence||a.id.localeCompare(b.id))[0]!;this.#queue.delete(task.id);this.#running.set(task.id,task);void this.#run(task);}}
  async #run(task:InternalTask):Promise<void>{const started=this.#now();let timer:ReturnType<typeof setTimeout>|undefined;let timedOut=false;try{const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;task.controller.abort();reject(new Error('WORKER_TASK_TIMEOUT'));},task.timeoutMs);});const output=await Promise.race([Promise.resolve(task.run(task.input,task.controller.signal)),timeout]);if(task.controller.signal.aborted&&!timedOut){this.#cancelled+=1;this.#record({id:task.id,status:'cancelled',durationMs:Math.max(0,this.#now()-started)});}else{const duration=Math.max(0,this.#now()-started);this.#completed+=1;this.#durationTotal+=duration;this.#record({id:task.id,status:'completed',durationMs:duration,output:output as TOutput});}}catch(error){const duration=Math.max(0,this.#now()-started);if(timedOut){this.#timedOut+=1;this.#durationTotal+=duration;this.#record({id:task.id,status:'timeout',durationMs:duration,error:error instanceof Error?error.message:String(error)});}else if(task.controller.signal.aborted){this.#cancelled+=1;this.#record({id:task.id,status:'cancelled',durationMs:duration});}else{this.#failed+=1;this.#durationTotal+=duration;this.#record({id:task.id,status:'failed',durationMs:duration,error:error instanceof Error?error.message:String(error)});}}finally{if(timer)clearTimeout(timer);this.#running.delete(task.id);this.#pump();}}
  #record(result:WorkerResultV15<TOutput>):void{this.#results.push(Object.freeze(result));if(this.#results.length>4096)this.#results.shift();}
}

export const isTransferableArrayBuffer=(value:unknown):value is ArrayBuffer=>typeof ArrayBuffer!=='undefined'&&value instanceof ArrayBuffer;
