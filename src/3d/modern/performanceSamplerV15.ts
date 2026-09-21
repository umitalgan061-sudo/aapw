/** Rolling performance sampler with percentiles and pressure classification. */
export interface PerformanceSampleV15{readonly frameMs:number;readonly cpuMs:number;readonly gpuMs:number;readonly simulationMs:number;readonly streamingMs:number;readonly networkMs:number;readonly drawCalls:number;readonly triangles:number;readonly visibleObjects:number;readonly memoryMb:number;readonly timestampMs:number;readonly frame:number;}
export type PressureBandV15='excellent'|'healthy'|'strained'|'degraded'|'critical';
export interface PerformanceSnapshotV15{readonly count:number;readonly average:PerformanceSampleV15;readonly p50FrameMs:number;readonly p95FrameMs:number;readonly p99FrameMs:number;readonly maxFrameMs:number;readonly pressure:number;readonly band:PressureBandV15;readonly memoryPressure:number;readonly gpuPressure:number;readonly cpuPressure:number;readonly digest:string;}

const finite=(v:number)=>Number.isFinite(v)?Math.max(0,v):0;
const percentile=(values:readonly number[],p:number):number=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*p)-1))]??0;};
const avg=(values:readonly number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
const digest=(snapshot:unknown):string=>{const text=JSON.stringify(snapshot);let h=2166136261;for(let i=0;i<text.length;i+=1){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};

export class PerformanceSamplerV15{
  readonly #capacity:number;readonly #samples:PerformanceSampleV15[]=[];#last:PerformanceSnapshotV15|undefined;
  constructor(capacity=240){this.#capacity=Math.max(30,Math.min(2400,Math.trunc(capacity)));}
  push(sample:PerformanceSampleV15):PerformanceSnapshotV15{
    const normalized=Object.freeze({frameMs:finite(sample.frameMs),cpuMs:finite(sample.cpuMs),gpuMs:finite(sample.gpuMs),simulationMs:finite(sample.simulationMs),streamingMs:finite(sample.streamingMs),networkMs:finite(sample.networkMs),drawCalls:Math.trunc(finite(sample.drawCalls)),triangles:Math.trunc(finite(sample.triangles)),visibleObjects:Math.trunc(finite(sample.visibleObjects)),memoryMb:finite(sample.memoryMb),timestampMs:finite(sample.timestampMs),frame:Math.trunc(finite(sample.frame))});
    this.#samples.push(normalized);while(this.#samples.length>this.#capacity)this.#samples.shift();this.#last=this.#calculate();return this.#last;
  }
  current():PerformanceSnapshotV15{return this.#last??this.#calculate();}
  samples():readonly PerformanceSampleV15[]{return Object.freeze([...this.#samples]);}
  reset():void{this.#samples.length=0;this.#last=undefined;}
  pressure():number{return this.current().pressure;}
  band():PressureBandV15{return this.current().band;}

  #calculate():PerformanceSnapshotV15{
    const f=this.#samples.map(s=>s.frameMs),c=this.#samples.map(s=>s.cpuMs),g=this.#samples.map(s=>s.gpuMs),m=this.#samples.map(s=>s.memoryMb);
    const frameAvg=avg(f),cpuAvg=avg(c),gpuAvg=avg(g),memoryAvg=avg(m);
    const cpuPressure=Math.min(1,cpuAvg/22),gpuPressure=Math.min(1,gpuAvg/22),memoryPressure=Math.min(1,memoryAvg/1600),framePressure=Math.min(1,frameAvg/33.33);
    const pressure=Math.min(1,framePressure*.4+cpuPressure*.2+gpuPressure*.2+memoryPressure*.2);
    const band:PressureBandV15=pressure<.2?'excellent':pressure<.4?'healthy':pressure<.6?'strained':pressure<.8?'degraded':'critical';
    const average:PerformanceSampleV15=Object.freeze({frameMs:frameAvg,cpuMs:cpuAvg,gpuMs:gpuAvg,simulationMs:avg(this.#samples.map(s=>s.simulationMs)),streamingMs:avg(this.#samples.map(s=>s.streamingMs)),networkMs:avg(this.#samples.map(s=>s.networkMs)),drawCalls:Math.trunc(avg(this.#samples.map(s=>s.drawCalls))),triangles:Math.trunc(avg(this.#samples.map(s=>s.triangles))),visibleObjects:Math.trunc(avg(this.#samples.map(s=>s.visibleObjects))),memoryMb:memoryAvg,timestampMs:this.#samples.at(-1)?.timestampMs??0,frame:this.#samples.at(-1)?.frame??0});
    const payload={count:this.#samples.length,average,p50:percentile(f,.5),p95:percentile(f,.95),p99:percentile(f,.99),max:Math.max(...f,0),pressure,band};
    return Object.freeze({count:this.#samples.length,average,p50FrameMs:percentile(f,.5),p95FrameMs:percentile(f,.95),p99FrameMs:percentile(f,.99),maxFrameMs:Math.max(...f,0),pressure,memoryPressure,gpuPressure,cpuPressure,digest:digest(payload)});
  }
}

export const comparePerformanceV15=(a:PerformanceSnapshotV15,b:PerformanceSnapshotV15)=>Object.freeze({frameDeltaMs:b.average.frameMs-a.average.frameMs,pressureDelta:b.pressure-a.pressure,memoryDeltaMb:b.average.memoryMb-a.average.memoryMb,drawCallDelta:b.average.drawCalls-a.average.drawCalls});
