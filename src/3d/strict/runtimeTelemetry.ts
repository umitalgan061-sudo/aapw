import type { RuntimeBudgets, RuntimeDiagnostics, RuntimePhase } from './liveCoreTypes.ts';
import { clamp, stableHash } from './liveCoreTypes.ts';

export type TelemetryMetricKind = 'counter' | 'gauge' | 'histogram' | 'trace';
export interface TelemetrySample { readonly name:string; readonly kind:TelemetryMetricKind; readonly value:number; readonly tick:number; readonly tags?:Readonly<Record<string,string>>; readonly durationMs?:number; }
export interface HistogramSnapshot { readonly count:number; readonly min:number; readonly max:number; readonly mean:number; readonly p50:number; readonly p90:number; readonly p95:number; readonly p99:number; }
export interface BudgetAlarm { readonly id:string; readonly budgetMs:number; readonly observedMs:number; readonly exceededByMs:number; readonly tick:number; readonly category:'simulation'|'render'|'input'|'asset'|'telemetry'; }
export interface TelemetrySnapshot { readonly counters:Readonly<Record<string,number>>; readonly gauges:Readonly<Record<string,number>>; readonly histograms:Readonly<Record<string,HistogramSnapshot>>; readonly alarms:readonly BudgetAlarm[]; readonly retainedSamples:number; readonly digest:string; }

const finite = (v:number, fallback=0) => Number.isFinite(v) ? v : fallback;
const normalizeName=(v:string)=>v.trim().slice(0,96).replace(/[^a-zA-Z0-9._:-]/g,'_');
const normalizeTags=(tags?:Readonly<Record<string,string>>)=>Object.freeze(Object.fromEntries(Object.entries(tags??{}).sort(([a],[b])=>a.localeCompare(b)).slice(0,12).map(([k,v])=>[normalizeName(k),String(v).slice(0,96)])));
const percentile=(values:readonly number[], p:number)=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);const index=(sorted.length-1)*clamp(p,0,1);const low=Math.floor(index),high=Math.ceil(index);return low===high?sorted[low]!:sorted[low]!+(sorted[high]!-sorted[low]!)*(index-low);};

