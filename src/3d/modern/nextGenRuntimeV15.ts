import { NextGenRuntimeV14 } from './nextGenRuntimeV14';
import type { BudgetObservationV14 } from './budgetDirectorV14';
import type { InputIntentV14 } from './inputIntentV14';
import { ExecutionGraphV15 } from './executionGraphV15';
import { DeterministicSchedulerV15 } from './deterministicSchedulerV15';
import { RuntimeGuardV15 } from './runtimeGuardV15';
import { TelemetryTraceV15 } from './telemetryTraceV15';
import { WorldStateJournalV15, type JsonValue } from './worldStateJournalV15';
import { NetworkReconciliationV15, type InputFrameV15, type StateCodecV15 } from './networkReconciliationV15';

export interface NextGenRuntimeOptionsV15{readonly initialQuality?:'minimal'|'balanced'|'high'|'ultra';readonly fixedStepMs?:number;readonly frameBudgetMs?:number;readonly maxExecutionTasks?:number;readonly worldState?:JsonValue;readonly now?:()=>number;}
export interface NextGenFrameV15{readonly frame:number;readonly tick:number;readonly deltaMs:number;readonly input:InputIntentV14;readonly budget:ReturnType<NextGenRuntimeV14['control']['budget']['decision']>;readonly execution:Awaited<ReturnType<ExecutionGraphV15<unknown>['runFrame']>>['report'];readonly guard:ReturnType<RuntimeGuardV15['evaluate']>;readonly trace:string;readonly worldDigest:string;readonly reconciliation:ReturnType<NetworkReconciliationV15<unknown>['metrics']>;readonly healthy:boolean;readonly alerts:readonly string[];}

const identityCodec:StateCodecV15<Record<string,unknown>>={
  digest:(state)=>{const keys=Object.keys(state).sort();return JSON.stringify(keys.map((key)=>[key,state[key]]));},
  clone:(state)=>JSON.parse(JSON.stringify(state)) as Record<string,unknown>,
  distance:(a,b)=>{const keys=new Set([...Object.keys(a),...Object.keys(b)]);let d=0;for(const key of keys)if(JSON.stringify(a[key])!==JSON.stringify(b[key]))d+=1;return d/Math.max(1,keys.size);},
  apply:(state,input)=>{const payload=input.payload as Record<string,unknown>;return Object.freeze({...state,...payload});},
};

const defaultWorld=():JsonValue=>({player:{x:0,y:0,z:0,health:100},world:{tick:0,weather:'clear'},flags:{}});

export class NextGenRuntimeV15{
  readonly v14:NextGenRuntimeV14;
  readonly execution:ExecutionGraphV15<unknown>;
  readonly scheduler:DeterministicSchedulerV15;
  readonly guard:RuntimeGuardV15;
  readonly trace:TelemetryTraceV15;
  readonly journal:WorldStateJournalV15;
  readonly reconciliation:NetworkReconciliationV15<Record<string,unknown>>;
  #lastFrame:NextGenFrameV15|undefined;

  constructor(options:NextGenRuntimeOptionsV15={}){
    this.v14=new NextGenRuntimeV14({initialQuality:options.initialQuality,fixedStepMs:options.fixedStepMs,clock:options.now});
    this.execution=new ExecutionGraphV15();
    this.scheduler=new DeterministicSchedulerV15({fixedStepMs:options.fixedStepMs, maxCatchUpSteps:8});
    this.guard=new RuntimeGuardV15({now:options.now});
    this.guard.installDefaultRules();
    this.trace=new TelemetryTraceV15({clock:options.now});
    this.journal=new WorldStateJournalV15(options.worldState??defaultWorld());
    this.reconciliation=new NetworkReconciliationV15({},identityCodec,{now:options.now,correctionThreshold:.35});
    this.#registerCoreTasks();
  }

