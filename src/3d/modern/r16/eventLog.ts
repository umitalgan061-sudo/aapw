import { BoundedQueue } from './bounded.js';
import { combineDigests,digestValue,normalizeTick,sequenceId } from './deterministic.js';
import type { R16Event,R16EventQuery,R16EventSeverity,R16RuntimeConfig,R16Source } from './types.js';
const weight:Readonly<Record<R16EventSeverity,number>>=Object.freeze({debug:0,info:1,warn:2,error:3,fatal:4});

export class R16EventLog{
  readonly #seed:number; readonly #events:BoundedQueue<R16Event>; #sequence=0;#dropped=0;
  constructor(config:Pick<R16RuntimeConfig,'seed'|'maxEvents'>){this.#seed=config.seed;this.#events=new BoundedQueue({capacity:config.maxEvents,dropOldest:true});}
  emit<T>(topic:string,payload:T,tick:number,source:R16Source,severity:R16EventSeverity='info'):R16Event<T>{
    const t=normalizeTick(tick),sequence=++this.#sequence;
    const event:R16Event<T>=Object.freeze({version:16,tick:t,seed:this.#seed,source,id:sequenceId('evt',t,sequence,this.#seed),topic:topic.slice(0,96),payload,severity,emittedTick:t,sequence,digest:digestValue({topic,payload,t,source,severity,sequence})});
    const pushed=this.#events.push(event as R16Event);if(pushed.dropped)this.#dropped++;
    return event;
  }
  query(query:R16EventQuery={}):readonly R16Event[]{
    const min=query.minTick==null?0:normalizeTick(query.minTick),max=query.maxTick==null?Number.MAX_SAFE_INTEGER:normalizeTick(query.maxTick),minSeverity=query.severity?weight[query.severity]:0,limit=Math.max(1,Math.trunc(query.limit??256));
    return Object.freeze(this.#events.values().filter(e=>(!query.topic||e.topic===query.topic)&&e.emittedTick>=min&&e.emittedTick<=max&&weight[e.severity]>=minSeverity).sort((a,b)=>a.sequence-b.sequence).slice(-limit));
  }
  latest(topic?:string):R16Event|null{return this.query({topic,limit:1}).at(-1)??null;}
  digest():string{return combineDigests(this.#events.values().map(e=>e.digest));}
  stats(){return Object.freeze({count:this.#events.size,dropped:this.#dropped,digest:this.digest()});}
  clear(){this.#events.clear();this.#sequence=0;this.#dropped=0;}
}
