/**
 * Transactional, versioned save-state coordinator.
 *
 * A host adapter can map R44SaveStore to IndexedDB, OPFS, a native filesystem, or a
 * server. The coordinator itself verifies canonical content, uses optimistic
 * revision checks, and requires an explicit migration path for schema evolution.
 */
import {
  R44BoundaryError,
  R44InvariantError,
  type R44Fingerprint,
  type R44JsonValue,
  type R44SaveId,
  r44AsSaveId,
  r44FiniteInteger,
  r44NormalizeId,
  r44NormalizeLabel,
} from "./contracts.js";
import { r44CanonicalClone, r44Fingerprint } from "./hash.js";

export interface R44SaveEnvelope {
  readonly formatVersion: 1;
  readonly id: R44SaveId;
  readonly schema: string;
  readonly schemaRevision: number;
  readonly revision: number;
  readonly savedTick: number;
  readonly parentFingerprint: R44Fingerprint | null;
  readonly contentFingerprint: R44Fingerprint;
  readonly state: R44JsonValue;
  readonly metadata: Readonly<Record<string, R44JsonValue>>;
}

export interface R44SaveWriteOptions {
  readonly expectedRevision?: number;
  readonly expectedParentFingerprint?: R44Fingerprint | null;
  readonly savedTick: number;
  readonly metadata?: Readonly<Record<string, R44JsonValue>>;
}

export interface R44SaveCommitResult {
  readonly committed: boolean;
  readonly envelope: R44SaveEnvelope | null;
  readonly conflict: "revision" | "parent-fingerprint" | "schema" | "invalid" | null;
  readonly message: string | null;
}

export interface R44SaveStore {
  read(id: R44SaveId): Promise<R44SaveEnvelope | null>;
  writeAtomic(envelope: R44SaveEnvelope, expectedRevision: number | null): Promise<boolean>;
  delete(id: R44SaveId, expectedRevision?: number): Promise<boolean>;
  list(): Promise<readonly R44SaveEnvelope[]>;
}

export type R44SaveMigration = (state: R44JsonValue) => R44JsonValue;

export interface R44MigrationRegistration {
  readonly schema: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly migrate: R44SaveMigration;
}

export interface R44SaveCoordinatorOptions {
  readonly maxStateBytes?: number;
  readonly maxMetadataKeys?: number;
  readonly currentSchema: string;
  readonly currentSchemaRevision: number;
}

export class R44SaveMigrationRegistry {
  readonly #migrations = new Map<string, R44MigrationRegistration>();

  register(registration: R44MigrationRegistration): void {
    const schema = r44NormalizeId(registration.schema, "schema", 128);
    const fromRevision = r44FiniteInteger(registration.fromRevision, "fromRevision", 1, 1_000_000);
    const toRevision = r44FiniteInteger(registration.toRevision, "toRevision", fromRevision + 1, 1_000_000);
    if (typeof registration.migrate !== "function") throw new R44BoundaryError("migration-callback", "Migration callback is required");
    const key = this.#key(schema, fromRevision, toRevision);
    if (this.#migrations.has(key)) throw new R44InvariantError("migration-duplicate", "Migration path already registered", { key });
    this.#migrations.set(key, Object.freeze({ ...registration, schema, fromRevision, toRevision }));
  }

  path(schema: string, fromRevision: number, toRevision: number): readonly R44MigrationRegistration[] {
    const normalizedSchema = r44NormalizeId(schema, "schema", 128);
    const from = r44FiniteInteger(fromRevision, "fromRevision", 1);
    const to = r44FiniteInteger(toRevision, "toRevision", 1);
    if (from === to) return Object.freeze([]);
    if (from > to) throw new R44BoundaryError("migration-downgrade", "Downgrade migrations are not supported");
    const path: R44MigrationRegistration[] = [];
    let current = from;
    const visited = new Set<number>();
    while (current < to) {
      if (visited.has(current)) throw new R44InvariantError("migration-cycle", "Migration cycle detected", { schema, current });
      visited.add(current);
      const next = [...this.#migrations.values()]
        .filter((candidate) => candidate.schema === normalizedSchema && candidate.fromRevision === current && candidate.toRevision <= to)
        .sort((a, b) => a.toRevision - b.toRevision)[0];
      if (next === undefined) throw new R44BoundaryError("migration-path-missing", "No migration path from " + current + " to " + to);
      path.push(next);
      current = next.toRevision;
    }
    if (current !== to) throw new R44BoundaryError("migration-path-gap", "Migration path ended at an incompatible revision");
    return Object.freeze(path);
  }

  apply(schema: string, fromRevision: number, toRevision: number, stateInput: R44JsonValue): R44JsonValue {
    let state = r44CanonicalClone(stateInput);
    for (const migration of this.path(schema, fromRevision, toRevision)) {
      state = r44CanonicalClone(migration.migrate(state));
    }
    return state;
  }

  list(): readonly R44MigrationRegistration[] {
    return Object.freeze([...this.#migrations.values()].sort((a, b) =>
      a.schema.localeCompare(b.schema) || a.fromRevision - b.fromRevision || a.toRevision - b.toRevision));
  }

  #key(schema: string, from: number, to: number): string {
    return schema + "|" + from + "|" + to;
  }
}

export class R44SaveCoordinator {
  readonly #store: R44SaveStore;
  readonly #migrations: R44SaveMigrationRegistry;
  readonly #maxStateBytes: number;
  readonly #maxMetadataKeys: number;
  readonly #currentSchema: string;
  readonly #currentSchemaRevision: number;
  #commits = 0;
  #conflicts = 0;
  #rejected = 0;

