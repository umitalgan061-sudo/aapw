import { SlidingWindow } from './bounded.js';
import { combineDigests,digestValue } from './deterministic.js';
import type { R16MetricSummary,R16RuntimeConfig,R16TelemetryDigest,R16TelemetrySample } from './types.js';

export class R16Telemetry{
  readonly #maxSamples:number;readonly #samples:R16TelemetrySample[]=[];readonly #windows=new Map<string,SlidingWindow>();#dropped=0;
  constructor(config:Pick<R16RuntimeConfig,'maxTelemetrySamples'>){this.#maxSamples=Math.max(1,Math.trunc(config.maxTelemetrySamples));}
  record(metric:string,value:number,tick:number,unit='count',tags:Readonly<Record<string,string>>={}):void{
    if(!metric||!Number.isFinite(value))return;
    const sample:R16TelemetrySample=Object.freeze({metric:metric.slice(0,96),value,tick:Math.max(0,Math.trunc(tick)),unit:unit.slice(0,24),tags:Object.freeze(Object.fromEntries(Object.entries(tags).sort(([a],[b])=>a.localeCompare(b))))});
    if(this.#samples.length>=this.#maxSamples){this.#samples.shift();this.#dropped++;}this.#samples.push(sample);
    let window=this.#windows.get(sample.metric);if(!window){window=new SlidingWindow(240);this.#windows.set(sample.metric,window);}window.push(value);
  }
  metric(metric:string):R16MetricSummary|null{
    const values=this.#samples.filter(x=>x.metric===metric);const window=this.#windows.get(metric);if(!values.length||!window)return null;const s=window.stats();
    return Object.freeze({metric,count:values.length,min:s.minimum,max:s.maximum,avg:s.average,p95:s.p95,latest:values.at(-1)?.value??0,unit:values.at(-1)?.unit??'count'});
  }
  query(prefix='',limit=256){return Object.freeze(this.#samples.filter(x=>x.metric.startsWith(prefix)).slice(-Math.max(1,Math.trunc(limit))));}
  digest():R16TelemetryDigest{return Object.freeze({sampleCount:this.#samples.length,digest:combineDigests(this.#samples.map(digestValue)),droppedCount:this.#dropped});}
  export(){return Object.freeze([...this.#samples]);}
  clear(){this.#samples.length=0;this.#windows.clear();this.#dropped=0;}
}
export class R16SpanTimer{
  readonly #metric:string;readonly #tick:number;readonly #start:number;readonly #telemetry:R16Telemetry;readonly #now:()=>number;
  constructor(metric:string,tick:number,telemetry:R16Telemetry,now=()=>typeof performance!=='undefined'?performance.now():Date.now()){this.#metric=metric;this.#tick=tick;this.#telemetry=telemetry;this.#now=now;this.#start=now();}
  end(now=this.#now){const elapsed=Math.max(0,now()-this.#start);this.#telemetry.record(this.#metric,elapsed,this.#tick,'ms');return elapsed;}
}
