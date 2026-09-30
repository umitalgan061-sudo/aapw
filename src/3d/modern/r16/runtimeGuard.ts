import { digestValue } from './deterministic.js';
import type { R16Result } from './types.js';

export type R16GuardViolationKind='capacity'|'ordering'|'invariant'|'integrity'|'lifecycle';
export interface R16GuardViolation{readonly id:string;readonly kind:R16GuardViolationKind;readonly subsystem:string;readonly message:string;readonly severity:'warn'|'error'|'fatal';readonly tick:number;readonly digest:string;}
export interface R16GuardReport{readonly passed:boolean;readonly violations:readonly R16GuardViolation[];readonly warnings:number;readonly errors:number;readonly fatals:number;readonly digest:string;}

export class R16RuntimeGuard{
  readonly #violations=new Map<string,R16GuardViolation>();
  assert(condition:boolean,id:string,kind:R16GuardViolationKind,subsystem:string,message:string,tick:number,severity:R16GuardViolation['severity']='error'):R16Result<void>{
    if(condition)return{ok:true,value:undefined};
    const violation:R16GuardViolation=Object.freeze({id:id.slice(0,96),kind,subsystem:subsystem.slice(0,96),message:message.slice(0,256),severity,tick:Math.max(0,Math.trunc(tick)),digest:digestValue({id,kind,subsystem,message,tick,severity})});
    this.#violations.set(violation.id,violation);
    return{ok:false,error:{code:'R16_GUARD_'+kind.toUpperCase(),message:violation.message,retryable:severity==='warn'}};
  }
  clear(id:string){return this.#violations.delete(id);}
  report():R16GuardReport{
    const violations=Object.freeze([...this.#violations.values()].sort((a,b)=>a.id.localeCompare(b.id)));
    const warnings=violations.filter(x=>x.severity==='warn').length,errors=violations.filter(x=>x.severity==='error').length,fatals=violations.filter(x=>x.severity==='fatal').length;
    return Object.freeze({passed:errors===0&&fatals===0,violations,warnings,errors,fatals,digest:digestValue(violations)});
  }
  clearAll(){this.#violations.clear();}
}
