export const R16_VERSION = 16 as const;
export type R16Version = typeof R16_VERSION;
export type R16Source = 'engine' | 'ui' | 'network' | 'save' | 'replay' | 'system' | 'worker';
export type R16HealthState = 'healthy' | 'degraded' | 'recovering' | 'blocked';
export type R16CommandStatus = 'queued' | 'accepted' | 'rejected' | 'applied' | 'dropped';
export type R16EventSeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type R16ReplicationMode = 'authoritative' | 'predictive' | 'observed';
export type R16PersistenceKind = 'checkpoint' | 'journal' | 'replay';
export type R16BudgetClass = 'simulation' | 'render' | 'streaming' | 'network' | 'save' | 'worker';

export interface R16Error { readonly code:string; readonly message:string; readonly retryable:boolean; }
export type R16Result<T> = { readonly ok:true; readonly value:T } | { readonly ok:false; readonly error:R16Error };

export interface R16ClockSample { readonly tick:number; readonly monotonicMs:number; readonly deltaMs:number; }
export interface R16TickEnvelope { readonly version:R16Version; readonly tick:number; readonly seed:number; readonly source:R16Source; }

export interface R16Command<T=unknown> extends R16TickEnvelope {
  readonly id:string; readonly topic:string; readonly payload:T; readonly createdTick:number; readonly deadlineTick:number; readonly priority:number;
}
export interface R16CommandReceipt {
  readonly id:string; readonly status:R16CommandStatus; readonly appliedTick:number|null; readonly digest:string; readonly reason:string|null;
}
export interface R16CommandHandler<T=unknown> { readonly topic:string; readonly apply:(command:R16Command<T>)=>R16Result<unknown>; }
export interface R16CommandBusStats { readonly queued:number; readonly accepted:number; readonly applied:number; readonly rejected:number; readonly dropped:number; }

export interface R16Event<T=unknown> extends R16TickEnvelope {
  readonly id:string; readonly topic:string; readonly payload:T; readonly severity:R16EventSeverity; readonly emittedTick:number; readonly sequence:number; readonly digest:string;
}
export interface R16EventQuery { readonly topic?:string; readonly minTick?:number; readonly maxTick?:number; readonly severity?:R16EventSeverity; readonly limit?:number; }

export interface R16StateMutation {
  readonly path:string; readonly value:unknown; readonly source:R16Source; readonly tick:number; readonly mutationId:string; readonly reason:string;
}
export interface R16StatePatch {
  readonly revision:number; readonly tick:number; readonly source:R16Source; readonly mutations:readonly R16StateMutation[]; readonly digest:string;
}
export interface R16StateSnapshot {
  readonly version:R16Version; readonly revision:number; readonly tick:number; readonly state:Readonly<Record<string,unknown>>; readonly digest:string; readonly createdAtTick:number;
}
export interface R16SnapshotRecord { readonly kind:'checkpoint'|'rollback'|'replay-marker'; readonly revision:number; readonly tick:number; readonly digest:string; readonly snapshot:R16StateSnapshot; }

export interface R16BudgetLimit { readonly budget:R16BudgetClass; readonly maxUnits:number; readonly maxMilliseconds:number; readonly weight:number; readonly burstUnits:number; }
export interface R16BudgetSample { readonly budget:R16BudgetClass; readonly requestedUnits:number; readonly consumedUnits:number; readonly elapsedMs:number; readonly pressure:number; readonly tick:number; }
export interface R16WorkItem<T=unknown> { readonly id:string; readonly budget:R16BudgetClass; readonly units:number; readonly priority:number; readonly enqueuedTick:number; readonly expiresTick:number; readonly payload:T; }
export interface R16WorkReceipt { readonly id:string; readonly accepted:boolean; readonly consumedUnits:number; readonly reason:string|null; }

export interface R16ReplicationEntity {
  readonly entityId:string; readonly revision:number; readonly authority:R16ReplicationMode;
  readonly position?:readonly [number,number,number]; readonly rotation?:readonly [number,number,number,number];
  readonly velocity?:readonly [number,number,number]; readonly components:Readonly<Record<string,unknown>>;
}
export interface R16ReplicationDelta {
  readonly tick:number; readonly entityId:string; readonly revision:number;
  readonly changed:Readonly<Record<string,unknown>>; readonly removed:readonly string[]; readonly checksum:string;
}
export interface R16ReplicationAck { readonly entityId:string; readonly acceptedRevision:number; readonly rejected:boolean; readonly reason:string|null; }
export interface R16PeerBudget { readonly peerId:string; readonly maxEntities:number; readonly maxBytesPerTick:number; readonly maxDeltasPerTick:number; }

export interface R16PersistenceEntry {
  readonly sequence:number; readonly kind:R16PersistenceKind; readonly tick:number; readonly revision:number; readonly digest:string; readonly payload:Readonly<Record<string,unknown>>;
}
export interface R16PersistenceDigest { readonly firstSequence:number; readonly lastSequence:number; readonly entryCount:number; readonly digest:string; }

export interface R16TelemetrySample { readonly metric:string; readonly value:number; readonly tick:number; readonly unit:string; readonly tags:Readonly<Record<string,string>>; }
export interface R16TelemetryDigest { readonly sampleCount:number; readonly digest:string; readonly droppedCount:number; }
export interface R16MetricSummary { readonly metric:string; readonly count:number; readonly min:number; readonly max:number; readonly avg:number; readonly p95:number; readonly latest:number; readonly unit:string; }

export interface R16HealthSignal { readonly subsystem:string; readonly severity:R16EventSeverity; readonly score:number; readonly reason:string; readonly tick:number; }
export interface R16HealthReport { readonly version:R16Version; readonly state:R16HealthState; readonly score:number; readonly tick:number; readonly signals:readonly R16HealthSignal[]; readonly digest:string; }

export interface R16RuntimeConfig {
  readonly seed:number; readonly fixedStepMs:number; readonly maxCommandsPerTick:number; readonly maxEvents:number;
  readonly maxStateNodes:number; readonly maxSnapshots:number; readonly maxJournalEntries:number; readonly maxTelemetrySamples:number;
  readonly maxWorkItemsPerBudget:number; readonly maxReplicationEntities:number; readonly maxReplicationDeltasPerTick:number; readonly maxReplicationBytesPerTick:number;
}
export const DEFAULT_R16_CONFIG:R16RuntimeConfig=Object.freeze({
  seed:16092026,fixedStepMs:16.6666666667,maxCommandsPerTick:1024,maxEvents:8192,maxStateNodes:4096,maxSnapshots:128,
  maxJournalEntries:8192,maxTelemetrySamples:16384,maxWorkItemsPerBudget:2048,maxReplicationEntities:8192,
  maxReplicationDeltasPerTick:2048,maxReplicationBytesPerTick:524288,
});
export interface R16RuntimeDigest {
  readonly tick:number; readonly stateRevision:number; readonly eventDigest:string; readonly snapshotDigest:string;
  readonly persistenceDigest:string; readonly telemetryDigest:string; readonly healthDigest:string; readonly replicationDigest:string;
}
