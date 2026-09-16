import { DeterministicSchedulerV5, type TaskV5 } from './deterministicSchedulerV5';
import { AssetDependencyGraphV5 } from './assetGraphV5';
import { NetworkSessionV5 } from './networkSessionV5';
import { InputPipelineV5, type InputActionV5 } from './inputPipelineV5';
import { PerformanceControllerV5 } from './performanceControllerV5';
import { PersistenceRuntimeV5, RecoveryCoordinatorV5, type PersistenceAdapterV5, type RecoveryDomainHandlerV5 } from './persistenceRecoveryV5';
import { VisibilityPipelineV5, type VisibilityCandidateV5 } from './renderVisibilityV5';
import { type RuntimeEventV5, type RuntimeHealthV5, type RuntimePhaseV5, type RuntimeSnapshotV5, type EntityStateV5, type RuntimeIdV5, runtimeIdV5, tickV5, sequenceV5, createEntityStateV5, checksumV5, type TickV5, type BudgetUsageV5, defaultBudgetV5, type QualityV5 } from './runtimeContractV5';

export interface RuntimeOrchestratorOptionsV5<T> {
  readonly runtimeId?: string;
  readonly brand?: 'desktop' | 'tablet' | 'mobile' | 'constrained' | 'headless';
  readonly fixedDeltaSeconds?: number;
  readonly maxEntities?: number;
  readonly persistence?: { readonly schema: string; readonly version: number; readonly adapter: PersistenceAdapterV5<T>; };
  readonly now?: () => number;
}
export interface RuntimeEventHandlerV5<T = unknown> { readonly type: string; readonly handle: (event: RuntimeEventV5<T>) => void; }
export interface RuntimeOrchestratorMetricsV5 { readonly tick: TickV5; readonly frames: number; readonly entityCount: number; readonly events: number; readonly errors: number; readonly recoveries: number; readonly phase: RuntimePhaseV5; readonly quality: QualityV5; readonly network: ReturnType<NetworkSessionV5['metrics']>; readonly assets: ReturnType<AssetDependencyGraphV5['metrics']>; readonly budget: BudgetUsageV5; }

function safeNumber(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }

export class RuntimeOrchestratorV5<T = unknown> {
  readonly id: RuntimeIdV5;
  readonly scheduler: DeterministicSchedulerV5;
  readonly assets: AssetDependencyGraphV5;
  readonly network: NetworkSessionV5;
  readonly input: InputPipelineV5;
  readonly performance: PerformanceControllerV5;
  readonly visibility: VisibilityPipelineV5;
  readonly persistence: PersistenceRuntimeV5<T> | null;
  readonly recovery: RecoveryCoordinatorV5;
  readonly brand: RuntimeOrchestratorOptionsV5<T>['brand'];
  #now: () => number;
  #phase: RuntimePhaseV5 = 'created';
  #tick: TickV5 = tickV5(0);
  #sequence = sequenceV5(0);
  #frames = 0;
  #errors = 0;
  #recoveries = 0;
  #entities = new Map<number, EntityStateV5>();
  #handlers = new Map<string, RuntimeEventHandlerV5<unknown>>();
  #events: RuntimeEventV5<unknown>[] = [];
  #maxEntities: number;

