
export const R41_VERSION = 41 as const;

export type RuntimeMode = 'booting' | 'loading' | 'running' | 'paused' | 'degraded' | 'recovering' | 'faulted' | 'stopped' | 'disposed';
export type QualityTier = 'minimal' | 'low' | 'balanced' | 'high' | 'ultra';
export type NetworkRole = 'offline' | 'client' | 'host' | 'server';
export type Priority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type WorkClass = 'simulation' | 'gameplay' | 'streaming' | 'network' | 'render' | 'persistence' | 'telemetry' | 'background';
export type AssetState = 'declared' | 'queued' | 'loading' | 'ready' | 'failed' | 'evicted';
export type EntityKind = 'player' | 'npc' | 'animal' | 'creature' | 'dragon' | 'vehicle' | 'structure' | 'prop' | 'effect' | 'system';
export type CommandKind = 'move' | 'look' | 'jump' | 'sprint' | 'guard' | 'attack' | 'dodge' | 'interact' | 'equip' | 'use' | 'teleport' | 'emote' | 'pause' | 'resume' | 'custom';
export type RenderBackend = 'webgl2' | 'webgpu' | 'headless';
export type RenderFeature = 'dynamicResolution' | 'temporalHistory' | 'taa' | 'ssao' | 'bloom' | 'fog' | 'instancing' | 'textureCompression' | 'occlusionHints' | 'motionVectors' | 'multiview';

export interface Vec2 { readonly x: number; readonly y: number; }
export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface Quat { readonly x: number; readonly y: number; readonly z: number; readonly w: number; }

export interface Transform {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
}

export interface Entity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly transform: Transform;
  readonly velocity: Vec3;
  readonly health: number;
  readonly stamina: number;
  readonly active: boolean;
  readonly lod: 0 | 1 | 2 | 3;
  readonly revision: number;
  readonly tags: readonly string[];
  readonly data: Readonly<Record<string, unknown>>;
}

export interface InputFrame {
  readonly tick: number;
  readonly sequence: number;
  readonly move: Vec2;
  readonly look: Vec2;
  readonly jump: boolean;
  readonly sprint: boolean;
  readonly guard: boolean;
  readonly attack: boolean;
  readonly dodge: boolean;
  readonly interact: boolean;
  readonly source: 'keyboard' | 'mouse' | 'gamepad' | 'touch' | 'mixed' | 'replay';
}

