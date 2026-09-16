import type { Disposable, EngineResult, SerializedEnvelope } from './types.js';
import { hashString, stableSort, toHex32 } from './deterministic.js';
import { deserializeState, serializeState } from './protocol.js';
import { deepFreeze } from './validation.js';

export interface SnapshotEntry { readonly id: string; readonly version: number; readonly updatedAtTick: number; readonly data: unknown; readonly checksum: string; }
export interface SnapshotManifest { readonly schema: string; readonly version: number; readonly count: number; readonly checksum: string; readonly ids: readonly string[]; }
export interface DeltaPatch { readonly id: string; readonly version: number; readonly operations: readonly DeltaOperation[]; readonly checksum: string; }
export type DeltaOperation =
  | { readonly op: 'set'; readonly path: string; readonly value: unknown }
  | { readonly op: 'remove'; readonly path: string }
  | { readonly op: 'replace'; readonly path: string; readonly value: unknown };

export class SnapshotStore implements Disposable {
  private readonly schema: string;
  private readonly version: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, SnapshotEntry>();
  private _disposed = false;
  private revision = 0;

  public constructor(schema = 'aapw.engine.snapshot', version = 1, maxEntries = 2048) {
    this.schema = schema;
    this.version = Math.max(1, Math.trunc(version));
    this.maxEntries = Math.max(1, Math.trunc(maxEntries));
  }
  public get disposed(): boolean { return this._disposed; }
  public get size(): number { return this.entries.size; }
  public get storeRevision(): number { return this.revision; }

  public put(id: string, data: unknown, tick = 0): EngineResult<SnapshotEntry> {
    if (this._disposed) return fail('SNAPSHOT_DISPOSED');
    if (!id || id.length > 256) return fail('SNAPSHOT_ID');
    if (this.entries.size >= this.maxEntries && !this.entries.has(id)) return fail('SNAPSHOT_FULL');
    const encoded = serializeState(`${this.schema}:${id}`, this.version, deepClone(data));
    const entry = Object.freeze({ id, version: this.version, updatedAtTick: Math.max(0, Math.trunc(tick)), data: deepFreeze(deepClone(data)), checksum: encoded.checksum });
    this.entries.set(id, entry);
    this.revision += 1;
    return { ok: true, value: entry, meta: { status: 'ok', code: 'SNAPSHOT_STORED' } };
  }

  public get<T>(id: string): SnapshotEntry & { readonly data: T } | undefined {
    const entry = this.entries.get(id);
    return entry as (SnapshotEntry & { readonly data: T }) | undefined;
  }

  public restore<T>(id: string): EngineResult<T> {
    const entry = this.entries.get(id);
    if (!entry) return fail('SNAPSHOT_MISSING');
    const envelope = serializeState(`${this.schema}:${id}`, entry.version, entry.data);
    const decoded = deserializeState<T>(envelope);
    return decoded.ok ? decoded : fail('SNAPSHOT_RESTORE');
  }

  public remove(id: string): boolean {
    if (this._disposed) return false;
    const removed = this.entries.delete(id);
    if (removed) this.revision += 1;
    return removed;
  }

  public manifest(): SnapshotManifest {
    const ids = stableSort([...this.entries.keys()], (a, b) => a.localeCompare(b));
    const digest = toHex32(hashString(JSON.stringify(ids.map(id => [id, this.entries.get(id)?.checksum]))));
    return Object.freeze({ schema: this.schema, version: this.version, count: ids.length, checksum: digest, ids: Object.freeze(ids) });
  }

  public export(): SerializedEnvelope {
    const payload = stableSort([...this.entries.values()], (a, b) => a.id.localeCompare(b.id)).map(entry => ({ id: entry.id, version: entry.version, updatedAtTick: entry.updatedAtTick, data: entry.data, checksum: entry.checksum }));
    return serializeState(this.schema, this.version, payload);
  }

  public import(envelope: SerializedEnvelope, replace = false): EngineResult<number> {
    if (this._disposed) return fail('SNAPSHOT_DISPOSED');
    const decoded = deserializeState<SnapshotEntry[]>(envelope);
    if (!decoded.ok || !Array.isArray(decoded.value)) return fail('SNAPSHOT_IMPORT');
    if (replace) this.entries.clear();
    let accepted = 0;
    const ordered = stableSort(decoded.value, (a, b) => String(a.id).localeCompare(String(b.id)));
    for (const raw of ordered) {
      if (!raw || typeof raw.id !== 'string') continue;
      if (this.entries.size >= this.maxEntries && !this.entries.has(raw.id)) break;
      const candidate = Object.freeze({ id: raw.id, version: Math.max(1, Math.trunc(raw.version ?? this.version)), updatedAtTick: Math.max(0, Math.trunc(raw.updatedAtTick ?? 0)), data: deepFreeze(deepClone(raw.data)), checksum: String(raw.checksum ?? '') });
      this.entries.set(candidate.id, candidate);
      accepted += 1;
    }
    this.revision += accepted > 0 ? 1 : 0;
    return { ok: true, value: accepted, meta: { status: 'ok', code: 'SNAPSHOT_IMPORTED' } };
  }

