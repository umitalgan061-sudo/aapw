import {RuntimeError,asFrameIndex,asTaskId,asTick,clampFinite,priorityRank} from './contracts.ts';
import type {FrameIndex,RuntimeBudget,RuntimeMode,TaskExecutionContext,TaskId,TaskLane,TaskPriority,TaskResult,TaskSpec,Tick} from './contracts.ts';

interface ScheduledTask{readonly spec:TaskSpec;nextDueTick:Tick;runs:number;dropped:number;enabled:boolean;}
export interface LaneExecutionReport{readonly lane:TaskLane;readonly attempted:number;readonly completed:number;readonly yielded:number;readonly dropped:number;readonly milliseconds:number;readonly workUnits:number;readonly overSoftBudget:boolean;readonly overHardBudget:boolean;}
export interface SchedulerFrameReport{readonly tick:Tick;readonly frame:FrameIndex;readonly lanes:readonly LaneExecutionReport[];readonly totalMilliseconds:number;readonly totalWorkUnits:number;readonly droppedTasks:number;}
export interface SchedulerOptions{readonly clock:()=>number;readonly maxGlobalTasks:number;}
const DEFAULT_OPTIONS:SchedulerOptions={clock:()=>performance.now(),maxGlobalTasks:192};
const LANES:readonly TaskLane[]=['simulation','world','render','network','assets','telemetry'];
export class DeterministicScheduler{
  #tasks=new Map<TaskId,ScheduledTask>();#options:SchedulerOptions;#sequence=0;#tick:Tick=asTick(0);#frame:FrameIndex=asFrameIndex(0);#lastReport:SchedulerFrameReport|null=null;
  constructor(readonly budgets:Readonly<Record<TaskLane,RuntimeBudget>>,options:Partial<SchedulerOptions>={}){this.#options={...DEFAULT_OPTIONS,...options};}
  get tick():Tick{return this.#tick;}get frame():FrameIndex{return this.#frame;}
  schedule(spec:Omit<TaskSpec,'id'>&{readonly id?:TaskId}):TaskId{
    if(this.#tasks.size>=this.#options.maxGlobalTasks)throw new RuntimeError({code:'R32_SCHEDULER_LIMIT',message:'Scheduler task limit exceeded'});
    const id=spec.id??asTaskId('r32-task-'+String(++this.#sequence));if(this.#tasks.has(id))throw new RuntimeError({code:'R32_SCHEDULER_DUPLICATE',message:'Task already exists: '+String(id)});
    this.#tasks.set(id,{spec:{...spec,id,intervalTicks:Math.max(1,Math.floor(spec.intervalTicks))},nextDueTick:this.#tick,runs:0,dropped:0,enabled:spec.enabled??true});return id;
  }
  cancel(id:TaskId):boolean{return this.#tasks.delete(id);}
  setEnabled(id:TaskId,enabled:boolean):void{const task=this.#tasks.get(id);if(!task)throw new RuntimeError({code:'R32_SCHEDULER_UNKNOWN_TASK',message:'Unknown task: '+String(id)});task.enabled=enabled;}
  getTaskStats(){return[...this.#tasks.values()].sort((a,b)=>this.#compare(a,b)).map(task=>({id:task.spec.id,lane:task.spec.lane,priority:task.spec.priority,runs:task.runs,dropped:task.dropped,nextDueTick:task.nextDueTick,enabled:task.enabled}));}
  runFrame(deltaSeconds:number,mode:RuntimeMode):SchedulerFrameReport{
    const delta=clampFinite(deltaSeconds,0,0.25);this.#tick=asTick(this.#tick+1);this.#frame=asFrameIndex(this.#frame+1);
    const lanes:LaneExecutionReport[]=[];let totalMilliseconds=0,totalWorkUnits=0,droppedTasks=0;
    for(const lane of LANES){const report=this.#runLane(lane,delta,mode);lanes.push(report);totalMilliseconds+=report.milliseconds;totalWorkUnits+=report.workUnits;droppedTasks+=report.dropped;}
    this.#lastReport={tick:this.#tick,frame:this.#frame,lanes,totalMilliseconds,totalWorkUnits,droppedTasks};return this.#lastReport;
  }
  lastReport():SchedulerFrameReport|null{return this.#lastReport;}
  #runLane(lane:TaskLane,deltaSeconds:number,mode:RuntimeMode):LaneExecutionReport{
    const budget=this.budgets[lane],candidates=[...this.#tasks.values()].filter(t=>t.enabled&&t.spec.lane===lane&&t.nextDueTick<=this.#tick).sort((a,b)=>this.#compare(a,b));
    let attempted=0,completed=0,yielded=0,dropped=0,milliseconds=0,workUnits=0;
    for(const task of candidates){
      if(attempted>=budget.maxTasks||workUnits+task.spec.workEstimate>budget.maxWorkUnits){task.dropped+=1;dropped+=1;continue;}
      const context:TaskExecutionContext={tick:this.#tick,frame:this.#frame,deltaSeconds,mode,lane,budget};const start=this.#options.clock();let result:TaskResult;
      try{result=task.spec.run(context);}catch(error){task.dropped+=1;dropped+=1;throw new RuntimeError({code:'R32_TASK_FAILURE',message:'Scheduled task failed: '+String(task.spec.id),cause:error,metadata:{lane,taskId:String(task.spec.id)}});}
      const measured=Math.max(0,this.#options.clock()-start);const cost=Number.isFinite(result.cost.milliseconds)?result.cost.milliseconds:measured;
      milliseconds+=Math.max(measured,cost);workUnits+=Math.max(0,result.cost.workUnits);attempted+=1;task.runs+=1;if(result.completed)completed+=1;if(result.yielded)yielded+=1;
      task.nextDueTick=result.nextDueTick??asTick(this.#tick+Math.max(1,task.spec.intervalTicks));
      if(milliseconds>=budget.hardMilliseconds){for(const pending of candidates.slice(attempted)){pending.dropped+=1;dropped+=1;}break;}
    }
    return{lane,attempted,completed,yielded,dropped,milliseconds,workUnits,overSoftBudget:milliseconds>budget.softMilliseconds,overHardBudget:milliseconds>budget.hardMilliseconds};
  }
  #compare(a:ScheduledTask,b:ScheduledTask):number{
    const due=a.nextDueTick-b.nextDueTick;if(due)return due;const priority=priorityRank[a.spec.priority]-priorityRank[b.spec.priority];if(priority)return priority;const work=a.spec.workEstimate-b.spec.workEstimate;if(work)return work;return String(a.spec.id).localeCompare(String(b.spec.id));
  }
}
