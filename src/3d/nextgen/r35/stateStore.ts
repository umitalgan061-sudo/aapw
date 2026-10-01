import type { R35RuntimeEvent } from './contracts';
import { R35_VERSION, type R35RuntimeSnapshot } from './contracts';

export interface StatePatch<T> {
  readonly label: string;
  readonly apply: (current: T) => T;
}

export interface StateRevision<T> {
  readonly revision: number;
  readonly state: T;
  readonly label: string;
  readonly tick: number;
  readonly checksum: string;
}

export interface StateSelector<T, S> {
  readonly key: string;
  readonly select: (state: T) => S;
  readonly equals?: (a: S, b: S) => boolean;
}

export interface StateSubscription<S> {
  readonly id: number;
  readonly selector: StateSelector<R35RuntimeSnapshot, S>;
  readonly listener: (value: S, previous: S) => void;
  previous: S;
}

export interface StateStoreOptions {
  readonly historyCapacity?: number;
  readonly eventCapacity?: number;
  readonly checksum?: (state: R35RuntimeSnapshot) => string;
}

function defaultChecksum(state: R35RuntimeSnapshot): string {
  const stable = JSON.stringify(state, Object.keys(state).sort());
  let hash = 2166136261;
  for (let i = 0; i < stable.length; i += 1) {
    hash ^= stable.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) deepFreeze(nested);
    }
  }
  return value;
}

function equalByObjectIs<T>(a: T, b: T): boolean {
  return Object.is(a, b);
}

export class R35StateStore {
  #state: R35RuntimeSnapshot;
  #revision = 0;
  #subscriptionSequence = 0;
  #history: StateRevision<R35RuntimeSnapshot>[] = [];
  #events: R35RuntimeEvent[] = [];
  #subscriptions = new Map<number, StateSubscription<unknown>>();
  #historyCapacity: number;
  #eventCapacity: number;
  #checksum: (state: R35RuntimeSnapshot) => string;
  #transactionDepth = 0;
  #pendingPatches: StatePatch<R35RuntimeSnapshot>[] = [];

  constructor(initialState: R35RuntimeSnapshot, options: StateStoreOptions = {}) {
    this.#historyCapacity = Math.max(1, options.historyCapacity ?? 240);
    this.#eventCapacity = Math.max(1, options.eventCapacity ?? 512);
    this.#checksum = options.checksum ?? defaultChecksum;
    this.#state = deepFreeze(structuredClone(initialState));
    this.recordRevision('initial');
  }

  get state(): R35RuntimeSnapshot {
    return this.#state;
  }

  get revision(): number {
    return this.#revision;
  }

  get historySize(): number {
    return this.#history.length;
  }

  get eventSize(): number {
    return this.#events.length;
  }

  read<S>(selector: StateSelector<R35RuntimeSnapshot, S>): S {
    return selector.select(this.#state);
  }

  subscribe<S>(
    selector: StateSelector<R35RuntimeSnapshot, S>,
    listener: (value: S, previous: S) => void,
  ): () => void {
    const id = ++this.#subscriptionSequence;
    this.#subscriptions.set(id, {
      id,
      selector,
      listener,
      previous: selector.select(this.#state),
    } as StateSubscription<unknown>);
    return () => this.#subscriptions.delete(id);
  }

  patch(patch: StatePatch<R35RuntimeSnapshot>): number {
    if (!patch.label) throw new Error('state patch label is required');
    if (this.#transactionDepth > 0) {
      this.#pendingPatches.push(patch);
      return this.#revision + this.#pendingPatches.length;
    }
    return this.applyPatches([patch]);
  }

