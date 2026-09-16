export type Brand<T, B extends string> = T & { readonly __brand: B };
export type EntityId = Brand<string, 'EntityId'>;
export type ComponentType = Brand<string, 'ComponentType'>;
export type SystemId = Brand<string, 'SystemId'>;
export type EventName = Brand<string, 'EventName'>;
export type FrameId = Brand<number, 'FrameId'>;
export type TickId = Brand<number, 'TickId'>;
export type Sequence = Brand<number, 'Sequence'>;

export interface Vec2 { readonly x: number; readonly y: number; }
export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface Quaternion { readonly x: number; readonly y: number; readonly z: number; readonly w: number; }
export interface Aabb3 { readonly min: Vec3; readonly max: Vec3; }
export interface Sphere3 { readonly center: Vec3; readonly radius: number; }
export interface Transform { readonly position: Vec3; readonly rotation: Quaternion; readonly scale: Vec3; }

export type Finite = number & { readonly __finite: unique symbol };
export type Normalized01 = number & { readonly __normalized01: unique symbol };
export type Positive = number & { readonly __positive: unique symbol };

export interface TimeSample {
  readonly deltaSeconds: number;
  readonly elapsedSeconds: number;
  readonly frame: FrameId;
  readonly tick: TickId;
  readonly alpha: number;
}

export interface FixedStepConfig {
  readonly stepSeconds: Positive;
  readonly maxSubSteps: number;
  readonly maxFrameDeltaSeconds: Positive;
  readonly timeScale: number;
}

export interface Budget {
  readonly cpuMilliseconds: number;
  readonly gpuMilliseconds: number;
  readonly memoryBytes: number;
  readonly entities: number;
  readonly events: number;
  readonly commands: number;
}

export interface BudgetUsage extends Budget {
  readonly cpuRatio: number;
  readonly gpuRatio: number;
  readonly memoryRatio: number;
  readonly entityRatio: number;
  readonly eventRatio: number;
  readonly commandRatio: number;
}

export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type ResultStatus = 'ok' | 'rejected' | 'invalid' | 'disposed' | 'overflow';

export interface ResultMeta {
  readonly status: ResultStatus;
  readonly code: string;
  readonly message?: string;
}

export interface EngineResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly meta: ResultMeta;
}

export interface Disposable { dispose(): void; readonly disposed: boolean; }
export interface Snapshotable<T> { snapshot(): Readonly<T>; }
export interface Resettable { reset(): void; }

export interface TaggedRecord {
  readonly kind: string;
  readonly version: number;
  readonly revision: number;
}

export interface CommandBase extends TaggedRecord {
  readonly id: Sequence;
  readonly entity: EntityId;
  readonly issuedAtTick: TickId;
  readonly priority: number;
}

