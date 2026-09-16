import type { Disposable, EngineResult, EntityId, Sequence } from './types.js';
import { clamp } from './deterministic.js';

export class RingBuffer<T> implements Disposable {
  private readonly capacity: number;
  private readonly values: Array<T | undefined>;
  private head = 0;
  private length = 0;
  private _disposed = false;

  public constructor(capacity = 64) {
    this.capacity = Math.max(1, Math.trunc(capacity));
    this.values = new Array<T | undefined>(this.capacity);
  }

  public get disposed(): boolean { return this._disposed; }
  public get size(): number { return this.length; }
  public get maxSize(): number { return this.capacity; }
  public get isFull(): boolean { return this.length >= this.capacity; }

  public push(value: T): boolean {
    if (this._disposed) return false;
    if (this.length < this.capacity) {
      const index = (this.head + this.length) % this.capacity;
      this.values[index] = value;
      this.length += 1;
      return true;
    }
    this.values[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    return false;
  }

  public unshift(value: T): boolean {
    if (this._disposed) return false;
    this.head = (this.head - 1 + this.capacity) % this.capacity;
    this.values[this.head] = value;
    if (this.length < this.capacity) this.length += 1;
    return this.length < this.capacity;
  }

  public get(offset: number): T | undefined {
    if (offset < 0 || offset >= this.length) return undefined;
    return this.values[(this.head + Math.trunc(offset)) % this.capacity];
  }

  public atNewest(offset = 0): T | undefined { return this.get(this.length - 1 - Math.trunc(offset)); }

  public toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.length; i += 1) {
      const value = this.get(i);
      if (value !== undefined) result.push(value);
    }
    return result;
  }

  public drain(max = this.length): T[] {
    if (this._disposed) return [];
    const count = Math.min(this.length, Math.max(0, Math.trunc(max)));
    const result: T[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = this.values[this.head];
      if (value !== undefined) result.push(value);
      this.values[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.length -= 1;
    }
    return result;
  }

  public clear(): void {
    this.values.fill(undefined);
    this.head = 0;
    this.length = 0;
  }

  public dispose(): void { this.clear(); this._disposed = true; }
}

export interface PriorityItem<T> { readonly value: T; readonly priority: number; readonly sequence: Sequence; }

export class BoundedPriorityQueue<T> implements Disposable {
  private readonly capacity: number;
  private readonly items: PriorityItem<T>[] = [];
  private sequence = 0;
  private _disposed = false;

  public constructor(capacity = 256) { this.capacity = Math.max(1, Math.trunc(capacity)); }
  public get disposed(): boolean { return this._disposed; }
  public get size(): number { return this.items.length; }

  public push(value: T, priority = 0): EngineResult<void> {
    if (this._disposed) return { ok: false, meta: { status: 'disposed', code: 'QUEUE_DISPOSED' } };
    const item: PriorityItem<T> = { value, priority: clamp(priority, -1e9, 1e9), sequence: (this.sequence += 1) as Sequence };
    this.items.push(item);
    this.items.sort(comparePriority);
    let status: 'ok' | 'overflow' = 'ok';
    if (this.items.length > this.capacity) { this.items.pop(); status = 'overflow'; }
    return { ok: status === 'ok', meta: { status, code: status === 'ok' ? 'QUEUED' : 'QUEUE_FULL' } };
  }

  public peek(): T | undefined { return this.items[0]?.value; }
  public pop(): T | undefined { return this.items.shift()?.value; }
  public drain(max = this.items.length): T[] {
    const count = Math.max(0, Math.min(this.items.length, Math.trunc(max)));
    return this.items.splice(0, count).map(item => item.value);
  }
  public snapshot(): readonly PriorityItem<T>[] { return this.items.map(item => Object.freeze({ ...item })); }
  public clear(): void { this.items.length = 0; }
  public dispose(): void { this.clear(); this._disposed = true; }
}

const comparePriority = <T>(a: PriorityItem<T>, b: PriorityItem<T>): number => {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return (a.sequence as number) - (b.sequence as number);
};

export class LruCache<K, V> implements Disposable {
  private readonly capacity: number;
  private readonly map = new Map<K, V>();
  private _disposed = false;

  public constructor(capacity = 256) { this.capacity = Math.max(1, Math.trunc(capacity)); }
  public get disposed(): boolean { return this._disposed; }
  public get size(): number { return this.map.size; }

