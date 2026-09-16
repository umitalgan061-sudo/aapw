export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type EntityId = Brand<number, 'EntityId'>;
export type Tick = Brand<number, 'Tick'>;
export type FrameId = Brand<number, 'FrameId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type CommandId = Brand<string, 'CommandId'>;
export type SessionId = Brand<string, 'SessionId'>;

export const asEntityId = (value: number): EntityId => Math.max(0, Math.trunc(value)) as EntityId;
export const asTick = (value: number): Tick => Math.max(0, Math.trunc(value)) as Tick;
export const asFrameId = (value: number): FrameId => Math.max(0, Math.trunc(value)) as FrameId;
export const asAssetId = (value: string): AssetId => value.trim() as AssetId;
export const asCommandId = (value: string): CommandId => value.trim() as CommandId;
export const asSessionId = (value: string): SessionId => value.trim() as SessionId;

export type Vec2 = Readonly<{ x: number; y: number }>;
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type Quat = Readonly<{ x: number; y: number; z: number; w: number }>;
export type Aabb = Readonly<{ min: Vec3; max: Vec3 }>;
export type Sphere = Readonly<{ center: Vec3; radius: number }>;

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const quat = (x = 0, y = 0, z = 0, w = 1): Quat => ({ x, y, z, w });
export const add3 = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub3 = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale3 = (a: Vec3, scalar: number): Vec3 => vec3(a.x * scalar, a.y * scalar, a.z * scalar);
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const lengthSq3 = (a: Vec3): number => dot3(a, a);
export const length3 = (a: Vec3): number => Math.sqrt(lengthSq3(a));
export const normalize3 = (a: Vec3): Vec3 => {
  const length = length3(a);
  return length <= Number.EPSILON ? vec3() : scale3(a, 1 / length);
};
export const distanceSq3 = (a: Vec3, b: Vec3): number => lengthSq3(sub3(a, b));
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const saturate = (value: number): number => clamp(value, 0, 1);
export const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * saturate(alpha);

export type ComponentKind =
  | 'transform'
  | 'velocity'
  | 'health'
  | 'stamina'
  | 'animation'
  | 'combat'
  | 'ai'
  | 'inventory'
  | 'quest'
  | 'network'
  | 'render'
  | 'audio'
  | 'metadata';