  transaction(label: string, builder: (store: R35StateStore) => void): number {
    if (!label) throw new Error('transaction label is required');
    this.#transactionDepth += 1;
    try {
      builder(this);
    } finally {
      this.#transactionDepth -= 1;
    }
    if (this.#transactionDepth !== 0) return this.#revision;
    const patches = this.#pendingPatches.splice(0);
    if (patches.length === 0) return this.#revision;
    return this.applyPatches([{ label, apply: (state) => patches.reduce((current, item) => item.apply(current), state) }]);
  }

  appendEvent(event: R35RuntimeEvent): void {
    this.#events.push(structuredClone(event));
    if (this.#events.length > this.#eventCapacity) this.#events.splice(0, this.#events.length - this.#eventCapacity);
  }

  events(limit = this.#eventCapacity): readonly R35RuntimeEvent[] {
    const size = Math.max(0, Math.min(limit, this.#events.length));
    return this.#events.slice(this.#events.length - size).map((event) => structuredClone(event));
  }

  revisions(limit = this.#historyCapacity): readonly StateRevision<R35RuntimeSnapshot>[] {
    const size = Math.max(0, Math.min(limit, this.#history.length));
    return this.#history.slice(this.#history.length - size).map((entry) => ({
      ...entry,
      state: structuredClone(entry.state),
    }));
  }

  checkpoint(): StateRevision<R35RuntimeSnapshot> {
    const last = this.#history.at(-1);
    if (!last) throw new Error('state store has no checkpoint');
    return {
      ...last,
      state: structuredClone(last.state),
    };
  }

  restore(checkpoint: StateRevision<R35RuntimeSnapshot>, reason = 'restore'): number {
    if (checkpoint.state.version !== R35_VERSION) throw new Error('incompatible checkpoint version');
    const previous = this.#state;
    this.#state = deepFreeze(structuredClone(checkpoint.state));
    this.#revision += 1;
    this.recordRevision(reason);
    this.notify(previous);
    return this.#revision;
  }

  replace(next: R35RuntimeSnapshot, label = 'replace'): number {
    if (next.version !== R35_VERSION) throw new Error('incompatible runtime snapshot version');
    const previous = this.#state;
    this.#state = deepFreeze(structuredClone(next));
    this.#revision += 1;
    this.recordRevision(label);
    this.notify(previous);
    return this.#revision;
  }

  trimHistory(maxEntries: number): void {
    const keep = Math.max(1, Math.floor(maxEntries));
    if (this.#history.length > keep) this.#history.splice(0, this.#history.length - keep);
  }

  clearEvents(): void {
    this.#events.length = 0;
  }

  private applyPatches(patches: readonly StatePatch<R35RuntimeSnapshot>[]): number {
    const previous = this.#state;
    let next = previous;
    for (const patch of patches) {
      next = patch.apply(next);
      if (!next || typeof next !== 'object') throw new Error('state patch returned an invalid state');
    }
    this.#state = deepFreeze(structuredClone(next));
    this.#revision += 1;
    this.recordRevision(patches.map((patch) => patch.label).join(' + '));
    this.notify(previous);
    return this.#revision;
  }

  private recordRevision(label: string): void {
    const entry: StateRevision<R35RuntimeSnapshot> = Object.freeze({
      revision: this.#revision,
      state: structuredClone(this.#state),
      label,
      tick: this.#state.tick,
      checksum: this.#checksum(this.#state),
    });
    this.#history.push(entry);
    if (this.#history.length > this.#historyCapacity) this.#history.shift();
  }

  private notify(previous: R35RuntimeSnapshot): void {
    for (const subscription of this.#subscriptions.values()) {
      const typed = subscription as StateSubscription<unknown>;
      const nextValue = typed.selector.select(this.#state);
      const same = (typed.selector.equals ?? equalByObjectIs)(typed.previous, nextValue);
      if (same) continue;
      const oldValue = typed.previous;
      typed.previous = structuredClone(nextValue);
      typed.listener(nextValue, oldValue);
    }
    void previous;
  }
}

export function createRuntimeSnapshot(input: Partial<R35RuntimeSnapshot> = {}): R35RuntimeSnapshot {
  const base: R35RuntimeSnapshot = {
    version: R35_VERSION,
    mode: 'booting',
    tick: 0,
    wallClockMs: 0,
    player: null,
    world: {
      tick: 0,
      seed: 1,
      entityCount: 0,
      activeCount: 0,
      loadedChunks: 0,
      streamingQueue: 0,
      weatherKey: 'clear',
    },
    network: {
      connected: false,
      serverTick: 0,
      lastAckSequence: 0,
      pendingCommands: 0,
      packetsIn: 0,
      packetsOut: 0,
      rejectedCommands: 0,
    },
    quality: {
      quality: 'balanced',
      renderScale: 1,
      pixelRatioCap: 1.5,
      shadowTier: 2,
      vegetationDensity: 1,
      postProcessing: true,
    },
    telemetry: {
      frameMs: 0,
      simulationMs: 0,
      renderMs: 0,
      networkMs: 0,
      streamingMs: 0,
      memoryBytes: 0,
      entityCount: 0,
    },
    features: {},
  };
  return Object.freeze({
    ...base,
    ...input,
    world: { ...base.world, ...input.world },
    network: { ...base.network, ...input.network },
    quality: { ...base.quality, ...input.quality },
    telemetry: { ...base.telemetry, ...input.telemetry },
  });
}

export function createSelector<S>(
  key: string,
  select: (state: R35RuntimeSnapshot) => S,
  equals?: (a: S, b: S) => boolean,
): StateSelector<R35RuntimeSnapshot, S> {
  return equals === undefined ? Object.freeze({ key, select }) : Object.freeze({ key, select, equals });
}

export function runtimeSnapshotChecksum(snapshot: R35RuntimeSnapshot): string {
  return defaultChecksum(snapshot);
}
