import type { R16Result } from './types.js';

export type R16FaultKind='throw'|'reject'|'delay'|'corrupt'|'drop';
export interface R16FaultRule{
  readonly id:string;
  readonly subsystem:string;
  readonly kind:R16FaultKind;
  readonly probability:number;
  readonly maxHits:number;
  readonly message:string;
}
export interface R16FaultHit{
  readonly id:string;
  readonly subsystem:string;
  readonly kind:R16FaultKind;
  readonly tick:number;
  readonly hitIndex:number;
}
export interface R16FaultStats{
  readonly armed:number;
  readonly hits:number;
  readonly byKind:Readonly<Record<R16FaultKind,number>>;
  readonly digest:string;
}
interface RuleState{rule:R16FaultRule;hits:number;}

export class R16FaultInjector{
  readonly #seed:number;
  readonly #rules=new Map<string,RuleState>();
  readonly #hits:R16FaultHit[]=[];
  constructor(seed=1){this.#seed=Math.trunc(seed);}
  arm(rule:R16FaultRule):R16Result<void>{
    if(!rule.id||rule.id.length>96||!rule.subsystem||rule.subsystem.length>96)return{ok:false,error:{code:'FAULT_RULE_ID',message:'Fault rule id/subsystem invalid',retryable:false}};
    if(!Number.isFinite(rule.probability)||rule.probability<0||rule.probability>1)return{ok:false,error:{code:'FAULT_PROBABILITY',message:'Fault probability must be between 0 and 1',retryable:false}};
    if(!Number.isInteger(rule.maxHits)||rule.maxHits<1||rule.maxHits>10000)return{ok:false,error:{code:'FAULT_HIT_CAP',message:'Fault hit cap invalid',retryable:false}};
    this.#rules.set(rule.id,{rule:Object.freeze({...rule,probability:rule.probability,maxHits:Math.trunc(rule.maxHits),message:rule.message.slice(0,256)}),hits:0});
    return{ok:true,value:undefined};
  }
  shouldInject(id:string,tick:number,entropy=0):R16Result<R16FaultHit|null>{
    const state=this.#rules.get(id);if(!state)return{ok:false,error:{code:'FAULT_MISSING',message:'Fault rule is not armed',retryable:false}};
    if(state.hits>=state.rule.maxHits)return{ok:true,value:null};
    const roll=this.random(tick,state.hits,entropy);
    if(roll>state.rule.probability)return{ok:true,value:null};
    state.hits+=1;
    const hit:R16FaultHit=Object.freeze({id:state.rule.id,subsystem:state.rule.subsystem,kind:state.rule.kind,tick:Math.max(0,Math.trunc(tick)),hitIndex:state.hits});
    this.#hits.push(hit);
    return{ok:true,value:hit};
  }
  disarm(id:string){return this.#rules.delete(id);}
  disarmAll(){this.#rules.clear();}
  stats():R16FaultStats{
    const byKind:Record<R16FaultKind,number>={throw:0,reject:0,delay:0,corrupt:0,drop:0};
    for(const hit of this.#hits)byKind[hit.kind]+=1;
    return Object.freeze({armed:this.#rules.size,hits:this.#hits.length,byKind:Object.freeze(byKind),digest:String(this.#hits.length)+':'+Object.entries(byKind).map(([k,v])=>k+'='+v).join(',')});
  }
  hits(limit=256){return Object.freeze(this.#hits.slice(-Math.max(1,Math.trunc(limit))));}
  reset(){for(const state of this.#rules.values())state.hits=0;this.#hits.length=0;}
  private random(tick:number,index:number,entropy:number):number{
    let x=(this.#seed^Math.trunc(tick)^Math.trunc(index*0x9e3779b9)^Math.trunc(entropy*1e6))>>>0;
    x=Math.imul(x^x>>>16,0x45d9f3b)>>>0;x=Math.imul(x^x>>>16,0x45d9f3b)>>>0;x=(x^x>>>16)>>>0;
    return x/0xffffffff;
  }
}
