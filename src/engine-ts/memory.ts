import type { Disposable } from './types.js';
import { clamp } from './deterministic.js';

export interface AllocationStats { readonly capacity: number; readonly active: number; readonly highWaterMark: number; readonly allocations: number; readonly releases: number; readonly rejected: number; readonly bytesEstimate: number; }

export class ObjectPool<T extends object> implements Disposable {
  private readonly factory: () => T;
  private readonly resetter: (value: T) => void;
  private readonly capacity: number;
  private readonly free: T[] = [];
  private readonly active = new Set<T>();
  private highWaterMark = 0;
  private allocations = 0;
  private releases = 0;
  private rejected = 0;
  private _disposed = false;

  public constructor(factory: () => T, resetter: (value: T) => void = () => undefined, capacity = 1024) {
    this.factory = factory;
    this.resetter = resetter;
    this.capacity = Math.max(1, Math.trunc(capacity));
  }
  public get disposed(): boolean { return this._disposed; }
  public get stats(): AllocationStats { return Object.freeze({ capacity: this.capacity, active: this.active.size, highWaterMark: this.highWaterMark, allocations: this.allocations, releases: this.releases, rejected: this.rejected, bytesEstimate: this.active.size * 64 }); }
  public acquire(): T | undefined {
    if (this._disposed || this.active.size >= this.capacity) { this.rejected += 1; return undefined; }
    const value = this.free.pop() ?? this.factory();
    this.active.add(value);
    this.allocations += 1;
    this.highWaterMark = Math.max(this.highWaterMark, this.active.size);
    return value;
  }
  public release(value: T): boolean {
    if (this._disposed || !this.active.delete(value)) return false;
    try { this.resetter(value); } catch { /* reset isolation */ }
    if (this.free.length < this.capacity) this.free.push(value);
    this.releases += 1;
    return true;
  }
  public releaseAll(): void { for (const value of [...this.active]) this.release(value); }
  public clearFree(): void { this.free.length = 0; }
  public dispose(): void { if (this._disposed) return; this.releaseAll(); this.clearFree(); this._disposed = true; }
}

export interface BudgetLedgerOptions { readonly maxBytes: number; readonly maxHandles: number; readonly maxGroups: number; }
export interface AllocationReceipt { readonly accepted: boolean; readonly group: string; readonly bytes: number; readonly handles: number; readonly usageBytes: number; readonly usageHandles: number; readonly reason: string; }

export class MemoryBudgetLedger implements Disposable {
  private readonly options: BudgetLedgerOptions;
  private readonly groups = new Map<string, { bytes: number; handles: number; pinned: boolean }>();
  private _disposed = false;
  private revision = 0;