  constructor(options: RuntimeOrchestratorOptionsV5<T> = {}) {
    this.id = runtimeIdV5(options.runtimeId ?? `aapw-v5-${Math.floor((options.now?.() ?? Date.now()) % 1_000_000_000)}`);
    this.brand = options.brand ?? 'desktop'; this.#now = options.now ?? (() => Date.now());
    this.scheduler = new DeterministicSchedulerV5({ fixedDeltaSeconds: options.fixedDeltaSeconds });
    this.assets = new AssetDependencyGraphV5(); this.network = new NetworkSessionV5({ now: this.#now }); this.input = new InputPipelineV5(); this.input.installDefaults();
    this.performance = new PerformanceControllerV5({ now: this.#now }); this.visibility = new VisibilityPipelineV5();
    this.persistence = options.persistence ? new PersistenceRuntimeV5(options.persistence) : null; this.recovery = new RecoveryCoordinatorV5({ now: this.#now });
    this.#maxEntities = Math.max(1, Math.min(1_000_000, Math.floor(options.maxEntities ?? 100_000)));
  }

  phase(): RuntimePhaseV5 { return this.#phase; }
  tick(): TickV5 { return this.#tick; }
  entityCount(): number { return this.#entities.size; }
  frames(): number { return this.#frames; }
  errors(): number { return this.#errors; }

  start(): boolean { if (this.#phase !== 'created' && this.#phase !== 'stopped') return false; this.#phase = 'running'; this.#emit('runtime.start', {}); return true; }
  pause(): boolean { if (this.#phase !== 'running') return false; this.#phase = 'paused'; this.#emit('runtime.pause', {}); return true; }
  resume(): boolean { if (this.#phase !== 'paused' && this.#phase !== 'recovering') return false; this.#phase = 'running'; this.#emit('runtime.resume', {}); return true; }
  stop(): boolean { if (this.#phase === 'stopped') return false; this.#phase = 'stopped'; this.scheduler.stop(); this.#emit('runtime.stop', {}); return true; }
  fail(message = 'runtime failure'): void { this.#errors += 1; this.#phase = 'failed'; this.#emit('runtime.fail', { message: message.slice(0, 256) }); }

  spawn(initial: Partial<EntityStateV5> = {}): number {
    if (this.#entities.size >= this.#maxEntities) throw new Error('Entity limit reached');
    const id = Number(initial.id ?? (this.#entities.size + 1)); const entity = createEntityStateV5(id as EntityStateV5['id'], initial); this.#entities.set(id, entity); this.#emit('entity.spawn', { id }); return id;
  }
  despawn(id: number): boolean { const removed = this.#entities.delete(id); if (removed) this.#emit('entity.despawn', { id }); return removed; }
  entity(id: number): EntityStateV5 | null { return this.#entities.get(id) ?? null; }
  entities(): readonly EntityStateV5[] { return Object.freeze([...this.#entities.values()].sort((a, b) => a.id - b.id)); }

  registerTask(task: TaskV5): void { const result = this.scheduler.register(task); if (!result.ok) throw new Error(result.error?.message ?? 'Task registration failed'); }
  registerEventHandler(handler: RuntimeEventHandlerV5<unknown>): void { if (this.#handlers.has(handler.type)) throw new Error(`Event handler already registered: ${handler.type}`); this.#handlers.set(handler.type, handler); }
  unregisterEventHandler(type: string): boolean { return this.#handlers.delete(type); }

  dispatchInput(action: InputActionV5, value = 1): void { const command = this.input.nextCommand(this.#tick, action, value); this.#emit('input.command', command); }

  frame(deltaSeconds = 1 / 60): RuntimeOrchestratorMetricsV5 {
    if (this.#phase !== 'running') return this.metrics();
    this.#tick = tickV5(this.#tick + 1); this.#frames += 1;
    try { this.scheduler.run(this.#tick, deltaSeconds); this.#simulate(deltaSeconds); } catch (cause) { this.#errors += 1; this.#emit('runtime.error', { message: cause instanceof Error ? cause.message : 'frame failure' }); }
    this.performance.sample({ frameMs: Math.max(0.1, deltaSeconds * 1000), cpuMs: 0, gpuMs: 0, drawCalls: this.#entities.size, triangles: this.#entities.size * 500, memoryBytes: this.#entities.size * 256, networkBytes: this.network.metrics().bytesSent + this.network.metrics().bytesReceived, assetBytes: this.assets.metrics().bytesInFlight });
    return this.metrics();
  }

  snapshot(): RuntimeSnapshotV5 { const entities = this.entities(); const payload = { runtimeId: this.id, tick: this.#tick, phase: this.#phase, brand: this.brand, quality: this.performance.quality(), entities }; return Object.freeze({ ...payload, sequence: this.#sequence, checksum: checksumV5(payload) }); }
  health(): RuntimeHealthV5 { const usage = this.performance.usage(); const score = Math.max(0, Math.min(100, 100 - usage.pressure * 45 - this.#errors * 3)); return Object.freeze({ score, phase: this.#phase, degraded: score < 75, errors: this.#errors, droppedFrames: Math.max(0, this.#frames - this.scheduler.metrics().executed), recoveryCount: this.#recoveries, pressure: usage.pressure }); }
  metrics(): RuntimeOrchestratorMetricsV5 { return Object.freeze({ tick: this.#tick, frames: this.#frames, entityCount: this.#entities.size, events: this.#events.length, errors: this.#errors, recoveries: this.#recoveries, phase: this.#phase, quality: this.performance.quality(), network: this.network.metrics(), assets: this.assets.metrics(), budget: this.performance.usage() }); }
  events(limit = 128): readonly RuntimeEventV5<unknown>[] { return Object.freeze(this.#events.slice(-Math.max(1, Math.min(4096, limit)))); }

  renderCandidates(): readonly VisibilityCandidateV5[] { return Object.freeze(this.entities().map((entity) => ({ id: entity.id, transform: entity.transform, bounds: { min: entity.transform.position, max: entity.transform.position, radius: 1 }, material: 'entity', lod: 0 as const, visible: entity.active, distance: 0, layer: 0, castShadow: true, transparent: false }))); }
  recoveryHandlers(): readonly string[] { return Object.freeze([]); }
  registerRecoveryHandler(handler: RecoveryDomainHandlerV5): void { this.recovery.register(handler); }
  async save(slot: number): Promise<OutcomeSaveV5> { if (!this.persistence) return { ok: false, message: 'Persistence is not configured' }; return this.persistence.save(slot, this.snapshot() as unknown as T, this.#tick); }
  async load(slot: number): Promise<OutcomeLoadV5<T>> { if (!this.persistence) return { ok: false, message: 'Persistence is not configured' }; const result = await this.persistence.load(slot); if (!result.ok || result.value === null) return result.ok ? { ok: true, value: null } : { ok: false, message: result.error?.message ?? 'load failed' }; return { ok: true, value: result.value }; }
  recover(reason = 'runtime-health'): boolean { this.#phase = 'recovering'; const plan = { reason, domains: ['input', 'simulation', 'assets', 'network', 'render', 'persistence'] as const, maxAttempts: 3, cooldownMs: 1000 }; const report = this.recovery.recover(plan, this.#tick); if (report.success) { this.#recoveries += 1; this.#phase = 'running'; this.#emit('runtime.recovered', report); return true; } this.#errors += 1; this.#phase = 'failed'; return false; }
  reset(): void { this.#phase = 'created'; this.#tick = tickV5(0); this.#sequence = sequenceV5(0); this.#frames = 0; this.#errors = 0; this.#recoveries = 0; this.#entities.clear(); this.#events.length = 0; this.scheduler.reset(); this.performance.reset(); this.network.clear(); this.assets.clear(); }

  #simulate(deltaSeconds: number): void { for (const [id, entity] of this.#entities) { const position = entity.transform.position; const velocity = entity.velocity; const next = { x: position.x + velocity.x * deltaSeconds, y: position.y + velocity.y * deltaSeconds, z: position.z + velocity.z * deltaSeconds }; this.#entities.set(id, Object.freeze({ ...entity, transform: Object.freeze({ ...entity.transform, position: next }), revision: entity.revision + 1 })); } }
  #emit(type: string, payload: unknown): void { this.#sequence = sequenceV5(this.#sequence + 1); const event: RuntimeEventV5<unknown> = Object.freeze({ type, tick: this.#tick, sequence: this.#sequence, payload }); this.#events.push(event); while (this.#events.length > 4096) this.#events.shift(); try { this.#handlers.get(type)?.handle(event); } catch { this.#errors += 1; } }
}

export interface OutcomeSaveV5 { readonly ok: boolean; readonly message?: string; readonly value?: unknown; readonly error?: unknown; }
export interface OutcomeLoadV5<T> { readonly ok: boolean; readonly value?: T | null; readonly message?: string; }

export function createV5Runtime<T = unknown>(options: RuntimeOrchestratorOptionsV5<T> = {}): RuntimeOrchestratorV5<T> { return new RuntimeOrchestratorV5(options); }
export function runtimeSummaryV5<T>(runtime: RuntimeOrchestratorV5<T>): Readonly<Record<string, unknown>> { return Object.freeze({ id: runtime.id, phase: runtime.phase(), tick: runtime.tick(), health: runtime.health(), metrics: runtime.metrics(), entityCount: runtime.entityCount() }); }
