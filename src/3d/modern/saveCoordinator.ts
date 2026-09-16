import type { Result, SaveSlot, UnixMillis } from './types';
import { checksum, stableStringify } from './deterministic';
import { SaveSystem } from './saveSystem';
import type { ReplayRecording, SessionSaveHooks, SessionSavePayload, SessionSettings, SessionSnapshot } from './runtimeContracts';

export interface SaveJournalEntry {
  readonly id: string;
  readonly slot: number;
  readonly reason: string;
  readonly requestedAt: UnixMillis;
  readonly completedAt: UnixMillis | null;
  readonly success: boolean;
  readonly checksum: string | null;
  readonly errorCode?: string;
}

export interface SaveCoordinatorOptions {
  readonly schema?: string;
  readonly version?: number;
  readonly maxSlots?: number;
  readonly slot?: number;
  readonly autoSaveMinutes?: number;
  readonly minimumSaveIntervalMs?: number;
  readonly maxJournalEntries?: number;
  readonly now?: () => UnixMillis;
  readonly hooks?: SessionSaveHooks;
}

export interface SaveCoordinatorStatus {
  readonly enabled: boolean;
  readonly activeSlot: number;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly queuedReason: string | null;
  readonly lastSaveAt: UnixMillis | null;
  readonly nextAutoSaveAt: UnixMillis | null;
  readonly successfulSaves: number;
  readonly failedSaves: number;
}

export interface SaveCoordinatorPayloadFactory {
  (): SessionSavePayload;
}

const DEFAULT_SCHEMA = 'aapw-runtime-session';
const DEFAULT_VERSION = 4;
const DEFAULT_SLOT = 0;
const DEFAULT_AUTOSAVE_MINUTES = 3;
const DEFAULT_MIN_INTERVAL_MS = 15_000;
const DEFAULT_JOURNAL_ENTRIES = 64;

function validSlot(slot: number, maxSlots: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < maxSlots;
}

function sanitizeInterval(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1000, Math.trunc(value));
}

/**
 * Adds a transactional, debounced persistence policy on top of SaveSystem.
 *
 * The coordinator is deliberately browser-agnostic apart from SaveSystem's adapter. It can therefore
 * be reused in tests, editor previews and headless simulations. It never mutates a caller's payload;
 * the payload is frozen before entering the write queue and a checksum is attached to every journal item.
 */
export class SaveCoordinator {
  readonly system: SaveSystem<SessionSavePayload>;
  readonly maxJournalEntries: number;
  #now: () => UnixMillis;
  #autoSaveMs: number;
  #minimumSaveIntervalMs: number;
  #activeSlot: number;
  #dirty = false;
  #saving = false;
  #queuedReason: string | null = null;
  #lastSaveAt: UnixMillis | null = null;
  #nextAutoSaveAt: UnixMillis | null = null;
  #successfulSaves = 0;
  #failedSaves = 0;
  #sequence = 0;
  #journal: SaveJournalEntry[] = [];
  #payloadFactory: SaveCoordinatorPayloadFactory | null = null;
  #settings: SessionSettings | null = null;
  #hooks: SessionSaveHooks;
  #queue: Promise<void> = Promise.resolve();
  #onDirty?: (dirty: boolean) => void;
  #onJournal?: (entry: SaveJournalEntry) => void;

  constructor(options: SaveCoordinatorOptions = {}) {
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
    const maxSlots = Math.max(1, Math.min(99, Math.trunc(options.maxSlots ?? 12)));
    this.#activeSlot = validSlot(options.slot ?? DEFAULT_SLOT, maxSlots) ? Math.trunc(options.slot ?? DEFAULT_SLOT) : 0;
    this.maxJournalEntries = Math.max(8, Math.min(512, Math.trunc(options.maxJournalEntries ?? DEFAULT_JOURNAL_ENTRIES)));
    this.#autoSaveMs = sanitizeInterval((options.autoSaveMinutes ?? DEFAULT_AUTOSAVE_MINUTES) * 60_000, DEFAULT_AUTOSAVE_MINUTES * 60_000);
    this.#minimumSaveIntervalMs = sanitizeInterval(options.minimumSaveIntervalMs, DEFAULT_MIN_INTERVAL_MS);
    this.#hooks = options.hooks ?? {};
    this.system = new SaveSystem<SessionSavePayload>({
      schema: options.schema ?? DEFAULT_SCHEMA,
      version: Math.max(2, Math.trunc(options.version ?? DEFAULT_VERSION)),
      maxSlots,
      now: this.#now,
    });
    this.#registerDefaultMigrations();
    this.#scheduleNextAutoSave();
  }

