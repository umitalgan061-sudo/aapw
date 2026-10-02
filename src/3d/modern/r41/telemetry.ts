import{stableHash}from'./hash';import type{HealthSignal,MetricPoint,RuntimeHealth}from'./contracts';
export class RuntimeTelemetry{
 #metrics:MetricPoint[]=[];#signals=new Map<string,HealthSignal>();readonly maxMetrics:number;#dropped=0;
 constructor(maxMetrics=20000){this.maxMetrics=Math.max(128,Math.trunc(maxMetrics));}
 metric(name:string,value:number,timestampMs:number,tags:Readonly<Record<string,string>>={}):MetricPoint{const point=Object.freeze({name,value:Number.isFinite(value)?value:0,timestampMs,tags:Object.freeze({...tags})});this.#metrics.push(point);while(this.#metrics.length>this.maxMetrics){this.#metrics.shift();this.#dropped+=1;}return point;}
 setHealth(signal:HealthSignal):void{this.#signals.set(signal.subsystem,Object.freeze({...signal,score:Math.max(0,Math.min(1,signal.score))}));}
 snapshot(phase:RuntimeHealth['phase'],tick:number,activeWork:number,droppedWork:number,memoryBytes:number):RuntimeHealth{const signals=[...this.#signals.values()].sort((a,b)=>a.subsystem.localeCompare(b.subsystem));const score=signals.length?signals.reduce((s,v)=>s+v.score,0)/signals.length:1;return Object.freeze({phase,score,signals:Object.freeze(signals),activeWork,droppedWork,memoryBytes,tick,digest:stableHash({phase,tick,activeWork,droppedWork,memoryBytes,signals})});}
 metrics():readonly MetricPoint[]{return Object.freeze([...this.#metrics]);}dropped():number{return this.#dropped;}clear():void{this.#metrics=[];this.#signals.clear();this.#dropped=0;}
}
