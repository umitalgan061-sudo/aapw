export type Brand<T, B extends string> = T & { readonly __brand: B };

export type EntityIdV7 = Brand<number, 'EntityIdV7'>;
export type RevisionV7 = Brand<number, 'RevisionV7'>;
export type TickV7 = Brand<number, 'TickV7'>;
export type SequenceV7 = Brand<number, 'SequenceV7'>;
export type ContentHashV7 = Brand<string, 'ContentHashV7'>;

export type Scalar = number;

export interface Vec3V7 { readonly x: number; readonly y: number; readonly z: number; }
export interface AabbV7 { readonly min: Vec3V7; readonly max: Vec3V7; }
export interface SphereV7 { readonly center: Vec3V7; readonly radius: number; }

export type RuntimePhaseV7 = 'booting' | 'running' | 'throttled' | 'recovering' | 'stopped';
export type RuntimeModeV7 = 'full' | 'balanced' | 'constrained' | 'headless';
export type SchedulerLaneV7 = 'critical' | 'simulation' | 'streaming' | 'render' | 'telemetry' | 'background';
export type TaskOutcomeV7 = 'executed' | 'deferred' | 'cancelled' | 'failed' | 'expired';
export type NetworkConnectionV7 = 'offline' | 'connecting' | 'connected' | 'degraded' | 'draining';

export interface TransformComponentV7 {
  readonly position: Vec3V7;
  readonly yaw: number;
  readonly pitch: number;
  readonly scale: Vec3V7;
}

export interface KinematicsComponentV7 {
  readonly velocity: Vec3V7;
  readonly acceleration: Vec3V7;
  readonly grounded: boolean;
  readonly maxSpeed: number;
}

export interface VitalComponentV7 {
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly poise: number;
  readonly maxPoise: number;
  readonly invulnerableUntilTick: TickV7;
}

export interface InterestComponentV7 {
  readonly priority: number;
  readonly simulationLod: 0 | 1 | 2 | 3;
  readonly renderLod: 0 | 1 | 2 | 3;
  readonly alwaysRelevant: boolean;
}

export interface NetworkComponentV7 {
  readonly owner: string;
  readonly dirtyRevision: RevisionV7;
  readonly lastAckedSequence: SequenceV7;
  readonly replicated: boolean;
}

export interface ActorComponentSetV7 {
  readonly transform: TransformComponentV7;
  readonly kinematics: KinematicsComponentV7;
  readonly vital: VitalComponentV7;
  readonly interest: InterestComponentV7;
  readonly network: NetworkComponentV7;
  readonly tags: readonly string[];
}

export interface EntityRecordV7 {
  readonly id: EntityIdV7;
  readonly archetype: string;
  readonly components: ActorComponentSetV7;
  readonly createdTick: TickV7;
}

export interface SpawnEntityCommandV7 {
  readonly type: 'spawn';
  readonly id: EntityIdV7;
  readonly archetype: string;
  readonly components: ActorComponentSetV7;
}

export interface DespawnEntityCommandV7 {
  readonly type: 'despawn';
  readonly id: EntityIdV7;
}

export interface MoveEntityCommandV7 {
  readonly type: 'move';
  readonly id: EntityIdV7;
  readonly position: Vec3V7;
  readonly velocity: Vec3V7;
}

export interface DamageEntityCommandV7 {
  readonly type: 'damage';
  readonly id: EntityIdV7;
  readonly amount: number;
  readonly source?: EntityIdV7;
}

export interface HealEntityCommandV7 {
  readonly type: 'heal';
  readonly id: EntityIdV7;
  readonly amount: number;
}

export interface SetInterestCommandV7 {
  readonly type: 'interest';
  readonly id: EntityIdV7;
  readonly priority: number;
  readonly simulationLod: 0 | 1 | 2 | 3;
  readonly renderLod: 0 | 1 | 2 | 3;
}

export interface SetTagCommandV7 {
  readonly type: 'tag';
  readonly id: EntityIdV7;
  readonly tag: string;
  readonly enabled: boolean;
}

export interface RuntimeModeCommandV7 {
  readonly type: 'mode';
  readonly mode: RuntimeModeV7;
}

export type RuntimeCommandV7 =
  | SpawnEntityCommandV7
  | DespawnEntityCommandV7
  | MoveEntityCommandV7
  | DamageEntityCommandV7
  | HealEntityCommandV7
  | SetInterestCommandV7
  | SetTagCommandV7
  | RuntimeModeCommandV7;