  configure(payloadFactory: SaveCoordinatorPayloadFactory, settings: SessionSettings, options: { onDirty?: (dirty: boolean) => void; onJournal?: (entry: SaveJournalEntry) => void } = {}): void {
    this.#payloadFactory = payloadFactory;
    this.#settings = Object.freeze({ ...settings });
    this.#onDirty = options.onDirty;
    this.#onJournal = options.onJournal;
  }

  get status(): SaveCoordinatorStatus {
    return Object.freeze({
      enabled: this.#payloadFactory !== null,
      activeSlot: this.#activeSlot,
      dirty: this.#dirty,
      saving: this.#saving,
      queuedReason: this.#queuedReason,
      lastSaveAt: this.#lastSaveAt,
      nextAutoSaveAt: this.#nextAutoSaveAt,
      successfulSaves: this.#successfulSaves,
      failedSaves: this.#failedSaves,
    });
  }

  markDirty(reason = 'runtime-change'): void {
    const wasDirty = this.#dirty;
    this.#dirty = true;
    this.#queuedReason = reason;
    if (!wasDirty) this.#onDirty?.(true);
  }

  clearDirty(): void {
    this.#dirty = false;
    this.#queuedReason = null;
    this.#onDirty?.(false);
  }

  setActiveSlot(slot: number): Result<number> {
    if (!validSlot(slot, this.system.maxSlots)) {
      return { ok: false, error: { code: 'SAVE_COORDINATOR_SLOT_INVALID', message: 'Save slot is outside the configured range', retryable: false } };
    }
    if (this.#saving) {
      return { ok: false, error: { code: 'SAVE_COORDINATOR_BUSY', message: 'Cannot change slots while saving', retryable: true } };
    }
    this.#activeSlot = slot;
    this.#scheduleNextAutoSave();
    return { ok: true, value: slot };
  }

  requestSave(reason = 'manual', slot = this.#activeSlot): Promise<Result<void>> {
    this.markDirty(reason);
    return this.#enqueueSave(slot, reason, false);
  }

