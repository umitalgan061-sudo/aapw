import {HealthGrade,clampFinite} from './contracts.ts';

export type QualityLevel='ultra'|'high'|'balanced'|'performance'|'mobile';
export interface PerformanceSample{readonly frameMilliseconds:number;readonly gpuMilliseconds?:number;readonly networkRttMilliseconds?:number;readonly memoryBytes?:number;readonly visibleEntities?:number;readonly droppedTasks?:number;}
export interface PerformanceThresholds{readonly excellentFrame:number;readonly acceptableFrame:number;readonly criticalFrame:number;readonly excellentRtt:number;readonly criticalRtt:number;readonly criticalMemoryBytes:number;}
export interface QualityProfile{readonly level:QualityLevel;readonly renderScale:number;readonly shadowScale:number;readonly vegetationDensity:number;readonly effectsDensity:number;readonly simulationRate:number;readonly maxVisibleEntities:number;readonly textureBias:number;}
export interface GovernorSnapshot{readonly level:QualityLevel;readonly score:number;readonly trend:number;readonly samples:number;readonly cooldownFrames:number;readonly profile:QualityProfile;readonly reason:string;}
export interface PerformanceGovernorOptions{readonly windowSize:number;readonly minDwellFrames:number;readonly thresholds:PerformanceThresholds;readonly clock?:()=>number;}
const DEFAULT_THRESHOLDS:PerformanceThresholds={excellentFrame:13,acceptableFrame:16.7,criticalFrame:28,excellentRtt:55,criticalRtt:180,criticalMemoryBytes:768*1024*1024};
const PROFILES:Readonly<Record<QualityLevel,QualityProfile>>={
  ultra:{level:'ultra',renderScale:1,shadowScale:1,vegetationDensity:1,effectsDensity:1,simulationRate:1,maxVisibleEntities:2400,textureBias:0},
  high:{level:'high',renderScale:.92,shadowScale:.9,vegetationDensity:.88,effectsDensity:.9,simulationRate:1,maxVisibleEntities:1900,textureBias:.25},
  balanced:{level:'balanced',renderScale:.82,shadowScale:.75,vegetationDensity:.72,effectsDensity:.72,simulationRate:.98,maxVisibleEntities:1500,textureBias:.5},
  performance:{level:'performance',renderScale:.72,shadowScale:.55,vegetationDensity:.55,effectsDensity:.5,simulationRate:.92,maxVisibleEntities:1000,textureBias:.9},
  mobile:{level:'mobile',renderScale:.6,shadowScale:.35,vegetationDensity:.35,effectsDensity:.3,simulationRate:.86,maxVisibleEntities:650,textureBias:1.25},
};
const ORDER:readonly QualityLevel[]=['ultra','high','balanced','performance','mobile'];
const GRADE_WEIGHT:Record<HealthGrade,number>={excellent:1,healthy:.8,degraded:.55,critical:.25};

