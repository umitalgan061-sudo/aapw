import { clamp01,digestValue } from './deterministic.js';
import type { R16EventSeverity,R16HealthReport,R16HealthSignal,R16HealthState,R16RuntimeConfig } from './types.js';

export class R16HealthSupervisor{
  readonly #signals=new Map<string,R16HealthSignal>();readonly #maxSignals:number;#tick=0;#state:R16HealthState='healthy';
  constructor(config:Pick<R16RuntimeConfig,'maxEvents'>){this.#maxSignals=Math.max(16,Math.min(512,Math.trunc(config.maxEvents)));}
  report(subsystem:string,score:number,severity:R16EventSeverity,reason:string,tick:number){
    const signal:R16HealthSignal=Object.freeze({subsystem:subsystem.slice(0,96),severity,score:clamp01(score),reason:reason.slice(0,256),tick:Math.max(0,Math.trunc(tick))});
    this.#tick=signal.tick;this.#signals.set(signal.subsystem,signal);this.recompute();
  }
  recover(subsystem:string,tick:number){this.report(subsystem,1,'info','recovered',tick);}
  state(){return this.#state;}
  reportSnapshot():R16HealthReport{
    const signals=[...this.#signals.values()].sort((a,b)=>a.subsystem.localeCompare(b.subsystem));const score=signals.length?signals.reduce((s,x)=>s+x.score,0)/signals.length:1;
    return Object.freeze({version:16,state:this.#state,score,tick:this.#tick,signals:Object.freeze(signals),digest:digestValue({state:this.#state,score,tick:this.#tick,signals})});
  }
  clear(){this.#signals.clear();this.#tick=0;this.#state='healthy';}
  private recompute(){
    const list=[...this.#signals.values()],min=list.reduce((m,x)=>Math.min(m,x.score),1),fatal=list.some(x=>x.severity==='fatal'),error=list.some(x=>x.severity==='error');
    this.#state=fatal||min<.2?'blocked':error||min<.5?'recovering':min<.8?'degraded':'healthy';
  }
}