  constructor(store: R44SaveStore, migrations: R44SaveMigrationRegistry, options: R44SaveCoordinatorOptions) {
    this.#store = store;
    this.#migrations = migrations;
    this.#maxStateBytes = r44FiniteInteger(options.maxStateBytes ?? 4 * 1024 * 1024, "maxStateBytes", 128, 64 * 1024 * 1024);
    this.#maxMetadataKeys = r44FiniteInteger(options.maxMetadataKeys ?? 64, "maxMetadataKeys", 1, 4096);
    this.#currentSchema = r44NormalizeId(options.currentSchema, "currentSchema", 128);
    this.#currentSchemaRevision = r44FiniteInteger(options.currentSchemaRevision, "currentSchemaRevision", 1, 1_000_000);
  }

  async commit(idInput: string, stateInput: R44JsonValue, options: R44SaveWriteOptions): Promise<R44SaveCommitResult> {
    const id = r44AsSaveId(idInput);
    const tick = r44FiniteInteger(options.savedTick, "savedTick", 0);
    const current = await this.#store.read(id);
    const expectedRevision = options.expectedRevision ?? current?.revision ?? 0;
    if (expectedRevision !== (current?.revision ?? 0)) {
      this.#conflicts += 1;
      return this.#conflict("revision", "Save revision changed before commit");
    }
    if (options.expectedParentFingerprint !== undefined && options.expectedParentFingerprint !== (current?.contentFingerprint ?? null)) {
      this.#conflicts += 1;
      return this.#conflict("parent-fingerprint", "Save parent fingerprint changed before commit");
    }
    const state = r44CanonicalClone(stateInput);
    const contentDigest = r44Fingerprint(state, { maxEncodedLength: this.#maxStateBytes });
    if (contentDigest.byteLength > this.#maxStateBytes) {
      this.#rejected += 1;
      return this.#conflict("invalid", "Save state exceeds configured size limit");
    }
    const metadata = this.#normalizeMetadata(options.metadata ?? {});
    const envelope: R44SaveEnvelope = Object.freeze({
      formatVersion: 1,
      id,
      schema: this.#currentSchema,
      schemaRevision: this.#currentSchemaRevision,
      revision: (current?.revision ?? 0) + 1,
      savedTick: tick,
      parentFingerprint: current?.contentFingerprint ?? null,
      contentFingerprint: contentDigest.fingerprint,
      state,
      metadata,
    });
    if (!await this.#store.writeAtomic(envelope, current?.revision ?? null)) {
      this.#conflicts += 1;
      return this.#conflict("revision", "Storage adapter rejected atomic revision update");
    }
    this.#commits += 1;
    return Object.freeze({ committed: true, envelope, conflict: null, message: null });
  }

  async load(idInput: string): Promise<R44SaveEnvelope | null> {
    const id = r44AsSaveId(idInput);
    const envelope = await this.#store.read(id);
    if (envelope === null) return null;
    this.#verifyEnvelope(envelope);
    const state = envelope.schema === this.#currentSchema && envelope.schemaRevision === this.#currentSchemaRevision
      ? r44CanonicalClone(envelope.state)
      : this.#migrations.apply(envelope.schema, envelope.schemaRevision, this.#currentSchemaRevision, envelope.state);
    const contentFingerprint = r44Fingerprint(state, { maxEncodedLength: this.#maxStateBytes }).fingerprint;
    return Object.freeze({
      ...envelope,
      schema: this.#currentSchema,
      schemaRevision: this.#currentSchemaRevision,
      contentFingerprint,
      state,
      metadata: Object.freeze({ ...envelope.metadata }),
    });
  }

  async delete(idInput: string, expectedRevision?: number): Promise<boolean> {
    const id = r44AsSaveId(idInput);
    const current = await this.#store.read(id);
    if (current === null) return false;
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      this.#conflicts += 1;
      return false;
    }
    return this.#store.delete(id, current.revision);
  }

  async list(): Promise<readonly Readonly<{ id: string; schema: string; revision: number; savedTick: number; fingerprint: string }>[]> {
    const envelopes = await this.#store.list();
    return Object.freeze(envelopes.map((envelope) => {
      this.#verifyEnvelope(envelope);
      return Object.freeze({
        id: envelope.id,
        schema: envelope.schema,
        revision: envelope.revision,
        savedTick: envelope.savedTick,
        fingerprint: envelope.contentFingerprint,
      });
    }));
  }

  diagnostics(): Readonly<Record<string, number>> {
    return Object.freeze({ commits: this.#commits, conflicts: this.#conflicts, rejected: this.#rejected });
  }

  #verifyEnvelope(envelope: R44SaveEnvelope): void {
    if (envelope.formatVersion !== 1) throw new R44BoundaryError("save-format", "Unsupported save format");
    r44AsSaveId(envelope.id);
    r44NormalizeId(envelope.schema, "save schema", 128);
    r44FiniteInteger(envelope.schemaRevision, "schemaRevision", 1, 1_000_000);
    r44FiniteInteger(envelope.revision, "revision", 1);
    r44FiniteInteger(envelope.savedTick, "savedTick", 0);
    const actual = r44Fingerprint(envelope.state, { maxEncodedLength: this.#maxStateBytes }).fingerprint;
    if (actual !== envelope.contentFingerprint) throw new R44BoundaryError("save-integrity", "Save content fingerprint mismatch");
  }

  #normalizeMetadata(input: Readonly<Record<string, R44JsonValue>>): Readonly<Record<string, R44JsonValue>> {
    const keys = Object.keys(input).sort();
    if (keys.length > this.#maxMetadataKeys) throw new R44BoundaryError("save-metadata-size", "Save metadata key limit exceeded");
    const output: Record<string, R44JsonValue> = Object.create(null) as Record<string, R44JsonValue>;
    for (const key of keys) {
      output[r44NormalizeLabel(key, 96)] = r44CanonicalClone(input[key] ?? null);
    }
    return Object.freeze(output);
  }

  #conflict(conflict: NonNullable<R44SaveCommitResult["conflict"]>, message: string): R44SaveCommitResult {
    return Object.freeze({ committed: false, envelope: null, conflict, message });
  }
}

export class R44MemorySaveStore implements R44SaveStore {
  readonly #saves = new Map<R44SaveId, R44SaveEnvelope>();

  async read(id: R44SaveId): Promise<R44SaveEnvelope | null> {
    return this.#saves.get(id) ?? null;
  }

  async writeAtomic(envelope: R44SaveEnvelope, expectedRevision: number | null): Promise<boolean> {
    const current = this.#saves.get(envelope.id);
    if ((current?.revision ?? null) !== expectedRevision) return false;
    if (current !== undefined && envelope.revision !== current.revision + 1) return false;
    if (current === undefined && envelope.revision !== 1) return false;
    this.#saves.set(envelope.id, r44CanonicalClone(envelope as unknown as R44JsonValue) as unknown as R44SaveEnvelope);
    return true;
  }

  async delete(id: R44SaveId, expectedRevision?: number): Promise<boolean> {
    const current = this.#saves.get(id);
    if (current === undefined || (expectedRevision !== undefined && current.revision !== expectedRevision)) return false;
    return this.#saves.delete(id);
  }

  async list(): Promise<readonly R44SaveEnvelope[]> {
    return Object.freeze([...this.#saves.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }
}
