import { checksumV5, type OutcomeV5, okV5, failV5, type PersistenceEnvelopeV5, type RecoveryPlanV5, tickV5, type TickV5 } from './runtimeContractV5';

export interface PersistenceAdapterV5<T> { readonly load: (slot: number) => Promise<PersistenceEnvelopeV5<T> | null>; readonly save: (slot: number, envelope: PersistenceEnvelopeV5<T>) => Promise<void>; readonly remove: (slot: number) => Promise<void>; readonly list: () => Promise<readonly number[]>; }
export interface PersistenceOptionsV5<T> { readonly schema: string; readonly version: number; readonly maxSlots?: number; readonly maxBytes?: number; readonly now?: () => number; readonly adapter: PersistenceAdapterV5<T>; }
export interface RecoveryJournalEntryV5 { readonly id: number; readonly domain: RecoveryPlanV5['domains'][number]; readonly action: 'diagnose' | 'quiesce' | 'reset' | 'replay' | 'resume'; readonly tick: TickV5; readonly success: boolean; readonly message: string; }
export interface RecoveryReportV5 { readonly success: boolean; readonly attempts: number; readonly recoveredDomains: readonly string[]; readonly failedDomains: readonly string[]; readonly journal: readonly RecoveryJournalEntryV5[]; }

function safeSlot(slot: number, max: number): boolean { return Number.isInteger(slot) && slot >= 0 && slot < max; }

export class PersistenceRuntimeV5<T> {
  readonly schema: string;
  readonly version: number;
  readonly maxSlots: number;
  readonly maxBytes: number;
  #now: () => number;
  #adapter: PersistenceAdapterV5<T>;
  #migrations = new Map<number, (payload: unknown) => unknown>();
  #lastWritten = new Map<number, string>();

  constructor(options: PersistenceOptionsV5<T>) {
    this.schema = options.schema;
    this.version = Math.max(1, Math.floor(options.version));
    this.maxSlots = Math.max(1, Math.min(99, Math.floor(options.maxSlots ?? 12)));
    this.maxBytes = Math.max(1024, Math.min(64 * 1024 * 1024, Math.floor(options.maxBytes ?? 2 * 1024 * 1024)));
    this.#now = options.now ?? (() => Date.now());
    this.#adapter = options.adapter;
  }

