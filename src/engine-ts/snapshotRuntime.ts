import type { Disposable } from './coreTypes.js';
import { stableSort } from './coreTypes.js';

export interface SnapshotRecord<T> { readonly tick: number; readonly version: number; readonly state: T; readonly checksum: string; readonly bytes: number; }
export interface PatchEntry { readonly path: string; readonly op: 'add' | 'replace' | 'remove'; readonly value?: unknown; }
export interface SnapshotStats { readonly snapshots: number; readonly bytes: number; readonly patches: number; readonly dropped: number; readonly latestTick: number; }

function canonical(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`; }
function checksum(value: unknown): string { const text = canonical(value); let h = 2166136261; for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
function size(value: unknown): number { return new TextEncoder().encode(canonical(value)).byteLength; }
function walk(before: unknown, after: unknown, path: string, patches: PatchEntry[]): void {
  if (Object.is(before, after)) return;
  if (before === undefined) { patches.push({ path, op: 'add', value: after }); return; }
  if (after === undefined) { patches.push({ path, op: 'remove' }); return; }
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') { patches.push({ path, op: 'replace', value: after }); return; }
  if (Array.isArray(before) !== Array.isArray(after)) { patches.push({ path, op: 'replace', value: after }); return; }
  if (Array.isArray(before) && Array.isArray(after)) { const length = Math.max(before.length, after.length); for (let i = 0; i < length; i += 1) walk(before[i], after[i], `${path}/${i}`, patches); return; }
  const beforeObject = before as Record<string, unknown>; const afterObject = after as Record<string, unknown>; const keys = new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]); for (const key of [...keys].sort()) walk(beforeObject[key], afterObject[key], `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, patches);
}
function getPath(target: any, path: string): unknown { if (!path) return target; let value = target; for (const part of path.slice(1).split('/').map(item => item.replaceAll('~1', '/').replaceAll('~0', '~'))) { if (value === null || value === undefined) return undefined; value = value[part]; } return value; }
function applyPatch<T>(state: T, patch: PatchEntry): T { const parts = patch.path ? patch.path.slice(1).split('/').map(item => item.replaceAll('~1', '/').replaceAll('~0', '~')) : []; if (!parts.length) return patch.op === 'remove' ? undefined as T : patch.value as T; const root: any = structuredClone(state); let cursor: any = root; for (let i = 0; i < parts.length - 1; i += 1) { const key = parts[i]!; cursor[key] ??= Number.isInteger(Number(parts[i + 1])) ? [] : {}; cursor = cursor[key]; } const leaf = parts.at(-1)!; if (patch.op === 'remove') Array.isArray(cursor) ? cursor.splice(Number(leaf), 1) : delete cursor[leaf]; else cursor[leaf] = patch.value; return root as T; }

export class SnapshotRuntime<T> implements Disposable {
  readonly maxSnapshots: number; readonly maxBytes: number;
  #snapshots: SnapshotRecord<T>[] = []; #patches: PatchEntry[][] = []; #bytes = 0; #dropped = 0; #disposed = false;
  constructor(maxSnapshots = 64, maxBytes = 32 * 1024 * 1024) { this.maxSnapshots = Math.max(4, Math.trunc(maxSnapshots)); this.maxBytes = Math.max(1024 * 1024, Math.trunc(maxBytes)); }
  capture(tick: number, state: T, version = 1): SnapshotRecord<T> | null { if (this.#disposed) return null; const record: SnapshotRecord<T> = Object.freeze({ tick: Math.max(0, Math.trunc(tick)), version, state, checksum: checksum(state), bytes: size(state) }); if (record.bytes > this.maxBytes) { this.#dropped += 1; return null; } const previous = this.#snapshots.at(-1); if (previous) this.#patches.push(this.diff(previous.state, state)); else this.#patches.push([]); this.#snapshots.push(record); this.#bytes += record.bytes; while (this.#snapshots.length > this.maxSnapshots || this.#bytes > this.maxBytes) { const removed = this.#snapshots.shift(); this.#patches.shift(); if (removed) this.#bytes = Math.max(0, this.#bytes - removed.bytes); this.#dropped += 1; } return record; }
  diff(before: T, after: T): readonly PatchEntry[] { const patches: PatchEntry[] = []; walk(before, after, '', patches); return Object.freeze(patches); }
  apply(state: T, patches: readonly PatchEntry[]): T { let next = state; for (const patch of patches) next = applyPatch(next, patch); return next; }
  find(tick: number): SnapshotRecord<T> | null { let best: SnapshotRecord<T> | null = null; for (const snapshot of this.#snapshots) if (snapshot.tick <= tick && (!best || snapshot.tick > best.tick)) best = snapshot; return best; }
  latest(): SnapshotRecord<T> | null { return this.#snapshots.at(-1) ?? null; }
  verify(snapshot: SnapshotRecord<T>): boolean { return checksum(snapshot.state) === snapshot.checksum && snapshot.bytes === size(snapshot.state); }
  snapshots(): readonly SnapshotRecord<T>[] { return Object.freeze(this.#snapshots.slice()); }
  stats(): SnapshotStats { return Object.freeze({ snapshots: this.#snapshots.length, bytes: this.#bytes, patches: this.#patches.length, dropped: this.#dropped, latestTick: this.#snapshots.at(-1)?.tick ?? 0 }); }
  dispose(): void { this.#disposed = true; this.#snapshots.length = 0; this.#patches.length = 0; this.#bytes = 0; }
}

export const stablePatchSort = (patches: readonly PatchEntry[]): readonly PatchEntry[] => Object.freeze(stableSort(patches, (a, b) => a.path.localeCompare(b.path) || a.op.localeCompare(b.op)));
