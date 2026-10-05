/**
 * AAPW R42 canonical TypeScript runtime contracts.
 * Production TypeScript owner. No ambient randomness or wall-clock dependency.
 */

export const R42_VERSION = 42 as const;

export type RuntimeMode =
  | 'booting'
  | 'loading'
  | 'running'
  | 'paused'
  | 'degraded'
  | 'recovering'
  | 'faulted'
  | 'stopped'
  | 'disposed';

export type QualityTier = 'minimal' | 'low' | 'balanced' | 'high' | 'ultra';
export type RenderBackend = 'webgpu' | 'webgl2' | 'headless';
export type InputSource = 'keyboard' | 'mouse' | 'gamepad' | 'touch' | 'mixed' | 'replay';
export type NetworkMode = 'offline' | 'client' | 'host' | 'server';
export type Priority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type WorkClass =
  | 'simulation'
  | 'gameplay'
  | 'streaming'
  | 'network'
  | 'render'
  | 'assets'
  | 'persistence'
  | 'telemetry'
  | 'background';

export type EntityKind =
  | 'player'
  | 'npc'
  | 'animal'
  | 'creature'
  | 'dragon'
  | 'vehicle'
  | 'structure'
  | 'prop'
  | 'effect'
  | 'system';

export type ActionKind =
  | 'move'
  | 'look'
  | 'jump'
  | 'sprint'
  | 'guard'
  | 'attack'
  | 'dodge'
  | 'interact'
  | 'equip'
  | 'use'
  | 'teleport'
  | 'emote'
  | 'pause'
  | 'resume'
  | 'custom';

export type ComponentName =
  | 'transform'
  | 'velocity'
  | 'health'
  | 'stamina'
  | 'combat'
  | 'inventory'
  | 'navigation'
  | 'render'
  | 'network'
  | 'metadata';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Transform {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
}

export interface Velocity {
  readonly linear: Vec3;
  readonly angular: Vec3;
}

export interface CombatState {
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly poise: number;
  readonly maxPoise: number;
  readonly guarding: boolean;
  readonly attacking: boolean;
  readonly dodging: boolean;
  readonly invulnerable: boolean;
  readonly cooldownUntilTick: number;
  readonly comboIndex: number;
  readonly revision: number;
}

export interface WorldEntity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly transform: Transform;
  readonly velocity: Velocity;
  readonly combat: CombatState;
  readonly lod: 0 | 1 | 2 | 3;
  readonly active: boolean;
  readonly revision: number;
  readonly tags: readonly string[];
  readonly components: Readonly<Record<ComponentName, boolean>>;
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
  readonly source: InputSource;
}

