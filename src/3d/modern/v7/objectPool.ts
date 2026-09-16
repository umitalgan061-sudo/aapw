import { clamp, integer, type Disposable } from './primitives.js';

export interface PoolStats { readonly capacity: number; readonly allocated: number; readonly active: number; readonly free: number; readonly created: number; readonly recycled: number; readonly rejected: number; }

export class BoundedObjectPool<T> implements Disposable {
  readonly capacity: number;
  readonly factory: () => T;
  readonly reset?: (value: T) => void;
  #free: T[] = [];
  #active = new Set<T>();
  #created = 0;
  #recycled = 0;
  #rejected = 0;
  #disposed = false;
  constructor(factory: () => T, capacity = 256, reset?: (value: T) => void) {
    this.factory = factory;
    this.capacity = clamp(integer(capacity), 1, 100_000);
    this.reset = reset;
  }
  acquire(): T | null {
    if (this.#disposed) return null;
    if (this.#free.length) {
      const value = this.#free.pop()!;
      this.#active.add(value);
      this.#recycled += 1;
      return value;
    }
    if (this.#active.size >= this.capacity) {
      this.#rejected += 1;
      return null;
    }
    const value = this.factory();
    this.#created += 1;
    this.#active.add(value);
    return value;
  }
  release(value: T): boolean {
    if (this.#disposed || !this.#active.delete(value)) return false;
    try { this.reset?.(value); } catch { return false; }
    this.#free.push(value);
    return true;
  }
  releaseMany(values: readonly T[]): number {
    let released = 0;
    for (const value of values) released += Number(this.release(value));
    return released;
  }
  active(): readonly T[] { return Object.freeze([...this.#active]); }
  clear(): void {
    for (const value of this.#active) { try { this.reset?.(value); } catch { /* reset isolation */ } }
    for (const value of this.#free) { try { this.reset?.(value); } catch { /* reset isolation */ } }
    this.#active.clear();
    this.#free.length = 0;
  }
  stats(): PoolStats { return Object.freeze({ capacity: this.capacity, allocated: this.#active.size + this.#free.length, active: this.#active.size, free: this.#free.length, created: this.#created, recycled: this.#recycled, rejected: this.#rejected }); }
  dispose(): void { this.#disposed = true; this.clear(); }
}

export function prewarmPool<T>(pool: BoundedObjectPool<T>, count: number): number {
  const held: T[] = [];
  for (let index = 0; index < clamp(integer(count), 0, 100_000); index += 1) {
    const value = pool.acquire();
    if (value === null) break;
    held.push(value);
  }
  return pool.releaseMany(held);
}
