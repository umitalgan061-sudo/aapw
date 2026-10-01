export type Brand<T, B extends string> = T & { readonly __brand: B };
export type EntityId = Brand<string, 'EntityId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type CommandId = Brand<string, 'CommandId'>;
export type Tick = Brand<number, 'Tick'>;
export type Revision = Brand<number, 'Revision'>;
export type TimestampMs = Brand<number, 'TimestampMs'>;

export type RuntimePhase = 'input' | 'simulation' | 'navigation' | 'ai' | 'audio' | 'streaming' | 'network' | 'save' | 'render' | 'telemetry';
export type TaskLane = 'critical' | 'interactive' | 'simulation' | 'background' | 'idle';
export type EntityLod = 'near' | 'mid' | 'far' | 'sleeping';
export type GraphicsBackend = 'webgpu' | 'webgl2' | 'headless';
export type PlatformClass = 'desktop' | 'tablet' | 'mobile' | 'constrained';

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface Quat { readonly x: number; readonly y: number; readonly z: number; readonly w: number; }
export interface Transform { readonly position: Vec3; readonly rotation: Quat; readonly scale: Vec3; }
export interface Velocity { readonly linear: Vec3; readonly angular: Vec3; }
export interface Bounds { readonly min: Vec3; readonly max: Vec3; readonly radius: number; }

export interface EntityState {
  readonly id: EntityId; readonly transform: Transform; readonly velocity: Velocity; readonly bounds: Bounds;
  readonly lod: EntityLod; readonly active: boolean; readonly revision: Revision; readonly tags: readonly string[];
}
export interface InterestPoint { readonly id: string; readonly position: Vec3; readonly radius: number; readonly weight: number; }
export interface Stimulus {
  readonly id: string; readonly source: EntityId | string; readonly type: 'visual' | 'audio' | 'damage' | 'social' | 'environment' | 'objective';
  readonly position: Vec3; readonly intensity: number; readonly confidence: number; readonly expiresAtTick: Tick;
}
export interface DecisionScore { readonly action: string; readonly utility: number; readonly urgency: number; readonly cost: number; readonly confidence: number; }
export interface AudioSourceState {
  readonly id: string; readonly position: Vec3; readonly velocity: Vec3; readonly gain: number;
  readonly occlusion: number; readonly priority: number; readonly bus: 'music' | 'dialogue' | 'ambience' | 'sfx' | 'ui';
}
export interface RenderResource {
  readonly id: string; readonly bytes: number; readonly transient: boolean; readonly format: string;
  readonly width: number; readonly height: number; readonly samples: number; readonly usage: readonly string[];
}
export interface RenderPass {
  readonly id: string; readonly phase: RuntimePhase; readonly reads: readonly string[]; readonly writes: readonly string[];
  readonly estimatedGpuMs: number; readonly drawCalls: number; readonly triangles: number; readonly optional: boolean;
}
export interface FrameBudget {
  readonly frameMs: number; readonly cpuMs: number; readonly gpuMs: number; readonly drawCalls: number;
  readonly triangles: number; readonly memoryBytes: number;
}
export interface QualityState {
  readonly tier: 0 | 1 | 2 | 3 | 4; readonly renderScale: number; readonly shadows: boolean;
  readonly foliageDensity: number; readonly postFx: number; readonly maxAudioVoices: number;
}
export interface BrowserCapabilities {
  readonly backend: GraphicsBackend; readonly workers: boolean; readonly offscreenCanvas: boolean;
  readonly sharedArrayBuffer: boolean; readonly indexedDb: boolean; readonly broadcastChannel: boolean;
  readonly deviceMemoryGb: number | null; readonly hardwareConcurrency: number; readonly reducedMotion: boolean; readonly saveData: boolean;
}
export interface RuntimeConfig {
  readonly platform: PlatformClass; readonly capabilities: BrowserCapabilities; readonly fixedHz: number;
  readonly maxCatchUpSteps: number; readonly frameBudget: FrameBudget; readonly initialQuality: QualityState;
  readonly maxEntities: number; readonly maxTasksPerFrame: number;
}
export interface RuntimeTask {
  readonly id: CommandId; readonly lane: TaskLane; readonly phase: RuntimePhase; readonly costUnits: number;
  readonly deadlineTick: Tick | null; readonly enqueuedAt: Tick; readonly run: (context: TaskContext) => TaskResult;
}
export interface TaskContext { readonly tick: Tick; readonly phase: RuntimePhase; readonly remainingUnits: number; readonly abortSignal: AbortSignal; }
export interface TaskResult { readonly consumedUnits: number; readonly completed: boolean; readonly reschedule: boolean; readonly detail?: string; }
export interface RuntimeCommand {
  readonly id: CommandId; readonly tick: Tick; readonly actor: EntityId | null; readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>; readonly sequence: number; readonly predictionKey: string | null;
}
export interface SnapshotEnvelope<T> { readonly version: number; readonly tick: Tick; readonly revision: Revision; readonly digest: string; readonly state: T; }
export interface WorldDelta {
  readonly entityId: EntityId; readonly revision: Revision; readonly tick: Tick; readonly transform?: Transform;
  readonly velocity?: Velocity; readonly lod?: EntityLod; readonly active?: boolean; readonly digest: string;
}
export interface SaveEnvelope<T> { readonly schema: string; readonly createdAt: TimestampMs; readonly tick: Tick; readonly digest: string; readonly state: T; }
export interface ReplayFrame { readonly tick: Tick; readonly commands: readonly RuntimeCommand[]; readonly digest: string; }
export interface MetricSample {
  readonly name: string; readonly value: number; readonly unit: string; readonly tick: Tick; readonly phase: RuntimePhase;
  readonly tags: Readonly<Record<string, string>>;
}
export interface TraceSpan {
  readonly id: string; readonly name: string; readonly phase: RuntimePhase; readonly startedAt: number; readonly endedAt: number;
  readonly parentId: string | null; readonly attributes: Readonly<Record<string, string | number | boolean>>;
}
export interface HealthSignal {
  readonly subsystem: string; readonly ok: boolean; readonly severity: 'info' | 'warning' | 'error' | 'fatal';
  readonly code: string; readonly message: string; readonly tick: Tick;
}
export interface AssetManifestEntry {
  readonly id: AssetId; readonly uri: string; readonly bytes: number; readonly digest: string;
  readonly priority: number; readonly optional: boolean; readonly contentType: 'model' | 'texture' | 'audio' | 'shader' | 'data';
}
export interface AssetRequest {
  readonly id: AssetId; readonly distance: number; readonly priorityBias: number;
  readonly hardDeadlineTick: Tick | null; readonly allowPlaceholder: boolean;
}
export interface AssetResidency {
  readonly id: AssetId; readonly state: 'unloaded' | 'queued' | 'loading' | 'resident' | 'stale' | 'failed';
  readonly bytes: number; readonly lastUsedTick: Tick; readonly refCount: number;
}
export interface NetworkEnvelope {
  readonly protocol: number; readonly sessionId: string; readonly sequence: number; readonly ack: number;
  readonly sentAtTick: Tick; readonly kind: 'input' | 'snapshot' | 'delta' | 'event' | 'ping';
  readonly payload: unknown; readonly digest: string;
}
export interface PredictionState<T> {
  readonly inputSequence: number; readonly tick: Tick; readonly predicted: T; readonly authoritative: T | null; readonly error: number;
}
export interface SaveJournalEntry {
  readonly transactionId: string; readonly tick: Tick; readonly operation: 'begin' | 'write' | 'commit' | 'abort';
  readonly digest: string; readonly bytes: number;
}
export interface FeatureFlag {
  readonly id: string; readonly enabled: boolean; readonly rollout: number;
  readonly expiresAt: TimestampMs | null; readonly owner: string;
}
export interface RuntimeHealthReport {
  readonly generatedAt: TimestampMs; readonly tick: Tick; readonly digest: string; readonly signals: readonly HealthSignal[];
  readonly quality: QualityState; readonly queueDepth: number; readonly residentAssets: number; readonly activeEntities: number;
}
export interface TaskBudgetReport {
  readonly tick: Tick; readonly laneUnits: Readonly<Record<TaskLane, number>>;
  readonly phaseUnits: Readonly<Record<RuntimePhase, number>>; readonly deferred: number; readonly dropped: number;
}
export interface RenderDecision { readonly quality: QualityState; readonly budget: FrameBudget; readonly reason: 'steady' | 'upgrade' | 'downgrade' | 'panic'; readonly pressure: number; }
export interface R40PlatformEvents {
  readonly taskCompleted: RuntimeTask; readonly entityChanged: EntityState; readonly assetState: AssetResidency;
  readonly networkCorrection: PredictionState<unknown>; readonly health: HealthSignal; readonly frame: RenderDecision;
}
export type R40Listener<K extends keyof R40PlatformEvents> = (payload: R40PlatformEvents[K]) => void;