  requestAutoSave(now = this.#now()): Promise<Result<void> | null> {
    if (this.#payloadFactory === null || !this.#dirty) return Promise.resolve(null);
    if (this.#saving) return Promise.resolve(null);
    if (this.#lastSaveAt !== null && now - this.#lastSaveAt < this.#minimumSaveIntervalMs) return Promise.resolve(null);
    if (this.#nextAutoSaveAt !== null && now < this.#nextAutoSaveAt) return Promise.resolve(null);
    return this.#enqueueSave(this.#activeSlot, 'autosave', true);
  }

  tick(now = this.#now()): Promise<Result<void> | null> {
    if (this.#payloadFactory === null) return Promise.resolve(null);
    if (!this.#dirty || this.#saving) return Promise.resolve(null);
    if (this.#lastSaveAt !== null && now - this.#lastSaveAt < this.#minimumSaveIntervalMs) return Promise.resolve(null);
    if (this.#nextAutoSaveAt === null) this.#scheduleNextAutoSave(now);
    if (this.#nextAutoSaveAt !== null && now >= this.#nextAutoSaveAt) return this.requestAutoSave(now);
    return Promise.resolve(null);
  }

  async load(slot = this.#activeSlot): Promise<Result<SessionSavePayload | null>> {
    const result = await this.system.load(slot);
    if (!result.ok) return result;
    if (result.value) {
      this.#activeSlot = slot;
      this.#dirty = false;
      this.#queuedReason = null;
      this.#lastSaveAt = this.#now();
      this.#scheduleNextAutoSave();
      this.#onDirty?.(false);
    }
    return result;
  }

  async list(): Promise<readonly SaveSlot[]> {
    return this.system.list();
  }

  async delete(slot: number): Promise<Result<void>> {
    if (!validSlot(slot, this.system.maxSlots)) {
      return { ok: false, error: { code: 'SAVE_COORDINATOR_SLOT_INVALID', message: 'Save slot is outside the configured range', retryable: false } };
    }
    try {
      await this.system.remove(slot);
      if (slot === this.#activeSlot) this.clearDirty();
      return { ok: true, value: undefined };
    } catch (cause) {
      return { ok: false, error: { code: 'SAVE_COORDINATOR_DELETE_FAILED', message: String(cause), retryable: true, cause } };
    }
  }

  journal(): readonly SaveJournalEntry[] {
    return Object.freeze(this.#journal.map((entry) => Object.freeze({ ...entry })));
  }

  diagnostics(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      status: this.status,
      journal: this.journal(),
      schema: this.system.schema,
      version: this.system.version,
      maxSlots: this.system.maxSlots,
      payloadConfigured: Boolean(this.#payloadFactory),
      settings: this.#settings,
    });
  }

  #enqueueSave(slot: number, reason: string, autosave: boolean): Promise<Result<void>> {
    let resolveResult!: (result: Result<void>) => void;
    const resultPromise = new Promise<Result<void>>((resolve) => { resolveResult = resolve; });
    this.#queue = this.#queue.then(async () => {
      resolveResult(await this.#performSave(slot, reason, autosave));
    });
    return resultPromise;
  }

  async #performSave(slot: number, reason: string, autosave: boolean): Promise<Result<void>> {
    if (!validSlot(slot, this.system.maxSlots)) {
      return { ok: false, error: { code: 'SAVE_COORDINATOR_SLOT_INVALID', message: 'Save slot is outside the configured range', retryable: false } };
    }
    if (!this.#payloadFactory) {
      return { ok: false, error: { code: 'SAVE_COORDINATOR_UNCONFIGURED', message: 'No session payload factory is configured', retryable: false } };
    }
    this.#saving = true;
    this.#queuedReason = reason;
    const requestedAt = this.#now();
    const id = `save-${requestedAt}-${this.#sequence++}`;
    let journal: SaveJournalEntry;
    try {
      const rawPayload = this.#payloadFactory();
      const prepared = this.#hooks.beforeSave ? await this.#hooks.beforeSave(rawPayload) : rawPayload;
      const payload = this.#freezePayload(prepared);
      const result = await this.system.save(slot, payload);
      if (!result.ok) {
        this.#failedSaves += 1;
        journal = { id, slot, reason, requestedAt, completedAt: this.#now(), success: false, checksum: null, errorCode: result.error.code };
        this.#recordJournal(journal);
        if (!autosave) this.#queuedReason = reason;
        return result;
      }
      this.#successfulSaves += 1;
      this.#lastSaveAt = this.#now();
      this.clearDirty();
      this.#scheduleNextAutoSave(this.#lastSaveAt);
      journal = { id, slot, reason, requestedAt, completedAt: this.#lastSaveAt, success: true, checksum: result.value.checksum };
      this.#recordJournal(journal);
      await this.#hooks.afterSave?.(payload);
      return { ok: true, value: undefined };
    } catch (cause) {
      this.#failedSaves += 1;
      journal = { id, slot, reason, requestedAt, completedAt: this.#now(), success: false, checksum: null, errorCode: 'SAVE_COORDINATOR_EXCEPTION' };
      this.#recordJournal(journal);
      return { ok: false, error: { code: 'SAVE_COORDINATOR_EXCEPTION', message: String(cause), retryable: true, cause } };
    } finally {
      this.#saving = false;
    }
  }

  #freezePayload(payload: SessionSavePayload): SessionSavePayload {
    const snapshot = this.#freezeSnapshot(payload.snapshot);
    const replay = payload.replay ? Object.freeze({
      header: Object.freeze({ ...payload.replay.header }),
      frames: Object.freeze(payload.replay.frames.map((frame) => Object.freeze({
        frame: frame.frame,
        timestamp: frame.timestamp,
        actions: Object.freeze(frame.actions.map((event) => Object.freeze({ ...event }))),
      }))),
      checksum: payload.replay.checksum,
    }) : undefined;
    const metadata = Object.freeze({ ...payload.metadata });
    return Object.freeze({ settings: Object.freeze({ ...payload.settings }), snapshot, ...(replay ? { replay } : {}), metadata });
  }

  #freezeSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
    return Object.freeze({
      ...snapshot,
      player: Object.freeze({
        ...snapshot.player,
        position: Object.freeze({ ...snapshot.player.position }),
        velocity: Object.freeze({ ...snapshot.player.velocity }),
      }),
      camera: Object.freeze({
        ...snapshot.camera,
        position: Object.freeze({ ...snapshot.camera.position }),
        target: Object.freeze({ ...snapshot.camera.target }),
      }),
      world: Object.freeze({
        ...snapshot.world,
        loadedCells: Object.freeze([...snapshot.world.loadedCells]),
        discoveredSettlements: Object.freeze([...snapshot.world.discoveredSettlements]),
      }),
      runtime: Object.freeze({ ...snapshot.runtime }),
      digest: String(snapshot.digest),
    });
  }

  #recordJournal(entry: SaveJournalEntry): void {
    this.#journal.push(Object.freeze({ ...entry }));
    while (this.#journal.length > this.maxJournalEntries) this.#journal.shift();
    this.#onJournal?.(entry);
  }

  #scheduleNextAutoSave(now = this.#now()): void {
    this.#nextAutoSaveAt = now + this.#autoSaveMs;
  }

  #registerDefaultMigrations(): void {
    this.system.registerMigration(1, (payload) => ({ settings: payload, snapshot: {}, metadata: { migratedFrom: 1 }, __legacy: true }));
    this.system.registerMigration(2, (payload) => ({ ...(payload as Record<string, unknown>), metadata: { ...((payload as Record<string, unknown>).metadata as Record<string, unknown> ?? {}), migratedFrom: 2 } }));
    this.system.registerMigration(3, (payload) => {
      const data = payload as Record<string, unknown>;
      const metadata = typeof data.metadata === 'object' && data.metadata ? data.metadata as Record<string, unknown> : {};
      return { ...data, metadata: { ...metadata, migrationStamp: 'runtime-v4' } };
    });
  }
}

export interface SaveRecoveryReport {
  readonly inspected: number;
  readonly valid: number;
  readonly invalid: number;
  readonly newestValidSlot: number | null;
  readonly errors: readonly { readonly slot: number; readonly code: string }[];
}

/** Inspects all slots without mutating them and returns the newest recoverable save. */
export async function inspectSaveRecovery(coordinator: SaveCoordinator): Promise<SaveRecoveryReport> {
  const slots = await coordinator.list();
  const errors: { slot: number; code: string }[] = [];
  let valid = 0;
  let newestValidSlot: number | null = null;
  let newestTime = -Infinity;
  for (const slot of slots) {
    const result = await coordinator.load(slot.slot);
    if (!result.ok) {
      errors.push({ slot: slot.slot, code: result.error.code });
      continue;
    }
    if (!result.value) continue;
    valid += 1;
    const time = Number(slot.updatedAt);
    if (time > newestTime) {
      newestTime = time;
      newestValidSlot = slot.slot;
    }
  }
  return Object.freeze({ inspected: slots.length, valid, invalid: errors.length, newestValidSlot, errors: Object.freeze(errors.map((error) => Object.freeze(error))) });
}

export function savePayloadDigest(payload: SessionSavePayload): string {
  return checksum(stableStringify(payload));
}

export function replaySummary(replay: ReplayRecording | undefined): Readonly<Record<string, number | string>> {
  if (!replay) return Object.freeze({ frames: 0, durationMs: 0, actions: 0, checksum: '' });
  const actions = replay.frames.reduce((count, frame) => count + frame.actions.length, 0);
  const durationMs = replay.frames.length ? Math.max(0, Number(replay.frames[replay.frames.length - 1]?.timestamp ?? 0) - Number(replay.frames[0]?.timestamp ?? 0)) : 0;
  return Object.freeze({ frames: replay.frames.length, durationMs, actions, checksum: replay.checksum });
}
