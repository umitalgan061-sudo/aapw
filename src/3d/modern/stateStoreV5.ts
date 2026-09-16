import {
  type OutcomeV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
  type RuntimeSourceV4,
  type TickId,
  tickId,
  stableListV4,
} from './runtimeContractsV4';

export type StateKeyV5 = string;
export type StateVersionV5 = number;

export interface StateEntryV5<T = unknown> {
  readonly key: StateKeyV5;
  readonly version: StateVersionV5;
  readonly tick: TickId;
  readonly source: RuntimeSourceV4;
  readonly value: T;
  readonly updatedAt: number;
}

export interface StatePatchV5<T = unknown> {
  readonly key: StateKeyV5;
  readonly baseVersion: StateVersionV5;
  readonly nextVersion: StateVersionV5;
  readonly tick: TickId;
  readonly source: RuntimeSourceV4;
  readonly value: T;
  readonly checksum: string;
}

export interface StateTransactionV5 {
  readonly id: string;
  readonly tick: TickId;
  readonly source: RuntimeSourceV4;
  readonly changes: readonly StatePatchV5[];
}

export interface StateStoreMetricsV5 {
  readonly keys: number;
  readonly versions: number;
  readonly patches: number;
  readonly transactions: number;
  readonly conflicts: number;
  readonly subscribers: number;
  readonly pruned: number;
}

export interface StateStoreOptionsV5 {
  readonly maxKeys?: number;
  readonly maxHistoryPerKey?: number;
  readonly maxTransactions?: number;
  readonly now?: () => number;
}

export interface StateSubscriptionV5<T = unknown> {
  readonly key: StateKeyV5;
  readonly callback: (entry: StateEntryV5<T> | null, patch: StatePatchV5<T> | null) => void;
}

