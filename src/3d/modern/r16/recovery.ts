import { digestValue } from './deterministic.js';
import type { R16Result } from './types.js';

export type R16RecoveryDomain='input'|'simulation'|'render'|'streaming'|'network'|'save'|'worker';
export type R16RecoveryPhase='idle'|'diagnose'|'quiesce'|'reset'|'replay'|'resume'|'failed';

export interface R16RecoveryPlan{readonly domain:R16RecoveryDomain;readonly reason:string;readonly maxAttempts:number;readonly cooldownTicks:number;}
export interface R16RecoveryRecord{readonly domain:R16RecoveryDomain;readonly phase:R16RecoveryPhase;readonly attempt:number;readonly tick:number;readonly reason:string;readonly digest:string;}

interface State{phase:R16RecoveryPhase;attempt:number;lastTick:number;reason:string;}
const ORDER:readonly R16RecoveryDomain[]=['input','simulation','render','streaming','network','save','worker'];

export class R16RecoveryCoordinator{
  readonly #states=new Map<R16RecoveryDomain,State>();
  readonly #maxAttempts:number;
  constructor(maxAttempts=3){this.#maxAttempts=Math.max(1,Math.trunc(maxAttempts));for(const domain of ORDER)this.#states.set(domain,{phase:'idle',attempt:0,lastTick:-1,reason:''});}
  request(plan:R16RecoveryPlan,tick:number):R16Result<R16RecoveryRecord>{
    const state=this.#states.get(plan.domain)!;
    const maxAttempts=Math.min(this.#maxAttempts,Math.max(1,Math.trunc(plan.maxAttempts)));
    if(state.attempt>=maxAttempts&&state.phase==='failed')return{ok:false,error:{code:'RECOVERY_LIMIT',message:'Recovery attempt limit reached for '+plan.domain,retryable:false}};
    if(state.lastTick>=0&&tick-state.lastTick<Math.max(0,Math.trunc(plan.cooldownTicks)))return{ok:false,error:{code:'RECOVERY_COOLDOWN',message:'Recovery cooldown is active',retryable:true}};
    state.attempt+=1;state.lastTick=Math.max(0,Math.trunc(tick));state.reason=plan.reason.slice(0,256);state.phase='diagnose';
    return{ok:true,value:this.record(plan.domain,tick)};
  }
  advance(domain:R16RecoveryDomain,tick:number,success=true):R16Result<R16RecoveryRecord>{
    const state=this.#states.get(domain)!;
    const next:Record<R16RecoveryPhase,R16RecoveryPhase>={idle:'diagnose',diagnose:'quiesce',quiesce:'reset',reset:'replay',replay:'resume',resume:'idle',failed:'diagnose'};
    if(state.phase==='idle'&&success)return{ok:true,value:this.record(domain,tick)};
    if(!success){state.phase='failed';return{ok:false,error:{code:'RECOVERY_STEP_FAILED',message:'Recovery step failed for '+domain,retryable:state.attempt< this.#maxAttempts}};}
    state.phase=next[state.phase];if(state.phase==='idle')state.attempt=0;return{ok:true,value:this.record(domain,tick)};
  }
  abort(domain:R16RecoveryDomain,tick:number,reason='aborted'):R16RecoveryRecord{const state=this.#states.get(domain)!;state.phase='failed';state.lastTick=Math.max(0,Math.trunc(tick));state.reason=reason;return this.record(domain,tick);}
  status(domain:R16RecoveryDomain){const s=this.#states.get(domain)!;return Object.freeze({domain,phase:s.phase,attempt:s.attempt,lastTick:s.lastTick,reason:s.reason});}
  all(){return Object.freeze(ORDER.map(d=>this.status(d)));}
  digest(){return digestValue(this.all());}
  clear(){for(const domain of ORDER)this.#states.set(domain,{phase:'idle',attempt:0,lastTick:-1,reason:''});}
  private record(domain:R16RecoveryDomain,tick:number):R16RecoveryRecord{const s=this.#states.get(domain)!;return Object.freeze({domain,phase:s.phase,attempt:s.attempt,tick:Math.max(0,Math.trunc(tick)),reason:s.reason,digest:digestValue({domain,phase:s.phase,attempt:s.attempt,tick:s.lastTick,reason:s.reason})});}
}
