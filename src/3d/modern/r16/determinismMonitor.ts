import { combineDigests, digestValue } from './deterministic.js';

export interface R16DeterminismSample {
  readonly tick:number;
  readonly expected:string;
  readonly actual:string;
  readonly equal:boolean;
  readonly source:string;
  readonly digest:string;
}
export interface R16DeterminismReport {
  readonly samples:readonly R16DeterminismSample[];
  readonly matched:number;
  readonly mismatched:number;
  readonly firstMismatchTick:number|null;
  readonly digest:string;
}
export interface R16DeterminismMonitorOptions {
  readonly maxSamples:number;
  readonly failFast:boolean;
}

export class R16DeterminismMonitor {
  readonly #maxSamples:number;
  readonly #failFast:boolean;
  readonly #samples:R16DeterminismSample[]=[];
  #blocked=false;

  constructor(options:Partial<R16DeterminismMonitorOptions>={}) {
    this.#maxSamples=Math.max(16,Math.trunc(options.maxSamples??4096));
    this.#failFast=options.failFast??false;
  }

  compare(tick:number,expected:string,actual:string,source='runtime'):boolean {
    const normalizedTick=Math.max(0,Math.trunc(tick));
    const equal=expected===actual;
    const sample:R16DeterminismSample=Object.freeze({
      tick:normalizedTick,
      expected:String(expected).slice(0,128),
      actual:String(actual).slice(0,128),
      equal,
      source:source.slice(0,96),
      digest:digestValue({tick:normalizedTick,expected,actual,source}),
    });

    if(this.#samples.length>=this.#maxSamples)this.#samples.shift();
    this.#samples.push(sample);

    if(!equal&&this.#failFast)this.#blocked=true;
    return equal;
  }

  blocked():boolean{return this.#blocked;}

  report():R16DeterminismReport {
    const samples=Object.freeze([...this.#samples]);
    const matched=samples.filter(sample=>sample.equal).length;
    const mismatched=samples.length-matched;
    const first=samples.find(sample=>!sample.equal)?.tick??null;
    return Object.freeze({
      samples,
      matched,
      mismatched,
      firstMismatchTick:first,
      digest:combineDigests(samples.map(sample=>sample.digest)),
    });
  }

  assertClean():void {
    if(this.#blocked||this.report().mismatched>0){
      throw new Error('R16 determinism monitor detected a mismatch');
    }
  }

  reset():void{this.#samples.length=0;this.#blocked=false;}
}
