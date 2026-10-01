export interface IntelligenceMetricSample { readonly tick:number; readonly actors:number; readonly stimuli:number; readonly memories:number; readonly decisions:number; readonly events:number; readonly interests:number; readonly budgetDrops:number; readonly latencyMs:number; }
export interface IntelligenceMetricSummary { readonly samples:number; readonly actorsP95:number; readonly stimuliP95:number; readonly decisionsP95:number; readonly budgetDropsP95:number; readonly latencyP50:number; readonly latencyP95:number; readonly latencyP99:number; readonly totalEvents:number; readonly totalInterestQueries:number; }

const finite=(value:number,fallback=0):number=>Number.isFinite(value)?Math.max(0,value):fallback;
const percentile=(values:readonly number[],p:number):number=>{if(!values.length)return 0;const sorted=[...values].map(v=>finite(v)).sort((a,b)=>a-b);const index=Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1));return sorted[index]??0;};

export class IntelligenceTelemetry{
 readonly #samples:IntelligenceMetricSample[]=[];readonly #capacity:number;#disposed=false;
 constructor(capacity=240){this.#capacity=Math.max(8,Math.floor(capacity));}
 record(sample:IntelligenceMetricSample):void{if(this.#disposed)return;this.#samples.push(Object.freeze({...sample,actors:Math.max(0,Math.floor(finite(sample.actors))),stimuli:Math.max(0,Math.floor(finite(sample.stimuli))),memories:Math.max(0,Math.floor(finite(sample.memories))),decisions:Math.max(0,Math.floor(finite(sample.decisions))),events:Math.max(0,Math.floor(finite(sample.events))),interests:Math.max(0,Math.floor(finite(sample.interests))),budgetDrops:Math.max(0,Math.floor(finite(sample.budgetDrops))),latencyMs:finite(sample.latencyMs)}));while(this.#samples.length>this.#capacity)this.#samples.shift();}
 summary():IntelligenceMetricSummary{const s=this.#samples;return Object.freeze({samples:s.length,actorsP95:percentile(s.map(x=>x.actors),.95),stimuliP95:percentile(s.map(x=>x.stimuli),.95),decisionsP95:percentile(s.map(x=>x.decisions),.95),budgetDropsP95:percentile(s.map(x=>x.budgetDrops),.95),latencyP50:percentile(s.map(x=>x.latencyMs),.5),latencyP95:percentile(s.map(x=>x.latencyMs),.95),latencyP99:percentile(s.map(x=>x.latencyMs),.99),totalEvents:s.reduce((n,x)=>n+x.events,0),totalInterestQueries:s.reduce((n,x)=>n+x.interests,0)});}
 snapshot():readonly IntelligenceMetricSample[]{return Object.freeze([...this.#samples]);}
 clear():void{this.#samples.length=0;}
 dispose():void{this.#disposed=true;this.clear();}
 get size():number{return this.#samples.length;}
}

export function compareTelemetry(before:IntelligenceMetricSummary,after:IntelligenceMetricSummary):Readonly<Record<string,number>>{const ratio=(a:number,b:number)=>b===0?(a===0?0:1):(a-b)/b;return Object.freeze({latencyP50Delta:ratio(before.latencyP50,after.latencyP50),latencyP95Delta:ratio(before.latencyP95,after.latencyP95),latencyP99Delta:ratio(before.latencyP99,after.latencyP99),budgetDropDelta:ratio(before.budgetDropsP95,after.budgetDropsP95),decisionP95Delta:ratio(before.decisionsP95,after.decisionsP95)});}
