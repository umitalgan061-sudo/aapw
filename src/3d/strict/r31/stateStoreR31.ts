import type { RuntimeEventR31 } from './applicationTypesR31.ts';
import { EventBusR31 } from './eventBusR31.ts';

export interface StateChangeR31<T> {
  readonly key: string;
  readonly previous: T;
  readonly next: T;
  readonly version: number;
}

export interface StateStoreDiagnosticsR31 {
  readonly keys: number;
  readonly writes: number;
  readonly deletes: number;
  readonly version: number;
}

export class StateStoreR31<T extends object> {
  readonly #state: T;
  readonly #events: EventBusR31;
  #version = 0;
  #writes = 0;
  #deletes = 0;
  #disposed = false;

  constructor(initialState: T, events = new EventBusR31()) {
    this.#state = { ...initialState };
    this.#events = events;
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.#state[key];
  }

  has<K extends keyof T>(key: K): boolean {
    return Object.prototype.hasOwnProperty.call(this.#state, key);
  }

  snapshot(): Readonly<T> {
    return Object.freeze({ ...this.#state });
  }

  set<K extends keyof T>(key: K, next: T[K]): boolean {
    if (this.#disposed) return false;
    const previous = this.#state[key];
    if (Object.is(previous, next)) return false;
    this.#state[key] = next;
    this.#version++;
    this.#writes++;
    const change: StateChangeR31<T[K]> = Object.freeze({
      key: String(key),
      previous,
      next,
      version: this.#version,
    });
    this.#events.setTick(this.#version);
    this.#events.emit<StateChangeR31<T[K]>>(`state:${String(key)}`, change);
    return true;
  }

  update(patch: Partial<T>): number {
    let changed = 0;
    for (const key of Object.keys(patch) as Array<keyof T>) {
      if (this.set(key, patch[key]!)) changed++;
    }
    return changed;
  }

  delete<K extends keyof T>(key: K): boolean {
    if (this.#disposed || !this.has(key)) return false;
    delete (this.#state as Partial<T>)[key];
    this.#version++;
    this.#deletes++;
    this.#events.setTick(this.#version);
    this.#events.emit(`state:${String(key)}:deleted`, { key: String(key), version: this.#version });
    return true;
  }

  on<K extends keyof T>(key: K, handler: (change: StateChangeR31<T[K]>) => void): () => void {
    const subscription = this.#events.on<StateChangeR31<T[K]>>(`state:${String(key)}`, (event: RuntimeEventR31<StateChangeR31<T[K]>>) => {
      handler(event.payload);
    });
    return subscription.dispose;
  }

  diagnostics(): StateStoreDiagnosticsR31 {
    return Object.freeze({
      keys: Object.keys(this.#state).length,
      writes: this.#writes,
      deletes: this.#deletes,
      version: this.#version,
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#events.dispose();
  }
}
