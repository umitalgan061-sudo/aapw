import { asTick, digest, freezeDeep, integer, stableSort, type Disposable, type EntityId, type Tick, type V7Result } from './primitives.js';

export type StateSource = 'engine' | 'ui' | 'network' | 'save' | 'replay' | 'system';
export interface StatePatch { readonly path: string; readonly before: unknown; readonly after: unknown; readonly source: StateSource; readonly tick: Tick; readonly revision: number; }
export interface StateSnapshot { readonly revision: number; readonly tick: Tick; readonly value: Readonly<Record<string, unknown>>; readonly digest: string; }
export interface StateTransaction { readonly id: string; readonly source: StateSource; readonly tick: Tick; readonly changes: readonly StateChange[]; }
export interface StateChange { readonly path: string; readonly value: unknown; }
export interface StateEvent { readonly revision: number; readonly patches: readonly StatePatch[]; readonly snapshot: StateSnapshot; }
export interface StateStoreOptions { readonly maxKeys?: number; readonly maxDepth?: number; readonly history?: number; }

function pathParts(path: string): string[] { return path.split('.').map((item) => item.trim()).filter(Boolean).slice(0, 32); }
function cloneRecord(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}
function setPath(target: Record<string, unknown>, path: string, value: unknown, maxDepth: number): unknown {
  const parts = pathParts(path); if (!parts.length || parts.length > maxDepth) return undefined;
  let node: Record<string, unknown> = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]!;
    const next = node[key];
    if (next !== null && typeof next === 'object' && !Array.isArray(next)) node = next as Record<string, unknown>;
    else node = node[key] = {};
  }
  const key = parts.at(-1)!; const before = node[key]; node[key] = value; return before;
}

export class RuntimeStateStore implements Disposable {
  readonly maxKeys: number;
  readonly maxDepth: number;
  readonly historyLimit: number;
  #value: Record<string, unknown>;
  #revision = 0;
  #tick: Tick = asTick(0);
  #history: StateEvent[] = [];
  #listeners = new Set<(event: StateEvent) => void>();
  #disposed = false;

  constructor(initial: Readonly<Record<string, unknown>> = {}, options: StateStoreOptions = {}) {
    this.maxKeys = Math.max(16, integer(options.maxKeys ?? 2048));
    this.maxDepth = Math.max(2, Math.min(16, integer(options.maxDepth ?? 8)));
    this.historyLimit = Math.max(8, Math.min(1024, integer(options.history ?? 128)));
    this.#value = cloneRecord(initial);
  }

  begin(id: string, source: StateSource, tick: Tick, changes: readonly StateChange[]): V7Result<StateEvent> {
    if (this.#disposed) return { ok: false, code: 'STATE_DISPOSED', message: 'State store is disposed', retryable: false };
    if (!id || changes.length === 0 || changes.length > 256) return { ok: false, code: 'TRANSACTION_INVALID', message: 'Transaction is empty or too large', retryable: false };
    const next = cloneRecord(this.#value); const patches: StatePatch[] = [];
    for (const change of changes) {
      const before = setPath(next, change.path, freezeDeep(change.value), this.maxDepth);
      if (before === undefined && pathParts(change.path).length === 0) return { ok: false, code: 'PATH_INVALID', message: 'State path is invalid', retryable: false };
      patches.push(Object.freeze({ path: change.path, before, after: change.value, source, tick, revision: this.#revision + 1 }));
    }
    if (Object.keys(next).length > this.maxKeys) return { ok: false, code: 'STATE_LIMIT', message: 'State key limit exceeded', retryable: false };
    this.#value = next; this.#revision += 1; this.#tick = tick;
    const snapshot = this.snapshot();
    const event = Object.freeze({ revision: this.#revision, patches: Object.freeze(stableSort(patches, (a, b) => a.path.localeCompare(b.path))), snapshot });
    this.#history.push(event); if (this.#history.length > this.historyLimit) this.#history.shift();
    for (const listener of this.#listeners) { try { listener(event); } catch { /* observer isolation */ } }
    return { ok: true, value: event };
  }

  set(path: string, value: unknown, source: StateSource, tick: Tick): V7Result<StateEvent> { return this.begin(`set:${this.#revision + 1}`, source, tick, [{ path, value }]); }
  get(path: string): unknown {
    const parts = pathParts(path); let node: unknown = this.#value;
    for (const part of parts) { if (node === null || typeof node !== 'object') return undefined; node = (node as Record<string, unknown>)[part]; }
    return node;
  }
  snapshot(): StateSnapshot { const value = freezeDeep(cloneRecord(this.#value)); return Object.freeze({ revision: this.#revision, tick: this.#tick, value, digest: digest(this.#revision, this.#tick, value) }); }
  history(): readonly StateEvent[] { return Object.freeze([...this.#history]); }
  subscribe(listener: (event: StateEvent) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  revision(): number { return this.#revision; }
  tick(): Tick { return this.#tick; }
  replace(snapshot: StateSnapshot, source: StateSource): V7Result<StateEvent> {
    if (!snapshot || !snapshot.value || snapshot.digest !== digest(snapshot.revision, snapshot.tick, snapshot.value)) return { ok: false, code: 'SNAPSHOT_INVALID', message: 'Snapshot checksum mismatch', retryable: false };
    const changes = stableSort(Object.entries(snapshot.value).map(([path, value]) => ({ path, value })), (a, b) => a.path.localeCompare(b.path));
    return this.begin(`restore:${snapshot.revision}`, source, asTick(snapshot.tick), changes);
  }
  dispose(): void { this.#disposed = true; this.#listeners.clear(); this.#history.length = 0; this.#value = {}; }
}

export interface EntityStateEnvelope { readonly entity: EntityId; readonly state: StateSnapshot; }
export const entityState = (entity: EntityId, store: RuntimeStateStore): EntityStateEnvelope => Object.freeze({ entity, state: store.snapshot() });