export interface CommandEnvelope {
  readonly id: string;
  readonly tick: number;
  readonly sequence: number;
  readonly entityId: string;
  readonly kind: CommandKind;
  readonly source: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface CommandReceipt {
  readonly id: string;
  readonly sequence: number;
  readonly accepted: boolean;
  readonly reason: 'accepted' | 'rate-limited' | 'duplicate' | 'invalid-tick' | 'invalid-payload' | 'capacity' | 'stale';
}

export type RuntimeEvent =
  | { readonly type: 'runtime.mode'; readonly tick: number; readonly sequence: number; readonly from: RuntimeMode; readonly to: RuntimeMode; readonly reason: string }
  | { readonly type: 'runtime.tick'; readonly tick: number; readonly sequence: number; readonly deltaSeconds: number }
  | { readonly type: 'entity.spawn'; readonly tick: number; readonly sequence: number; readonly entityId: string; readonly kind: EntityKind }
  | { readonly type: 'entity.patch'; readonly tick: number; readonly sequence: number; readonly entityId: string; readonly revision: number }
  | { readonly type: 'entity.remove'; readonly tick: number; readonly sequence: number; readonly entityId: string }
  | { readonly type: 'command.accepted'; readonly tick: number; readonly sequence: number; readonly commandId: string }
  | { readonly type: 'command.rejected'; readonly tick: number; readonly sequence: number; readonly commandId: string; readonly reason: string }
  | { readonly type: 'asset.state'; readonly tick: number; readonly sequence: number; readonly assetId: string; readonly state: AssetState }
  | { readonly type: 'network.snapshot'; readonly tick: number; readonly sequence: number; readonly snapshotTick: number; readonly entityCount: number }
  | { readonly type: 'quality.changed'; readonly tick: number; readonly sequence: number; readonly from: QualityTier; readonly to: QualityTier; readonly reason: string }
  | { readonly type: 'fault'; readonly tick: number; readonly sequence: number; readonly domain: string; readonly message: string };

export interface ClockStep { readonly tick: number; readonly deltaSeconds: number; }

export interface ClockSnapshot {
  readonly tick: number;
  readonly elapsedSeconds: number;
  readonly accumulatorSeconds: number;
  readonly fixedStepSeconds: number;
  readonly timeScale: number;
  readonly droppedSteps: number;
  readonly maxCatchUpSteps: number;
  readonly paused: boolean;
}

export interface FrameBudget {
  readonly class: WorkClass;
  readonly budgetMs: number;
  readonly maxItems: number;
  readonly warningRatio: number;
  readonly criticalRatio: number;
}

export interface WorkItem<T = unknown> {
  readonly id: string;
  readonly class: WorkClass;
  readonly priority: Priority;
  readonly estimatedMs: number;
  readonly deadlineTick: number | null;
  readonly coalescingKey: string | null;
  readonly payload: T;
  readonly execute: (payload: T) => void | Promise<void>;
}

export interface WorkResult {
  readonly id: string;
  readonly class: WorkClass;
  readonly started: boolean;
  readonly completed: boolean;
  readonly deferred: boolean;
  readonly failed: boolean;
  readonly reason: string | null;
  readonly elapsedMs: number;
}

export interface SchedulerSnapshot {
  readonly tick: number;
  readonly queued: number;
  readonly running: number;
  readonly completed: number;
  readonly deferred: number;
  readonly failed: number;
  readonly deferredByClass: Readonly<Record<WorkClass, number>>;
}

export interface NetworkEntity {
  readonly id: string;
  readonly revision: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly rotation: Quat;
  readonly health: number;
  readonly stamina: number;
  readonly flags: number;
}

export interface NetworkSnapshot {
  readonly tick: number;
  readonly sequence: number;
  readonly acknowledgedInputSequence: number;
  readonly entities: readonly NetworkEntity[];
  readonly checksum: number;
}

export interface NetworkDelta {
  readonly baseTick: number;
  readonly targetTick: number;
  readonly added: readonly NetworkEntity[];
  readonly changed: readonly NetworkEntity[];
  readonly removed: readonly string[];
  readonly checksum: number;
}

export interface NetworkMetrics {
  readonly connected: boolean;
  readonly sent: number;
  readonly received: number;
  readonly dropped: number;
  readonly rejected: number;
  readonly pending: number;
  readonly lastAck: number;
  readonly rttMs: number;
}

export interface AssetNode {
  readonly id: string;
  readonly url: string;
  readonly state: AssetState;
  readonly bytes: number;
  readonly priority: Priority;
  readonly dependencies: readonly string[];
  readonly tags: readonly string[];
  readonly refs: number;
  readonly attempts: number;
  readonly lastUsedTick: number;
  readonly critical: boolean;
  readonly revision: number;
}

export interface AssetPlanItem {
  readonly id: string;
  readonly depth: number;
  readonly priority: Priority;
  readonly bytes: number;
  readonly dependenciesReady: boolean;
}

export interface AssetStats {
  readonly nodes: number;
  readonly ready: number;
  readonly loading: number;
  readonly failed: number;
  readonly residentBytes: number;
  readonly capacityBytes: number;
  readonly utilization: number;
  readonly digest: number;
}

export interface RenderInput {
  readonly backend: RenderBackend;
  readonly width: number;
  readonly height: number;
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number | null;
  readonly memoryPressure: number;
  readonly thermalPressure: number;
  readonly requestedFeatures: readonly RenderFeature[];
  readonly webgpuAvailable: boolean;
  readonly textureCompression: boolean;
  readonly visibility: number;
  readonly cameraCut: boolean;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
}

export interface RenderPlan {
  readonly backend: RenderBackend;
  readonly tier: QualityTier;
  readonly scale: number;
  readonly pixelRatioCap: number;
  readonly enabledFeatures: readonly RenderFeature[];
  readonly disabledFeatures: readonly RenderFeature[];
  readonly historyValid: boolean;
  readonly reason: string;
  readonly budgetMs: number;
}

export interface TelemetrySample {
  readonly tick: number;
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly networkMs: number;
  readonly streamingMs: number;
  readonly persistenceMs: number;
  readonly entityCount: number;
  readonly activeCount: number;
  readonly memoryBytes: number;
  readonly quality: QualityTier;
}

export interface HealthReport {
  readonly score: number;
  readonly ok: boolean;
  readonly mode: RuntimeMode;
  readonly tick: number;
  readonly warnings: readonly string[];
  readonly critical: readonly string[];
  readonly sampleCount: number;
}

export interface RuntimeConfig {
  readonly seed: number;
  readonly fixedStepSeconds: number;
  readonly maxCatchUpSteps: number;
  readonly maxEntities: number;
  readonly maxCommandsPerTick: number;
  readonly maxEvents: number;
  readonly maxTelemetrySamples: number;
  readonly snapshotHistory: number;
  readonly networkRole: NetworkRole;
  readonly quality: QualityTier;
  readonly frameBudgets: readonly FrameBudget[];
}

export interface WorldSnapshot {
  readonly version: typeof R41_VERSION;
  readonly tick: number;
  readonly revision: number;
  readonly seed: number;
  readonly entities: readonly Entity[];
  readonly flags: Readonly<Record<string, boolean>>;
  readonly values: Readonly<Record<string, number>>;
  readonly checksum: number;
}

export interface SaveEnvelope {
  readonly schema: typeof R41_VERSION;
  readonly slot: string;
  readonly createdAtMs: number;
  readonly world: WorldSnapshot;
  readonly metadata: Readonly<Record<string, string>>;
  readonly checksum: number;
}

export interface SystemContext {
  readonly tick: number;
  readonly deltaSeconds: number;
  readonly entities: readonly Entity[];
  readonly inputs: readonly InputFrame[];
  readonly commands: readonly CommandEnvelope[];
}

export interface SystemDefinition {
  readonly id: string;
  readonly class: WorkClass;
  readonly priority: Priority;
  readonly order: number;
  readonly run: (context: SystemContext) => void | Promise<void>;
}

export interface RuntimeSnapshot {
  readonly mode: RuntimeMode;
  readonly tick: number;
  readonly revision: number;
  readonly entities: number;
  readonly activeEntities: number;
  readonly queuedCommands: number;
  readonly queuedWork: number;
  readonly residentAssetBytes: number;
  readonly network: NetworkMetrics;
  readonly render: RenderPlan;
  readonly telemetry: TelemetrySample;
  readonly health: HealthReport;
  readonly checksum: number;
}

export interface Migration<T> {
  readonly from: number;
  readonly to: number;
  readonly migrate: (input: unknown) => T;
}

export function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, min)));
}

