export type PortResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PortError };

export interface PortError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export interface TimePort {
  nowMs(): number;
  deltaMs(): number;
  frame(): number;
}

export interface FixedClockPort extends TimePort {
  advance(deltaMs: number): void;
  reset(frame?: number, nowMs?: number): void;
}

export interface EventEnvelope<TType extends string, TPayload> {
  readonly type: TType;
  readonly frame: number;
  readonly atMs: number;
  readonly payload: TPayload;
}

export interface EventPort<TMap extends object> {
  publish<TKey extends keyof TMap & string>(
    event: EventEnvelope<TKey, TMap[TKey]>,
  ): void;
  subscribe<TKey extends keyof TMap & string>(
    type: TKey,
    handler: (event: EventEnvelope<TKey, TMap[TKey]>) => void,
  ): () => void;
  clear(): void;
}

export interface InputPort {
  snapshot(): readonly InputSample[];
  consume(): readonly InputSample[];
  setEnabled(enabled: boolean): void;
}

export interface InputSample {
  readonly action: string;
  readonly value: number;
  readonly source: 'keyboard' | 'pointer' | 'touch' | 'gamepad' | 'virtual';
  readonly code?: string;
  readonly atMs: number;
}

export interface WorldQueryPort {
  terrainHeight(x: number, z: number): number;
  waterLevel(): number;
  isWalkable(x: number, z: number, radius: number): boolean;
  nearestPoint(x: number, z: number, maxDistance: number): WorldPoint | null;
}

export interface WorldPoint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly biome: string;
}

export interface WorldMutationPort {
  setMarker(marker: WorldMarker): PortResult<void>;
  removeMarker(id: string): PortResult<void>;
  listMarkers(): readonly WorldMarker[];
}

export interface WorldMarker {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: string;
  readonly tags: readonly string[];
}

export interface PhysicsPort {
  integrate(body: PhysicsBody, input: PhysicsInput, deltaMs: number): PhysicsBody;
  sweep(body: PhysicsBody, from: WorldPoint, to: WorldPoint): PhysicsSweepResult;
}

export interface PhysicsBody {
  readonly id: string;
  readonly position: WorldPoint;
  readonly velocity: Vector3Like;
  readonly acceleration: Vector3Like;
  readonly radius: number;
  readonly grounded: boolean;
}

export interface PhysicsInput {
  readonly desiredVelocity: Vector3Like;
  readonly jump: boolean;
  readonly gravityScale: number;
  readonly friction: number;
}

export interface PhysicsSweepResult {
  readonly position: WorldPoint;
  readonly normal: Vector3Like;
  readonly collided: boolean;
  readonly toi: number;
}

export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AssetPort<T = unknown> {
  load<TValue = T>(key: string, signal?: AbortSignal): Promise<PortResult<TValue>>;
  retain(key: string): void;
  release(key: string): void;
  invalidate(key?: string): void;
  stats(): AssetStats;
}

export interface AssetStats {
  readonly requested: number;
  readonly ready: number;
  readonly failed: number;
  readonly residentBytes: number;
}

export interface PersistencePort<TState> {
  save(slot: number, state: TState): Promise<PortResult<PersistedState<TState>>>;
  load(slot: number): Promise<PortResult<PersistedState<TState> | null>>;
  remove(slot: number): Promise<PortResult<void>>;
  slots(): Promise<readonly SaveSlotRecord[]>;
}

export interface PersistedState<TState> {
  readonly slot: number;
  readonly schema: string;
  readonly version: number;
  readonly checksum: string;
  readonly savedAtMs: number;
  readonly state: TState;
}

export interface SaveSlotRecord {
  readonly slot: number;
  readonly schema: string;
  readonly version: number;
  readonly checksum: string;
  readonly savedAtMs: number;
}

export interface NetworkTransportPort {
  send(message: Uint8Array): PortResult<void>;
  readonly ready: boolean;
  readonly bufferedAmount: number;
  close(reason?: string): void;
}

export interface NetworkCodec<TMessage> {
  encode(message: TMessage): Uint8Array;
  decode(bytes: Uint8Array): PortResult<TMessage>;
}

export interface NetworkClockPort {
  nowTick(): number;
}

export interface RenderPort<TPacket = unknown> {
  submit(packet: TPacket): void;
  resize(width: number, height: number, dpr: number): void;
  recover(): Promise<PortResult<void>>;
  stats(): RenderStats;
}

export interface RenderStats {
  readonly backend: 'webgpu' | 'webgl2' | 'headless';
  readonly drawCalls: number;
  readonly triangles: number;
  readonly frameMs: number;
  readonly gpuMs: number | null;
  readonly memoryBytes: number;
}