export interface FrameCommand extends CommandBase {
  readonly type: 'frame';
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EventEnvelope<TPayload = unknown> extends TaggedRecord {
  readonly name: EventName;
  readonly sequence: Sequence;
  readonly tick: TickId;
  readonly frame: FrameId;
  readonly payload: Readonly<TPayload>;
}

export interface EventHandlerContext {
  readonly name: EventName;
  readonly tick: TickId;
  readonly frame: FrameId;
  readonly signal: AbortSignal;
}

export type EventHandler<T = unknown> = (event: EventEnvelope<T>, context: EventHandlerContext) => void | Promise<void>;

export interface StateContext<TData = unknown> {
  readonly tick: TickId;
  readonly frame: FrameId;
  readonly data: TData;
}

export interface StateDefinition<TData = unknown> {
  readonly id: string;
  readonly enter?: (context: StateContext<TData>) => void;
  readonly update?: (context: StateContext<TData>) => void;
  readonly exit?: (context: StateContext<TData>) => void;
}

export interface Transition<TData = unknown> {
  readonly from: string;
  readonly to: string;
  readonly guard?: (context: StateContext<TData>) => boolean;
  readonly priority?: number;
}

export interface SystemContext {
  readonly time: TimeSample;
  readonly budget: BudgetUsage;
  readonly signal: AbortSignal;
}

export interface SystemDefinition {
  readonly id: SystemId;
  readonly phase: string;
  readonly priority: number;
  readonly before?: readonly SystemId[];
  readonly after?: readonly SystemId[];
  readonly enabled?: (context: SystemContext) => boolean;
  readonly update: (context: SystemContext) => void;
}

export interface ComponentSchema<T extends object = Record<string, unknown>> {
  readonly type: ComponentType;
  readonly version: number;
  readonly defaults: () => T;
  readonly validate: (value: unknown) => value is T;
  readonly clone?: (value: T) => T;
}

export interface ComponentStore<T extends object> extends Disposable {
  readonly schema: ComponentSchema<T>;
  readonly size: number;
  has(entity: EntityId): boolean;
  get(entity: EntityId): Readonly<T> | undefined;
  set(entity: EntityId, value: T): EngineResult<void>;
  patch(entity: EntityId, patch: Partial<T>): EngineResult<void>;
  remove(entity: EntityId): boolean;
  clear(): void;
  entries(): IterableIterator<readonly [EntityId, Readonly<T>]>;
}

export interface EntityRecord {
  readonly id: EntityId;
  readonly generation: number;
  readonly alive: boolean;
}

export interface QueryFilter {
  readonly all?: readonly ComponentType[];
  readonly any?: readonly ComponentType[];
  readonly none?: readonly ComponentType[];
}

export interface QueryResult {
  readonly entities: readonly EntityId[];
  readonly scanned: number;
  readonly matched: number;
  readonly truncated: boolean;
}

export interface SpatialCellCoord { readonly x: number; readonly y: number; readonly z: number; }
export interface SpatialEntry { readonly entity: EntityId; readonly bounds: Aabb3; readonly layer: number; }
export interface SpatialQuery { readonly bounds?: Aabb3; readonly sphere?: Sphere3; readonly layerMask?: number; readonly maxResults?: number; }

export interface TelemetrySample {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly frame: FrameId;
  readonly tick: TickId;
  readonly tags: Readonly<Record<string, string>>;
}

export interface HistogramSnapshot {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface RuntimeHealth {
  readonly phase: 'booting' | 'ready' | 'degraded' | 'recovering' | 'failed' | 'disposed';
  readonly score: number;
  readonly faults: number;
  readonly recoveries: number;
  readonly lastFault?: string;
}

export interface CapabilitySnapshot {
  readonly webgl2: boolean;
  readonly webgpu: boolean;
  readonly offscreenCanvas: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly crossOriginIsolated: boolean;
  readonly gamepad: boolean;
  readonly touch: boolean;
  readonly worker: boolean;
  readonly deviceMemoryGb: number;
  readonly hardwareConcurrency: number;
}

export interface DeterministicSeed {
  readonly value: number;
  readonly namespace: string;
}

export interface RandomSnapshot { readonly state0: number; readonly state1: number; readonly calls: number; }

export interface SchedulerTask {
  readonly id: string;
  readonly runAtTick: TickId;
  readonly intervalTicks: number;
  readonly priority: number;
  readonly maxRuns?: number;
  readonly callback: (tick: TickId) => void;
}

export interface FrameEnvelope {
  readonly frame: FrameId;
  readonly tick: TickId;
  readonly deltaSeconds: number;
  readonly commands: readonly FrameCommand[];
  readonly events: readonly EventEnvelope[];
  readonly checksum: string;
}

export interface SerializedEnvelope {
  readonly schema: string;
  readonly version: number;
  readonly checksum: string;
  readonly data: string;
}

export const ENTITY_ID = (value: string): EntityId => value as EntityId;
export const COMPONENT_TYPE = (value: string): ComponentType => value as ComponentType;
export const SYSTEM_ID = (value: string): SystemId => value as SystemId;
export const EVENT_NAME = (value: string): EventName => value as EventName;
export const FRAME_ID = (value: number): FrameId => value as FrameId;
export const TICK_ID = (value: number): TickId => value as TickId;
export const SEQUENCE = (value: number): Sequence => value as Sequence;
