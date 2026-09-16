export type TickId=number;
export interface TickStep{readonly tick:TickId;readonly dt:number;readonly simulatedSeconds:number;readonly alpha:number;}
export interface SimulationMetrics{readonly ticks:number;readonly dropped:number;readonly simulatedSeconds:number;readonly lastTick:TickId;readonly accumulator:number;}
export interface SimulationTask{readonly id:string;readonly phase:'input'|'ai'|'physics'|'animation'|'world'|'late';readonly priority:number;readonly run:(step:TickStep)=>void|Promise<void>;}

/** Fixed-rate deterministic simulation runner with bounded work and explicit phases. */
export class DeterministicSimulation {
 private readonly dt:number;private readonly maxSteps:number;private accumulator=0;private tickId=0;private simulated=0;private dropped=0;private lastTimestamp:number|null=null;private readonly tasks:SimulationTask[]=[];private disposed=false;
 public constructor(dt=1/60,maxSteps=5){this.dt=Math.max(1/240,dt);this.maxSteps=Math.max(1,Math.floor(maxSteps));}
 public register(task:SimulationTask):void{this.ensure();if(this.tasks.some(t=>t.id===task.id))throw new Error(`SIM_TASK_REDEFINED:${task.id}`);this.tasks.push({...task});this.tasks.sort((a,b)=>a.priority-b.priority||a.phase.localeCompare(b.phase)||a.id.localeCompare(b.id));}
 public unregister(id:string):boolean{this.ensure();const i=this.tasks.findIndex(t=>t.id===id);if(i<0)return false;this.tasks.splice(i,1);return true;}
 public advance(timestampMs:number):Promise<readonly TickStep[]>{this.ensure();if(!Number.isFinite(timestampMs))throw new RangeError('SIM_TIMESTAMP_INVALID');if(this.lastTimestamp===null){this.lastTimestamp=timestampMs;return Promise.resolve([]);}const elapsed=Math.min(.25,Math.max(0,(timestampMs-this.lastTimestamp)/1000));this.lastTimestamp=timestampMs;this.accumulator+=elapsed;const steps:TickStep[]=[];while(this.accumulator>=this.dt&&steps.length<this.maxSteps){this.tickId+=1;const step={tick:this.tickId,dt:this.dt,simulatedSeconds:this.simulated+this.dt,alpha:0};this.simulated+=this.dt;this.accumulator-=this.dt;steps.push(step);}if(this.accumulator>=this.dt){const lost=this.accumulator-(this.accumulator%this.dt);this.accumulator-=lost;this.dropped+=Math.floor(lost/this.dt);}return this.runSteps(steps);}
 private async runSteps(steps:TickStep[]):Promise<readonly TickStep[]>{for(const step of steps)for(const task of this.tasks)await task.run(step);return steps;}
 public metrics():SimulationMetrics{return{ticks:this.tickId,dropped:this.dropped,simulatedSeconds:this.simulated,lastTick:this.tickId,accumulator:this.accumulator};}
 public interpolationAlpha():number{return this.accumulator/this.dt;}
 public tickIdValue():TickId{return this.tickId;}
 public reset():void{this.accumulator=0;this.tickId=0;this.simulated=0;this.dropped=0;this.lastTimestamp=null;}
 public clearTasks():void{this.tasks.length=0;}
 public taskIds():readonly string[]{return this.tasks.map(t=>t.id);}
 private ensure():void{if(this.disposed)throw new Error('SIMULATION_DISPOSED');}
 public dispose():void{if(this.disposed)return;this.tasks.length=0;this.disposed=true;}
}

export interface InputTick { readonly tick:TickId;readonly actions:Readonly<Record<string,boolean>>;readonly axes:Readonly<Record<string,number>>; }
export class InputTimeline {
 private readonly frames=new Map<TickId,InputTick>();private readonly capacity:number;
 constructor(capacity=600){this.capacity=Math.max(60,Math.floor(capacity));}
 push(frame:InputTick):void{this.frames.set(frame.tick,{tick:frame.tick,actions:{...frame.actions},axes:{...frame.axes}});while(this.frames.size>this.capacity){const oldest=[...this.frames.keys()].sort((a,b)=>a-b)[0];if(oldest===undefined)break;this.frames.delete(oldest);}}
 get(tick:TickId):InputTick|undefined{return this.frames.get(tick);}
 range(start:TickId,end:TickId):readonly InputTick[]{return[...this.frames.values()].filter(f=>f.tick>=start&&f.tick<=end).sort((a,b)=>a.tick-b.tick);}
 hash(start=0,end=Number.MAX_SAFE_INTEGER):number{let hash=2166136261;for(const frame of this.range(start,end)){const text=JSON.stringify(frame);for(let i=0;i<text.length;i+=1)hash=Math.imul(hash^text.charCodeAt(i),16777619);}return hash>>>0;}
 clear():void{this.frames.clear();}
}
