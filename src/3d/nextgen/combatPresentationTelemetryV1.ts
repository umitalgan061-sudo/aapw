/** Deterministic telemetry for combat presentation health and tuning. */
import type { CombatPresentationFrame } from './combatPresentationV1';
import type { CombatPresentationDispatch } from './combatPresentationQueueV1';

export interface CombatPresentationTelemetrySample { readonly tick: number; readonly cueCount: number; readonly dispatchCount: number; readonly droppedCues: number; readonly cameraShake: number; readonly hitstopTicks: number; readonly pendingQueue: number; readonly dispatchAgeMax: number; }
export interface CombatPresentationTelemetrySummary { readonly samples: number; readonly totalCues: number; readonly totalDispatches: number; readonly totalDropped: number; readonly cuePerTickP95: number; readonly dispatchPerTickP95: number; readonly peakPendingQueue: number; readonly peakCameraShake: number; readonly peakHitstopTicks: number; readonly dispatchAgeP95: number; readonly health: 'healthy' | 'pressured' | 'degraded'; }

const percentile=(values:readonly number[],p:number):number=>{if(!values.length)return 0;const a=[...values].sort((x,y)=>x-y);const i=Math.min(a.length-1,Math.max(0,Math.ceil(a.length*p)-1));return a[i]??0;};

export class CombatPresentationTelemetry {
  #samples: CombatPresentationTelemetrySample[]=[];
  #maxSamples:number;
  constructor(maxSamples=300){this.#maxSamples=Math.max(1,Math.floor(maxSamples));}
  record(frame:CombatPresentationFrame,dispatches:readonly CombatPresentationDispatch[],pendingQueue:number):void{
    const dispatchAgeMax=dispatches.reduce((m,d)=>Math.max(m,d.ageTicks),0);
    this.#samples.push(Object.freeze({tick:frame.tick,cueCount:frame.cues.length,dispatchCount:dispatches.length,droppedCues:frame.droppedCues,cameraShake:frame.cameraShake,hitstopTicks:frame.hitstopTicks,pendingQueue:Math.max(0,pendingQueue),dispatchAgeMax}));
    if(this.#samples.length>this.#maxSamples)this.#samples.splice(0,this.#samples.length-this.#maxSamples);
  }
  summary():CombatPresentationTelemetrySummary{
    const s=this.#samples;
    const totalCues=s.reduce((n,x)=>n+x.cueCount,0), totalDispatches=s.reduce((n,x)=>n+x.dispatchCount,0), totalDropped=s.reduce((n,x)=>n+x.droppedCues,0);
    const peakPending=s.reduce((m,x)=>Math.max(m,x.pendingQueue),0), peakCamera=s.reduce((m,x)=>Math.max(m,x.cameraShake),0), peakHitstop=s.reduce((m,x)=>Math.max(m,x.hitstopTicks),0);
    const dropRate=s.length?totalDropped/Math.max(1,totalCues):0;
    const health:CombatPresentationTelemetrySummary['health']=dropRate>0.12||peakPending>64?'degraded':dropRate>0.03||peakPending>24?'pressured':'healthy';
    return Object.freeze({samples:s.length,totalCues,totalDispatches,totalDropped,cuePerTickP95:percentile(s.map(x=>x.cueCount),.95),dispatchPerTickP95:percentile(s.map(x=>x.dispatchCount),.95),peakPendingQueue:peakPending,peakCameraShake:peakCamera,peakHitstopTicks:peakHitstop,dispatchAgeP95:percentile(s.map(x=>x.dispatchAgeMax),.95),health});
  }
  samples():readonly CombatPresentationTelemetrySample[]{return Object.freeze([...this.#samples]);}
  reset():void{this.#samples=[];}
  snapshot():Readonly<{version:1;samples:readonly CombatPresentationTelemetrySample[]}>{return Object.freeze({version:1,samples:Object.freeze([...this.#samples])});}
  restore(snapshot:Readonly<{version:1;samples:readonly CombatPresentationTelemetrySample[]}>):void{if(snapshot.version!==1)throw new Error('unsupported presentation telemetry snapshot');this.#samples=[...snapshot.samples].slice(-this.#maxSamples);}
}

export function createCombatPresentationTelemetry(maxSamples=300):CombatPresentationTelemetry{return new CombatPresentationTelemetry(maxSamples);}