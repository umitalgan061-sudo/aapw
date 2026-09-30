export type EntityId = number & { readonly __entityId: unique symbol };
export type ComponentType<T> = symbol & { readonly __componentType: T };
export type Tick = number & { readonly __tick: unique symbol };
export type Revision = number & { readonly __revision: unique symbol };

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }
export interface Aabb { min: Vec3; max: Vec3 }
export interface Transform { position: Vec3; rotation: Quat; scale: Vec3 }

export interface SimulationConfig {
  tickRate: number;
  maxCatchUpTicks: number;
  maxFrameDeltaSeconds: number;
  deterministicSeed: number;
}

export interface RuntimeFrame {
  tick: Tick;
  deltaSeconds: number;
  alpha: number;
  simulatedTicks: number;
  droppedSeconds: number;
}

export interface InputFrame {
  tick: Tick;
  sequence: number;
  move: Vec2;
  look: Vec2;
  buttons: number;
  axes: readonly number[];
}

export interface CommandEnvelope<T = unknown> {
  id: string;
  tick: Tick;
  sequence: number;
  kind: string;
  payload: T;
  source: string;
  checksum: number;
}

export interface EventEnvelope<T = unknown> {
  id: string;
  tick: Tick;
  revision: Revision;
  kind: string;
  payload: T;
  source: string;
}

export interface SnapshotEntity {
  id: EntityId;
  mask: number;
  components: Record<string, unknown>;
}

export interface WorldSnapshot {
  tick: Tick;
  revision: Revision;
  entities: readonly SnapshotEntity[];
  checksum: number;
}

export interface RuntimeMetrics {
  frameTimeMs: number;
  simulationTimeMs: number;
  renderTimeMs: number;
  networkTimeMs: number;
  entityCount: number;
  activeSystems: number;
  pendingCommands: number;
  pendingResources: number;
  snapshotBytes: number;
}

export interface RuntimeHealth {
  score: number;
  status: 'healthy' | 'degraded' | 'critical';
  reasons: readonly string[];
  metrics: RuntimeMetrics;
}

export interface SystemContext {
  readonly tick: Tick;
  readonly deltaSeconds: number;
  readonly entities: EntityId[];
  emit<T>(kind: string, payload: T): void;
  dispatch<T>(kind: string, payload: T): void;
}

export type SystemPhase = 'input' | 'simulation' | 'presentation' | 'network' | 'persistence';
export type SystemFrequency = 'tick' | 'fixed-rate' | 'demand';

export interface SystemDefinition {
  id: string;
  phase: SystemPhase;
  frequency: SystemFrequency;
  priority: number;
  budgetMs: number;
  step(context: SystemContext): void;
}

export interface ResourceDescriptor {
  key: string;
  bytes: number;
  cost: number;
  tags: readonly string[];
  priority: number;
  evictable: boolean;
}

export interface ResourceState extends ResourceDescriptor {
  state: 'queued' | 'loading' | 'ready' | 'failed' | 'evicted';
  lastUsedTick: Tick;
  revision: Revision;
  error?: string;
}

export interface QueryShape {
  center: Vec3;
  radius: number;
  layer?: string;
  predicate?: (entity: EntityId) => boolean;
}

export interface NetworkPeer {
  id: string;
  ackTick: Tick;
  lastReceiveTick: Tick;
  inputLead: number;
  rttMs: number;
  packetLoss: number;
}

export interface NetworkPacket<T = unknown> {
  protocol: number;
  kind: string;
  sequence: number;
  tick: Tick;
  ack: number;
  payload: T;
  checksum: number;
}

export interface WorkerMessage<T = unknown> {
  channel: 'simulation' | 'streaming' | 'pathfinding' | 'asset';
  requestId: string;
  version: number;
  payload: T;
}

export interface WorkerResponse<T = unknown> extends WorkerMessage<T> {
  ok: boolean;
  error?: string;
}

export interface SaveHeader {
  magic: string;
  version: number;
  tick: Tick;
  revision: Revision;
  checksum: number;
}

export interface SaveEnvelope {
  header: SaveHeader;
  world: WorldSnapshot;
  metadata: Record<string, string | number | boolean>;
}

export interface LifecycleState {
  phase: 'cold' | 'booting' | 'ready' | 'running' | 'paused' | 'stopping' | 'stopped' | 'faulted';
  reason?: string;
}

export interface RuntimeFault {
  code: string;
  message: string;
  tick: Tick;
  recoverable: boolean;
  source: string;
}

export interface RuntimeEventMap {
  tickStarted: { tick: Tick; deltaSeconds: number };
  tickCompleted: { tick: Tick; durationMs: number };
  commandRejected: { kind: string; reason: string };
  resourceFailed: { key: string; reason: string };
  runtimeFault: RuntimeFault;
  lifecycleChanged: LifecycleState;
}

export function entityId(value: number): EntityId {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError('Entity ids must be positive integers');
  return value as EntityId;
}

export function tickValue(value: number): Tick {
  if (!Number.isInteger(value) || value < 0) throw new RangeError('Ticks must be non-negative integers');
  return value as Tick;
}

export function revisionValue(value: number): Revision {
  if (!Number.isInteger(value) || value < 0) throw new RangeError('Revisions must be non-negative integers');
  return value as Revision;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function quatIdentity(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function transformIdentity(): Transform {
  return { position: vec3(), rotation: quatIdentity(), scale: vec3(1, 1, 1) };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function saturate(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * saturate(t);
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  const s = saturate(t);
  return { x: lerp(a.x, b.x, s), y: lerp(a.y, b.y, s), z: lerp(a.z, b.z, s) };
}

export function distanceSquared(a: Vec3, b: Vec3): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSquared(a, b));
}

export function normalizeVec2(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y);
  if (length <= Number.EPSILON) return { x: 0, y: 0 };
  return { x: v.x / length, y: v.y / length };
}

export function normalizeVec3(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length <= Number.EPSILON) return { x: 0, y: 0, z: 0 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtractVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVec3(v: Vec3, scalar: number): Vec3 {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mixHash(seed: number, value: number): number {
  let hash = seed ^ value;
  hash = Math.imul(hash ^ (hash >>> 16), 2246822519);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489917);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function stableChecksum(value: unknown): number {
  const serialized = stableStringify(value);
  return hashString(serialized);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

export function createComponentType<T>(name: string): ComponentType<T> {
  return Symbol.for(`aapw.nextgen.component.${name}`) as ComponentType<T>;
}

export function cloneTransform(value: Transform): Transform {
  return {
    position: { ...value.position },
    rotation: { ...value.rotation },
    scale: { ...value.scale },
  };
}

export function cloneInputFrame(frame: InputFrame): InputFrame {
  return {
    ...frame,
    move: { ...frame.move },
    look: { ...frame.look },
    axes: [...frame.axes],
  };
}

export function isFiniteVec3(value: Vec3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

export function isValidSimulationConfig(config: SimulationConfig): boolean {
  return Number.isFinite(config.tickRate) && config.tickRate > 0
    && Number.isInteger(config.maxCatchUpTicks) && config.maxCatchUpTicks > 0
    && Number.isFinite(config.maxFrameDeltaSeconds) && config.maxFrameDeltaSeconds > 0
    && Number.isInteger(config.deterministicSeed);
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  tickRate: 60,
  maxCatchUpTicks: 8,
  maxFrameDeltaSeconds: 0.25,
  deterministicSeed: 0x51f15e,
};
