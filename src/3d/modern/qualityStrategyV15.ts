/** Dynamic quality controller separating simulation fidelity from presentation fidelity. */
export type QualityTierV15='minimal'|'balanced'|'high'|'ultra';
export interface QualityBudgetV15{readonly renderScale:number;readonly maxObjects:number;readonly maxDrawCalls:number;readonly maxTriangles:number;readonly maxParticles:number;readonly shadowCascades:number;readonly textureAnisotropy:number;readonly updateHz:number;readonly aiHz:number;}
export interface QualityObservationV15{readonly frameMs:number;readonly cpuMs:number;readonly gpuMs:number;readonly memoryPressure:number;readonly thermalPressure:number;readonly visibleObjects:number;readonly drawCalls:number;readonly droppedFrames:number;}
export interface QualityDecisionV15{readonly tier:QualityTierV15;readonly score:number;readonly pressure:number;readonly budget:QualityBudgetV15;readonly changed:boolean;readonly reasons:readonly string[];}
export interface QualityStrategyOptionsV15{readonly initial?:QualityTierV15;readonly dwellFrames?:number;readonly minTier?:QualityTierV15;readonly maxTier?:QualityTierV15;}

const order:readonly QualityTierV15[]=['minimal','balanced','high','ultra'];
const profiles:Readonly<Record<QualityTierV15,QualityBudgetV15>>={
  minimal:Object.freeze({renderScale:.6,maxObjects:900,maxDrawCalls:500,maxTriangles:500000,maxParticles:120,shadowCascades:1,textureAnisotropy:1,updateHz:30,aiHz:8}),
  balanced:Object.freeze({renderScale:.78,maxObjects:1800,maxDrawCalls:900,maxTriangles:1000000,maxParticles:300,shadowCascades:2,textureAnisotropy:2,updateHz:60,aiHz:15}),
  high:Object.freeze({renderScale:.9,maxObjects:3200,maxDrawCalls:1400,maxTriangles:1800000,maxParticles:650,shadowCascades:3,textureAnisotropy:4,updateHz:60,aiHz:20}),
  ultra:Object.freeze({renderScale:1,maxObjects:6000,maxDrawCalls:2200,maxTriangles:3200000,maxParticles:1200,shadowCascades:4,textureAnisotropy:8,updateHz:60,aiHz:30}),
};

const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,Number.isFinite(v)?v:a));

export class QualityStrategyV15{
  readonly #dwell:number;
  readonly #minTier:QualityTierV15;
  readonly #maxTier:QualityTierV15;
  #tier:QualityTierV15;
  #stable=0;
  #pressure=0;

  constructor(options:QualityStrategyOptionsV15={}){
    this.#tier=options.initial??'balanced';
    this.#minTier=options.minTier??'minimal';
    this.#maxTier=options.maxTier??'ultra';
    this.#dwell=Math.max(1,Math.trunc(options.dwellFrames??30));
    if(order.indexOf(this.#tier)<order.indexOf(this.#minTier))this.#tier=this.#minTier;
    if(order.indexOf(this.#tier)>order.indexOf(this.#maxTier))this.#tier=this.#maxTier;
  }

  observe(observation:QualityObservationV15):QualityDecisionV15{
    const frame=clamp(observation.frameMs,0,250);
    const cpu=clamp(observation.cpuMs,0,250);
    const gpu=clamp(observation.gpuMs,0,250);
    const memory=clamp(observation.memoryPressure,0,1);
    const thermal=clamp(observation.thermalPressure,0,1);
    const drops=clamp(observation.droppedFrames/10,0,1);
    const render=clamp(observation.drawCalls/Math.max(1,profiles[this.#tier].maxDrawCalls),0,1);
    const objectPressure=clamp(observation.visibleObjects/Math.max(1,profiles[this.#tier].maxObjects),0,1);
    const pressure=clamp(frame/33.33*.3+cpu/22*.2+gpu/22*.2+memory*.12+thermal*.08+drops*.05+render*.025+objectPressure*.025,0,1);
    const previous=this.#tier;
    const reasons:string[]=[];

    if(pressure>=.82){
      this.#stable=0;
      const index=Math.max(order.indexOf(this.#minTier),order.indexOf(this.#tier)-1);
      this.#tier=order[index]??this.#minTier;
      reasons.push('sustained runtime pressure');
    }else if(pressure<=.34){
      this.#stable+=1;
      if(this.#stable>=this.#dwell){
        this.#stable=0;
        const index=Math.min(order.indexOf(this.#maxTier),order.indexOf(this.#tier)+1);
        this.#tier=order[index]??this.#maxTier;
        reasons.push('stable headroom available');
      }
    }else{
      this.#stable=0;
    }

    if(memory>.85)reasons.push('memory pressure');
    if(thermal>.8)reasons.push('thermal pressure');
    if(frame>33.33)reasons.push('frame budget exceeded');
    if(gpu>22)reasons.push('gpu budget exceeded');
    this.#pressure=pressure;
    const changed=previous!==this.#tier;
    return Object.freeze({tier:this.#tier,score:Number(((1-pressure)*100).toFixed(2)),pressure:Number(pressure.toFixed(4)),budget:profiles[this.#tier],changed,reasons:Object.freeze([...new Set(reasons)])});
  }

  decision():QualityDecisionV15{return Object.freeze({tier:this.#tier,score:Number(((1-this.#pressure)*100).toFixed(2)),pressure:this.#pressure,budget:profiles[this.#tier],changed:false,reasons:Object.freeze([])});}
  tier():QualityTierV15{return this.#tier;}
  pressure():number{return this.#pressure;}
  budget():QualityBudgetV15{return profiles[this.#tier];}
  reset(tier:QualityTierV15=this.#tier):void{this.#tier=tier;this.#stable=0;this.#pressure=0;}
  static profile(tier:QualityTierV15):QualityBudgetV15{return profiles[tier];}
}

export const qualityInterpolationV15=(from:QualityBudgetV15,to:QualityBudgetV15,t:number):QualityBudgetV15=>{const p=clamp(t,0,1);const mix=(a:number,b:number)=>a+(b-a)*p;return Object.freeze({renderScale:mix(from.renderScale,to.renderScale),maxObjects:Math.round(mix(from.maxObjects,to.maxObjects)),maxDrawCalls:Math.round(mix(from.maxDrawCalls,to.maxDrawCalls)),maxTriangles:Math.round(mix(from.maxTriangles,to.maxTriangles)),maxParticles:Math.round(mix(from.maxParticles,to.maxParticles)),shadowCascades:Math.max(1,Math.round(mix(from.shadowCascades,to.shadowCascades))),textureAnisotropy:Math.max(1,Math.round(mix(from.textureAnisotropy,to.textureAnisotropy))),updateHz:Math.max(15,Math.round(mix(from.updateHz,to.updateHz))),aiHz:Math.max(5,Math.round(mix(from.aiHz,to.aiHz)))});};