  public constructor(options: Partial<BudgetLedgerOptions> = {}) {
    this.options = Object.freeze({ maxBytes: Math.max(1024, Math.trunc(options.maxBytes ?? 512 * 1024 * 1024)), maxHandles: Math.max(16, Math.trunc(options.maxHandles ?? 8192)), maxGroups: Math.max(4, Math.trunc(options.maxGroups ?? 256)) });
  }
  public get disposed(): boolean { return this._disposed; }
  public get usage(): { readonly bytes: number; readonly handles: number; readonly bytesRatio: number; readonly handlesRatio: number; readonly groups: number; readonly revision: number } {
    let bytes = 0; let handles = 0;
    for (const item of this.groups.values()) { bytes += item.bytes; handles += item.handles; }
    return Object.freeze({ bytes, handles, bytesRatio: bytes / this.options.maxBytes, handlesRatio: handles / this.options.maxHandles, groups: this.groups.size, revision: this.revision });
  }
  public reserve(group: string, bytes: number, handles = 1, pinned = false): AllocationReceipt {
    if (this._disposed) return this.receipt(group, 0, 0, false, 'disposed');
    const safeBytes = Math.max(0, Math.trunc(bytes));
    const safeHandles = Math.max(0, Math.trunc(handles));
    const current = this.groups.get(group) ?? { bytes: 0, handles: 0, pinned };
    if (!this.groups.has(group) && this.groups.size >= this.options.maxGroups) return this.receipt(group, safeBytes, safeHandles, false, 'group-limit');
    const usage = this.usage;
    if (usage.bytes + safeBytes > this.options.maxBytes) return this.receipt(group, safeBytes, safeHandles, false, 'byte-limit');
    if (usage.handles + safeHandles > this.options.maxHandles) return this.receipt(group, safeBytes, safeHandles, false, 'handle-limit');
    current.bytes += safeBytes; current.handles += safeHandles; current.pinned = current.pinned || pinned;
    this.groups.set(group, current); this.revision += 1;
    return this.receipt(group, safeBytes, safeHandles, true, 'reserved');
  }
  public release(group: string, bytes: number, handles = 1): AllocationReceipt {
    if (this._disposed) return this.receipt(group, 0, 0, false, 'disposed');
    const current = this.groups.get(group);
    if (!current) return this.receipt(group, 0, 0, false, 'group-missing');
    current.bytes = Math.max(0, current.bytes - Math.max(0, Math.trunc(bytes)));
    current.handles = Math.max(0, current.handles - Math.max(0, Math.trunc(handles)));
    if (current.bytes === 0 && current.handles === 0 && !current.pinned) this.groups.delete(group);
    this.revision += 1;
    return this.receipt(group, Math.max(0, Math.trunc(bytes)), Math.max(0, Math.trunc(handles)), true, 'released');
  }
  public pin(group: string): boolean { const current = this.groups.get(group); if (!current) return false; current.pinned = true; this.revision += 1; return true; }
  public unpin(group: string): boolean { const current = this.groups.get(group); if (!current) return false; current.pinned = false; this.revision += 1; return true; }
  public rebalance(targetRatio = 0.85): readonly string[] {
    const target = clamp(targetRatio, 0.1, 0.99); const victims = [...this.groups.entries()].filter(([, value]) => !value.pinned).sort((a, b) => (b[1].bytes - a[1].bytes) || a[0].localeCompare(b[0])); const released: string[] = [];
    for (const [name, value] of victims) { if (this.usage.bytesRatio <= target && this.usage.handlesRatio <= target) break; this.groups.delete(name); released.push(name); }
    if (released.length) this.revision += 1;
    return Object.freeze(released);
  }
  public snapshot(): readonly (AllocationReceipt & { readonly pinned: boolean })[] {
    return Object.freeze([...this.groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([group, value]) => Object.freeze({ group, bytes: value.bytes, handles: value.handles, usageBytes: this.usage.bytes, usageHandles: this.usage.handles, accepted: true, reason: 'snapshot', pinned: value.pinned })));
  }
  public clear(): void { this.groups.clear(); this.revision += 1; }
  public dispose(): void { if (this._disposed) return; this.clear(); this._disposed = true; }
  private receipt(group: string, bytes: number, handles: number, accepted: boolean, reason: string): AllocationReceipt { const usage = this.usage; return Object.freeze({ group, bytes, handles, accepted, usageBytes: usage.bytes, usageHandles: usage.handles, reason }); }
}

export interface Handle<T> { readonly id: number; readonly generation: number; readonly value: T; }
export class HandleTable<T> implements Disposable {
  private readonly values = new Map<number, { generation: number; value: T }>();
  private nextId = 1;
  private _disposed = false;
  public get disposed(): boolean { return this._disposed; }
  public allocate(value: T): Handle<T> | undefined { if (this._disposed) return undefined; const id = this.nextId++; const generation = 1; this.values.set(id, { generation, value }); return Object.freeze({ id, generation, value }); }
  public get(handle: Pick<Handle<T>, 'id' | 'generation'>): T | undefined { const entry = this.values.get(handle.id); return entry?.generation === handle.generation ? entry.value : undefined; }
  public release(handle: Pick<Handle<T>, 'id' | 'generation'>): boolean { const entry = this.values.get(handle.id); if (!entry || entry.generation !== handle.generation) return false; this.values.delete(handle.id); return true; }
  public clear(): void { this.values.clear(); }
  public dispose(): void { this.clear(); this._disposed = true; }
}