export class PerformanceGovernor{
  readonly #options:Required<Pick<PerformanceGovernorOptions,'windowSize'|'minDwellFrames'>>&{thresholds:PerformanceThresholds;clock:()=>number};
  readonly #samples:PerformanceSample[]=[];
  #level:QualityLevel='balanced';
  #cooldown=0;
  #score=70;
  #trend=0;
  #reason='initial';
  #forced=false;
  constructor(options:Partial<PerformanceGovernorOptions>={}){this.#options={windowSize:options.windowSize??90,minDwellFrames:options.minDwellFrames??30,thresholds:{...DEFAULT_THRESHOLDS,...options.thresholds},clock:options.clock??(()=>performance.now())};}
  get level():QualityLevel{return this.#level;}
  force(level:QualityLevel,reason='manual'):void{this.#level=level;this.#forced=true;this.#cooldown=this.#options.minDwellFrames;this.#reason=reason;}
  release():void{this.#forced=false;this.#cooldown=0;}
  reset(level:QualityLevel='balanced'):void{this.#samples.length=0;this.#level=level;this.#cooldown=0;this.#score=70;this.#trend=0;this.#reason='reset';}
  observe(sample:PerformanceSample):GovernorSnapshot{
    this.#samples.push({...sample,frameMilliseconds:Math.max(0,sample.frameMilliseconds)});
    while(this.#samples.length>this.#options.windowSize)this.#samples.shift();
    const next=this.#evaluate();
    if(!this.#forced&&this.#cooldown>0)this.#cooldown-=1;
    return next;
  }
  snapshot():GovernorSnapshot{return{level:this.#level,score:this.#score,trend:this.#trend,samples:this.#samples.length,cooldownFrames:this.#cooldown,profile:PROFILES[this.#level],reason:this.#reason};}
  recommend():QualityProfile{return PROFILES[this.#chooseTarget()];}
  grade():HealthGrade{return this.#score>=90?'excellent':this.#score>=75?'healthy':this.#score>=55?'degraded':'critical';}
  #evaluate():GovernorSnapshot{
    if(!this.#samples.length)return this.snapshot();
    const average=this.#avg(v=>v.frameMilliseconds),p95=this.#percentile(v=>v.frameMilliseconds,.95);
    const rtt=this.#avg(v=>v.networkRttMilliseconds??0),memory=Math.max(...this.#samples.map(v=>v.memoryBytes??0)),drops=this.#avg(v=>v.droppedTasks??0);
    const frameScore=clampFinite(100-(Math.max(0,average-this.#options.thresholds.excellentFrame)*3),0,100);
    const p95Score=clampFinite(100-(Math.max(0,p95-this.#options.thresholds.acceptableFrame)*2),0,100);
    const rttScore=rtt===0?100:clampFinite(100-(Math.max(0,rtt-this.#options.thresholds.excellentRtt)*.4),0,100);
    const memoryScore=memory>=this.#options.thresholds.criticalMemoryBytes?35:memory>this.#options.thresholds.criticalMemoryBytes*.8?70:100;
    const dropScore=clampFinite(100-drops*8,0,100);
    const score=frameScore*.4+p95Score*.2+rttScore*.15+memoryScore*.15+dropScore*.1;
    this.#trend=.7*this.#trend+.3*(score-this.#score);this.#score=clampFinite(score,0,100);
    const target=this.#chooseTarget();
    if(!this.#forced&&this.#cooldown===0&&target!==this.#level){this.#level=target;this.#cooldown=this.#options.minDwellFrames;this.#reason=this.#explain(average,p95,rtt,memory,drops);}
    return this.snapshot();
  }
  #chooseTarget():QualityLevel{
    const score=this.#score;
    if(score>=94)return 'ultra';if(score>=84)return 'high';if(score>=68)return 'balanced';if(score>=48)return 'performance';return 'mobile';
  }
  #explain(avg:number,p95:number,rtt:number,memory:number,drops:number):string{
    if(p95>this.#options.thresholds.criticalFrame)return 'p95 frame time is critical';
    if(avg>this.#options.thresholds.acceptableFrame)return 'frame time is elevated';
    if(rtt>this.#options.thresholds.criticalRtt)return 'network RTT is critical';
    if(memory>this.#options.thresholds.criticalMemoryBytes)return 'memory pressure is critical';
    if(drops>2)return 'runtime budget drops are elevated';
    return 'adaptive quality target changed';
  }
  #avg(select:(s:PerformanceSample)=>number):number{if(!this.#samples.length)return 0;return this.#samples.reduce((sum,s)=>sum+select(s),0)/this.#samples.length;}
  #percentile(select:(s:PerformanceSample)=>number,p:number):number{const values=this.#samples.map(select).sort((a,b)=>a-b);if(!values.length)return 0;return values[Math.min(values.length-1,Math.ceil(values.length*p)-1)]??0;}
}

export const getQualityProfile=(level:QualityLevel):QualityProfile=>PROFILES[level];
export const qualityOrder=():readonly QualityLevel[]=>ORDER.slice();

export interface PerformanceBudgetDecision{readonly allowExpensivePass:boolean;readonly allowBackgroundWork:boolean;readonly visibleEntityCap:number;readonly renderScale:number;readonly reason:string;}
export function createBudgetDecision(snapshot:GovernorSnapshot):PerformanceBudgetDecision{
  const profile=snapshot.profile;const severe=snapshot.score<55;const degraded=snapshot.score<75;
  return{allowExpensivePass:!severe&&profile.level!=='mobile',allowBackgroundWork:!severe&&snapshot.trend>=-8,visibleEntityCap:profile.maxVisibleEntities,renderScale:profile.renderScale,reason:severe?'protect frame budget':degraded?'stabilize frame budget':'normal adaptive budget'};
}
