export type StateVersion = number;
export type StatePath = readonly (string | number)[];

export interface StateChange<T> {
  readonly version: StateVersion;
  readonly previous: T;
  readonly next: T;
  readonly changedPaths: readonly StatePath[];
  readonly timestamp: number;
  readonly label: string;
}

export interface StateTransaction<T> {
  readonly baseVersion: StateVersion;
  readonly label: string;
  readonly draft: T;
  readonly commit: () => StateChange<T>;
  readonly rollback: () => void;
}

export interface StateStoreOptions<T> {
  readonly initial: T;
  readonly clone?: (value: T) => T;
  readonly freeze?: boolean;
  readonly historyLimit?: number;
  readonly onChange?: (change: StateChange<T>) => void;
}

export type Equality<T> = (a: T, b: T) => boolean;
export type Selector<S, U> = (state: S) => U;
export type StateListener<S, U> = (value: U, previous: U, state: S, change: StateChange<S>) => void;

const identity = <T>(value: T): T => value;
const defaultEquality = <T>(a: T, b: T): boolean => Object.is(a, b);

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as T;
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as object)) result[key] = deepClone(item);
    return result as T;
  }
  return value;
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const child of Object.values(value as object)) deepFreeze(child);
  return value;
}

export function cloneForState<T>(value: T): T {
  return deepClone(value);
}

const pathString = (path: StatePath): string => path.map(String).join('.');

export function diffState(previous: unknown, next: unknown, basePath: StatePath = []): StatePath[] {
  if (Object.is(previous, next)) return [];
  if (Array.isArray(previous) && Array.isArray(next)) {
    const paths: StatePath[] = [];
    const length = Math.max(previous.length, next.length);
    for (let index = 0; index < length; index += 1) paths.push(...diffState(previous[index], next[index], [...basePath, index]));
    return paths.length ? paths : [basePath];
  }
  if (previous && next && typeof previous === 'object' && typeof next === 'object') {
    const keys = new Set([...Object.keys(previous as object), ...Object.keys(next as object)]);
    const paths: StatePath[] = [];
    for (const key of [...keys].sort()) paths.push(...diffState((previous as Record<string, unknown>)[key], (next as Record<string, unknown>)[key], [...basePath, key]));
    return paths.length ? paths : [basePath];
  }
  return [basePath];
}

export class TransactionalStateStore<T> {
  #state: T;
  #version = 0;
  readonly #clone: (value: T) => T;
  readonly #freeze: boolean;
  readonly #historyLimit: number;
  readonly #history: StateChange<T>[] = [];
  readonly #subscriptions = new Set<{ selector: Selector<T, unknown>; equality: Equality<unknown>; listener: StateListener<T, unknown>; last: unknown }>();
  readonly #onChange?: (change: StateChange<T>) => void;

  constructor(options: StateStoreOptions<T>) {
    this.#clone = options.clone ?? cloneForState;
    this.#freeze = options.freeze ?? false;
    this.#historyLimit = Math.max(0, Math.floor(options.historyLimit ?? 128));
    this.#state = this.#prepare(options.initial);
    this.#onChange = options.onChange;
  }

  #prepare(value: T): T {
    const cloned = this.#clone(value);
    return this.#freeze ? deepFreeze(cloned) : cloned;
  }

  get version(): StateVersion { return this.#version; }
  get state(): T { return this.#state; }
  snapshot(): T { return this.#clone(this.#state); }

  read<U>(selector: Selector<T, U>): U { return selector(this.#state); }

  subscribe<U>(selector: Selector<T, U>, listener: StateListener<T, U>, equality: Equality<U> = defaultEquality): () => void {
    const record = {
      selector: selector as Selector<T, unknown>,
      equality: equality as Equality<unknown>,
      listener: listener as StateListener<T, unknown>,
      last: selector(this.#state),
    };
    this.#subscriptions.add(record);
    return () => this.#subscriptions.delete(record);
  }

  transaction(label = 'transaction'): StateTransaction<T> {
    const draft = this.#clone(this.#state);
    const baseVersion = this.#version;
    let active = true;
    const commit = (): StateChange<T> => {
      if (!active) throw new Error('Transaction already closed');
      active = false;
      if (baseVersion !== this.#version) throw new Error('State changed while transaction was open');
      return this.#commit(draft, label);
    };
    const rollback = (): void => { active = false; };
    return { baseVersion, label, draft, commit, rollback };
  }

  set(next: T, label = 'set'): StateChange<T> {
    return this.#commit(this.#clone(next), label);
  }

  update(updater: (draft: T) => void, label = 'update'): StateChange<T> {
    const draft = this.#clone(this.#state);
    updater(draft);
    return this.#commit(draft, label);
  }

  #commit(candidate: T, label: string): StateChange<T> {
    const previous = this.#state;
    const next = this.#prepare(candidate);
    const changedPaths = diffState(previous, next).filter((path) => path.length > 0);
    this.#version += 1;
    const change: StateChange<T> = Object.freeze({
      version: this.#version,
      previous,
      next,
      changedPaths,
      timestamp: Date.now(),
      label,
    });
    this.#state = next;
    if (this.#historyLimit > 0) {
      this.#history.push(change);
      while (this.#history.length > this.#historyLimit) this.#history.shift();
    }
    this.#notify(change);
    this.#onChange?.(change);
    return change;
  }

  #notify(change: StateChange<T>): void {
    for (const subscription of [...this.#subscriptions]) {
      const nextValue = subscription.selector(this.#state);
      if (subscription.equality(subscription.last, nextValue)) continue;
      const previousValue = subscription.last;
      subscription.last = nextValue;
      subscription.listener(nextValue, previousValue, this.#state, change);
    }
  }

  history(): readonly StateChange<T>[] { return [...this.#history]; }

  undo(): StateChange<T> | undefined {
    const previous = this.#history.at(-2)?.next;
    if (previous === undefined) return undefined;
    return this.#commit(this.#clone(previous), 'undo');
  }

  replaceSilently(next: T, version = this.#version + 1): void {
    if (!Number.isSafeInteger(version) || version < 0) throw new RangeError('State version invalid');
    this.#state = this.#prepare(next);
    this.#version = version;
    for (const subscription of this.#subscriptions) subscription.last = subscription.selector(this.#state);
  }

  toJSON(): string { return JSON.stringify({ version: this.#version, state: this.#state }); }

  pathValues(paths: readonly StatePath[]): Readonly<Record<string, unknown>> {
    const output: Record<string, unknown> = {};
    for (const path of paths) {
      let current: unknown = this.#state;
      for (const segment of path) {
        if (current === null || current === undefined || typeof current !== 'object') { current = undefined; break; }
        current = (current as Record<string | number, unknown>)[segment];
      }
      output[pathString(path)] = current;
    }
    return output;
  }
}

export interface StatePatch<T> { readonly version: number; readonly label: string; readonly apply: (state: T) => T; }

export class StatePatchQueue<T> {
  readonly #queue: StatePatch<T>[] = [];
  #lastVersion = -1;

  push(patch: StatePatch<T>): void {
    if (!Number.isSafeInteger(patch.version) || patch.version < 0) throw new RangeError('Patch version invalid');
    if (patch.version <= this.#lastVersion) throw new Error('Patch versions must increase monotonically');
    this.#queue.push(patch);
    this.#lastVersion = patch.version;
  }

  drain(state: T): T {
    let result = state;
    for (const patch of this.#queue) result = patch.apply(result);
    this.#queue.length = 0;
    return result;
  }

  get size(): number { return this.#queue.length; }
  get lastVersion(): number { return this.#lastVersion; }
}
