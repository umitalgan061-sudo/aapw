export type RuntimePhase='cold'|'booting'|'ready'|'running'|'paused'|'recovering'|'stopping'|'stopped'|'failed';
export type CommandPriority='critical'|'high'|'normal'|'low'|'background';
export type WorkLane='input'|'simulation'|'world'|'asset'|'render'|'network'|'persistence'|'telemetry';
export type QualityTier='minimal'|'balanced'|'high'|'cinematic';
export type MutationSource='engine'|'ui'|'network'|'save'|'replay'|'system';
export type CapabilityKind='webgpu'|'webgl2'|'worker'|'offscreen-canvas'|'indexed-db'|'broadcast-channel'|'shared-array-buffer'|'service-worker'|'web-transport';
export interface Tick{readonly index:number;readonly simulationMs:number;readonly wallMs:number;readonly deltaMs:number;readonly alpha:number;}
export interface CommandEnvelope<T=unknown>{readonly id:string;readonly type:string;readonly priority:CommandPriority;readonly createdTick:number;readonly deadlineTick:number;readonly source:MutationSource;readonly payload:T;}
export interface CommandResult<T=unknown>{readonly accepted:boolean;readonly duplicate:boolean;readonly value?:T;readonly errorCode?:string;readonly errorMessage?:string;readonly completedTick:number;}
export interface RuntimeEvent<T=unknown>{readonly sequence:number;readonly tick:number;readonly type:string;readonly source:string;readonly payload:T;readonly coalescible:boolean;}
export interface MetricPoint{readonly name:string;readonly value:number;readonly timestampMs:number;readonly tags:Readonly<Record<string,string>>;}
export interface HealthSignal{readonly subsystem:string;readonly status:'healthy'|'degraded'|'critical';readonly score:number;readonly detail:string;}
export interface RuntimeHealth{readonly phase:RuntimePhase;readonly score:number;readonly signals:readonly HealthSignal[];readonly activeWork:number;readonly droppedWork:number;readonly memoryBytes:number;readonly tick:number;readonly digest:string;}
export interface WorkItem<T=unknown>{readonly id:string;readonly lane:WorkLane;readonly priority:CommandPriority;readonly estimatedCostMs:number;readonly createdTick:number;readonly deadlineTick:number;readonly payload:T;readonly run:(payload:T,tick:Tick)=>void;}
export interface BudgetProfile{readonly frameMs:number;readonly laneBudgets:Readonly<Record<WorkLane,number>>;readonly maxWorkPerTick:number;readonly maxAssetsPerTick:number;readonly maxNetworkOpsPerTick:number;}
export interface SnapshotEnvelope<T>{readonly schema:string;readonly revision:number;readonly tick:number;readonly digest:string;readonly state:T;}
export const PRIORITY_WEIGHT:Readonly<Record<CommandPriority,number>>=Object.freeze({critical:100,high:70,normal:40,low:20,background:5});
export const LANE_ORDER:readonly WorkLane[]=Object.freeze(['input','simulation','world','asset','network','render','persistence','telemetry']);
