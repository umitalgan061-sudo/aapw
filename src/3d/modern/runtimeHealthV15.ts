/** Health model combining correctness, performance, memory, network and migration signals. */
export interface HealthObservationV15{readonly deterministic:boolean;readonly errors:number;readonly warnings:number;readonly frameMs:number;readonly p95FrameMs:number;readonly memoryPressure:number;readonly networkRttMs:number;readonly packetLoss:number;readonly migrationCoverage:number;readonly failedTasks:number;readonly renderFailures:number;readonly assetFailures:number;readonly queueDepth:number;readonly queueCapacity:number;}
export interface HealthScoreV15{readonly score:number;readonly grade:'A'|'B'|'C'|'D'|'F';readonly healthy:boolean;readonly blocking:readonly string[];readonly warnings:readonly string[];readonly metrics:Readonly<Record<string,number>>;}
export interface HealthWindowV15{readonly observations:readonly HealthObservationV15[];readonly current:HealthScoreV15;readonly averageScore:number;readonly minimumScore:number;readonly degradedFrames:number;}

const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,Number.isFinite(v)?v:a));

export class RuntimeHealthV15{
  readonly #capacity:number;
  readonly #window:HealthObservationV15[]=[];
  #current:HealthScoreV15={score:100,grade:'A',healthy:true,blocking:[],warnings:[],metrics:{}};
  constructor(capacity=120){this.#capacity=Math.max(30,Math.min(1200,Math.trunc(capacity)));}

  observe(value:HealthObservationV15):HealthScoreV15{
    const observation=Object.freeze({...value,errors:Math.max(0,Math.trunc(value.errors)),warnings:Math.max(0,Math.trunc(value.warnings)),failedTasks:Math.max(0,Math.trunc(value.failedTasks)),renderFailures:Math.max(0,Math.trunc(value.renderFailures)),assetFailures:Math.max(0,Math.trunc(value.assetFailures))});
    this.#window.push(observation);
    while(this.#window.length>this.#capacity)this.#window.shift();
    this.#current=this.#score(observation);
    return this.#current;
  }

  current():HealthScoreV15{return this.#current;}
  observations():readonly HealthObservationV15[]{return Object.freeze([...this.#window]);}
  healthy():boolean{return this.#current.healthy;}
  score():number{return this.#current.score;}

  window():HealthWindowV15{
    const scores=this.#window.map((observation)=>this.#score(observation).score);
    return Object.freeze({observations:this.observations(),current:this.#current,averageScore:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:100,minimumScore:scores.length?Math.min(...scores):100,degradedFrames:scores.filter((score)=>score<75).length});
  }

  reset():void{this.#window.length=0;this.#current={score:100,grade:'A',healthy:true,blocking:[],warnings:[],metrics:{}};}

  #score(value:HealthObservationV15):HealthScoreV15{
    const deterministicPenalty=value.deterministic?0:40;
    const errorPenalty=Math.min(20,value.errors*4);
    const warningPenalty=Math.min(10,value.warnings*1.5);
    const framePenalty=Math.min(18,Math.max(0,value.p95FrameMs-16.67)*.45);
    const memoryPenalty=Math.min(12,clamp(value.memoryPressure,0,1)*12);
    const networkPenalty=Math.min(12,clamp(value.packetLoss,0,1)*45+Math.max(0,value.networkRttMs-100)*.02);
    const migrationPenalty=Math.min(10,(1-clamp(value.migrationCoverage,0,1))*10);
    const taskPenalty=Math.min(12,value.failedTasks*3);
    const renderPenalty=Math.min(10,value.renderFailures*2);
    const assetPenalty=Math.min(8,value.assetFailures*1.5);
    const queuePenalty=Math.min(8,(value.queueDepth/Math.max(1,value.queueCapacity))*8);
    const blocking:string[]=[];const warnings:string[]=[];
    if(!value.deterministic)blocking.push('NON_DETERMINISTIC_RUNTIME');
    if(value.failedTasks>0)blocking.push('TASK_FAILURES');
    if(value.renderFailures>2)blocking.push('RENDER_FAILURES');
    if(value.assetFailures>8)blocking.push('ASSET_FAILURES');
    if(value.errors>4)blocking.push('ERROR_RATE');
    if(value.p95FrameMs>50)blocking.push('FRAME_TIME');
    if(value.memoryPressure>.95)blocking.push('MEMORY_PRESSURE');
    if(value.packetLoss>.25)blocking.push('NETWORK_LOSS');
    if(value.migrationCoverage<.9)warnings.push('MIGRATION_COVERAGE');
    if(value.queueDepth/value.queueCapacity>.75)warnings.push('WORK_QUEUE_PRESSURE');
    if(value.p95FrameMs>33.33)warnings.push('FRAME_PRESSURE');
    const score=clamp(100-deterministicPenalty-errorPenalty-warningPenalty-framePenalty-memoryPenalty-networkPenalty-migrationPenalty-taskPenalty-renderPenalty-assetPenalty-queuePenalty,0,100);
    const grade=score>=90?'A':score>=80?'B':score>=70?'C':score>=55?'D':'F';
    return Object.freeze({score:Number(score.toFixed(2)),grade,healthy:blocking.length===0&&score>=70,blocking:Object.freeze([...new Set(blocking)]),warnings:Object.freeze([...new Set(warnings)]),metrics:Object.freeze({frameMs:value.frameMs,p95FrameMs:value.p95FrameMs,memoryPressure:value.memoryPressure,networkRttMs:value.networkRttMs,packetLoss:value.packetLoss,migrationCoverage:value.migrationCoverage,queueUtilization:value.queueDepth/Math.max(1,value.queueCapacity)})});
  }
}

export const healthGradeLabelV15=(grade:HealthScoreV15['grade']):string=>({A:'stable',B:'healthy',C:'watch',D:'degraded',F:'critical'}[grade]);