class BoundedHistogram {
  #values:number[]=[]; #sum=0; #min=Infinity; #max=-Infinity; readonly #capacity:number;
  constructor(capacity=512){this.#capacity=Math.max(16,Math.floor(capacity));}
  add(value:number){const n=Math.max(0,finite(value));this.#values.push(n);this.#sum+=n;this.#min=Math.min(this.#min,n);this.#max=Math.max(this.#max,n);if(this.#values.length>this.#capacity){const old=this.#values.shift()!;this.#sum-=old;this.#min=Math.min(...this.#values);this.#max=Math.max(...this.#values);}}
  snapshot():HistogramSnapshot{return Object.freeze({count:this.#values.length,min:this.#values.length?this.#min:0,max:this.#values.length?this.#max:0,mean:this.#values.length?this.#sum/this.#values.length:0,p50:percentile(this.#values,.5),p90:percentile(this.#values,.9),p95:percentile(this.#values,.95),p99:percentile(this.#values,.99)});}
  values(){return [...this.#values];}
}

export interface TelemetryPolicy { readonly maxSamples:number; readonly maxAlarms:number; readonly histogramCapacity:number; readonly maxTraceDurationMs:number; readonly maxTagCount:number; }
export const DEFAULT_TELEMETRY_POLICY:TelemetryPolicy=Object.freeze({maxSamples:4096,maxAlarms:256,histogramCapacity:512,maxTraceDurationMs:5000,maxTagCount:12});

export class StrictRuntimeTelemetry {
  #policy:TelemetryPolicy; #samples:TelemetrySample[]=[]; #counters=new Map<string,number>(); #gauges=new Map<string,number>(); #histograms=new Map<string,BoundedHistogram>(); #alarms:BudgetAlarm[]=[]; #disposed=false;
  constructor(policy:TelemetryPolicy=DEFAULT_TELEMETRY_POLICY){this.#policy=Object.freeze({...policy});}
  #retain(sample:TelemetrySample){this.#samples.push(Object.freeze(sample));if(this.#samples.length>this.#policy.maxSamples)this.#samples.shift();}
  increment(name:string,amount=1,tick=0,tags?:Readonly<Record<string,string>>){if(this.#disposed)return;const key=normalizeName(name);const next=(this.#counters.get(key)??0)+finite(amount);this.#counters.set(key,next);this.#retain({name:key,kind:'counter',value:next,tick:Math.max(0,Math.floor(tick)),tags:normalizeTags(tags)});}
  gauge(name:string,value:number,tick=0,tags?:Readonly<Record<string,string>>){if(this.#disposed)return;const key=normalizeName(name);const next=finite(value);this.#gauges.set(key,next);this.#retain({name:key,kind:'gauge',value:next,tick:Math.max(0,Math.floor(tick)),tags:normalizeTags(tags)});}
  observe(name:string,value:number,tick=0,tags?:Readonly<Record<string,string>>){if(this.#disposed)return;const key=normalizeName(name);let histogram=this.#histograms.get(key);if(!histogram){histogram=new BoundedHistogram(this.#policy.histogramCapacity);this.#histograms.set(key,histogram);}const n=Math.max(0,finite(value));histogram.add(n);this.#retain({name:key,kind:'histogram',value:n,tick:Math.max(0,Math.floor(tick)),tags:normalizeTags(tags)});}
  trace(name:string,durationMs:number,tick=0,tags?:Readonly<Record<string,string>>){if(this.#disposed)return;const n=clamp(durationMs,0,this.#policy.maxTraceDurationMs);this.observe(name,n,tick,tags);this.#retain({name:normalizeName(name),kind:'trace',value:n,tick:Math.max(0,Math.floor(tick)),tags:normalizeTags(tags),durationMs:n});}
  recordBudget(budgets:RuntimeBudgets,tick:number,budgetMs:RuntimeBudgets){const pairs:[keyof RuntimeBudgets,TelemetryMetricKind][]=[['simulationMs','histogram'],['renderMs','histogram'],['inputMs','histogram'],['assetMs','histogram'],['telemetryMs','histogram']];for(const [category] of pairs){this.observe(category,budgets[category],tick,{domain:String(category)});const observed=budgets[category],limit=budgetMs[category];if(observed>limit)this.#raiseAlarm(String(category),limit,observed,tick);}}
  recordRuntimeDiagnostics(diag:RuntimeDiagnostics,budgetMs:RuntimeBudgets){this.gauge('runtime.frameTimeMs',diag.frameTimeMs,Number(diag.tick));this.gauge('runtime.residentAssetBytes',diag.residentAssetBytes,Number(diag.tick));this.gauge('runtime.simulationSteps',diag.simulationSteps,Number(diag.tick));this.recordBudget({simulationMs:0,renderMs:diag.frameTimeMs,inputMs:0,assetMs:0,telemetryMs:0},Number(diag.tick),budgetMs);}
  #raiseAlarm(category:string,budgetMs:number,observedMs:number,tick:number){const alarm=Object.freeze({id:stableHash({category,budgetMs,observedMs,tick}),budgetMs,observedMs,exceededByMs:observedMs-budgetMs,tick,category:category as BudgetAlarm['category']});this.#alarms.push(alarm);if(this.#alarms.length>this.#policy.maxAlarms)this.#alarms.shift();}
  snapshot():TelemetrySnapshot{const counters=Object.fromEntries([...this.#counters.entries()].sort(([a],[b])=>a.localeCompare(b)));const gauges=Object.fromEntries([...this.#gauges.entries()].sort(([a],[b])=>a.localeCompare(b)));const histograms=Object.fromEntries([...this.#histograms.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,v.snapshot()]));const digest=stableHash({counters,gauges,histograms,alarms:this.#alarms});return Object.freeze({counters:Object.freeze(counters),gauges:Object.freeze(gauges),histograms:Object.freeze(histograms),alarms:Object.freeze([...this.#alarms]),retainedSamples:this.#samples.length,digest});}
  samples():readonly TelemetrySample[]{return Object.freeze([...this.#samples]);}
  alarms():readonly BudgetAlarm[]{return Object.freeze([...this.#alarms]);}
  reset(){this.#samples=[];this.#counters.clear();this.#gauges.clear();this.#histograms.clear();this.#alarms=[];}
  dispose(){this.#disposed=true;this.reset();}
  get disposed(){return this.#disposed;}
}

export const telemetryPhaseTags=(phase:RuntimePhase)=>Object.freeze({phase});