  get frame():NextGenFrameV15|undefined{return this.#lastFrame;}
  async tick(observation:BudgetObservationV14,input:InputIntentV14):Promise<NextGenFrameV15>{
    const root=this.trace.start('runtime.frame','internal',{frame:this.v14.control.frame,tick:this.v14.control.frame});
    const v14=await this.v14.tick(observation,input);
    const budgetMs=Math.max(1,observation.frameMs<17?Math.max(8,v14.runtime.budget.maxSimulationMs+v14.runtime.budget.maxStreamingMs):v14.runtime.budget.maxSimulationMs);
    const scheduled=this.scheduler.advance(observation.frameMs);
    const execution=await this.execution.runFrame({input,v14}, {frame:v14.frame,tick:v14.runtime.frame,deltaMs:v14.runtime.deltaMs,budgetMs});
    this.journal.transaction((state)=>[{path:['world','tick'],after:v14.runtime.frame,before:(state as any)?.world?.tick}],{tick:v14.runtime.frame,source:'runtime'});
    const guard=this.guard.evaluate({frameMs:observation.frameMs,simulationTick:v14.runtime.frame,memoryMb:observation.memoryPressure*1400,networkRttMs:observation.gpuMs,packetLoss:observation.memoryPressure/20,entities:observation.visibleObjects,commands:scheduled.executedCommands.length,digest:this.journal.digest()});
    const alerts:string[]=[...v14.alerts];if(!guard.healthy)alerts.push('GUARD_DEGRADED');if(execution.report.overBudget)alerts.push('EXECUTION_BUDGET_EXCEEDED');if(scheduled.catchUpClamped)alerts.push('SCHEDULER_CATCHUP_CLAMPED');
    const trace=root?.end(guard.healthy?'ok':'error');
    const reconciliation=this.reconciliation.metrics();
    const frame=Object.freeze({frame:v14.frame,tick:v14.runtime.frame,deltaMs:v14.runtime.deltaMs,input,budget:v14.runtime.budget,execution:execution.report,guard,trace:trace?.id??'none',worldDigest:this.journal.digest(),reconciliation,healthy:guard.healthy&&v14.healthy&&!execution.report.failed.length,alerts:Object.freeze([...new Set(alerts)])});
    this.#lastFrame=frame;
    return frame;
  }

  enqueueTask<T>(task:{id:string;phase:Parameters<ExecutionGraphV15<T>['add']>[0]['phase'];priority:Parameters<ExecutionGraphV15<T>['add']>[0]['priority'];budgetMs:number;dependsOn?:readonly string[];critical?:boolean;run:(input:T,context:Parameters<ExecutionGraphV15<T>['add']>[0]['run'] extends (i:infer I,c:infer C)=>unknown?C:never)=>T|Promise<T>}):()=>void{return this.execution.add(task as never);}
  queueInput(payload:Record<string,unknown>,tick:number,sequence:number):InputFrameV15<Record<string,unknown>>{return this.reconciliation.recordInput(payload,tick,sequence);}
  predict(input:InputFrameV15<Record<string,unknown>>){return this.reconciliation.predict(input);}
  authoritative(state:Record<string,unknown>,tick:number,sequence:number){return this.reconciliation.receiveAuthoritative(state,tick,sequence);}
  snapshot(){return Object.freeze({frame:this.v14.control.frame,quality:this.v14.control.budget.decision(),scheduler:this.scheduler.snapshot(),guard:this.guard.history(),journal:{revision:this.journal.revision,tick:this.journal.tick,digest:this.journal.digest()},trace:this.trace.snapshot(),reconciliation:this.reconciliation.metrics()});}
  reset(worldState:JsonValue=defaultWorld()):void{this.#lastFrame=undefined;this.scheduler.reset();this.guard.reset();this.trace.clear();this.journal.reset(worldState);this.reconciliation.reset({});}

  #registerCoreTasks():void{
    this.execution.add({id:'input.normalize',phase:'input',priority:5,budgetMs:1,critical:true,run:(value)=>value});
    this.execution.add({id:'simulation.control',phase:'simulation',priority:5,budgetMs:5,dependsOn:['input.normalize'],critical:true,run:(value)=>value});
    this.execution.add({id:'world.commit',phase:'world',priority:4,budgetMs:2,dependsOn:['simulation.control'],run:(value)=>value});
    this.execution.add({id:'streaming.adapt',phase:'streaming',priority:3,budgetMs:2,dependsOn:['world.commit'],run:(value)=>value});
    this.execution.add({id:'network.reconcile',phase:'network',priority:4,budgetMs:2,dependsOn:['simulation.control'],run:(value)=>value});
    this.execution.add({id:'render.prepare',phase:'render',priority:3,budgetMs:4,dependsOn:['world.commit','network.reconcile'],run:(value)=>value});
    this.execution.add({id:'telemetry.flush',phase:'telemetry',priority:1,budgetMs:1,dependsOn:['render.prepare'],run:(value)=>value});
  }
}

export const createNextGenRuntimeV15=(options?:NextGenRuntimeOptionsV15):NextGenRuntimeV15=>new NextGenRuntimeV15(options);
