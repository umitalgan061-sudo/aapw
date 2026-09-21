import type {
  Brand,
  ComponentType,
  EntityId,
  FrameContext,
  SimTimeMs,
  SystemId,
  Tick,
} from './coreTypes.ts';
import { COMPONENT_TYPE, ENTITY_ID, SIM_TIME_MS, SYSTEM_ID, TICK, clamp } from './coreTypes.ts';

export interface QueryFilter {
  readonly all?: readonly ComponentType[];
  readonly any?: readonly ComponentType[];
  readonly none?: readonly ComponentType[];
}

export interface ComponentStore<T extends object> {
  readonly type: ComponentType;
  has(entity: EntityId): boolean;
  get(entity: EntityId): T | undefined;
  set(entity: EntityId, value: T): void;
  remove(entity: EntityId): boolean;
  entries(): IterableIterator<readonly [EntityId, T]>;
  size(): number;
}

export interface EngineEventMap {
  'runtime/frame-begin': { readonly context: FrameContext };
  'runtime/frame-end': { readonly context: FrameContext; readonly elapsedMs: number };
  'runtime/error': { readonly code: string; readonly message: string; readonly recoverable: boolean };
  'entity/spawned': { readonly entity: EntityId };
  'entity/despawned': { readonly entity: EntityId };
  'world/phase-changed': { readonly from: string; readonly to: string; readonly tick: Tick };
  'render/backend-changed': { readonly backend: 'webgpu' | 'webgl2'; readonly reason: string };
  'render/degraded': { readonly fromTier: string; readonly toTier: string; readonly reason: string };
  'save/committed': { readonly slot: string; readonly revision: number; readonly checksum: string };
  'save/recovered': { readonly slot: string; readonly revision: number; readonly source: 'primary' | 'backup' };
}

type EventName = keyof EngineEventMap;
type Listener<K extends EventName> = (payload: EngineEventMap[K]) => void;

export interface EventSubscription {
  readonly event: EventName;
  readonly dispose: () => void;
}

export class TypedEventBus {
  private readonly listeners = new Map<EventName, Set<Listener<any>>>();

  on<K extends EventName>(event: K, listener: Listener<K>): EventSubscription {
    const bucket = this.listeners.get(event) ?? new Set<Listener<K>>();
    bucket.add(listener);
    this.listeners.set(event, bucket as Set<Listener<any>>);
    return { event, dispose: () => this.off(event, listener) };
  }

  once<K extends EventName>(event: K, listener: Listener<K>): EventSubscription {
    let subscription: EventSubscription;
    subscription = this.on(event, payload => {
      subscription.dispose();
      listener(payload);
    });
    return subscription;
  }

  off<K extends EventName>(event: K, listener: Listener<K>): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    bucket.delete(listener);
    if (bucket.size === 0) this.listeners.delete(event);
  }

  emit<K extends EventName>(event: K, payload: EngineEventMap[K]): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const listener of [...bucket]) listener(payload);
  }

  clear(): void {
    this.listeners.clear();
  }

  listenerCount(event?: EventName): number {
    if (event) return this.listeners.get(event)?.size ?? 0;
    let total = 0;
    for (const bucket of this.listeners.values()) total += bucket.size;
    return total;
  }
}

export interface SchedulerTask {
  readonly id: string;
  readonly system: SystemId;
  readonly phase: RuntimePhase;
  readonly priority: number;
  readonly budgetWeight: number;
  readonly run: (context: FrameContext) => void;
}

export const RUNTIME_PHASES = Object.freeze([
  'input', 'simulation', 'ai', 'streaming', 'animation', 'presentation', 'render', 'post',
] as const);
export type RuntimePhase = typeof RUNTIME_PHASES[number];

export interface SchedulerBudgetReport {
  readonly frameId: number;
  readonly budgetMs: number;
  readonly spentMs: number;
  readonly remainingMs: number;
  readonly executedTasks: number;
  readonly deferredTasks: number;
  readonly phaseSpans: Readonly<Record<RuntimePhase, number>>;
}

const phaseRank = new Map(RuntimePhaseList().map((value, index) => [value, index] as const));
function RuntimePhaseList(): readonly RuntimePhase[] { return RUNTIME_PHASES; }

export class DeterministicScheduler {
  private readonly tasks = new Map<string, SchedulerTask>();
  private readonly phaseSpans: Record<RuntimePhase, number> = Object.fromEntries(
    RUNTIME_PHASES.map(phase => [phase, 0]),
  ) as Record<RuntimePhase, number>;

  register(task: SchedulerTask): void {
    if (!task.id || this.tasks.has(task.id)) throw new Error(`scheduler task collision: ${task.id}`);
    this.tasks.set(task.id, Object.freeze({ ...task, priority: Math.trunc(task.priority) }));
  }

  unregister(id: string): boolean { return this.tasks.delete(id); }

