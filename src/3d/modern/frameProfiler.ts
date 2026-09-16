import type { FrameId, FrameMetrics, TimestampMs } from './types';

export interface ProfileSample { readonly name: string; readonly startMs: number; readonly durationMs: number; readonly frameId: FrameId; readonly category: 'simulation'|'render'|'streaming'|'input'|'persistence'|'worker'|'other'; }
export interface ProfileSummary { readonly name: string; readonly category: ProfileSample['category']; readonly count: number; readonly totalMs: number; readonly averageMs: number; readonly maxMs: number; readonly p95Ms: number; }
export interface FrameProfile { readonly frameId: FrameId; readonly timestamp: TimestampMs; readonly cpuMs: number; readonly gpuMs: number | null; readonly samples: readonly ProfileSample[]; readonly budgetExceeded: boolean; }

class SampleBucket { private readonly values:number[]=[]; add(value:number):void{if(!Number.isFinite(value))return;this.values.push(value);if(this.values.length>1024)this.values.shift();} summary(name:string,category:ProfileSample['category']):ProfileSummary{const v=[...this.values].sort((a,b)=>a-b);const p=(x:number)=>v.length?v[Math.min(v.length-1,Math.floor(v.length*x))]??0:0;const total=v.reduce((a,b)=>a+b,0);return{name,category,count:v.length,totalMs:total,averageMs:v.length?total/v.length:0,maxMs:v.at(-1)??0,p95Ms:p(.95)};}}

/** Low-overhead profiler with bounded history and deterministic summaries. */
export class FrameProfiler {
  private readonly capacity:number; private readonly samples:ProfileSample[]=[]; private readonly buckets=new Map<string,SampleBucket>(); private current:FrameProfile|null=null; private disposed=false;
  public constructor(capacity=240){this.capacity=Math.max(30,Math.floor(capacity));}
  public begin(frameId:FrameId,timestamp:TimestampMs,cpuMs:number,gpuMs:number|null=null):void{this.ensure();this.current={frameId,timestamp,cpuMs,gpuMs,samples:[],budgetExceeded:cpuMs>16.7||(gpuMs??0)>16.7};}
  public sample(name:string,category:ProfileSample['category'],startMs:number,durationMs:number):void{this.ensure();if(!this.current)return;const sample={name,category,startMs,durationMs,frameId:this.current.frameId};this.current={...this.current,samples:[...this.current.samples,sample]};this.samples.push(sample);if(this.samples.length>this.capacity)this.samples.shift();let bucket=this.buckets.get(name);if(!bucket){bucket=new SampleBucket();this.buckets.set(name,bucket);}bucket.add(durationMs);}
  public end():FrameProfile|null{this.ensure();const result=this.current;this.current=null;return result;}
  public recordFrame(metrics:FrameMetrics):FrameProfile{this.begin(metrics.frameId,metrics.timestamp,metrics.cpuMs,metrics.gpuMs);this.sample('frame','other',Number(metrics.timestamp),metrics.cpuMs);return this.end()!;}
  public summaries():readonly ProfileSummary[]{return [...this.buckets].map(([name,bucket])=>bucket.summary(name,this.categoryFor(name))).sort((a,b)=>b.totalMs-a.totalMs||a.name.localeCompare(b.name));}
  public recent(limit=60):readonly ProfileSample[]{return this.samples.slice(-Math.max(0,limit));}
  public criticalPath():ProfileSummary|null{const summaries=this.summaries();return summaries.length?summaries[0]??null:null;}
  public reset():void{this.samples.length=0;this.buckets.clear();this.current=null;}
  private categoryFor(name:string):ProfileSample['category']{if(name.startsWith('render'))return'render';if(name.startsWith('asset')||name.startsWith('stream'))return'streaming';if(name.startsWith('input'))return'input';if(name.startsWith('save'))return'persistence';if(name.startsWith('worker'))return'worker';if(name.startsWith('sim'))return'simulation';return'other';}
  private ensure():void{if(this.disposed)throw new Error('FRAME_PROFILER_DISPOSED');}
  public dispose():void{if(this.disposed)return;this.reset();this.disposed=true;}
}

export interface FrameBudgetDecision { readonly simulationMs:number;readonly renderMs:number;readonly backgroundMs:number;readonly overBudget:boolean; }
export const splitFrameBudget=(cpuBudgetMs:number,simulationRatio=.45,renderRatio=.45):FrameBudgetDecision=>{const budget=Math.max(.5,cpuBudgetMs);const simulation=Math.min(budget,Math.max(0,budget*simulationRatio));const render=Math.min(budget-simulation,Math.max(0,budget*renderRatio));const background=Math.max(0,budget-simulation-render);return{simulationMs:simulation,renderMs:render,backgroundMs:background,overBudget:simulation+render>budget};};