export interface WorkerPort<TRequest, TResponse> {
  request(request: TRequest, signal?: AbortSignal): Promise<PortResult<TResponse>>;
  cancel(requestId: string): void;
  close(): void;
  stats(): WorkerStats;
}

export interface WorkerStats {
  readonly queued: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}

export interface LoggerPort {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface SecurityPort {
  sanitizeId(value: string): string;
  validateText(value: string, maxLength: number): PortResult<string>;
  validatePayload(bytes: Uint8Array, maxBytes: number): PortResult<void>;
  acceptRate(key: string, nowMs: number): boolean;
}

export interface RuntimeDiagnosticsPort {
  mark(name: string, value: number): void;
  increment(name: string, delta?: number): void;
  snapshot(): readonly DiagnosticSample[];
}

export interface DiagnosticSample {
  readonly name: string;
  readonly value: number;
}

export interface RuntimePolicyPort {
  qualityTier(): 'minimal' | 'balanced' | 'high' | 'ultra';
  maxSimulationMs(): number;
  maxStreamingMs(): number;
  maxWorkerTasks(): number;
  shouldThrottle(domain: 'simulation' | 'rendering' | 'streaming' | 'network'): boolean;
}

export interface RuntimeServiceBundle {
  readonly clock: FixedClockPort;
  readonly input: InputPort;
  readonly world: WorldQueryPort;
  readonly worldMutation: WorldMutationPort;
  readonly physics: PhysicsPort;
  readonly assets: AssetPort;
  readonly persistence: PersistencePort<unknown>;
  readonly transport: NetworkTransportPort;
  readonly renderer: RenderPort;
  readonly worker: WorkerPort<unknown, unknown>;
  readonly logger: LoggerPort;
  readonly security: SecurityPort;
  readonly diagnostics: RuntimeDiagnosticsPort;
  readonly policy: RuntimePolicyPort;
}

export class DeterministicFixedClock implements FixedClockPort {
  #now = 0;
  #delta = 0;
  #frame = 0;

  constructor(initialNowMs = 0, initialFrame = 0) {
    this.#now = Number.isFinite(initialNowMs) ? Math.max(0, initialNowMs) : 0;
    this.#frame = Number.isInteger(initialFrame) ? Math.max(0, initialFrame) : 0;
  }

  nowMs(): number {
    return this.#now;
  }

  deltaMs(): number {
    return this.#delta;
  }

  frame(): number {
    return this.#frame;
  }

  advance(deltaMs: number): void {
    const safeDelta = Number.isFinite(deltaMs) ? Math.min(Math.max(deltaMs, 0), 250) : 0;
    this.#delta = safeDelta;
    this.#now += safeDelta;
    this.#frame += 1;
  }

  reset(frame = 0, nowMs = 0): void {
    this.#frame = Number.isInteger(frame) ? Math.max(0, frame) : 0;
    this.#now = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
    this.#delta = 0;
  }
}

export class TypedEventBus<TMap extends object> implements EventPort<TMap> {
  readonly #handlers = new Map<string, Set<(event: EventEnvelope<string, unknown>) => void>>();

  publish<TKey extends keyof TMap & string>(event: EventEnvelope<TKey, TMap[TKey]>): void {
    const handlers = this.#handlers.get(event.type);
    if (!handlers) return;
    for (const handler of [...handlers]) handler(event as EventEnvelope<string, unknown>);
  }

  subscribe<TKey extends keyof TMap & string>(
    type: TKey,
    handler: (event: EventEnvelope<TKey, TMap[TKey]>) => void,
  ): () => void {
    const bucket = this.#handlers.get(type) ?? new Set();
    const wrapped = handler as unknown as (event: EventEnvelope<string, unknown>) => void;
    bucket.add(wrapped);
    this.#handlers.set(type, bucket);
    return () => {
      bucket.delete(wrapped);
      if (bucket.size === 0) this.#handlers.delete(type);
    };
  }

  clear(): void {
    this.#handlers.clear();
  }
}

export class MemoryLogger implements LoggerPort {
  readonly entries: { readonly level: string; readonly message: string; readonly data?: unknown }[] = [];
  readonly #maxEntries: number;

  constructor(maxEntries = 256) {
    this.#maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  debug(message: string, data?: unknown): void { this.#write('debug', message, data); }
  info(message: string, data?: unknown): void { this.#write('info', message, data); }
  warn(message: string, data?: unknown): void { this.#write('warn', message, data); }
  error(message: string, data?: unknown): void { this.#write('error', message, data); }

  #write(level: string, message: string, data?: unknown): void {
    this.entries.push({ level, message, data });
    while (this.entries.length > this.#maxEntries) this.entries.shift();
  }
}

export function ok<T>(value: T): PortResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: string, message: string, retryable = false): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}
