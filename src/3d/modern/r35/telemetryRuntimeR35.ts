
import { clamp, stableHash, type R35Budget, type R35Metric } from './contracts';

export interface R35Anomaly { readonly metric:string; readonly value:number; readonly baseline:number; readonly score:number; readonly tick:number; }
export class TelemetryRuntimeR35 {
  #metrics:R35Metric[]=[]; #window=new Map<string,number[]>(); #maxMetrics=10000; #sampleRate=1; #budget:R35Budget={cpu:8,gpu:8,memory:512,entities:4096,events:128};
  configure(sampleRate:number,budget?:Partial<R35Budget>):void{this.#sampleRate=clamp(sampleRate,0.01,1);this.#budget=Object.freeze({...this.#budget,...budget});}
  record(name:string,value:number,tick:number,tags:Readonly<Record<string,string>>={}):void{if(!name||!Number.isFinite(value)||(tick%Math.max(1,Math.round(1/this.#sampleRate)))!==0)return;const m=Object.freeze({name,value,tick,tags:Object.freeze({...tags})});this.#metrics.push(m);if(this.#metrics.length>this.#maxMetrics)this.#metrics.splice(0,this.#metrics.length-this.#maxMetrics);let w=this.#window.get(name);if(!w){w=[];this.#window.set(name,w);}w.push(value);if(w.length>60)w.shift();}
  latest(name:string):R35Metric|null{for(let i=this.#metrics.length-1;i>=0;i--)if(this.#metrics[i]!.name===name)return this.#metrics[i]!;return null;}
  anomalies(tick:number):ReadonlyArray<R35Anomaly>{const out:R35Anomaly[]=[];for(const [name,w] of this.#window.entries()){if(w.length<8)continue;const baseline=w.reduce((a,b)=>a+b,0)/w.length;const latest=w[w.length-1]!;const variance=w.reduce((s,v)=>s+(v-baseline)**2,0)/w.length;const sigma=Math.sqrt(variance)||1;const score=Math.abs(latest-baseline)/sigma;if(score>=3)out.push(Object.freeze({metric:name,value:latest,baseline,score,tick}));}return Object.freeze(out.sort((a,b)=>b.score-a.score));}
  budget():R35Budget{return this.#budget;}
  metrics(limit=256):ReadonlyArray<R35Metric>{return Object.freeze(this.#metrics.slice(-clamp(Math.trunc(limit),1,1000)));}
  digest():string{return stableHash(this.metrics(512));}
  clear():void{this.#metrics=[];this.#window.clear();}
  checkBudget(name:keyof R35Budget,value:number):boolean{return value<=this.#budget[name];}
}
