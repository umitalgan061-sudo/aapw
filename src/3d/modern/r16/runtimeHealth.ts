import { digestValue } from './deterministic.js';
import type { R16HealthReport } from './types.js';
import { R16HealthSupervisor } from './health.js';

export interface R16RuntimeHealthThresholds{readonly warn:number;readonly recover:number;readonly block:number;}
export interface R16HealthAggregatorInput{readonly commandRejected:number;readonly framePressure:number;readonly memoryPressure:number;readonly networkRejected:number;readonly workerFailures:number;readonly saveFailures:number;}

export class R16RuntimeHealthAggregator{
  readonly supervisor:R16HealthSupervisor;readonly #thresholds:R16RuntimeHealthThresholds;
  constructor(supervisor=new R16HealthSupervisor({maxEvents:128}),thresholds:Partial<R16RuntimeHealthThresholds>={}){
    this.supervisor=supervisor;this.#thresholds=Object.freeze({warn:.8,recover:.5,block:.2,...thresholds});
  }
  evaluate(input:R16HealthAggregatorInput,tick:number):R16HealthReport{
    this.supervisor.report('command',1-Math.min(1,input.commandRejected),input.commandRejected>0?'warn':'info','command rejection pressure',tick);
    this.supervisor.report('frame',1-Math.min(1,input.framePressure),input.framePressure>this.#thresholds.warn?'warn':'info','frame pressure',tick);
    this.supervisor.report('memory',1-Math.min(1,input.memoryPressure),input.memoryPressure>this.#thresholds.recover?'error':'info','memory pressure',tick);
    this.supervisor.report('network',1-Math.min(1,input.networkRejected),input.networkRejected>0?'warn':'info','network rejection pressure',tick);
    this.supervisor.report('worker',1-Math.min(1,input.workerFailures),input.workerFailures>0?'warn':'info','worker failure pressure',tick);
    this.supervisor.report('save',1-Math.min(1,input.saveFailures),input.saveFailures>0?'error':'info','save failure pressure',tick);
    const report=this.supervisor.reportSnapshot();return Object.freeze({...report,digest:digestValue(report)});
  }
}
