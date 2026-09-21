import { checksum, stableStringify } from './deterministic';
import type { FrameId, UnixMillis } from './types';

export type StatePath = readonly string[];
export type StateSource = 'engine' | 'ui' | 'network' | 'save' | 'replay' | 'system';
export type StateMutationKind = 'set' | 'merge' | 'delete' | 'replace' | 'patch';

export interface StateVersion {
  readonly revision: number;
  readonly frame: FrameId;
  readonly timestamp: UnixMillis;
  readonly source: StateSource;
  readonly checksum: string;
}

export interface StateMutation {
  readonly kind: StateMutationKind;
  readonly path: StatePath;
  readonly value?: unknown;
  readonly source: StateSource;
  readonly frame: FrameId;
  readonly reason?: string;
}

export interface StatePatch {
  readonly revision: number;
  readonly mutations: readonly StateMutation[];
  readonly checksum: string;
}

export interface StateHistoryEntry {
  readonly version: StateVersion;
  readonly patch: StatePatch;
}

export interface RuntimeStateOptions<T extends Record<string, unknown>> {
  readonly initial: T;
  readonly now?: () => UnixMillis;
  readonly maxHistory?: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly onCommit?: (version: StateVersion, patch: StatePatch, state: Readonly<T>) => void;
}

export interface TransactionOptions {
  readonly source?: StateSource;
  readonly frame?: FrameId;
  readonly reason?: string;
}

export interface RuntimeStateSnapshot<T> {
  readonly state: Readonly<T>;
  readonly version: StateVersion;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizePath(path: StatePath | string): StatePath {
  if (typeof path === 'string') {
    if (!path.trim()) return [];
    return Object.freeze(path.split('.').map((part) => part.trim()).filter(Boolean));
  }
  return Object.freeze(path.map((part) => String(part)).filter(Boolean));
}

function assertSafeGraph(value: unknown, maxDepth: number, maxNodes: number): void {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== 'object') return;
    if (depth > maxDepth) throw new RangeError('State graph depth limit exceeded');
    const object = node as object;
    if (seen.has(object)) throw new TypeError('Cyclic runtime state is not supported');
    seen.add(object);
    nodes += 1;
    if (nodes > maxNodes) throw new RangeError('State graph node limit exceeded');
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
    } else {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (key.length > 256) throw new RangeError('State key is too long');
        visit(child, depth + 1);
      }
    }
    seen.delete(object);
  };
  visit(value, 0);
}

function readAt(root: unknown, path: StatePath): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function writeAt(root: Record<string, unknown>, path: StatePath, value: unknown): void {
  if (!path.length) throw new RangeError('Root mutation requires replace');
  let cursor = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]!;
    const current = cursor[key];
    if (!current || typeof current !== 'object' || Array.isArray(current)) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]!] = clone(value);
}

function deleteAt(root: Record<string, unknown>, path: StatePath): void {
  if (!path.length) throw new RangeError('Root deletion is not allowed');
  let cursor: unknown = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    if (!cursor || typeof cursor !== 'object') return;
    cursor = (cursor as Record<string, unknown>)[path[index]!];
  }
  if (cursor && typeof cursor === 'object') delete (cursor as Record<string, unknown>)[path[path.length - 1]!];
}

function mergeAt(root: Record<string, unknown>, path: StatePath, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Merge value must be an object');
  const existing = readAt(root, path);
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) writeAt(root, path, {});
  const target = readAt(root, path) as Record<string, unknown>;
  Object.assign(target, clone(value) as Record<string, unknown>);
}

function applyMutation<T extends Record<string, unknown>>(state: T, mutation: StateMutation): void {
  const next = mutation.kind === 'replace' ? clone(mutation.value as T) : state;
  if (mutation.kind === 'replace') {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, next);
    return;
  }
  if (mutation.kind === 'set' || mutation.kind === 'patch') {
    writeAt(state, mutation.path, mutation.value);
    return;
  }
  if (mutation.kind === 'merge') {
    mergeAt(state, mutation.path, mutation.value);
    return;
  }
  if (mutation.kind === 'delete') {
    deleteAt(state, mutation.path);
  }
}

