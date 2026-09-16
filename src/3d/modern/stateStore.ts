import { platformEvents, type TypedEventBus } from './eventBus';
import type { EventMap, QualityTier } from './types';

export interface ModernState {
  quality: QualityTier;
  isLoading: boolean;
  loadProgress: number;
  phase: string;
  error: string | null;
  fps: number;
  frameMs: number;
  backend: EventMap['runtime:ready']['backend'];
  paused: boolean;
}

export type StateKey = keyof ModernState;

export interface StateChange<K extends StateKey = StateKey> {
  readonly key: K;
  readonly value: ModernState[K];
  readonly previous: ModernState[K];
}

const DEFAULT_STATE: ModernState = {
  quality: 'high',
  isLoading: true,
  loadProgress: 0,
  phase: 'boot',
  error: null,
  fps: 60,
  frameMs: 16.67,
  backend: 'headless',
  paused: false,
};

/**
 * Immutable-by-convention state container. Every mutation is validated, observable and reduced
 * to a single change record. This enables deterministic replay and makes accidental NaN state
 * propagation far harder than with an untyped object bag.
 */
export class ModernStateStore {
  #state: ModernState;
  #events: TypedEventBus<EventMap>;

  constructor(initial: Partial<ModernState> = {}, events = platformEvents) {
    this.#state = { ...DEFAULT_STATE, ...initial };
    this.#events = events;
    this.#validate(this.#state);
  }

  get<K extends StateKey>(key: K): ModernState[K] {
    return this.#state[key];
  }

  set<K extends StateKey>(key: K, value: ModernState[K]): boolean {
    this.#validateField(key, value);
    const previous = this.#state[key];
    if (Object.is(previous, value)) return false;
    this.#state = { ...this.#state, [key]: value };
    this.#emitChange({ key, value, previous });
    return true;
  }

  patch(next: Partial<ModernState>): number {
    let changed = 0;
    for (const key of Object.keys(next) as StateKey[]) {
      const value = next[key];
      if (value !== undefined && this.set(key, value)) changed += 1;
    }
    return changed;
  }

  update(mutator: (draft: ModernState) => void): number {
    const draft = { ...this.#state };
    mutator(draft);
    this.#validate(draft);
    return this.patch(draft);
  }

  snapshot(): Readonly<ModernState> {
    return Object.freeze({ ...this.#state });
  }

  reset(): void {
    this.patch(DEFAULT_STATE);
  }

  #emitChange<K extends StateKey>(change: StateChange<K>): void {
    this.#events.emit(`state:${String(change.key)}` as never, change as never);
  }

  #validate(state: ModernState): void {
    if (!Number.isFinite(state.loadProgress) || state.loadProgress < 0 || state.loadProgress > 1) {
      throw new RangeError('loadProgress must be a finite ratio in [0, 1]');
    }
    if (!Number.isFinite(state.fps) || state.fps < 0 || state.fps > 1000) {
      throw new RangeError('fps must be a finite value in [0, 1000]');
    }
    if (!Number.isFinite(state.frameMs) || state.frameMs < 0 || state.frameMs > 10000) {
      throw new RangeError('frameMs must be a finite value in [0, 10000]');
    }
  }

  #validateField<K extends StateKey>(key: K, value: ModernState[K]): void {
    if (key === 'loadProgress') {
      const v = value as number;
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new RangeError('invalid loadProgress');
    }
    if (key === 'fps' || key === 'frameMs') {
      const v = value as number;
      if (!Number.isFinite(v) || v < 0) throw new RangeError(`invalid ${String(key)}`);
    }
  }
}

export const modernState = new ModernStateStore();
