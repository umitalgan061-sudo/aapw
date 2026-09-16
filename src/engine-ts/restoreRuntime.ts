import type { Disposable } from './coreTypes.js';
import { SnapshotRuntime } from './snapshotRuntime.js';
import { PersistenceRuntime } from './persistenceRuntime.js';
import { SecurityRuntime } from './securityRuntime.js';

export interface RestoreReport { readonly accepted: boolean; readonly slot: number; readonly source: 'save' | 'snapshot'; readonly restoredTick: number; readonly failures: readonly string[]; readonly durationMs: number; }
export interface RestorePolicy { readonly maxPayloadBytes: number; readonly maxAgeMs: number; readonly allowPartial: boolean; }
export interface RestoreStats { readonly attempts: number; readonly successes: number; readonly failures: number; readonly lastTick: number; }

const DEFAULT_POLICY: RestorePolicy = Object.freeze({ maxPayloadBytes: 8 * 1024 * 1024, maxAgeMs: 30 * 24 * 60 * 60 * 1000, allowPartial: false });

export class RestoreRuntime<T = Record<string, unknown>> implements Disposable {
  readonly snapshots: SnapshotRuntime<T>;
  readonly persistence: PersistenceRuntime<T>;
  readonly security: SecurityRuntime;
  readonly policy: RestorePolicy;
  #now: () => number;
  #attempts = 0;
  #successes = 0;
  #failures = 0;
  #lastTick = 0;
  #disposed = false;

  constructor(options: { readonly schema?: string; readonly version?: number; readonly policy?: Partial<RestorePolicy>; readonly now?: () => number } = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.policy = Object.freeze({ ...DEFAULT_POLICY, ...options.policy });
    this.snapshots = new SnapshotRuntime<T>();
    this.persistence = new PersistenceRuntime<T>({ schema: options.schema ?? 'aapw-restore', version: options.version ?? 1, maxBytes: this.policy.maxPayloadBytes, now: this.#now });
    this.security = new SecurityRuntime({ maxPayloadBytes: this.policy.maxPayloadBytes });
  }

  capture(tick: number, state: T): boolean { return this.snapshots.capture(tick, state) !== null; }

  async restore(slot: number): Promise<RestoreReport> {
    const started = this.#now(); this.#attempts += 1; const failures: string[] = [];
    if (this.#disposed) return this.#report(slot, 'save', 0, ['disposed'], started);
    const result = await this.persistence.load(slot);
    if (!result.ok || result.value === null) { failures.push(result.ok ? 'save-not-found' : String(result.meta.code)); this.#failures += 1; return this.#report(slot, 'save', 0, failures, started); }
    if (!this.security.validate(result.value).ok) { failures.push('payload-rejected'); this.#failures += 1; return this.#report(slot, 'save', 0, failures, started); }
    this.#successes += 1;
    const restoredTick = this.#extractTick(result.value);
    this.#lastTick = Math.max(this.#lastTick, restoredTick);
    return this.#report(slot, 'save', restoredTick, failures, started);
  }

  restoreLatestSnapshot(tick = Number.MAX_SAFE_INTEGER): RestoreReport {
    const started = this.#now(); this.#attempts += 1;
    const snapshot = this.snapshots.find(tick);
    if (!snapshot) { this.#failures += 1; return this.#report(-1, 'snapshot', 0, ['snapshot-not-found'], started); }
    if (!this.security.validate(snapshot.state).ok) { this.#failures += 1; return this.#report(-1, 'snapshot', snapshot.tick, ['snapshot-rejected'], started); }
    if (!this.snapshots.verify(snapshot)) { this.#failures += 1; return this.#report(-1, 'snapshot', snapshot.tick, ['snapshot-checksum'], started); }
    this.#successes += 1; this.#lastTick = snapshot.tick; return this.#report(-1, 'snapshot', snapshot.tick, [], started);
  }

  stats(): RestoreStats { return Object.freeze({ attempts: this.#attempts, successes: this.#successes, failures: this.#failures, lastTick: this.#lastTick }); }
  dispose(): void { this.#disposed = true; this.snapshots.dispose(); this.persistence.dispose(); this.security.dispose(); }

  #report(slot: number, source: 'save' | 'snapshot', restoredTick: number, failures: readonly string[], started: number): RestoreReport { return Object.freeze({ accepted: failures.length === 0, slot, source, restoredTick, failures: Object.freeze([...failures]), durationMs: Math.max(0, this.#now() - started) }); }
  #extractTick(value: T): number { if (value && typeof value === 'object' && 'runtime' in value) { const runtime = (value as Record<string, unknown>).runtime; if (runtime && typeof runtime === 'object' && 'scheduler' in runtime) { const scheduler = (runtime as Record<string, unknown>).scheduler; if (scheduler && typeof scheduler === 'object' && typeof (scheduler as Record<string, unknown>).tick === 'number') return Math.max(0, Math.trunc((scheduler as Record<string, unknown>).tick as number)); } } return 0; }
}
