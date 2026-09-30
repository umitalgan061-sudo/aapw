import { digestValue,normalizeTick } from './deterministic.js';
import type { R16BudgetClass,R16Result,R16RuntimeConfig,R16WorkItem } from './types.js';

export interface R16WorkerLane{readonly id:string;readonly concurrency:number;readonly budget:R16BudgetClass;readonly latencyTargetMs:number;}
export interface R16WorkerTicket{readonly id:string;readonly laneId:string;readonly accepted:boolean;readonly reason:string|null;readonly tick:number;}
export interface R16WorkerStats{readonly laneId:string;readonly queued:number;readonly active:number;readonly completed:number;readonly failed:number;readonly digest:string;}

interface MutableLane{config:R16WorkerLane;queue:R16WorkItem[];active:Set<string>;completed:number;failed:number;}

export class R16WorkerScheduler{
  readonly #maxQueued:number;readonly #lanes=new Map<string,MutableLane>();
  constructor(config:Pick<R16RuntimeConfig,'maxWorkItemsPerBudget'>){this.#maxQueued=Math.max(8,Math.trunc(config.maxWorkItemsPerBudget));}
  registerLane(lane:R16WorkerLane):R16Result<void>{
    if(!lane.id||this.#lanes.has(lane.id))return{ok:false,error:{code:'WORKER_LANE_DUPLICATE',message:'Worker lane is already registered',retryable:false}};
    if(lane.concurrency<1||lane.concurrency>64)return{ok:false,error:{code:'WORKER_CONCURRENCY',message:'Worker concurrency outside bounded range',retryable:false}};
    if(lane.latencyTargetMs<=0)return{ok:false,error:{code:'WORKER_LATENCY',message:'Latency target must be positive',retryable:false}};
    this.#lanes.set(lane.id,{config:Object.freeze({...lane,concurrency:Math.trunc(lane.concurrency)}),queue:[],active:new Set(),completed:0,failed:0});
    return{ok:true,value:undefined};
  }
  enqueue<T>(laneId:string,item:Omit<R16WorkItem<T>,'budget'>):R16Result<R16WorkerTicket>{
    const lane=this.#lanes.get(laneId);if(!lane)return{ok:false,error:{code:'WORKER_LANE_MISSING',message:'Worker lane does not exist',retryable:false}};
    if(lane.queue.length>=this.#maxQueued)return{ok:false,error:{code:'WORKER_QUEUE_FULL',message:'Worker lane queue reached capacity',retryable:true}};
    if(item.units<1||item.units>65536)return{ok:false,error:{code:'WORKER_UNITS',message:'Worker unit cost is outside limits',retryable:false}};
    const work:R16WorkItem=Object.freeze({...item,budget:lane.config.budget,units:Math.trunc(item.units),priority:Math.trunc(item.priority),enqueuedTick:normalizeTick(item.enqueuedTick),expiresTick:normalizeTick(item.expiresTick)});
    lane.queue.push(work);return{ok:true,value:Object.freeze({id:work.id,laneId,accepted:true,reason:null,tick:work.enqueuedTick})};
  }
  dispatch(tick:number):readonly R16WorkItem[]{
    const t=normalizeTick(tick);const dispatched:R16WorkItem[]=[];
    for(const lane of this.#lanes.values()){
      while(lane.active.size<lane.config.concurrency&&lane.queue.length){
        lane.queue.sort((a,b)=>b.priority-a.priority||a.enqueuedTick-b.enqueuedTick||a.id.localeCompare(b.id));
        const work=lane.queue.shift()!;
        if(work.expiresTick<t){lane.failed++;continue;}
        lane.active.add(work.id);dispatched.push(work);
      }
    }
    return Object.freeze(dispatched);
  }
  complete(laneId:string,id:string,ok=true):boolean{
    const lane=this.#lanes.get(laneId);if(!lane||!lane.active.has(id))return false;lane.active.delete(id);if(ok)lane.completed++;else lane.failed++;return true;
  }
  stats(laneId:string):R16WorkerStats|null{
    const lane=this.#lanes.get(laneId);if(!lane)return null;
    return Object.freeze({laneId,queued:lane.queue.length,active:lane.active.size,completed:lane.completed,failed:lane.failed,digest:digestValue({laneId,queue:lane.queue.map(x=>x.id),active:[...lane.active].sort(),completed:lane.completed,failed:lane.failed})});
  }
  allStats(){return Object.freeze([...this.#lanes.keys()].sort().map(id=>this.stats(id)!));}
  clear(){this.#lanes.clear();}
}
