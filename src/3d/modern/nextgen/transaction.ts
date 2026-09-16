export interface TransactionOperation<T> {
  readonly label: string;
  readonly apply: () => T;
  readonly rollback: (value: T) => void;
}

export interface TransactionResult<T> {
  committed: boolean;
  values: T[];
  failedAt?: string;
  error?: Error;
}

export class RuntimeTransaction<T> {
  readonly #operations: TransactionOperation<T>[] = [];
  #active = false;

  add(operation: TransactionOperation<T>): this {
    if (this.#active) throw new Error('Cannot add operation after transaction starts');
    if (!operation.label.trim()) throw new Error('Transaction label is required');
    this.#operations.push(operation);
    return this;
  }

  run(): TransactionResult<T> {
    if (this.#active) throw new Error('Transaction already running');
    this.#active = true;
    const values: T[] = [];
    const applied: TransactionOperation<T>[] = [];
    try {
      for (const operation of this.#operations) {
        const value = operation.apply();
        values.push(value);
        applied.push(operation);
      }
      return { committed: true, values };
    } catch (error) {
      for (let index = applied.length - 1; index >= 0; index -= 1) {
        try { applied[index].rollback(values[index]); } catch { /* best-effort rollback */ }
      }
      const failedAt = this.#operations[applied.length]?.label;
      return {
        committed: false,
        values: [],
        failedAt,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } finally {
      this.#active = false;
    }
  }

  get size(): number { return this.#operations.length; }
  clear(): void { if (!this.#active) this.#operations.length = 0; }
}

export interface AtomicValue<T> {
  get(): T;
  set(value: T): void;
}

export function atomic<T>(initial: T): AtomicValue<T> {
  let value = initial;
  return {
    get: () => value,
    set: (next) => { value = next; },
  };
}

export function withRollback<T>(target: AtomicValue<T>, next: T, label: string): TransactionOperation<T> {
  let previous: T;
  return {
    label,
    apply: () => {
      previous = target.get();
      target.set(next);
      return previous;
    },
    rollback: () => target.set(previous),
  };
}
