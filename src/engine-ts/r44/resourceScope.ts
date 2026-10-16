/**
 * Explicit resource lifetime management.
 *
 * The registry tracks ownership and estimated bytes, not the opaque resource
 * itself. Callers keep the handle in the release closure. Release is idempotent;
 * final disposal is LIFO so dependencies usually outlive their dependants.
 */
import {
  R44BoundaryError,
  R44InvariantError,
  type R44Disposable,
  type R44JsonValue,
  type R44ResourceId,
  r44AsResourceId,
  r44FiniteInteger,
  r44NormalizeId,
  r44NormalizeLabel,
  r44ToFailure,
} from "./contracts.js";

export type R44ScopeState = "open" | "disposing" | "disposed";

export interface R44DisposeFailure {
  readonly resourceId: string;
  readonly owner: string;
  readonly code: string;
  readonly message: string;
}

export interface R44DisposeReport {
  readonly scopeId: string;
  readonly disposed: number;
  readonly skipped: number;
  readonly failures: readonly R44DisposeFailure[];
  readonly elapsedLogicalTicks: number;
}

export interface R44ScopeOptions {
  readonly tick?: number;
  readonly strictRegistration?: boolean;
  readonly onFailure?: (failure: R44DisposeFailure) => void;
}

interface R44DisposerEntry {
  readonly id: string;
  readonly owner: string;
  readonly disposer: () => void | Promise<void>;
  readonly tick: number;
  active: boolean;
}

export interface R44ScopeHandle {
  readonly id: string;
  readonly active: boolean;
  release(): void;
}

export class R44ResourceScope implements R44Disposable {
  readonly #id: string;
  readonly #strictRegistration: boolean;
  readonly #onFailure: ((failure: R44DisposeFailure) => void) | undefined;
  readonly #entries: R44DisposerEntry[] = [];
  #state: R44ScopeState = "open";
  #tick: number;
  #nextId = 1;
  #disposePromise: Promise<R44DisposeReport> | null = null;
  #lastReport: R44DisposeReport | null = null;

  constructor(idInput: string, options: R44ScopeOptions = {}) {
    this.#id = r44NormalizeId(idInput, "scope id", 128);
    this.#strictRegistration = options.strictRegistration ?? true;
    this.#onFailure = options.onFailure;
    this.#tick = r44FiniteInteger(options.tick ?? 0, "tick", 0);
  }