export interface ActionCommand {
  readonly id: string;
  readonly entityId: string;
  readonly tick: number;
  readonly sequence: number;
  readonly kind: ActionKind;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WorldPatch {
  readonly entityId: string;
  readonly revision: number;
  readonly changes: Readonly<Record<string, unknown>>;
}

export interface BudgetRule {
  readonly class: WorkClass;
  readonly budgetMs: number;
  readonly maxItems: number;
  readonly warningRatio: number;
  readonly criticalRatio: number;
}

export interface RuntimePolicy {
  readonly fixedStepSeconds: number;
  readonly maxCatchUpSteps: number;
  readonly maxFrameDeltaSeconds: number;
  readonly maxEntities: number;
  readonly maxCommandsPerTick: number;
  readonly maxEventsPerTick: number;
  readonly maxAssetBytes: number;
  readonly maxNetworkPacketBytes: number;
  readonly inputHistory: number;
  readonly snapshotHistory: number;
  readonly budgets: readonly BudgetRule[];
}

export interface RenderCapabilities {
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly maxTextureSize: number;
  readonly maxSamples: number;
  readonly compressedTextures: boolean;
  readonly devicePixelRatio: number;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
}

export interface RenderSettings {
  readonly backend: RenderBackend;
  readonly quality: QualityTier;
  readonly scale: number;
  readonly pixelRatio: number;
  readonly shadows: boolean;
  readonly bloom: boolean;
  readonly ssao: boolean;
  readonly instancing: boolean;
  readonly temporalHistory: boolean;
  readonly reason: string;
}

export interface FrameMetrics {
  readonly tick: number;
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly networkMs: number;
  readonly streamingMs: number;
  readonly assetsMs: number;
  readonly persistenceMs: number;
  readonly entityCount: number;
  readonly activeEntities: number;
  readonly memoryBytes: number;
  readonly quality: QualityTier;
  readonly backend: RenderBackend;
  readonly droppedSteps: number;
}

export interface NetworkEntityState {
  readonly id: string;
  readonly revision: number;
  readonly transform: Transform;
  readonly velocity: Velocity;
  readonly combat: CombatState;
  readonly flags: number;
}

export interface SnapshotPacket {
  readonly protocol: 42;
  readonly tick: number;
  readonly sequence: number;
  readonly acknowledgedInput: number;
  readonly entities: readonly NetworkEntityState[];
  readonly checksum: number;
}

export interface DeltaPacket {
  readonly protocol: 42;
  readonly baseTick: number;
  readonly targetTick: number;
  readonly sequence: number;
  readonly added: readonly NetworkEntityState[];
  readonly changed: readonly NetworkEntityState[];
  readonly removed: readonly string[];
  readonly checksum: number;
}

export interface AssetRecord {
  readonly id: string;
  readonly url: string;
  readonly state: 'declared' | 'queued' | 'loading' | 'ready' | 'failed' | 'evicted';
  readonly bytes: number;
  readonly refs: number;
  readonly priority: Priority;
  readonly dependencies: readonly string[];
  readonly lastUsedTick: number;
  readonly revision: number;
  readonly digest: string | null;
  readonly critical: boolean;
}

export interface AssetRequest {
  readonly id: string;
  readonly priority: Priority;
  readonly requestedTick: number;
  readonly signal?: AbortSignal;
}

export interface SaveEnvelope {
  readonly schema: 42;
  readonly slot: string;
  readonly revision: number;
  readonly tick: number;
  readonly world: readonly WorldEntity[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly checksum: number;
}

export interface WorkerTask<T = unknown> {
  readonly id: string;
  readonly class: WorkClass;
  readonly priority: Priority;
  readonly estimatedMs: number;
  readonly payload: T;
  readonly execute: (payload: T) => void | Promise<void>;
}

export interface WorkerResult {
  readonly id: string;
  readonly started: boolean;
  readonly completed: boolean;
  readonly deferred: boolean;
  readonly failed: boolean;
  readonly elapsedMs: number;
  readonly reason: string | null;
}

export interface RuntimeEvent {
  readonly type:
    | 'runtime.mode'
    | 'runtime.tick'
    | 'entity.spawn'
    | 'entity.patch'
    | 'entity.remove'
    | 'command.accepted'
    | 'command.rejected'
    | 'asset.state'
    | 'network.snapshot'
    | 'render.plan'
    | 'quality.changed'
    | 'fault';
  readonly tick: number;
  readonly sequence: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface RuntimeSnapshot {
  readonly version: 42;
  readonly mode: RuntimeMode;
  readonly tick: number;
  readonly revision: number;
  readonly entityCount: number;
  readonly activeEntities: number;
  readonly commandCount: number;
  readonly assetBytes: number;
  readonly render: RenderSettings;
  readonly metrics: FrameMetrics;
  readonly checksum: number;
}

export interface HealthReport {
  readonly ok: boolean;
  readonly score: number;
  readonly mode: RuntimeMode;
  readonly tick: number;
  readonly warnings: readonly string[];
  readonly critical: readonly string[];
  readonly sampleCount: number;
  readonly digest: number;
}

export interface RuntimePlugin {
  readonly id: string;
  readonly order: number;
  readonly enabled: boolean;
  readonly initialize?: (context: RuntimePluginContext) => void | Promise<void>;
  readonly beforeTick?: (context: RuntimePluginContext) => void | Promise<void>;
  readonly afterTick?: (context: RuntimePluginContext) => void | Promise<void>;
  readonly dispose?: (context: RuntimePluginContext) => void | Promise<void>;
}

export interface RuntimePluginContext {
  readonly tick: number;
  readonly deltaSeconds: number;
  readonly mode: RuntimeMode;
  readonly snapshot: RuntimeSnapshot;
}

export interface RuntimeConfig {
  readonly seed: number;
  readonly network: NetworkMode;
  readonly quality: QualityTier;
  readonly policy: RuntimePolicy;
  readonly capabilities: RenderCapabilities;
}

export interface ClockSnapshot {
  readonly tick: number;
  readonly elapsedSeconds: number;
  readonly accumulatorSeconds: number;
  readonly fixedStepSeconds: number;
  readonly timeScale: number;
  readonly droppedSteps: number;
  readonly paused: boolean;
}

export interface RateLimitState {
  readonly key: string;
  readonly windowStartTick: number;
  readonly count: number;
  readonly max: number;
}

export function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function safeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return fallback;
  return value;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, min)));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
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

export function normalize2(value: Vec2): Vec2 {
  const magnitude = Math.hypot(value.x, value.y);
  return magnitude <= Number.EPSILON ? vec2() : vec2(value.x / magnitude, value.y / magnitude);
}

export function normalize3(value: Vec3): Vec3 {
  const magnitude = Math.hypot(value.x, value.y, value.z);
  return magnitude <= Number.EPSILON ? vec3() : vec3(value.x / magnitude, value.y / magnitude, value.z / magnitude);
}

export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return '{' + Object.keys(objectValue).sort().map(key => JSON.stringify(key) + ':' + stableStringify(objectValue[key])).join(',') + '}';
  }
  return JSON.stringify(String(value));
}

export function hashValue(value: unknown): number {
  const source = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.filter(value => value.length > 0))].sort());
}

export function cloneVec3(value: Vec3): Vec3 {
  return vec3(value.x, value.y, value.z);
}

export function cloneQuat(value: Quat): Quat {
  return quat(value.x, value.y, value.z, value.w);
}

export function cloneTransform(value: Transform): Transform {
  return deepFreeze({
    position: cloneVec3(value.position),
    rotation: cloneQuat(value.rotation),
    scale: cloneVec3(value.scale),
  });
}

export function cloneVelocity(value: Velocity): Velocity {
  return deepFreeze({
    linear: cloneVec3(value.linear),
    angular: cloneVec3(value.angular),
  });
}

export function cloneCombat(value: CombatState): CombatState {
  return deepFreeze({ ...value });
}

export function cloneEntity(value: WorldEntity): WorldEntity {
  return deepFreeze({
    ...value,
    transform: cloneTransform(value.transform),
    velocity: cloneVelocity(value.velocity),
    combat: cloneCombat(value.combat),
    tags: [...value.tags],
    components: { ...value.components },
    data: { ...value.data },
  });
}