  registerMigration(fromVersion: number, migrate: (payload: unknown) => unknown): OutcomeV5<void> {
    if (!Number.isInteger(fromVersion) || fromVersion < 1 || fromVersion >= this.version) return failV5('MIGRATION_VERSION', 'Migration version must precede the current schema');
    if (this.#migrations.has(fromVersion)) return failV5('MIGRATION_EXISTS', 'Migration already exists');
    this.#migrations.set(fromVersion, migrate); return okV5(undefined);
  }

  envelope(payload: T, tick: TickV5 = tickV5(0)): PersistenceEnvelopeV5<T> { return Object.freeze({ schema: this.schema, version: this.version, tick, createdAt: this.#now(), payload, checksum: checksumV5(payload) }); }

  async save(slot: number, payload: T, tick: TickV5 = tickV5(0)): Promise<OutcomeV5<PersistenceEnvelopeV5<T>>> {
    if (!safeSlot(slot, this.maxSlots)) return failV5('SAVE_SLOT', 'Invalid save slot');
    const envelope = this.envelope(payload, tick); const encoded = JSON.stringify(envelope); const bytes = new TextEncoder().encode(encoded).byteLength;
    if (bytes > this.maxBytes) return failV5('SAVE_SIZE', 'Save exceeds configured size limit');
    try { await this.#adapter.save(slot, envelope); this.#lastWritten.set(slot, envelope.checksum); return okV5(envelope); } catch (cause) { return failV5('SAVE_WRITE', 'Save write failed', tick, 'error', true, cause); }
  }

  async load(slot: number): Promise<OutcomeV5<T | null>> {
    if (!safeSlot(slot, this.maxSlots)) return failV5('SAVE_SLOT', 'Invalid save slot');
    try {
      const envelope = await this.#adapter.load(slot);
      if (!envelope) return okV5(null);
      if (envelope.schema !== this.schema) return failV5('SAVE_SCHEMA', 'Save schema mismatch');
      if (!Number.isInteger(envelope.version) || envelope.version < 1 || envelope.version > this.version) return failV5('SAVE_VERSION', 'Unsupported save version');
      if (checksumV5(envelope.payload) !== envelope.checksum) return failV5('SAVE_CHECKSUM', 'Save checksum mismatch');
      let payload: unknown = envelope.payload;
      for (let version = envelope.version; version < this.version; version += 1) {
        const migration = this.#migrations.get(version);
        if (!migration) return failV5('SAVE_MIGRATION', `Missing migration ${version}->${version + 1}`);
        payload = migration(payload);
      }
      return okV5(payload as T);
    } catch (cause) { return failV5('SAVE_READ', 'Save read failed', tickV5(0), 'error', true, cause); }
  }

  async list(): Promise<readonly number[]> { const slots = await this.#adapter.list(); return Object.freeze(slots.filter((slot) => safeSlot(slot, this.maxSlots)).sort((a, b) => a - b)); }
  async remove(slot: number): Promise<void> { if (!safeSlot(slot, this.maxSlots)) throw new RangeError('Invalid save slot'); await this.#adapter.remove(slot); this.#lastWritten.delete(slot); }
  lastChecksum(slot: number): string | null { return this.#lastWritten.get(slot) ?? null; }
  verifyEnvelope(envelope: PersistenceEnvelopeV5<T>): boolean { return envelope.schema === this.schema && envelope.version >= 1 && envelope.version <= this.version && checksumV5(envelope.payload) === envelope.checksum; }
}

export interface RecoveryDomainHandlerV5 { readonly domain: RecoveryPlanV5['domains'][number]; readonly diagnose: () => boolean; readonly quiesce: () => void; readonly reset: () => void; readonly replay: () => void; readonly resume: () => void; }
export interface RecoveryOptionsV5 { readonly maxAttempts?: number; readonly cooldownMs?: number; readonly maxJournal?: number; readonly now?: () => number; }

export class RecoveryCoordinatorV5 {
  readonly maxAttempts: number; readonly cooldownMs: number; readonly maxJournal: number;
  #now: () => number; #handlers = new Map<string, RecoveryDomainHandlerV5>(); #journal: RecoveryJournalEntryV5[] = []; #lastRecovery = -Infinity; #attempt = 0;
  constructor(options: RecoveryOptionsV5 = {}) { this.maxAttempts = Math.max(1, Math.min(10, Math.floor(options.maxAttempts ?? 3))); this.cooldownMs = Math.max(0, options.cooldownMs ?? 1500); this.maxJournal = Math.max(16, Math.min(4096, Math.floor(options.maxJournal ?? 256))); this.#now = options.now ?? (() => Date.now()); }
  register(handler: RecoveryDomainHandlerV5): void { if (this.#handlers.has(handler.domain)) throw new Error(`Recovery domain already registered: ${handler.domain}`); this.#handlers.set(handler.domain, handler); }
  unregister(domain: string): boolean { return this.#handlers.delete(domain); }
  canRecover(): boolean { return this.#now() - this.#lastRecovery >= this.cooldownMs && this.#attempt < this.maxAttempts; }
  recover(plan: RecoveryPlanV5, tick: TickV5): RecoveryReportV5 {
    if (!this.canRecover()) return Object.freeze({ success: false, attempts: this.#attempt, recoveredDomains: [], failedDomains: ['cooldown'], journal: Object.freeze(this.#journal.slice()) });
    this.#lastRecovery = this.#now(); this.#attempt += 1;
    const recovered: string[] = []; const failed: string[] = [];
    for (const domain of plan.domains) {
      const handler = this.#handlers.get(domain); if (!handler) { failed.push(domain); this.#record(domain, 'diagnose', tick, false, 'handler-missing'); continue; }
      let healthy = false;
      try { healthy = handler.diagnose(); this.#record(domain, 'diagnose', tick, healthy, healthy ? 'healthy' : 'unhealthy'); } catch { healthy = false; this.#record(domain, 'diagnose', tick, false, 'diagnose-error'); }
      if (healthy) { recovered.push(domain); continue; }
      try { handler.quiesce(); this.#record(domain, 'quiesce', tick, true, 'quiesced'); handler.reset(); this.#record(domain, 'reset', tick, true, 'reset'); handler.replay(); this.#record(domain, 'replay', tick, true, 'replayed'); handler.resume(); this.#record(domain, 'resume', tick, true, 'resumed'); recovered.push(domain); } catch { failed.push(domain); this.#record(domain, 'resume', tick, false, 'recovery-error'); }
    }
    return Object.freeze({ success: failed.length === 0, attempts: this.#attempt, recoveredDomains: Object.freeze(recovered), failedDomains: Object.freeze(failed), journal: Object.freeze(this.#journal.slice()) });
  }
  journal(): readonly RecoveryJournalEntryV5[] { return Object.freeze(this.#journal.slice()); }
  resetAttempts(): void { this.#attempt = 0; this.#lastRecovery = -Infinity; }
  #record(domain: RecoveryDomainHandlerV5['domain'], action: RecoveryJournalEntryV5['action'], tick: TickV5, success: boolean, message: string): void { this.#journal.push(Object.freeze({ id: this.#journal.length + 1, domain, action, tick, success, message })); while (this.#journal.length > this.maxJournal) this.#journal.shift(); }
}
