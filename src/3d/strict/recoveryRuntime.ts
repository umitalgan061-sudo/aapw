import type { Result } from './liveCoreTypes.ts';
import { err, ok, stableHash } from './liveCoreTypes.ts';

export type RecoveryReason='renderer-device-lost'|'asset-failure'|'memory-pressure'|'runtime-exception'|'network-timeout'|'manual';
export type RecoveryAction='retry'|'fallback-renderer'|'reduce-quality'|'flush-cache'|'pause-streaming'|'restart-subsystem'|'fail-closed';
export interface RecoveryAttempt{readonly index:number;readonly reason:RecoveryReason;readonly action:RecoveryAction;readonly success:boolean;readonly tick:number;readonly digest:string;}
export interface RecoveryPolicy{readonly maxAttempts:number;readonly cooldownTicks:number;readonly resetAfterStableTicks:number;readonly allowRendererFallback:boolean;readonly allowCacheFlush:boolean;}
export interface RecoveryState{readonly phase:'healthy'|'recovering'|'degraded'|'failed';readonly attempts:number;readonly lastReason?:RecoveryReason;readonly lastAction?:RecoveryAction;readonly stableTicks:number;readonly generation:number;readonly digest:string;}
export const DEFAULT_RECOVERY_POLICY:RecoveryPolicy=Object.freeze({maxAttempts:5,cooldownTicks:30,resetAfterStableTicks:300,allowRendererFallback:true,allowCacheFlush:true});

const actionFor=(reason:RecoveryReason,index:number,p:RecoveryPolicy):RecoveryAction=>reason==='renderer-device-lost'&&p.allowRendererFallback?'fallback-renderer':reason==='memory-pressure'&&p.allowCacheFlush?'flush-cache':reason==='asset-failure'?'retry':reason==='network-timeout'?'pause-streaming':index>=3?'restart-subsystem':'reduce-quality';

export class StrictRecoveryRuntime{
 #policy:RecoveryPolicy;#state:RecoveryState={phase:'healthy',attempts:0,stableTicks:0,generation:0,digest:''};#history:RecoveryAttempt[]=[];#cooldown=0;#disposed=false;
 constructor(policy:RecoveryPolicy=DEFAULT_RECOVERY_POLICY){this.#policy=Object.freeze({...policy});this.#state=this.#buildState({phase:'healthy',attempts:0,stableTicks:0,generation:0});}
 #buildState(input:Omit<RecoveryState,'digest'>):RecoveryState{const digest=stableHash(input);return Object.freeze({...input,digest});}
 trigger(reason:RecoveryReason,tick:number):Result<RecoveryAction>{if(this.#disposed)return err('RUNTIME_DISPOSED','Recovery runtime is disposed.');if(this.#cooldown>0)return err('INVALID_FRAME','Recovery cooldown is active.',true,{cooldown:this.#cooldown});if(this.#state.attempts>=this.#policy.maxAttempts){this.#state=this.#buildState({...this.#state,phase:'failed',lastReason:reason});return err('INVALID_FRAME','Recovery attempt budget exhausted.',false,{reason});}const index=this.#state.attempts+1;const action=actionFor(reason,index,this.#policy);this.#state=this.#buildState({...this.#state,phase:'recovering',attempts:index,lastReason:reason,lastAction:action,generation:this.#state.generation+1,stableTicks:0});this.#cooldown=this.#policy.cooldownTicks;this.#history.push(Object.freeze({index,reason,action,success:false,tick,digest:stableHash({index,reason,action,tick})}));if(this.#history.length>64)this.#history.shift();return ok(action);}
 complete(success:boolean,tick:number):Result<RecoveryState>{if(this.#disposed)return err('RUNTIME_DISPOSED','Recovery runtime is disposed.');const phase=success?'degraded':'failed';this.#state=this.#buildState({...this.#state,phase,stableTicks:0});const current=this.#history.at(-1);if(current)this.#history[this.#history.length-1]=Object.freeze({...current,success,digest:stableHash({...current,success})});if(!success&&this.#state.attempts>=this.#policy.maxAttempts)this.#state=this.#buildState({...this.#state,phase:'failed'});void tick;return ok(this.#state);}
tick(stable=true){if(this.#disposed)return;this.#cooldown=Math.max(0,this.#cooldown-1);if(stable&&this.#state.phase!=='healthy'){const nextStable=this.#state.stableTicks+1;this.#state=this.#buildState({...this.#state,stableTicks:nextStable,...(nextStable>=this.#policy.resetAfterStableTicks?{phase:'healthy',attempts:0,}: {})});}}
snapshot():RecoveryState{return this.#state;}
history():readonly RecoveryAttempt[]{return Object.freeze([...this.#history]);}
reset(){this.#history=[];this.#cooldown=0;this.#state=this.#buildState({phase:'healthy',attempts:0,stableTicks:0,generation:this.#state.generation+1});}
dispose(){this.#disposed=true;this.reset();}
}