export function entityId(value: string): EntityId { return value as EntityId; }
export function assetId(value: string): AssetId { return value as AssetId; }
export function commandId(value: string): CommandId { return value as CommandId; }
export function tick(value: number): Tick { return Math.max(0, Math.trunc(value)) as Tick; }
export function revision(value: number): Revision { return Math.max(0, Math.trunc(value)) as Revision; }
export function timestamp(value: number): TimestampMs { return Math.max(0, Math.trunc(value)) as TimestampMs; }

export const ZERO_VEC3: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const IDENTITY_QUAT: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
export const ONE_VEC3: Vec3 = Object.freeze({ x: 1, y: 1, z: 1 });

export function freezeVec3(value: Vec3): Vec3 { return Object.freeze({ x: value.x, y: value.y, z: value.z }); }
export function freezeTransform(value: Transform): Transform {
  return Object.freeze({ position: freezeVec3(value.position), rotation: Object.freeze({ ...value.rotation }), scale: freezeVec3(value.scale) });
}
export function cloneEntityState(value: EntityState): EntityState {
  return Object.freeze({
    ...value,
    transform: freezeTransform(value.transform),
    velocity: Object.freeze({ linear: freezeVec3(value.velocity.linear), angular: freezeVec3(value.velocity.angular) }),
    bounds: Object.freeze({ min: freezeVec3(value.bounds.min), max: freezeVec3(value.bounds.max), radius: value.bounds.radius }),
    tags: Object.freeze([...value.tags]),
  });
}
