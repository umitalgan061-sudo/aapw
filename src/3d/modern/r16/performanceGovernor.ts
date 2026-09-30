import { clamp01,digestValue } from './deterministic.js';

export type R16QualityTier='minimal'|'balanced'|'quality'|'ultra';
export interface R16PerformanceSignal{readonly frameMs:number;readonly cpuMs:number;readonly gpuMs:number;readonly memoryPressure:number;readonly networkPressure:number;readonly simulationPressure:number;}
export interface R16PerformanceDecision{readonly tier:R16QualityTier;readonly renderScale:number;readonly workerScale:number;readonly streamingScale:number;readonly reason:string;readonly pressure:number;readonly changed:boolean;readonly digest:string;}
export interface R16PerformancePolicy{readonly targetFrameMs:number;readonly degradeThreshold:number;readonly upgradeThreshold:number;readonly hysteresisTicks:number;readonly maxStep:number;}

const TIERS:readonly R16QualityTier[]=['minimal','balanced','quality','ultra'];
const RANK:Readonly<Record<R16QualityTier,number>>=Object.freeze({minimal:0,balanced:1,quality:2,ultra:3});

export class R16PerformanceGovernor{
  readonly #policy:R16PerformancePolicy;#tier:R16QualityTier='quality';#stable=0;#lastTick=-1;
  constructor(policy:Partial<R16PerformancePolicy>={}){
    this.#policy=Object.freeze({targetFrameMs:16.6667,degradeThreshold:.9,upgradeThreshold:.55,hysteresisTicks:45,maxStep:1,...policy});
  }
  evaluate(signal:R16PerformanceSignal,tick:number):R16PerformanceDecision{
    const framePressure=signal.frameMs/Math.max(.1,this.#policy.targetFrameMs);
    const pressure=clamp01(Math.max(framePressure,signal.cpuMs/12,signal.gpuMs/12,signal.memoryPressure,signal.networkPressure,signal.simulationPressure));
    let next=this.#tier;let reason='stable';let changed=false;
    if(pressure>=this.#policy.degradeThreshold){this.#stable=0;const target=Math.max(0,RANK[this.#tier]-this.#policy.maxStep);next=TIERS[target]??this.#tier;reason='pressure';}
    else if(pressure<=this.#policy.upgradeThreshold){this.#stable+=1;if(this.#stable>=this.#policy.hysteresisTicks){this.#stable=0;const target=Math.min(TIERS.length-1,RANK[this.#tier]+1);next=TIERS[target]??this.#tier;reason='sustained-headroom';}}
    else this.#stable=0;
    changed=next!==this.#tier;this.#tier=next;this.#lastTick=Math.max(0,Math.trunc(tick));
    const rank=RANK[this.#tier];const renderScale=[.65,.82,.92,1][rank]??.92;const workerScale=[.5,.72,.88,1][rank]??.88;const streamingScale=[.55,.75,.9,1][rank]??.9;
    return Object.freeze({tier:this.#tier,renderScale,workerScale,streamingScale,reason,pressure,changed,digest:digestValue({tick:this.#lastTick,signal, tier:this.#tier,renderScale,workerScale,streamingScale})});
  }
  tier(){return this.#tier;}stableTicks(){return this.#stable;}lastTick(){return this.#lastTick;}
  reset(tier:R16QualityTier='quality'){this.#tier=tier;this.#stable=0;this.#lastTick=-1;}
}