export interface CommandEnvelopeV7 {
  readonly sequence: SequenceV7;
  readonly tick: TickV7;
  readonly revision: RevisionV7;
  readonly command: RuntimeCommandV7;
}

export interface EntityDeltaV7 {
  readonly id: EntityIdV7;
  readonly revision: RevisionV7;
  readonly changed: Partial<ActorComponentSetV7>;
  readonly removed: readonly (keyof ActorComponentSetV7)[];
}

export interface WorldSnapshotV7 {
  readonly tick: TickV7;
  readonly revision: RevisionV7;
  readonly baseline: ContentHashV7 | null;
  readonly entities: readonly EntityRecordV7[];
  readonly deltas: readonly EntityDeltaV7[];
  readonly checksum: ContentHashV7;
}

export interface InputCommandV7 {
  readonly sequence: SequenceV7;
  readonly tick: TickV7;
  readonly move: Vec3V7;
  readonly look: { readonly yaw: number; readonly pitch: number };
  readonly actions: readonly string[];
}

export interface PredictionStateV7 {
  readonly tick: TickV7;
  readonly sequence: SequenceV7;
  readonly position: Vec3V7;
  readonly velocity: Vec3V7;
  readonly checksum: ContentHashV7;
}

export interface RenderBudgetV7 {
  readonly frameMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly textureBytes: number;
  readonly gpuMemoryBytes: number;
}

export interface SimulationBudgetV7 {
  readonly tickMs: number;
  readonly actorUpdates: number;
  readonly pathQueries: number;
  readonly physicsQueries: number;
}

export interface NetworkBudgetV7 {
  readonly maxBytesPerSecond: number;
  readonly maxPacketBytes: number;
  readonly maxSnapshotsPerSecond: number;
  readonly maxCommandsPerSecond: number;
}

export interface RuntimeBudgetsV7 {
  readonly render: RenderBudgetV7;
  readonly simulation: SimulationBudgetV7;
  readonly network: NetworkBudgetV7;
  readonly schedulerMs: number;
}

export interface PlatformProfileV7 {
  readonly mode: RuntimeModeV7;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb: number | null;
  readonly webgpu: boolean;
  readonly offscreenCanvas: boolean;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
}

export interface TaskSpecV7<T> {
  readonly id: string;
  readonly lane: SchedulerLaneV7;
  readonly priority: number;
  readonly costEstimateMs: number;
  readonly budgetClass: 'must-run' | 'preferred' | 'opportunistic';
  readonly maxDeferrals: number;
  readonly expiresAtTick?: TickV7;
  readonly payload: T;
  readonly run: (payload: T, context: TaskContextV7) => TaskResultV7;
}

export interface TaskContextV7 {
  readonly tick: TickV7;
  readonly budgetRemainingMs: number;
  readonly deterministicSeed: number;
  readonly lane: SchedulerLaneV7;
}

export interface TaskResultV7 {
  readonly outcome: Exclude<TaskOutcomeV7, 'deferred'>;
  readonly costMs: number;
  readonly message?: string;
}

export interface SchedulerReportV7 {
  readonly tick: TickV7;
  readonly budgetMs: number;
  readonly spentMs: number;
  readonly executed: number;
  readonly deferred: number;
  readonly failed: number;
  readonly expired: number;
  readonly byLane: Readonly<Record<SchedulerLaneV7, { readonly executed: number; readonly deferred: number; readonly spentMs: number }>>;
}

export interface SpatialEntityV7 {
  readonly id: EntityIdV7;
  readonly bounds: AabbV7;
  readonly layer: number;
  readonly active: boolean;
}

export interface SpatialQueryV7 {
  readonly bounds?: AabbV7;
  readonly sphere?: SphereV7;
  readonly layer?: number;
  readonly limit?: number;
  readonly sortByDistanceTo?: Vec3V7;
}

export interface SpatialQueryResultV7 {
  readonly id: EntityIdV7;
  readonly distanceSquared: number;
  readonly cellKey: string;
}

export interface AssetDescriptorV7 {
  readonly id: string;
  readonly url: string;
  readonly kind: 'glb' | 'gltf' | 'texture' | 'audio' | 'json' | 'wasm';
  readonly bytes: number;
  readonly hash: ContentHashV7;
  readonly critical: boolean;
  readonly tags: readonly string[];
}

