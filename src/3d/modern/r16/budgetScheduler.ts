import { SlidingWindow } from './bounded.js';
import { clamp01,digestValue,normalizeTick } from './deterministic.js';
import type { R16BudgetClass,R16BudgetLimit,R16BudgetSample,R16Result,R16RuntimeConfig,R16WorkItem,R16WorkReceipt } from './types.js';

export const R16_DEFAULT_BUDGETS:readonly R16BudgetLimit[]=Object.freeze([
  {budget:'simulation',maxUnits:1024,maxMilliseconds:8,weight:1.2,burstUnits:128},
  {budget:'render',maxUnits:2048,maxMilliseconds:6,weight:1,burstUnits:256},
  {budget:'streaming',maxUnits:512,maxMilliseconds:3,weight:.8,burstUnits:64},
  {budget:'network',maxUnits:512,maxMilliseconds:2,weight:.9,burstUnits:64},
  {budget:'save',maxUnits:256,maxMilliseconds:2,weight:.5,burstUnits:32},
  {budget:'worker',maxUnits:768,maxMilliseconds:4,weight:.7,burstUnits:128},
]);
export interface R16BudgetDecision{readonly tick:number;readonly budget:R16BudgetClass;readonly accepted:readonly R16WorkItem[];readonly deferred:readonly R16WorkItem[];readonly pressure:number;}

export class R16BudgetScheduler{
  readonly #limits:ReadonlyMap<R16BudgetClass,R16BudgetLimit>;readonly #queues=new Map<R16BudgetClass,R16WorkItem[]>();readonly #windows=new Map<R16BudgetClass,SlidingWindow>();readonly #maxItems:number;readonly #samples:R16BudgetSample[]=[];
  constructor(config:Pick<R16RuntimeConfig,'maxWorkItemsPerBudget'>,limits=R16_DEFAULT_BUDGETS){
    this.#maxItems=Math.max(1,Math.trunc(config.maxWorkItemsPerBudget));this.#limits=new Map(limits.map(x=>[x.budget,Object.freeze({...x})]));
    for(const limit of limits){this.#queues.set(limit.budget,[]);this.#windows.set(limit.budget,new SlidingWindow(60));}
  }
  enqueue<T>(item:R16WorkItem<T>):R16Result<void>{
    const q=this.#queues.get(item.budget),limit=this.#limits.get(item.budget);if(!q||!limit)return{ok:false,error:{code:'BUDGET_UNKNOWN',message:'Unknown budget class',retryable:false}};
    if(q.length>=this.#maxItems)return{ok:false,error:{code:'BUDGET_QUEUE_FULL',message:'Work queue capacity reached',retryable:true}};
    q.push(Object.freeze({...item,units:Math.max(1,Math.trunc(item.units)),priority:Math.trunc(item.priority),enqueuedTick:normalizeTick(item.enqueuedTick),expiresTick:normalizeTick(item.expiresTick)}));return{ok:true,value:undefined};
  }
  consume(budget:R16BudgetClass,tick:number,elapsedMs=0):R16BudgetDecision{
    const q=this.#queues.get(budget)??[],limit=this.#limits.get(budget),t=normalizeTick(tick);if(!limit)return Object.freeze({tick:t,budget,accepted:Object.freeze([]),deferred:Object.freeze(q),pressure:1});
    const eligible=q.filter(x=>x.expiresTick>=t).sort((a,b)=>b.priority-a.priority||a.enqueuedTick-b.enqueuedTick||a.id.localeCompare(b.id));q.length=0;
    const history=this.#windows.get(budget)!;const previous=history.stats().p95;const capacity=Math.max(0,Math.trunc(limit.maxUnits+(previous<.5?limit.burstUnits*.5:previous>.9?0:limit.burstUnits*.2)));
    let used=0;const accepted:R16WorkItem[]=[];const deferred:R16WorkItem[]=[];
    for(const item of eligible){if(used+item.units<=capacity){used+=item.units;accepted.push(item);}else deferred.push(item);}
    q.push(...deferred);const pressure=clamp01(Math.max(used/Math.max(1,limit.maxUnits),elapsedMs/Math.max(.1,limit.maxMilliseconds)));history.push(pressure);
    this.#samples.push(Object.freeze({budget,requestedUnits:eligible.reduce((s,x)=>s+x.units,0),consumedUnits:used,elapsedMs:Math.max(0,elapsedMs),pressure,tick:t}));if(this.#samples.length>4096)this.#samples.shift();
    return Object.freeze({tick:t,budget,accepted:Object.freeze(accepted),deferred:Object.freeze(deferred),pressure});
  }
  pressure(budget:R16BudgetClass){return this.#windows.get(budget)?.stats().p95??0;}
  receipts(budget:R16BudgetClass,tick:number):readonly R16WorkReceipt[]{return Object.freeze(this.consume(budget,tick).accepted.map(x=>Object.freeze({id:x.id,accepted:true,consumedUnits:x.units,reason:null})));}
  samples(limit=256){return Object.freeze(this.#samples.slice(-Math.max(1,Math.trunc(limit))));}
  digest(){return digestValue(this.#samples);}
  clear(){for(const q of this.#queues.values())q.length=0;for(const w of this.#windows.values())w.reset();this.#samples.length=0;}
}
