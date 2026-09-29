export interface PoolableR25 {
  reset(): void;
}

export interface ObjectPoolOptionsR25<T> {
  readonly factory: () => T;
  readonly reset?: (value: T) => void;
  readonly maxRetained?: number;
  readonly preallocate?: number;
}

export interface ObjectPoolSnapshotR25 {
  readonly capacity: number;
  readonly available: number;
  readonly checkedOut: number;
  readonly allocations: number;
  readonly releases: number;
  readonly rejectedReleases: number;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

export class ObjectPoolR25<T> {
  readonly #factory: () => T;
  readonly #reset: (value: T) => void;
  readonly #maxRetained: number;
  readonly #free: T[] = [];
  readonly #inUse = new Set<T>();

  #allocations = 0;
  #releases = 0;
  #rejectedReleases = 0;
  #disposed = false;

  public constructor(options: ObjectPoolOptionsR25<T>) {
    if (typeof options.factory !== 'function') {
      throw new Error('R25_POOL_FACTORY_REQUIRED');
    }
    this.#factory = options.factory;
    this.#reset = options.reset ?? ((value) => {
      const candidate = value as T & Partial<PoolableR25>;
      candidate.reset?.();
    });
    this.#maxRetained = Math.max(1, Math.trunc(options.maxRetained ?? 1024));

    const preallocate = Math.min(
      this.#maxRetained,
      Math.max(0, Math.trunc(options.preallocate ?? 0)),
    );

    for (let index = 0; index < preallocate; index += 1) {
      this.#free.push(this.#create());
    }
  }

  public acquire(): T {
    this.#assertLive();
    const value = this.#free.pop() ?? this.#create();
    this.#inUse.add(value);
    return value;
  }

  public release(value: T): boolean {
    this.#assertLive();

    if (!this.#inUse.delete(value)) {
      this.#rejectedReleases += 1;
      return false;
    }

    this.#reset(value);
    this.#releases += 1;

    if (this.#free.length < this.#maxRetained) {
      this.#free.push(value);
    }

    return true;
  }

  public releaseMany(values: readonly T[]): number {
    let count = 0;
    for (const value of values) {
      if (this.release(value)) count += 1;
    }
    return count;
  }

  public drain(visitor?: (value: T) => void): void {
    this.#assertLive();
    for (const value of this.#free.splice(0)) {
      visitor?.(value);
    }
  }

  public snapshot(): ObjectPoolSnapshotR25 {
    return freeze({
      capacity: this.#free.length + this.#inUse.size,
      available: this.#free.length,
      checkedOut: this.#inUse.size,
      allocations: this.#allocations,
      releases: this.#releases,
      rejectedReleases: this.#rejectedReleases,
    });
  }

  public clear(visitor?: (value: T) => void): void {
    this.#assertLive();
    for (const value of this.#free) visitor?.(value);
    for (const value of this.#inUse) visitor?.(value);
    this.#free.length = 0;
    this.#inUse.clear();
  }

  public dispose(visitor?: (value: T) => void): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear(visitor);
  }

  #create(): T {
    const value = this.#factory();
    this.#allocations += 1;
    return value;
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R25_POOL_DISPOSED');
  }
}

export interface PoolLeaseR25<T> {
  readonly value: T;
  readonly release: () => boolean;
}

export function leaseFromPoolR25<T>(
  pool: ObjectPoolR25<T>,
): PoolLeaseR25<T> {
  const value = pool.acquire();
  let released = false;

  return freeze({
    value,
    release: () => {
      if (released) return false;
      released = pool.release(value);
      return released;
    },
  });
}
