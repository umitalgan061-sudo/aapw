import { freeze, type Revision, revision } from '../domain/contracts.ts';

export type Reducer<S, A> = (state: S, action: A) => S;
export type Selector<S, T> = (state: S) => T;
export type Equality<T> = (a: T, b: T) => boolean;
export type StoreListener<S> = (state: S, previous: S, action: unknown) => void;
export type Middleware<S, A> = (context: StoreContext<S, A>, next: (action: A) => void) => void;

export interface StoreContext<S, A> {
  readonly getState: () => S;
  readonly dispatch: (action: A) => void;
  readonly action: A;
}

export interface StoreMetrics {
  readonly actions: number;
  readonly updates: number;
  readonly noops: number;
  readonly subscribers: number;
  readonly revision: Revision;
}

export interface SubscriptionOptions<T> {
  readonly equality?: Equality<T>;
  readonly fireImmediately?: boolean;
}

const objectIs = <T>(a: T, b: T): boolean => Object.is(a, b);

export class ImmutableStore<S, A> {
  readonly #reducer: Reducer<S, A>;
  readonly #middlewares: readonly Middleware<S, A>[];
  #state: S;
  #revision = revision(0);
  #actions = 0;
  #updates = 0;
  #noops = 0;
  #listeners = new Set<StoreListener<S>>();
  #dispatching = false;
  #disposed = false;

  constructor(initialState: S, reducer: Reducer<S, A>, middlewares: readonly Middleware<S, A>[] = []) {
    this.#state = initialState;
    this.#reducer = reducer;
    this.#middlewares = [...middlewares];
  }

  getState(): S { return this.#state; }
  getRevision(): Revision { return this.#revision; }

  dispatch(action: A): void {
    if (this.#disposed) return;
    if (this.#dispatching) throw new Error('Recursive dispatch is not allowed.');
    this.#actions += 1;
    const invoke = (index: number, current: A): void => {
      const middleware = this.#middlewares[index];
      if (middleware) {
        middleware({ getState: () => this.#state, dispatch: this.dispatch.bind(this), action: current }, (nextAction) => invoke(index + 1, nextAction));
        return;
      }
      const previous = this.#state;
      const next = this.#reducer(previous, current);
      if (Object.is(next, previous)) { this.#noops += 1; return; }
      this.#state = next;
      this.#revision = revision(Number(this.#revision) + 1);
      this.#updates += 1;
      for (const listener of [...this.#listeners]) listener(this.#state, previous, current);
    };
    this.#dispatching = true;
    try { invoke(0, action); } finally { this.#dispatching = false; }
  }

  subscribe(listener: StoreListener<S>): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  select<T>(selector: Selector<S, T>, listener: (value: T, previous: T) => void, options: SubscriptionOptions<T> = {}): () => void {
    let selected = selector(this.#state);
    const equals = options.equality ?? objectIs;
    if (options.fireImmediately) listener(selected, selected);
    return this.subscribe((next) => {
      const value = selector(next);
      if (equals(value, selected)) return;
      const previous = selected;
      selected = value;
      listener(value, previous);
    });
  }

  transact(actions: readonly A[]): void {
    for (const action of actions) this.dispatch(action);
  }

  replaceState(nextState: S, action: A): void {
    if (this.#disposed || Object.is(nextState, this.#state)) return;
    const previous = this.#state;
    this.#state = nextState;
    this.#revision = revision(Number(this.#revision) + 1);
    this.#updates += 1;
    for (const listener of [...this.#listeners]) listener(this.#state, previous, action);
  }

  metrics(): StoreMetrics {
    return freeze({ actions: this.#actions, updates: this.#updates, noops: this.#noops, subscribers: this.#listeners.size, revision: this.#revision });
  }

  dispose(): void {
    this.#disposed = true;
    this.#listeners.clear();
  }
}

export interface HistoryEntry<S, A> {
  readonly index: number;
  readonly action: A;
  readonly state: S;
  readonly revision: Revision;
}

export interface HistoryOptions { readonly capacity?: number; }

export class HistoryStore<S, A> {
  readonly #store: ImmutableStore<S, A>;
  readonly #capacity: number;
  readonly #entries: HistoryEntry<S, A>[] = [];
  #cursor = -1;
  #unsubscribe: (() => void) | null = null;

  constructor(store: ImmutableStore<S, A>, options: HistoryOptions = {}) {
    this.#store = store;
    this.#capacity = Math.max(2, Math.floor(options.capacity ?? 64));
    this.#unsubscribe = store.subscribe((state, _previous, action) => {
      this.#cursor += 1;
      const entry = freeze({ index: this.#cursor, action: action as A, state, revision: store.getRevision() });
      this.#entries.splice(this.#cursor, Number.MAX_SAFE_INTEGER, entry);
      while (this.#entries.length > this.#capacity) { this.#entries.shift(); this.#cursor -= 1; }
    });
  }

  entries(): readonly HistoryEntry<S, A>[] { return [...this.#entries]; }
  canUndo(): boolean { return this.#cursor > 0; }
  canRedo(): boolean { return this.#cursor >= 0 && this.#cursor < this.#entries.length - 1; }

  undo(): S | undefined {
    if (!this.canUndo()) return undefined;
    this.#cursor -= 1;
    const entry = this.#entries[this.#cursor];
    if (!entry) return undefined;
    this.#store.replaceState(entry.state, entry.action);
    return entry.state;
  }

  redo(): S | undefined {
    if (!this.canRedo()) return undefined;
    this.#cursor += 1;
    const entry = this.#entries[this.#cursor];
    if (!entry) return undefined;
    this.#store.replaceState(entry.state, entry.action);
    return entry.state;
  }

  clear(): void { this.#entries.length = 0; this.#cursor = -1; }

  dispose(): void { this.#unsubscribe?.(); this.#unsubscribe = null; this.#entries.length = 0; this.#cursor = -1; }
}