  public has(key: K): boolean { return !this._disposed && this.map.has(key); }
  public get(key: K): V | undefined {
    if (this._disposed) return undefined;
    const value = this.map.get(key);
    if (value !== undefined) { this.map.delete(key); this.map.set(key, value); }
    return value;
  }
  public set(key: K, value: V): void {
    if (this._disposed) return;
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
  }
  public delete(key: K): boolean { return !this._disposed && this.map.delete(key); }
  public entries(): IterableIterator<readonly [K, V]> { return this.map.entries(); }
  public values(): IterableIterator<V> { return this.map.values(); }
  public clear(): void { this.map.clear(); }
  public dispose(): void { this.clear(); this._disposed = true; }
}

export class BitSet implements Disposable {
  private readonly words: Uint32Array;
  private _disposed = false;
  public constructor(size = 1024) { this.words = new Uint32Array(Math.max(1, Math.ceil(size / 32))); }
  public get disposed(): boolean { return this._disposed; }
  public get size(): number { return this.words.length * 32; }
  public has(index: number): boolean {
    const bit = Math.trunc(index);
    if (bit < 0 || bit >= this.size || this._disposed) return false;
    return (this.words[bit >>> 5] & (1 << (bit & 31))) !== 0;
  }
  public add(index: number): boolean {
    const bit = Math.trunc(index);
    if (bit < 0 || bit >= this.size || this._disposed) return false;
    const mask = 1 << (bit & 31);
    const word = bit >>> 5;
    const existed = (this.words[word] & mask) !== 0;
    this.words[word] |= mask;
    return !existed;
  }
  public delete(index: number): boolean {
    const bit = Math.trunc(index);
    if (bit < 0 || bit >= this.size || this._disposed) return false;
    const mask = 1 << (bit & 31);
    const word = bit >>> 5;
    const existed = (this.words[word] & mask) !== 0;
    this.words[word] &= ~mask;
    return existed;
  }
  public clear(): void { this.words.fill(0); }
  public count(): number { let total = 0; for (const word of this.words) total += popcount(word); return total; }
  public forEachSet(fn: (index: number) => void): void {
    if (this._disposed) return;
    for (let wordIndex = 0; wordIndex < this.words.length; wordIndex += 1) {
      let word = this.words[wordIndex];
      while (word !== 0) {
        const low = word & -word;
        const bitIndex = 31 - Math.clz32(low >>> 0);
        fn(wordIndex * 32 + bitIndex);
        word &= word - 1;
      }
    }
  }
  public dispose(): void { this.clear(); this._disposed = true; }
}

const popcount = (value: number): number => {
  let x = value >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

export class SparseSet implements Disposable {
  private readonly dense: number[] = [];
  private readonly sparse: Int32Array;
  private _disposed = false;
  public constructor(maxId = 65536) { this.sparse = new Int32Array(Math.max(1, Math.trunc(maxId))).fill(-1); }
  public get disposed(): boolean { return this._disposed; }
  public get size(): number { return this.dense.length; }
  public has(value: number): boolean {
    const id = Math.trunc(value);
    return !this._disposed && id >= 0 && id < this.sparse.length && this.sparse[id] >= 0 && this.dense[this.sparse[id]] === id;
  }
  public add(value: number): boolean {
    const id = Math.trunc(value);
    if (id < 0 || id >= this.sparse.length || this._disposed || this.has(id)) return false;
    this.sparse[id] = this.dense.length;
    this.dense.push(id);
    return true;
  }
  public delete(value: number): boolean {
    const id = Math.trunc(value);
    if (!this.has(id)) return false;
    const index = this.sparse[id];
    const last = this.dense[this.dense.length - 1];
    if (index !== this.dense.length - 1 && last !== undefined) {
      this.dense[index] = last;
      this.sparse[last] = index;
    }
    this.dense.pop();
    this.sparse[id] = -1;
    return true;
  }
  public values(): readonly number[] { return this.dense; }
  public clear(): void { this.dense.length = 0; this.sparse.fill(-1); }
  public dispose(): void { this.clear(); this._disposed = true; }
}

export const stableEntityList = (entities: readonly EntityId[]): EntityId[] => {
  return [...new Set(entities)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
};
