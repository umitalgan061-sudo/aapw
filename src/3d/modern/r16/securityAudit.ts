import { digestValue } from './deterministic.js';

export type R16SecuritySeverity='info'|'warn'|'block';
export interface R16SecurityFinding{readonly id:string;readonly severity:R16SecuritySeverity;readonly subsystem:string;readonly message:string;readonly tick:number;readonly digest:string;}
export interface R16SecurityAudit{readonly findings:readonly R16SecurityFinding[];readonly info:number;readonly warn:number;readonly block:number;readonly digest:string;}

export class R16SecurityAuditLog{
  readonly #findings=new Map<string,R16SecurityFinding>();
  record(id:string,severity:R16SecuritySeverity,subsystem:string,message:string,tick:number):R16SecurityFinding{
    const finding:R16SecurityFinding=Object.freeze({id:id.slice(0,96),severity,subsystem:subsystem.slice(0,96),message:message.slice(0,256),tick:Math.max(0,Math.trunc(tick)),digest:digestValue({id,severity,subsystem,message,tick})});
    this.#findings.set(finding.id,finding);return finding;
  }
  clear(id:string){return this.#findings.delete(id);}
  all(){return Object.freeze([...this.#findings.values()].sort((a,b)=>a.severity.localeCompare(b.severity)||a.id.localeCompare(b.id)));}
  audit():R16SecurityAudit{
    const findings=this.all();return Object.freeze({findings,info:findings.filter(x=>x.severity==='info').length,warn:findings.filter(x=>x.severity==='warn').length,block:findings.filter(x=>x.severity==='block').length,digest:digestValue(findings)});
  }
  clearAll(){this.#findings.clear();}
}