export function vec2(x = 0, y = 0): Vec2 {
  return Object.freeze({ x: finite(x), y: finite(y) });
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return Object.freeze({ x: finite(x), y: finite(y), z: finite(z) });
}

export function quat(x = 0, y = 0, z = 0, w = 1): Quat {
  return Object.freeze({ x: finite(x), y: finite(y), z: finite(z), w: finite(w) });
}

export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + stableStringify(record[key])).join(',') + '}';
  }
  return JSON.stringify(String(value));
}

export function stableHash(value: unknown): number {
  const source = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function cloneEntity(entity: Entity): Entity {
  return Object.freeze({
    ...entity,
    transform: Object.freeze({
      position: vec3(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z),
      rotation: quat(entity.transform.rotation.x, entity.transform.rotation.y, entity.transform.rotation.z, entity.transform.rotation.w),
      scale: vec3(entity.transform.scale.x, entity.transform.scale.y, entity.transform.scale.z),
    }),
    velocity: vec3(entity.velocity.x, entity.velocity.y, entity.velocity.z),
    tags: Object.freeze([...entity.tags]),
    data: Object.freeze({ ...entity.data }),
  });
}

export function cloneNetworkEntity(entity: NetworkEntity): NetworkEntity {
  return Object.freeze({
    id: entity.id,
    revision: Math.max(0, Math.trunc(entity.revision)),
    position: vec3(entity.position.x, entity.position.y, entity.position.z),
    velocity: vec3(entity.velocity.x, entity.velocity.y, entity.velocity.z),
    rotation: quat(entity.rotation.x, entity.rotation.y, entity.rotation.z, entity.rotation.w),
    health: clamp(entity.health, 0, 100),
    stamina: clamp(entity.stamina, 0, 100),
    flags: Math.trunc(entity.flags),
  });
}

export function nowMonotonic(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return 0;
}

export function cloneWorld(snapshot: WorldSnapshot): WorldSnapshot {
  return Object.freeze({
    ...snapshot,
    entities: Object.freeze(snapshot.entities.map(cloneEntity)),
    flags: Object.freeze({ ...snapshot.flags }),
    values: Object.freeze({ ...snapshot.values }),
  });
}