  runFrame(context: FrameContext, measure: (run: () => void) => number = defaultMeasure): SchedulerBudgetReport {
    for (const phase of RUNTIME_PHASES) this.phaseSpans[phase] = 0;
    const ordered = [...this.tasks.values()].sort((a, b) =>
      (phaseRank.get(a.phase) ?? 99) - (phaseRank.get(b.phase) ?? 99)
      || b.priority - a.priority
      || a.id.localeCompare(b.id),
    );
    let spentMs = 0;
    let executedTasks = 0;
    let deferredTasks = 0;
    for (const task of ordered) {
      const remaining = Math.max(0, context.budgetMs - spentMs);
      if (remaining <= 0 && task.priority < 100) { deferredTasks += 1; continue; }
      const elapsed = clamp(measure(() => task.run(context)), 0, 1000);
      spentMs += elapsed;
      this.phaseSpans[task.phase] += elapsed;
      executedTasks += 1;
    }
    return Object.freeze({
      frameId: context.frameId,
      budgetMs: context.budgetMs,
      spentMs,
      remainingMs: Math.max(0, context.budgetMs - spentMs),
      executedTasks,
      deferredTasks,
      phaseSpans: Object.freeze({ ...this.phaseSpans }),
    });
  }
}

const defaultMeasure = (run: () => void): number => {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  run();
  const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return Math.max(0, end - start);
};

export interface RuntimeClockSnapshot {
  readonly tick: Tick;
  readonly simulationTimeMs: SimTimeMs;
  readonly deltaSeconds: number;
  readonly accumulatorMs: number;
}

export class FixedStepClock {
  private tickValue = 0;
  private simulationTimeMsValue = 0;
  private accumulatorMs = 0;
  private previousNow = 0;

  constructor(private readonly stepMs = 1000 / 60, private readonly maxCatchUpSteps = 4) {}

  reset(now = 0): void {
    this.tickValue = 0;
    this.simulationTimeMsValue = 0;
    this.accumulatorMs = 0;
    this.previousNow = now;
  }

  advance(now: number, update: (deltaSeconds: number, tick: Tick) => void): RuntimeClockSnapshot {
    if (!Number.isFinite(now)) return this.snapshot(0);
    const elapsed = clamp(now - this.previousNow, 0, this.stepMs * this.maxCatchUpSteps);
    this.previousNow = now;
    this.accumulatorMs += elapsed;
    let steps = 0;
    while (this.accumulatorMs >= this.stepMs && steps < this.maxCatchUpSteps) {
      this.accumulatorMs -= this.stepMs;
      this.tickValue += 1;
      this.simulationTimeMsValue += this.stepMs;
      update(this.stepMs / 1000, TICK(this.tickValue));
      steps += 1;
    }
    return this.snapshot(this.accumulatorMs / this.stepMs);
  }

  snapshot(alpha = 0): RuntimeClockSnapshot {
    return Object.freeze({
      tick: TICK(this.tickValue),
      simulationTimeMs: SIM_TIME_MS(this.simulationTimeMsValue),
      deltaSeconds: this.stepMs / 1000,
      accumulatorMs: this.accumulatorMs,
    });
  }
}

export const makeEntityId = (namespace: string, index: number): EntityId =>
  ENTITY_ID(`${namespace}:${Math.max(0, Math.trunc(index))}`);
export const makeComponentType = (value: string): ComponentType => COMPONENT_TYPE(value.trim().toLowerCase());
export const makeSystemId = (value: string): SystemId => SYSTEM_ID(value.trim());
export const makeTime = (ms: number): SimTimeMs => SIM_TIME_MS(Math.max(0, Math.round(ms)));

export type RuntimeMetricKind = 'counter' | 'gauge' | 'duration' | 'ratio';
export interface RuntimeMetric {
  readonly name: string;
  readonly kind: RuntimeMetricKind;
  readonly value: number;
  readonly sampleCount: number;
  readonly updatedAtTick: Tick;
}

export class RuntimeMetrics {
  private readonly values = new Map<string, RuntimeMetric>();

  set(name: string, kind: RuntimeMetricKind, value: number, tick: Tick): void {
    this.values.set(name, Object.freeze({
      name,
      kind,
      value: Number.isFinite(value) ? value : 0,
      sampleCount: (this.values.get(name)?.sampleCount ?? 0) + 1,
      updatedAtTick: tick,
    }));
  }

  increment(name: string, amount: number, tick: Tick): void {
    const current = this.values.get(name);
    this.set(name, 'counter', (current?.value ?? 0) + (Number.isFinite(amount) ? amount : 0), tick);
  }

  get(name: string): RuntimeMetric | undefined { return this.values.get(name); }
  snapshot(): readonly RuntimeMetric[] { return [...this.values.values()].sort((a, b) => a.name.localeCompare(b.name)); }
}

export type ReadonlyJson = null | boolean | number | string | readonly ReadonlyJson[] | { readonly [key: string]: ReadonlyJson };
export const toReadonlyJson = (value: unknown, depth = 0): ReadonlyJson => {
  if (depth > 12 || value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return Object.freeze(value.map(item => toReadonlyJson(item, depth + 1)));
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return Object.freeze(Object.fromEntries(entries.map(([key, item]) => [key, toReadonlyJson(item, depth + 1)])));
  }
  return null;
};

export type OpaqueRevision = Brand<number, 'OpaqueRevision'>;
export const REVISION = (value: number): OpaqueRevision => Math.max(0, Math.trunc(value)) as OpaqueRevision;