export interface AssetRecordV7 extends AssetDescriptorV7 {
  readonly loaded: boolean;
  readonly residentBytes: number;
  readonly lastUsedTick: TickV7;
  readonly hitCount: number;
  readonly missCount: number;
}

export interface AssetBudgetV7 {
  readonly maxBytes: number;
  readonly reserveBytes: number;
  readonly maxEntries: number;
}

export interface PacketV7<T = unknown> {
  readonly protocol: 7;
  readonly sequence: SequenceV7;
  readonly ack: SequenceV7;
  readonly sentTick: TickV7;
  readonly baseline: ContentHashV7 | null;
  readonly payload: T;
  readonly bytes: number;
  readonly reliable: boolean;
}

export interface NetworkStatsV7 {
  readonly state: NetworkConnectionV7;
  readonly sentPackets: number;
  readonly receivedPackets: number;
  readonly droppedPackets: number;
  readonly retransmits: number;
  readonly sentBytes: number;
  readonly receivedBytes: number;
  readonly estimatedRttMs: number;
  readonly jitterMs: number;
  readonly lossRatio: number;
}

export interface SaveEnvelopeV7<T> {
  readonly schema: 7;
  readonly slot: number;
  readonly createdAtIso: string;
  readonly tick: TickV7;
  readonly revision: RevisionV7;
  readonly payload: T;
  readonly checksum: ContentHashV7;
  readonly migrations: readonly string[];
}

export interface SaveSlotSummaryV7 {
  readonly slot: number;
  readonly exists: boolean;
  readonly schema: number | null;
  readonly tick: TickV7 | null;
  readonly revision: RevisionV7 | null;
  readonly bytes: number;
  readonly checksum: ContentHashV7 | null;
}

export interface MetricPointV7 {
  readonly tick: TickV7;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly tags: Readonly<Record<string, string>>;
}

export interface RuntimeHealthV7 {
  readonly score: number;
  readonly mode: RuntimeModeV7;
  readonly degraded: boolean;
  readonly reasons: readonly string[];
  readonly recommendations: readonly string[];
}

export type ResultV7<T, E extends string = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: E; readonly message: string } };

export interface RuntimeConfigV7 {
  readonly fixedHz: number;
  readonly maxCatchUpSteps: number;
  readonly schedulerMs: number;
  readonly worldCellMeters: number;
  readonly network: NetworkBudgetV7;
  readonly asset: AssetBudgetV7;
}

export const DEFAULT_RUNTIME_CONFIG_V7: RuntimeConfigV7 = Object.freeze({
  fixedHz: 60,
  maxCatchUpSteps: 4,
  schedulerMs: 2.5,
  worldCellMeters: 32,
  network: Object.freeze({
    maxBytesPerSecond: 64 * 1024,
    maxPacketBytes: 1200,
    maxSnapshotsPerSecond: 30,
    maxCommandsPerSecond: 120,
  }),
  asset: Object.freeze({
    maxBytes: 256 * 1024 * 1024,
    reserveBytes: 16 * 1024 * 1024,
    maxEntries: 4096,
  }),
});

export const entityIdV7 = (value: number): EntityIdV7 => Math.max(0, Math.trunc(value)) as EntityIdV7;
export const tickV7 = (value: number): TickV7 => Math.max(0, Math.trunc(value)) as TickV7;
export const revisionV7 = (value: number): RevisionV7 => Math.max(0, Math.trunc(value)) as RevisionV7;
export const sequenceV7 = (value: number): SequenceV7 => Math.max(0, Math.trunc(value)) as SequenceV7;
export const hashV7 = (value: string): ContentHashV7 => value as ContentHashV7;
export const vec3V7 = (x = 0, y = 0, z = 0): Vec3V7 => Object.freeze({ x, y, z });
export const addVec3V7 = (a: Vec3V7, b: Vec3V7): Vec3V7 => vec3V7(a.x + b.x, a.y + b.y, a.z + b.z);
export const scaleVec3V7 = (a: Vec3V7, scalar: number): Vec3V7 => vec3V7(a.x * scalar, a.y * scalar, a.z * scalar);
export const distanceSquaredV7 = (a: Vec3V7, b: Vec3V7): number => {
  const x = a.x - b.x; const y = a.y - b.y; const z = a.z - b.z;
  return x * x + y * y + z * z;
};
export const clampV7 = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export const isFiniteVec3V7 = (value: Vec3V7): boolean => Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
