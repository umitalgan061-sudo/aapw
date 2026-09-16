import type {
  Backend,
  DeviceCapabilities,
  Failure,
  QualityTier,
  Result,
  RuntimeBudgets,
  RuntimeEventMap,
  RuntimeHealth,
  RuntimeMode,
  RuntimeState,
  Tick,
  WorldId,
} from './platform.js';

export class TypedEventBus<Events extends object> {
  #listeners = new Map<keyof Events, Set<(payload: unknown) => void>>();

  on<K extends keyof Events>(name: K, listener: (payload: Events[K]) => void): () => void {
    const set = this.#listeners.get(name) ?? new Set<(payload: unknown) => void>();
    const entry = listener as (payload: unknown) => void;
    set.add(entry);
    this.#listeners.set(name, set);
    return () => set.delete(entry);
  }

  once<K extends keyof Events>(name: K, listener: (payload: Events[K]) => void): () => void {
    let unsubscribe: (() => void) | undefined;
    const wrapped = (payload: Events[K]) => {
      unsubscribe?.();
      listener(payload);
    };
    unsubscribe = this.on(name, wrapped);
    return unsubscribe;
  }

  emit<K extends keyof Events>(name: K, payload: Events[K]): void {
    const set = this.#listeners.get(name);
    if (!set) return;
    for (const listener of [...set]) listener(payload);
  }

  clear<K extends keyof Events>(name?: K): void {
    if (name === undefined) this.#listeners.clear();
    else this.#listeners.delete(name);
  }

  count<K extends keyof Events>(name: K): number {
    return this.#listeners.get(name)?.size ?? 0;
  }
}

export type RuntimeBus = TypedEventBus<RuntimeEventMap>;

export interface ClockSnapshot {
  readonly nowMs: number;
  readonly tick: Tick;
  readonly deltaMs: number;
  readonly accumulatorMs: number;
}

export interface ClockConfig {
  readonly fixedStepMs: number;
  readonly maxDeltaMs: number;
  readonly maxCatchUpSteps: number;
}

export class FixedStepClock {
  readonly #config: ClockConfig;
  #lastMs = 0;
  #accumulatorMs = 0;
  #tick = 0 as Tick;

  constructor(config: Partial<ClockConfig> = {}) {
    this.#config = {
      fixedStepMs: Math.max(1, config.fixedStepMs ?? 1000 / 60),
      maxDeltaMs: Math.max(1, config.maxDeltaMs ?? 250),
      maxCatchUpSteps: Math.max(1, Math.floor(config.maxCatchUpSteps ?? 6)),
    };
  }

  reset(nowMs: number, tick: Tick = 0 as Tick): void {
    this.#lastMs = nowMs;
    this.#accumulatorMs = 0;
    this.#tick = tick;
  }

  advance(nowMs: number, step: (deltaMs: number, tick: Tick) => void): ClockSnapshot {
    if (!Number.isFinite(nowMs)) throw new RangeError('Clock time must be finite');
    if (this.#lastMs === 0) this.#lastMs = nowMs;
    const deltaMs = Math.min(this.#config.maxDeltaMs, Math.max(0, nowMs - this.#lastMs));
    this.#lastMs = nowMs;
    this.#accumulatorMs += deltaMs;
    let steps = 0;
    while (this.#accumulatorMs >= this.#config.fixedStepMs && steps < this.#config.maxCatchUpSteps) {
      this.#tick = (Number(this.#tick) + 1) as Tick;
      step(this.#config.fixedStepMs, this.#tick);
      this.#accumulatorMs -= this.#config.fixedStepMs;
      steps += 1;
    }
    if (steps === this.#config.maxCatchUpSteps && this.#accumulatorMs > this.#config.fixedStepMs) {
      this.#accumulatorMs = this.#config.fixedStepMs;
    }
    return { nowMs, tick: this.#tick, deltaMs, accumulatorMs: this.#accumulatorMs };
  }
}

export interface RuntimeFactoryOptions {
  readonly worldId: WorldId;
  readonly mode: RuntimeMode;
  readonly backend: Backend;
  readonly quality: QualityTier;
  readonly capabilities: DeviceCapabilities;
  readonly budgets: RuntimeBudgets;
}

export function createRuntimeState(options: RuntimeFactoryOptions): RuntimeState {
  return Object.freeze({
    worldId: options.worldId,
    tick: 0 as Tick,
    mode: options.mode,
    backend: options.backend,
    quality: options.quality,
    budgets: Object.freeze({ ...options.budgets }),
    capabilities: Object.freeze({ ...options.capabilities }),
  });
}

export function evolveTick(state: RuntimeState, tick: Tick): RuntimeState {
  if (Number(tick) < Number(state.tick)) throw new RangeError('Runtime tick cannot move backwards');
  return { ...state, tick };
}

export function normalizeFailure(error: unknown, context: Failure['context'] = {}): Failure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: error instanceof DOMException ? error.name : 'RUNTIME_FAILURE',
    message,
    cause: error,
    recoverable: true,
    timestamp: Date.now(),
    context,
  };
}

export async function settle<T>(operation: Promise<T>): Promise<Result<T, Failure>> {
  try {
    return { ok: true, value: await operation };
  } catch (error) {
    return { ok: false, error: normalizeFailure(error) };
  }
}

export function summarizeHealth(state: RuntimeState, health: RuntimeHealth): string {
  return [
    `backend=${state.backend}`,
    `quality=${state.quality}`,
    `frame=${health.frameTimeMs.toFixed(2)}ms`,
    `gpuMemory=${health.gpuMemoryBytes}`,
    `assetQueue=${health.assetQueueDepth}`,
    `recovery=${health.recoveredDeviceCount}`,
  ].join(' ');
}