  get id(): string { return this.#id; }
  get state(): R44ScopeState { return this.#state; }
  get activeCount(): number { return this.#entries.filter((entry) => entry.active).length; }
  get report(): R44DisposeReport | null { return this.#lastReport; }

  advance(tick: number): void {
    r44FiniteInteger(tick, "tick", this.#tick);
    this.#tick = tick;
  }

  defer(disposer: () => void | Promise<void>, options: { owner?: string; id?: string } = {}): R44ScopeHandle {
    if (this.#state !== "open") {
      if (this.#strictRegistration) throw new R44InvariantError("scope-closed", "Cannot register disposal after scope shutdown", { scopeId: this.#id });
      return Object.freeze({ id: "inactive", active: false, release: () => undefined });
    }
    if (typeof disposer !== "function") throw new R44BoundaryError("disposer-invalid", "Disposer must be a function");
    const id = options.id === undefined ? this.#id + ":" + this.#nextId++ : r44NormalizeId(options.id, "disposer id", 160);
    if (this.#entries.some((entry) => entry.id === id && entry.active)) {
      throw new R44InvariantError("disposer-id-duplicate", "Disposer id already exists in scope", { scopeId: this.#id, id });
    }
    const entry: R44DisposerEntry = {
      id,
      owner: r44NormalizeId(options.owner ?? "anonymous", "owner", 128),
      disposer,
      tick: this.#tick,
      active: true,
    };
    this.#entries.push(entry);
    return {
      id,
      get active() { return entry.active; },
      release: () => { entry.active = false; },
    };
  }

  own<T extends R44Disposable>(resource: T, options: { owner?: string; id?: string } = {}): T {
    this.defer(() => resource.dispose(), options);
    return resource;
  }

  child(id: string): R44ResourceScope {
    const child = new R44ResourceScope(this.#id + "/" + r44NormalizeId(id, "child id", 96), {
      tick: this.#tick,
      strictRegistration: this.#strictRegistration,
      onFailure: this.#onFailure,
    });
    this.defer(() => child.dispose(), { owner: "child-scope", id: "child:" + id });
    return child;
  }

  async dispose(): Promise<void> {
    await this.disposeDetailed();
  }

  disposeDetailed(): Promise<R44DisposeReport> {
    if (this.#disposePromise !== null) return this.#disposePromise;
    if (this.#state === "disposed" && this.#lastReport !== null) return Promise.resolve(this.#lastReport);
    this.#state = "disposing";
    this.#disposePromise = this.#runDisposal();
    return this.#disposePromise;
  }

  snapshot(): Readonly<Record<string, R44JsonValue>> {
    return Object.freeze({
      id: this.#id,
      state: this.#state,
      tick: this.#tick,
      registered: this.#entries.length,
      active: this.activeCount,
      disposed: this.#entries.length - this.activeCount,
      resources: this.#entries.filter((entry) => entry.active).map((entry) => ({
        id: entry.id, owner: entry.owner, registeredAtTick: entry.tick,
      })),
    });
  }

  assertDisposed(): void {
    if (this.#state !== "disposed") {
      throw new R44InvariantError("scope-not-disposed", "Resource scope has not been disposed", {
        scopeId: this.#id,
        state: this.#state,
        active: this.activeCount,
      });
    }
  }

  async #runDisposal(): Promise<R44DisposeReport> {
    let disposed = 0;
    let skipped = 0;
    const failures: R44DisposeFailure[] = [];
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      const entry = this.#entries[index];
      if (entry === undefined || !entry.active) {
        skipped += 1;
        continue;
      }
      entry.active = false;
      try {
        await entry.disposer();
        disposed += 1;
      } catch (error) {
        const failureInfo = r44ToFailure(error, "dispose-failed");
        const failure = Object.freeze({
          resourceId: entry.id,
          owner: entry.owner,
          code: failureInfo.code,
          message: failureInfo.message,
        });
        failures.push(failure);
        try { this.#onFailure?.(failure); } catch { /* reporting failures cannot stop cleanup */ }
      }
    }
    this.#state = "disposed";
    const firstTick = this.#entries[0]?.tick ?? this.#tick;
    this.#lastReport = Object.freeze({
      scopeId: this.#id,
      disposed,
      skipped,
      failures: Object.freeze(failures),
      elapsedLogicalTicks: Math.max(0, this.#tick - firstTick),
    });
    return this.#lastReport;
  }
}

export interface R44LeaseOptions {
  readonly owner: string;
  readonly kind: string;
  readonly estimatedBytes?: number;
  readonly acquiredTick: number;
  readonly release: () => void | Promise<void>;
  readonly tags?: readonly string[];
}

export interface R44LeaseSnapshot {
  readonly id: string;
  readonly owner: string;
  readonly kind: string;
  readonly estimatedBytes: number;
  readonly acquiredTick: number;
  readonly ageTicks: number;
  readonly references: number;
  readonly tags: readonly string[];
}

export interface R44LeaseRegistryOptions {
  readonly maxLeases?: number;
  readonly maxEstimatedBytes?: number;
  readonly maxAgeTicks?: number;
}

interface R44LeaseRecord extends R44LeaseSnapshot {
  readonly releaseAction: () => void | Promise<void>;
  released: boolean;
}

export class R44ResourceLeaseRegistry {
  readonly #maxLeases: number;
  readonly #maxEstimatedBytes: number;
  readonly #maxAgeTicks: number;
  readonly #leases = new Map<R44ResourceId, R44LeaseRecord>();
  #estimatedBytes = 0;
  #currentTick = 0;
  #duplicateReleaseCount = 0;

  constructor(options: R44LeaseRegistryOptions = {}) {
    this.#maxLeases = r44FiniteInteger(options.maxLeases ?? 20_000, "maxLeases", 1, 1_000_000);
    this.#maxEstimatedBytes = r44FiniteInteger(options.maxEstimatedBytes ?? 2048 * 1024 * 1024, "maxEstimatedBytes", 1);
    this.#maxAgeTicks = r44FiniteInteger(options.maxAgeTicks ?? 60 * 60 * 24, "maxAgeTicks", 1);
  }

  get size(): number { return this.#leases.size; }
  get estimatedBytes(): number { return this.#estimatedBytes; }

  advance(tick: number): void {
    this.#currentTick = r44FiniteInteger(tick, "tick", this.#currentTick);
  }

  register(idInput: string, options: R44LeaseOptions): R44ResourceLease {
    const id = r44AsResourceId(idInput);
    if (this.#leases.has(id)) throw new R44InvariantError("lease-duplicate", "Resource lease already registered", { id });
    if (this.#leases.size >= this.#maxLeases) throw new R44BoundaryError("lease-capacity", "Lease capacity exceeded");
    const estimatedBytes = r44FiniteInteger(options.estimatedBytes ?? 0, "estimatedBytes", 0, this.#maxEstimatedBytes);
    if (this.#estimatedBytes + estimatedBytes > this.#maxEstimatedBytes) {
      throw new R44BoundaryError("lease-memory-capacity", "Estimated resource memory budget exceeded");
    }
    const acquiredTick = r44FiniteInteger(options.acquiredTick, "acquiredTick", 0);
    const record: R44LeaseRecord = {
      id,
      owner: r44NormalizeId(options.owner, "owner", 128),
      kind: r44NormalizeLabel(options.kind, 96),
      estimatedBytes,
      acquiredTick,
      ageTicks: 0,
      references: 1,
      tags: Object.freeze((options.tags ?? []).map((tag) => r44NormalizeLabel(tag, 64)).slice(0, 24)),
      releaseAction: options.release,
      released: false,
    };
    this.#leases.set(id, record);
    this.#estimatedBytes += estimatedBytes;
    return new R44ResourceLease(this, id);
  }

  retain(id: R44ResourceId): boolean {
    const record = this.#leases.get(id);
    if (record === undefined || record.released) return false;
    record.references += 1;
    return true;
  }

  async release(id: R44ResourceId): Promise<boolean> {
    const record = this.#leases.get(id);
    if (record === undefined || record.released) {
      this.#duplicateReleaseCount += 1;
      return false;
    }
    record.references -= 1;
    if (record.references > 0) return true;
    record.released = true;
    this.#leases.delete(id);
    this.#estimatedBytes = Math.max(0, this.#estimatedBytes - record.estimatedBytes);
    await record.releaseAction();
    return true;
  }

  snapshots(): readonly R44LeaseSnapshot[] {
    return Object.freeze([...this.#leases.values()].map((record) => Object.freeze({
      id: record.id,
      owner: record.owner,
      kind: record.kind,
      estimatedBytes: record.estimatedBytes,
      acquiredTick: record.acquiredTick,
      ageTicks: Math.max(0, this.#currentTick - record.acquiredTick),
      references: record.references,
      tags: record.tags,
    })));
  }

  reportLeaks(options: { minimumAgeTicks?: number; owner?: string } = {}): readonly R44LeaseSnapshot[] {
    const minimumAge = r44FiniteInteger(options.minimumAgeTicks ?? this.#maxAgeTicks, "minimumAgeTicks", 0);
    const owner = options.owner === undefined ? null : r44NormalizeId(options.owner, "owner", 128);
    return Object.freeze(this.snapshots().filter((item) =>
      item.ageTicks >= minimumAge && (owner === null || item.owner === owner)));
  }

  async releaseOwner(ownerInput: string): Promise<number> {
    const owner = r44NormalizeId(ownerInput, "owner", 128);
    const keys = [...this.#leases.values()].filter((record) => record.owner === owner).map((record) => record.id);
    let released = 0;
    for (const key of keys) {
      const record = this.#leases.get(key);
      if (record === undefined) continue;
      record.references = 1;
      if (await this.release(key)) released += 1;
    }
    return released;
  }

  async disposeAll(): Promise<readonly R44DisposeFailure[]> {
    const failures: R44DisposeFailure[] = [];
    for (const record of [...this.#leases.values()].reverse()) {
      record.references = 1;
      try {
        await this.release(record.id);
      } catch (error) {
        const normalized = r44ToFailure(error, "lease-release-failed");
        failures.push(Object.freeze({
          resourceId: record.id,
          owner: record.owner,
          code: normalized.code,
          message: normalized.message,
        }));
      }
    }
    return Object.freeze(failures);
  }

  diagnostics(): Readonly<Record<string, number>> {
    return Object.freeze({
      activeLeases: this.#leases.size,
      estimatedBytes: this.#estimatedBytes,
      capacity: this.#maxLeases,
      byteCapacity: this.#maxEstimatedBytes,
      duplicateReleases: this.#duplicateReleaseCount,
      oldLeaseCount: this.reportLeaks().length,
    });
  }
}

export class R44ResourceLease {
  readonly #registry: R44ResourceLeaseRegistry;
  readonly id: R44ResourceId;
  #released = false;

  constructor(registry: R44ResourceLeaseRegistry, id: R44ResourceId) {
    this.#registry = registry;
    this.id = id;
  }

  get released(): boolean { return this.#released; }

  retain(): R44ResourceLease {
    if (this.#released || !this.#registry.retain(this.id)) {
      throw new R44InvariantError("lease-unavailable", "Cannot retain a released lease", { id: this.id });
    }
    return new R44ResourceLease(this.#registry, this.id);
  }

  async release(): Promise<boolean> {
    if (this.#released) return false;
    this.#released = true;
    return this.#registry.release(this.id);
  }
}