const digest = (value: unknown): string => {
  const text = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const cloneValue = <T>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

export class StateStoreV5 {
  readonly maxKeys: number;
  readonly maxHistoryPerKey: number;
  readonly maxTransactions: number;
  #now: () => number;
  #current = new Map<StateKeyV5, StateEntryV5>();
  #history = new Map<StateKeyV5, StateEntryV5[]>();
  #transactions: StateTransactionV5[] = [];
  #subscribers = new Map<number, StateSubscriptionV5>();
  #subscriptionId = 0;
  #metrics = { patches: 0, conflicts: 0, pruned: 0 };

  constructor(options: StateStoreOptionsV5 = {}) {
    this.maxKeys = Math.max(16, Math.trunc(options.maxKeys ?? 50_000));
    this.maxHistoryPerKey = Math.max(2, Math.trunc(options.maxHistoryPerKey ?? 32));
    this.maxTransactions = Math.max(32, Math.trunc(options.maxTransactions ?? 2048));
    this.#now = options.now ?? (() => performance.now());
  }

  has(key: StateKeyV5): boolean { return this.#current.has(key); }

  get<T>(key: StateKeyV5): T | undefined {
    return this.#current.get(key)?.value as T | undefined;
  }

  entry<T>(key: StateKeyV5): StateEntryV5<T> | null {
    const entry = this.#current.get(key);
    return entry ? Object.freeze({ ...entry, value: cloneValue(entry.value) }) as StateEntryV5<T> : null;
  }

  version(key: StateKeyV5): number { return this.#current.get(key)?.version ?? 0; }

  keys(): readonly StateKeyV5[] { return Object.freeze([...this.#current.keys()].sort()); }

  set<T>(key: StateKeyV5, value: T, source: RuntimeSourceV4, tick: TickId): OutcomeV4<StatePatchV5<T>> {
    if (!this.#validateKey(key)) return failV4(createRuntimeErrorV4('STATE_KEY_INVALID', 'Invalid state key', false, source));
    if (!this.#current.has(key) && this.#current.size >= this.maxKeys) return failV4(createRuntimeErrorV4('STATE_KEY_CAP', 'State key capacity reached', true, source));
    const previous = this.#current.get(key);
    const patch = this.#makePatch(key, previous?.version ?? 0, (previous?.version ?? 0) + 1, tick, source, value);
    this.#commitPatch(patch);
    return okV4(patch as StatePatchV5<T>);
  }

  delete(key: StateKeyV5, source: RuntimeSourceV4, tick: TickId): boolean {
    const previous = this.#current.get(key);
    if (!previous) return false;
    this.#current.delete(key);
    this.#history.delete(key);
    this.#notify(key, null, null);
    void source;
    void tick;
    return true;
  }

  begin(tick: TickId, source: RuntimeSourceV4, id = `tx-${this.#now()}-${this.#transactions.length + 1}`): StateTransactionBuilderV5 {
    return new StateTransactionBuilderV5(this, id, tick, source);
  }

  apply<T>(patch: StatePatchV5<T>, allowConflict = false): OutcomeV4<boolean> {
    const currentVersion = this.version(patch.key);
    if (!allowConflict && currentVersion !== patch.baseVersion) {
      this.#metrics.conflicts += 1;
      return failV4(createRuntimeErrorV4('STATE_VERSION_CONFLICT', `Expected version ${patch.baseVersion}, received ${currentVersion}`, true, patch.source));
    }
    if (digest({ key: patch.key, baseVersion: patch.baseVersion, nextVersion: patch.nextVersion, tick: patch.tick, source: patch.source, value: patch.value }) !== patch.checksum) return failV4(createRuntimeErrorV4('STATE_PATCH_CHECKSUM', 'State patch checksum mismatch', false, patch.source));
    this.#commitPatch(patch);
    return okV4(true);
  }

  transaction(transaction: StateTransactionV5): OutcomeV4<number> {
    if (!transaction.id.trim()) return failV4(createRuntimeErrorV4('STATE_TRANSACTION_ID', 'Transaction id is empty', false, transaction.source));
    const snapshots = new Map<string, StateEntryV5 | undefined>();
    for (const patch of transaction.changes) {
      snapshots.set(patch.key, this.#current.get(patch.key));
      const outcome = this.apply(patch);
      if (!outcome.ok) {
        for (const [key, value] of snapshots) { if (value) this.#current.set(key, value); else this.#current.delete(key); }
        return outcome;
      }
    }
    this.#transactions.push(Object.freeze({ ...transaction, changes: Object.freeze(transaction.changes.map((patch) => Object.freeze({ ...patch, value: cloneValue(patch.value) }))) }));
    while (this.#transactions.length > this.maxTransactions) { this.#transactions.shift(); this.#metrics.pruned += 1; }
    return okV4(transaction.changes.length);
  }

  history(key: StateKeyV5): readonly StateEntryV5[] {
    return Object.freeze((this.#history.get(key) ?? []).map((entry) => Object.freeze({ ...entry, value: cloneValue(entry.value) })));
  }

  transactionHistory(): readonly StateTransactionV5[] { return Object.freeze(this.#transactions.slice()); }

  subscribe<T = unknown>(key: StateKeyV5, callback: StateSubscriptionV5<T>['callback']): () => void {
    const id = ++this.#subscriptionId;
    this.#subscribers.set(id, { key, callback: callback as StateSubscriptionV5['callback'] });
    return () => this.#subscribers.delete(id);
  }

  snapshot(): Readonly<Record<string, unknown>> {
    const record: Record<string, unknown> = {};
    for (const key of stableListV4([...this.#current.keys()], (a, b) => a.localeCompare(b))) record[key] = cloneValue(this.#current.get(key)!.value);
    return Object.freeze(record);
  }

  snapshotWithMetadata(): readonly StateEntryV5[] {
    return Object.freeze(stableListV4([...this.#current.values()], (a, b) => a.key.localeCompare(b.key)).map((entry) => Object.freeze({ ...entry, value: cloneValue(entry.value) })));
  }

  restore(snapshot: readonly StateEntryV5[], allowOverwrite = false): OutcomeV4<number> {
    for (const entry of snapshot) {
      const current = this.#current.get(entry.key);
      if (current && !allowOverwrite && current.version > entry.version) return failV4(createRuntimeErrorV4('STATE_RESTORE_CONFLICT', `State ${entry.key} is newer than snapshot`, false, entry.source));
    }
    let restored = 0;
    for (const entry of snapshot) {
      this.#current.set(entry.key, Object.freeze({ ...entry, value: cloneValue(entry.value) }));
      restored += 1;
    }
    return okV4(restored);
  }

  prune(maxAgeMs: number): number {
    const cutoff = this.#now() - Math.max(0, maxAgeMs);
    let removed = 0;
    for (const [key, history] of this.#history) {
      const keep = history.filter((entry) => entry.updatedAt >= cutoff);
      removed += history.length - keep.length;
      if (keep.length) this.#history.set(key, keep); else this.#history.delete(key);
    }
    this.#metrics.pruned += removed;
    return removed;
  }

  metrics(): StateStoreMetricsV5 {
    let versions = 0;
    for (const history of this.#history.values()) versions += history.length;
    return Object.freeze({ keys: this.#current.size, versions, patches: this.#metrics.patches, transactions: this.#transactions.length, conflicts: this.#metrics.conflicts, subscribers: this.#subscribers.size, pruned: this.#metrics.pruned });
  }

  clear(): void {
    this.#current.clear(); this.#history.clear(); this.#transactions.length = 0;
  }

  #makePatch<T>(key: string, baseVersion: number, nextVersion: number, tick: TickId, source: RuntimeSourceV4, value: T): StatePatchV5<T> {
    const immutable = cloneValue(value);
    const core = { key, baseVersion, nextVersion, tick, source, value: immutable };
    return Object.freeze({ ...core, checksum: digest(core) });
  }

  #commitPatch<T>(patch: StatePatchV5<T>): void {
    const entry: StateEntryV5<T> = Object.freeze({ key: patch.key, version: patch.nextVersion, tick: patch.tick, source: patch.source, value: cloneValue(patch.value), updatedAt: this.#now() });
    this.#current.set(patch.key, entry);
    let history = this.#history.get(patch.key);
    if (!history) { history = []; this.#history.set(patch.key, history); }
    history.push(entry);
    while (history.length > this.maxHistoryPerKey) { history.shift(); this.#metrics.pruned += 1; }
    this.#metrics.patches += 1;
    this.#notify(patch.key, entry, patch);
  }

  #notify(key: string, entry: StateEntryV5 | null, patch: StatePatchV5 | null): void {
    for (const subscription of this.#subscribers.values()) if (subscription.key === key || subscription.key === '*') { try { subscription.callback(entry, patch); } catch { /* observers are isolated */ } }
  }

  #validateKey(key: string): boolean { return typeof key === 'string' && key.length > 0 && key.length <= 256 && /^[a-zA-Z0-9_.:/-]+$/.test(key); }
}

export class StateTransactionBuilderV5 {
  #store: StateStoreV5;
  #id: string;
  #tick: TickId;
  #source: RuntimeSourceV4;
  #changes: StatePatchV5[] = [];

  constructor(store: StateStoreV5, id: string, tick: TickId, source: RuntimeSourceV4) { this.#store = store; this.#id = id; this.#tick = tick; this.#source = source; }

  set<T>(key: string, value: T): this {
    const previous = this.#store.version(key);
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    const core = { key, baseVersion: previous, nextVersion: previous + 1, tick: this.#tick, source: this.#source, value };
    this.#changes.push(Object.freeze({ ...core, checksum: (hash >>> 0).toString(16).padStart(8, '0') }) as StatePatchV5);
    return this;
  }

  commit(): OutcomeV4<number> { return this.#store.transaction(Object.freeze({ id: this.#id, tick: this.#tick, source: this.#source, changes: Object.freeze(this.#changes.slice()) })); }
}

export function stateStoreTickV5(store: StateStoreV5, tick: number): TickId { return tickId(Math.max(0, Math.trunc(tick))); }