  public clear(): void { this.entries.clear(); this.revision += 1; }
  public dispose(): void { if (this._disposed) return; this.clear(); this._disposed = true; }
}

export const diffJson = (before: unknown, after: unknown, id = 'delta', version = 1): DeltaPatch => {
  const operations: DeltaOperation[] = [];
  walkDiff('', before, after, operations);
  const canonical = stableSort(operations, (a, b) => a.path.localeCompare(b.path) || a.op.localeCompare(b.op));
  return Object.freeze({ id, version: Math.max(1, Math.trunc(version)), operations: Object.freeze(canonical), checksum: toHex32(hashString(JSON.stringify(canonical, canonicalReplacer))) });
};

export const applyDelta = (before: unknown, patch: DeltaPatch): EngineResult<unknown> => {
  const expected = toHex32(hashString(JSON.stringify(patch.operations, canonicalReplacer)));
  if (expected !== patch.checksum) return fail('DELTA_CHECKSUM');
  const root = deepClone(before);
  try {
    for (const operation of patch.operations) {
      if (operation.path === '' && operation.op !== 'remove') return { ok: true, value: deepFreeze(deepClone((operation as { value: unknown }).value)), meta: { status: 'ok', code: 'DELTA_APPLIED' } };
      applyOperation(root, operation);
    }
    return { ok: true, value: deepFreeze(root), meta: { status: 'ok', code: 'DELTA_APPLIED' } };
  } catch (error) {
    return fail('DELTA_APPLY', error instanceof Error ? error.message : 'Unknown delta application error');
  }
};

export const roundTrip = (schema: string, version: number, value: unknown): EngineResult<unknown> => {
  const envelope = serializeState(schema, version, value);
  const decoded = deserializeState<unknown>(envelope);
  if (!decoded.ok) return decoded;
  return Object.freeze({ ok: true, value: decoded.value, meta: { status: 'ok', code: 'ROUND_TRIP' } });
};

const walkDiff = (path: string, before: unknown, after: unknown, operations: DeltaOperation[]): void => {
  if (Object.is(before, after)) return;
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) {
    operations.push({ op: path ? 'replace' : 'set', path, value: deepClone(after) });
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const nextPath = `${path}/${index}`;
      if (index >= after.length) operations.push({ op: 'remove', path: nextPath });
      else if (index >= before.length) operations.push({ op: 'set', path: nextPath, value: deepClone(after[index]) });
      else walkDiff(nextPath, before[index], after[index], operations);
    }
    return;
  }
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) {
    const nextPath = `${path}/${escapePointer(key)}`;
    if (!(key in right)) operations.push({ op: 'remove', path: nextPath });
    else if (!(key in left)) operations.push({ op: 'set', path: nextPath, value: deepClone(right[key]) });
    else walkDiff(nextPath, left[key], right[key], operations);
  }
};

const applyOperation = (root: unknown, operation: DeltaOperation): void => {
  if (operation.path === '') return;
  const segments = decodePointer(operation.path);
  if (segments.length === 0) return;
  const leaf = segments.pop()!;
  let parent: any = root;
  for (const segment of segments) {
    if (parent === null || typeof parent !== 'object') throw new Error(`Non-object path segment: ${segment}`);
    parent = parent[segment];
  }
  if (parent === null || typeof parent !== 'object') throw new Error(`Non-object leaf parent: ${leaf}`);
  if (operation.op === 'remove') {
    if (Array.isArray(parent)) parent.splice(Number(leaf), 1);
    else delete parent[leaf];
    return;
  }
  parent[leaf] = deepClone(operation.value);
};

const decodePointer = (path: string): string[] => path.split('/').slice(1).map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
const escapePointer = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');
const canonicalReplacer = (key: string, value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const output: Record<string, unknown> = {};
  for (const name of Object.keys(value as Record<string, unknown>).sort()) output[name] = (value as Record<string, unknown>)[name];
  return output;
};
const deepClone = <T>(value: T): T => structuredClone(value);
const fail = <T>(code: string, message?: string): EngineResult<T> => ({ ok: false, meta: { status: 'invalid', code, ...(message ? { message } : {}) } });