export interface TransformComponent {
  readonly kind: 'transform';
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

export interface VelocityComponent {
  readonly kind: 'velocity';
  linear: Vec3;
  angular: Vec3;
  grounded: boolean;
}

export interface HealthComponent {
  readonly kind: 'health';
  current: number;
  maximum: number;
  invulnerableUntil: Tick;
}

export interface StaminaComponent {
  readonly kind: 'stamina';
  current: number;
  maximum: number;
  regenPerSecond: number;
  lockedUntil: Tick;
}

export interface AnimationComponent {
  readonly kind: 'animation';
  locomotion: string;
  upperBody: string;
  additiveWeight: number;
  playbackRate: number;
  normalizedTime: number;
}

export interface CombatComponent {
  readonly kind: 'combat';
  stance: 'neutral' | 'attack' | 'block' | 'stagger' | 'dead';
  poise: number;
  maximumPoise: number;
  cooldownUntil: Tick;
}

export interface AiComponent {
  readonly kind: 'ai';
  archetype: string;
  target: EntityId | null;
  alertness: number;
  thinkDebt: number;
}

export interface InventorySlot {
  readonly itemId: string;
  readonly quantity: number;
  readonly durability: number;
}

export interface InventoryComponent {
  readonly kind: 'inventory';
  capacity: number;
  slots: readonly InventorySlot[];
}

export interface QuestComponent {
  readonly kind: 'quest';
  activeQuestIds: readonly string[];
  completedQuestIds: readonly string[];
}

export interface NetworkComponent {
  readonly kind: 'network';
  authority: 'local' | 'remote' | 'server';
  sequence: number;
  lastAcknowledgedTick: Tick;
}

export interface RenderComponent {
  readonly kind: 'render';
  visible: boolean;
  lod: number;
  layer: number;
  assetId: AssetId | null;
}

export interface AudioComponent {
  readonly kind: 'audio';
  emitterEnabled: boolean;
  volume: number;
  maxDistance: number;
}

export interface MetadataComponent {
  readonly kind: 'metadata';
  tags: readonly string[];
  name: string;
}

export type Component =
  | TransformComponent
  | VelocityComponent
  | HealthComponent
  | StaminaComponent
  | AnimationComponent
  | CombatComponent
  | AiComponent
  | InventoryComponent
  | QuestComponent
  | NetworkComponent
  | RenderComponent
  | AudioComponent
  | MetadataComponent;

export type ComponentByKind<K extends ComponentKind> = Extract<Component, { kind: K }>;

export interface EntityRecord {
  readonly id: EntityId;
  readonly createdTick: Tick;
  readonly components: ReadonlyMap<ComponentKind, Component>;
  readonly active: boolean;
}

export type RuntimePhase = 'boot' | 'simulate' | 'present' | 'save' | 'shutdown';
export type RuntimeStatus = 'cold' | 'starting' | 'ready' | 'degraded' | 'stopped';

export interface RuntimeClock {
  readonly tick: Tick;
  readonly frame: FrameId;
  readonly fixedDeltaSeconds: number;
  readonly accumulatorSeconds: number;
}

export interface RuntimeBudget {
  simulationMs: number;
  presentationMs: number;
  assetMs: number;
  networkMs: number;
  persistenceMs: number;
  workerMs: number;
  totalMs: number;
  maxTotalMs: number;
}

export interface RuntimeCapabilities {
  readonly webgl2: boolean;
  readonly webgpu: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly offscreenCanvas: boolean;
  readonly gamepad: boolean;
  readonly touch: boolean;
  readonly hardwareConcurrency: number;
  readonly devicePixelRatio: number;
}

export interface RuntimeConfig {
  readonly tickRate: number;
  readonly maxCatchUpSteps: number;
  readonly maxEntities: number;
  readonly maxCommandsPerTick: number;
  readonly maxAssetBytes: number;
  readonly maxNetworkBytesPerTick: number;
  readonly saveIntervalTicks: number;
  readonly snapshotHistory: number;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = Object.freeze({
  tickRate: 60,
  maxCatchUpSteps: 4,
  maxEntities: 100_000,
  maxCommandsPerTick: 2_048,
  maxAssetBytes: 256 * 1024 * 1024,
  maxNetworkBytesPerTick: 256 * 1024,
  saveIntervalTicks: 600,
  snapshotHistory: 120,
});

export interface InputIntent {
  readonly tick: Tick;
  readonly entity: EntityId;
  readonly move: Vec2;
  readonly look: Vec2;
  readonly jump: boolean;
  readonly sprint: boolean;
  readonly dodge: boolean;
  readonly primary: boolean;
  readonly secondary: boolean;
  readonly interact: boolean;
}

export interface SimulationEvent {
  readonly type: string;
  readonly tick: Tick;
  readonly source: EntityId | null;
  readonly target: EntityId | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface CommandEnvelope<TPayload = unknown> {
  readonly id: CommandId;
  readonly tick: Tick;
  readonly issuer: EntityId | null;
  readonly type: string;
  readonly payload: TPayload;
}

export interface StateDigest {
  readonly tick: Tick;
  readonly entityCount: number;
  readonly commandCount: number;
  readonly eventCount: number;
  readonly checksum: string;
}

export interface RuntimeSnapshot {
  readonly version: 5;
  readonly tick: Tick;
  readonly digest: StateDigest;
  readonly entities: readonly EntityRecord[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface SaveEnvelope {
  readonly schema: 'aapw-runtime-v5';
  readonly version: 5;
  readonly createdAtEpochMs: number;
  readonly snapshot: RuntimeSnapshot;
  readonly checksum: string;
}

export interface NetworkSnapshot {
  readonly sequence: number;
  readonly tick: Tick;
  readonly authoritative: boolean;
  readonly entities: readonly EntityRecord[];
}

export interface NetworkDelta {
  readonly baseSequence: number;
  readonly sequence: number;
  readonly tick: Tick;
  readonly upserts: readonly EntityRecord[];
  readonly removes: readonly EntityId[];
}

export interface RenderPacket {
  readonly frame: FrameId;
  readonly tick: Tick;
  readonly cameraPosition: Vec3;
  readonly visibleEntities: readonly EntityId[];
  readonly opaqueDraws: number;
  readonly transparentDraws: number;
  readonly shadowCasters: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogRecord {
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly tick: Tick | null;
  readonly frame: FrameId | null;
  readonly fields: Readonly<Record<string, unknown>>;
}

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
};

export const fnv1a = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const checksumObject = (value: unknown): string => fnv1a(stableStringify(value));

export const isFiniteVec3 = (value: Vec3): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);

export const sanitizeVec3 = (value: Vec3): Vec3 =>
  vec3(Number.isFinite(value.x) ? value.x : 0, Number.isFinite(value.y) ? value.y : 0, Number.isFinite(value.z) ? value.z : 0);

export const isEntityId = (value: unknown): value is EntityId => typeof value === 'number' && Number.isInteger(value) && value >= 0;
export const isTick = (value: unknown): value is Tick => typeof value === 'number' && Number.isInteger(value) && value >= 0;

export interface VersionedSchema {
  readonly name: string;
  readonly version: number;
  readonly minReaderVersion: number;
  readonly minWriterVersion: number;
}

export const RUNTIME_SCHEMA: VersionedSchema = Object.freeze({
  name: 'aapw-runtime',
  version: 5,
  minReaderVersion: 5,
  minWriterVersion: 5,
});

export const compareTicks = (a: Tick, b: Tick): number => (a < b ? -1 : a > b ? 1 : 0);
export const tickDistance = (from: Tick, to: Tick): number => Math.abs(Number(to) - Number(from));
export const nextTick = (tick: Tick): Tick => asTick(Number(tick) + 1);

export const copyVec3 = (value: Vec3): Vec3 => vec3(value.x, value.y, value.z);
export const copyQuat = (value: Quat): Quat => quat(value.x, value.y, value.z, value.w);

export const cloneComponent = <T extends Component>(component: T): T => {
  if (component.kind === 'transform') {
    return { ...component, position: copyVec3(component.position), rotation: copyQuat(component.rotation), scale: copyVec3(component.scale) } as T;
  }
  if (component.kind === 'velocity') return { ...component, linear: copyVec3(component.linear), angular: copyVec3(component.angular) } as T;
  if (component.kind === 'inventory') return { ...component, slots: component.slots.map((slot) => ({ ...slot })) } as T;
  if (component.kind === 'quest') return { ...component, activeQuestIds: [...component.activeQuestIds], completedQuestIds: [...component.completedQuestIds] } as T;
  if (component.kind === 'metadata') return { ...component, tags: [...component.tags] } as T;
  return { ...component } as T;
};

export const cloneEntity = (entity: EntityRecord): EntityRecord => {
  const components = new Map<ComponentKind, Component>();
  for (const [kind, component] of entity.components) components.set(kind, cloneComponent(component));
  return { ...entity, components };
};

export const mergeEntity = (base: EntityRecord, patch: Partial<EntityRecord>): EntityRecord => ({
  ...base,
  ...patch,
  id: base.id,
  components: patch.components ?? base.components,
});
