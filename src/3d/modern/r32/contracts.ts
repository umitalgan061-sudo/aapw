/**
 * R32 production runtime contracts.
 * New production behavior is strictly typed; legacy JavaScript is consumed only through explicit boundaries.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type EntityId = Brand<string,'EntityId'>;
export type CommandId = Brand<string,'CommandId'>;
export type TaskId = Brand<string,'TaskId'>;
export type AssetId = Brand<string,'AssetId'>;
export type SessionId = Brand<string,'SessionId'>;
export type Sequence = Brand<number,'Sequence'>;
export type Tick = Brand<number,'Tick'>;
export type FrameIndex = Brand<number,'FrameIndex'>;

export type RuntimeMode='booting'|'running'|'paused'|'recovering'|'stopping'|'stopped';
export type LifecyclePhase='construct'|'hydrate'|'prepare'|'activate'|'running'|'pause'|'recover'|'shutdown';
export type TaskLane='simulation'|'world'|'render'|'network'|'assets'|'telemetry';
export type TaskPriority='critical'|'high'|'normal'|'low'|'background';
export type AssetKind='json'|'text'|'binary'|'image'|'audio'|'model'|'shader';
export type AssetState='idle'|'queued'|'loading'|'ready'|'stale'|'failed'|'evicted';
export type NetworkChannel='reliable'|'unreliable'|'snapshot'|'command'|'telemetry';
export type HealthGrade='excellent'|'healthy'|'degraded'|'critical';

export interface Vec2 { readonly x:number; readonly y:number; }
export interface Vec3 { readonly x:number; readonly y:number; readonly z:number; }
export interface Quaternion { readonly x:number; readonly y:number; readonly z:number; readonly w:number; }
export interface Transform { readonly position:Vec3; readonly rotation:Quaternion; readonly scale:Vec3; }
export interface RuntimeVersion { readonly major:number; readonly minor:number; readonly patch:number; readonly label?:string; }

export interface RuntimeClockState {
  readonly tick:Tick; readonly frame:FrameIndex; readonly stepSeconds:number;
  readonly accumulatorSeconds:number; readonly simulatedSeconds:number;
}
export interface RuntimeBudget {
  readonly lane:TaskLane; readonly softMilliseconds:number; readonly hardMilliseconds:number;
  readonly maxTasks:number; readonly maxWorkUnits:number;
}
export interface RuntimeBudgetMap {
  readonly simulation:RuntimeBudget; readonly world:RuntimeBudget; readonly render:RuntimeBudget;
  readonly network:RuntimeBudget; readonly assets:RuntimeBudget; readonly telemetry:RuntimeBudget;
}
export interface TaskCost { readonly milliseconds:number; readonly workUnits:number; }
export interface TaskExecutionContext {
  readonly tick:Tick; readonly frame:FrameIndex; readonly deltaSeconds:number;
  readonly mode:RuntimeMode; readonly lane:TaskLane; readonly budget:RuntimeBudget;
}
export interface TaskResult {
  readonly completed:boolean; readonly cost:TaskCost; readonly yielded:boolean; readonly nextDueTick?:Tick;
}
export type RuntimeTask=(context:TaskExecutionContext)=>TaskResult;
export interface TaskSpec {
  readonly id:TaskId; readonly lane:TaskLane; readonly priority:TaskPriority;
  readonly intervalTicks:number; readonly maxRunsPerFrame:number; readonly enabled?:boolean;
  readonly workEstimate:number; readonly run:RuntimeTask;
}

export interface CommandEnvelope<TPayload> {
  readonly id:CommandId; readonly type:string; readonly issuedAtTick:Tick;
  readonly source:string; readonly payload:TPayload; readonly correlationId?:string; readonly expectedVersion?:number;
}
export interface CommandContext { readonly tick:Tick; readonly source:string; readonly signal:AbortSignal; }
export interface CommandHandler<TPayload,TResult> {
  readonly handle:(command:CommandEnvelope<TPayload>,context:CommandContext)=>TResult|Promise<TResult>;
}
export interface CommandMiddleware {
  readonly name:string;
  readonly before?:(command:CommandEnvelope<unknown>,context:CommandContext)=>void|Promise<void>;
  readonly after?:(command:CommandEnvelope<unknown>,result:unknown,context:CommandContext)=>void|Promise<void>;
  readonly onError?:(command:CommandEnvelope<unknown>,error:unknown,context:CommandContext)=>void|Promise<void>;
}
export interface CommandExecutionOptions { readonly timeoutMilliseconds:number; readonly dedupe:boolean; readonly retries:number; }
export interface CommandExecutionReceipt<TResult> {
  readonly commandId:CommandId; readonly accepted:boolean; readonly duplicate:boolean;
  readonly durationMilliseconds:number; readonly result?:TResult;
}

export interface StatePatch<TState> {
  readonly version:number; readonly previous:TState; readonly next:TState;
  readonly changedPaths:readonly string[]; readonly source:string; readonly tick:Tick;
}
export interface StateSnapshot<TState> { readonly version:number; readonly state:TState; readonly tick:Tick; readonly hash:string; }
export interface StateSelector<TState,TValue> {
  readonly select:(state:TState)=>TValue; readonly equals?:(previous:TValue,next:TValue)=>boolean;
}
export interface StateSubscription { readonly dispose:()=>void; }
export interface StateStoreOptions<TState> {
  readonly initialState:TState; readonly historyLimit:number; readonly freezeState:boolean; readonly hash:(state:TState)=>string;
}
export interface StateTransaction<TState> {
  readonly id:string; readonly baseVersion:number; readonly draft:TState;
  readonly commit:(source?:string)=>StatePatch<TState>|null; readonly rollback:()=>void;
}

export interface AssetDescriptor {
  readonly id:AssetId; readonly url:string; readonly kind:AssetKind; readonly expectedBytes?:number;
  readonly maxBytes:number; readonly sha256?:string; readonly version:number;
  readonly dependencies?:readonly AssetId[]; readonly priority:TaskPriority;
}
export interface AssetRecord<T> {
  readonly descriptor:AssetDescriptor; readonly state:AssetState; readonly value?:T;
  readonly bytes:number; readonly accessCount:number; readonly lastAccessTick:Tick; readonly errorMessage?:string;
}
export interface AssetLoader<T> {
  readonly load:(descriptor:AssetDescriptor,signal:AbortSignal)=>Promise<{readonly value:T;readonly bytes:number}>;
  readonly dispose?:(value:T)=>void;
}
export interface AssetRuntimeOptions { readonly byteBudget:number; readonly recordLimit:number; readonly staleAfterTicks:number; }
export interface AssetRequestReceipt { readonly assetId:AssetId; readonly state:AssetState; readonly deduplicated:boolean; readonly bytes:number; }

export interface NetworkPacket<TPayload> {
  readonly sessionId:SessionId; readonly sequence:Sequence; readonly channel:NetworkChannel;
  readonly tick:Tick; readonly payload:TPayload; readonly acknowledgedSequence?:Sequence;
}
export interface NetworkAckWindow { readonly highestReceived:Sequence; readonly recent:readonly Sequence[]; readonly missing:readonly Sequence[]; }
export interface NetworkSessionOptions {
  readonly maxInFlight:number; readonly maxPacketBytes:number; readonly resendAfterTicks:number;
  readonly inputBufferLimit:number; readonly commandRatePerTick:number;
}
export interface NetworkTransport<TPayload> { readonly send:(packet:NetworkPacket<TPayload>)=>void; readonly close?:()=>void; }
export interface NetworkReceipt {
  readonly accepted:boolean; readonly dropped:boolean; readonly reason?:string; readonly sequence?:Sequence;
}
export interface PredictionFrame<TInput,TState> {
  readonly sequence:Sequence; readonly tick:Tick; readonly input:TInput;
  readonly stateBefore:TState; readonly stateAfter:TState; readonly stateHash:string;
}
export interface ReconciliationResult<TState> {
  readonly reconciled:boolean; readonly rollbackFrames:number; readonly authoritative:TState; readonly predicted:TState;
}

export interface TelemetrySample {
  readonly tick:Tick; readonly frame:FrameIndex; readonly lane:TaskLane;
  readonly durationMilliseconds:number; readonly workUnits:number;
  readonly metadata?:Readonly<Record<string,string|number|boolean>>;
}
export interface MetricSummary { readonly count:number; readonly sum:number; readonly min:number; readonly max:number; readonly average:number; readonly p95:number; }
export interface HealthSnapshot {
  readonly score:number; readonly grade:HealthGrade; readonly frameMilliseconds:MetricSummary;
  readonly taskMilliseconds:MetricSummary; readonly droppedTasks:number; readonly failedAssets:number;
  readonly networkDrops:number; readonly memoryBytes:number; readonly recommendations:readonly string[];
}
export interface BrowserSignalSnapshot {
  readonly visible:boolean; readonly online:boolean; readonly width:number; readonly height:number;
  readonly devicePixelRatio:number; readonly pointerLocked:boolean; readonly coarsePointer:boolean;
}
export interface RuntimeEventMap {
  lifecycle:{phase:LifecyclePhase;mode:RuntimeMode};
  task:{taskId:TaskId;lane:TaskLane;result:TaskResult};
  command:{commandType:string;receipt:CommandExecutionReceipt<unknown>};
  asset:{descriptor:AssetDescriptor;state:AssetState};
  network:{channel:NetworkChannel;receipt:NetworkReceipt};
  browser:BrowserSignalSnapshot;
  health:HealthSnapshot;
  error:RuntimeError;
}
export interface RuntimeEvent<K extends keyof RuntimeEventMap> { readonly type:K; readonly tick:Tick; readonly payload:RuntimeEventMap[K]; }

export interface RuntimeErrorOptions {
  readonly code:string; readonly message:string; readonly cause?:unknown; readonly recoverable?:boolean;
  readonly metadata?:Readonly<Record<string,string|number|boolean>>;
}
export class RuntimeError extends Error {
  readonly code:string; readonly recoverable:boolean;
  readonly metadata:Readonly<Record<string,string|number|boolean>>;
  constructor(options:RuntimeErrorOptions) {
    super(options.message,{cause:options.cause}); this.name='RuntimeError';
    this.code=options.code; this.recoverable=options.recoverable??true; this.metadata=options.metadata??{};
  }
}
export interface RuntimeDiagnostics {
  readonly mode:RuntimeMode; readonly clock:RuntimeClockState; readonly health:HealthSnapshot;
  readonly pendingTasks:number; readonly queuedCommands:number; readonly loadedAssets:number;
  readonly bytesInAssets:number; readonly networkInFlight:number;
}
export interface RuntimeConfigR32 {
  readonly version:RuntimeVersion; readonly fixedStepSeconds:number; readonly maxCatchUpSteps:number;
  readonly command:CommandExecutionOptions; readonly stateHistoryLimit:number;
  readonly budgets:RuntimeBudgetMap; readonly assets:AssetRuntimeOptions; readonly network:NetworkSessionOptions;
}

export const R32_DEFAULT_CONFIG:RuntimeConfigR32={
  version:{major:32,minor:0,patch:0,label:'production'},fixedStepSeconds:1/60,maxCatchUpSteps:4,
  command:{timeoutMilliseconds:1500,dedupe:true,retries:1},stateHistoryLimit:120,
  budgets:{
    simulation:{lane:'simulation',softMilliseconds:4,hardMilliseconds:8,maxTasks:32,maxWorkUnits:1000},
    world:{lane:'world',softMilliseconds:3,hardMilliseconds:6,maxTasks:24,maxWorkUnits:750},
    render:{lane:'render',softMilliseconds:4,hardMilliseconds:7,maxTasks:24,maxWorkUnits:900},
    network:{lane:'network',softMilliseconds:2,hardMilliseconds:5,maxTasks:24,maxWorkUnits:700},
    assets:{lane:'assets',softMilliseconds:3,hardMilliseconds:8,maxTasks:20,maxWorkUnits:600},
    telemetry:{lane:'telemetry',softMilliseconds:1,hardMilliseconds:3,maxTasks:12,maxWorkUnits:300},
  },
  assets:{byteBudget:256*1024*1024,recordLimit:1024,staleAfterTicks:60*30},
  network:{maxInFlight:128,maxPacketBytes:64*1024,resendAfterTicks:30,inputBufferLimit:240,commandRatePerTick:8},
};
export const priorityRank:Record<TaskPriority,number>={critical:0,high:1,normal:2,low:3,background:4};
export const asEntityId=(value:string)=>value as EntityId;
export const asCommandId=(value:string)=>value as CommandId;
export const asTaskId=(value:string)=>value as TaskId;
export const asAssetId=(value:string)=>value as AssetId;
export const asSessionId=(value:string)=>value as SessionId;
export const asSequence=(value:number)=>value as Sequence;
export const asTick=(value:number)=>value as Tick;
export const asFrameIndex=(value:number)=>value as FrameIndex;

export function clampFinite(value:number,minimum:number,maximum:number):number {
  if(!Number.isFinite(value)) return minimum; return Math.min(maximum,Math.max(minimum,value));
}
export function assertFinite(value:number,label:string):number {
  if(!Number.isFinite(value)) throw new RuntimeError({code:'R32_NON_FINITE',message:label+' must be finite',recoverable:false});
  return value;
}
export function stableStringify(value:unknown):string {
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  const record=value as Record<string,unknown>;
  return '{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+':'+stableStringify(record[key])).join(',')+'}';
}
export function stableHash(value:unknown):string {
  const input=stableStringify(value); let hash=2166136261;
  for(let i=0;i<input.length;i+=1){hash^=input.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).padStart(8,'0');
}