export class RuntimeStateGraph<T extends Record<string, unknown>> {
  readonly maxHistory: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  #state: T;
  #revision = 0;
  #frame = 0 as FrameId;
  #now: () => UnixMillis;
  #history: StateHistoryEntry[] = [];
  #listeners = new Set<(snapshot: RuntimeStateSnapshot<T>) => void>();
  #onCommit?: RuntimeStateOptions<T>['onCommit'];

  constructor(options: RuntimeStateOptions<T>) {
    this.maxHistory = Math.max(1, Math.min(10_000, Math.trunc(options.maxHistory ?? 600)));
    this.maxDepth = Math.max(4, Math.min(64, Math.trunc(options.maxDepth ?? 16)));
    this.maxNodes = Math.max(128, Math.min(100_000, Math.trunc(options.maxNodes ?? 10_000)));
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
    this.#state = clone(options.initial);
    assertSafeGraph(this.#state, this.maxDepth, this.maxNodes);
    Object.freeze(this.#state);
    this.#onCommit = options.onCommit;
  }

  get revision(): number { return this.#revision; }
  get frame(): FrameId { return this.#frame; }

  snapshot(): RuntimeStateSnapshot<T> {
    return Object.freeze({ state: Object.freeze(clone(this.#state)), version: this.version() });
  }

  version(): StateVersion {
    return Object.freeze({
      revision: this.#revision,
      frame: this.#frame,
      timestamp: this.#now(),
      source: 'system',
      checksum: checksum(this.#state),
    });
  }

  read(path: StatePath | string = []): unknown {
    return clone(readAt(this.#state, normalizePath(path)));
  }

  subscribe(listener: (snapshot: RuntimeStateSnapshot<T>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  transaction(options: TransactionOptions = {}): RuntimeTransaction<T> {
    return new RuntimeTransaction(this, options);
  }

  apply(mutations: readonly StateMutation[], options: TransactionOptions = {}): StatePatch {
    const tx = this.transaction(options);
    for (const mutation of mutations) tx.push(mutation);
    return tx.commit();
  }

  history(): readonly StateHistoryEntry[] {
    return Object.freeze(this.#history.map((entry) => Object.freeze({
      version: entry.version,
      patch: Object.freeze({ ...entry.patch, mutations: Object.freeze(entry.patch.mutations.map((item) => Object.freeze({ ...item }))) }),
    })));
  }

  exportPatch(fromRevision = 0): readonly StatePatch[] {
    return Object.freeze(this.#history.filter((entry) => entry.version.revision > fromRevision).map((entry) => entry.patch));
  }

  importPatches(patches: readonly StatePatch[], options: TransactionOptions = {}): number {
    let applied = 0;
    for (const patch of patches) {
      if (checksum({ revision: patch.revision, mutations: patch.mutations }) !== patch.checksum) throw new TypeError('Invalid state patch checksum');
      this.apply(patch.mutations, options);
      applied += 1;
    }
    return applied;
  }

  rollback(targetRevision: number): boolean {
    if (!Number.isInteger(targetRevision) || targetRevision < 0 || targetRevision >= this.#revision) return false;
    const candidates = this.#history.filter((entry) => entry.version.revision > targetRevision);
    const target = this.#history.find((entry) => entry.version.revision === targetRevision);
    if (!target && targetRevision !== 0) return false;
    let rebuilt: T;
    if (targetRevision === 0) {
      rebuilt = clone(this.#history[0]?.patch.mutations.find((m) => m.kind === 'replace')?.value as T ?? {} as T);
    } else {
      const first = this.#history[0];
      if (!first) return false;
      rebuilt = clone(first.patch.mutations.find((m) => m.kind === 'replace')?.value as T ?? {} as T);
    }
    for (const entry of this.#history) {
      if (entry.version.revision > targetRevision) break;
      for (const mutation of entry.patch.mutations) applyMutation(rebuilt, mutation);
    }
    assertSafeGraph(rebuilt, this.maxDepth, this.maxNodes);
    this.#state = rebuilt;
    this.#revision = targetRevision;
    this.#history = this.#history.filter((entry) => entry.version.revision <= targetRevision);
    void candidates;
    this.#emit();
    return true;
  }

  _commit(mutations: readonly StateMutation[], options: TransactionOptions): StatePatch {
    if (!mutations.length) throw new RangeError('Cannot commit an empty transaction');
    const frame = options.frame ?? this.#frame;
    const source = options.source ?? 'system';
    const normalized = mutations.map((mutation) => Object.freeze({
      ...mutation,
      path: normalizePath(mutation.path),
      frame,
      source,
    }));
    const draft = clone(this.#state);
    assertSafeGraph(draft, this.maxDepth, this.maxNodes);
    for (const mutation of normalized) applyMutation(draft, mutation);
    assertSafeGraph(draft, this.maxDepth, this.maxNodes);
    this.#revision += 1;
    this.#frame = frame;
    this.#state = draft;
    Object.freeze(this.#state);
    const patch: StatePatch = Object.freeze({
      revision: this.#revision,
      mutations: Object.freeze(normalized),
      checksum: checksum({ revision: this.#revision, mutations: normalized }),
    });
    const version: StateVersion = Object.freeze({
      revision: this.#revision,
      frame,
      timestamp: this.#now(),
      source,
      checksum: checksum(this.#state),
    });
    this.#history.push(Object.freeze({ version, patch }));
    if (this.#history.length > this.maxHistory) this.#history.splice(0, this.#history.length - this.maxHistory);
    this.#onCommit?.(version, patch, this.#state);
    this.#emit();
    return patch;
  }

  _setFrame(frame: FrameId): void { this.#frame = frame; }

  #emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}

export class RuntimeTransaction<T extends Record<string, unknown>> {
  #graph: RuntimeStateGraph<T>;
  #options: TransactionOptions;
  #mutations: StateMutation[] = [];
  #closed = false;

  constructor(graph: RuntimeStateGraph<T>, options: TransactionOptions) {
    this.#graph = graph;
    this.#options = options;
  }

  push(mutation: Omit<StateMutation, 'frame' | 'source'> & Partial<Pick<StateMutation, 'frame' | 'source'>>): this {
    if (this.#closed) throw new Error('Transaction already closed');
    this.#mutations.push(Object.freeze({
      ...mutation,
      path: normalizePath(mutation.path),
      frame: mutation.frame ?? this.#options.frame ?? this.#graph.frame,
      source: mutation.source ?? this.#options.source ?? 'system',
      reason: mutation.reason ?? this.#options.reason,
    }));
    return this;
  }

  set(path: StatePath | string, value: unknown, reason?: string): this {
    return this.push({ kind: 'set', path: normalizePath(path), value, reason });
  }

  merge(path: StatePath | string, value: Record<string, unknown>, reason?: string): this {
    return this.push({ kind: 'merge', path: normalizePath(path), value, reason });
  }

  delete(path: StatePath | string, reason?: string): this {
    return this.push({ kind: 'delete', path: normalizePath(path), reason });
  }

  replace(value: T, reason?: string): this {
    return this.push({ kind: 'replace', path: [], value, reason });
  }

  commit(): StatePatch {
    if (this.#closed) throw new Error('Transaction already closed');
    this.#closed = true;
    return this.#graph._commit(this.#mutations, this.#options);
  }

  discard(): void { this.#closed = true; this.#mutations.length = 0; }

  get size(): number { return this.#mutations.length; }
}

export function stateDigest<T>(state: T): string {
  return checksum(stableStringify(state));
}
