export interface ReducerAction<T> {
  readonly type: string;
  readonly payload: T;
}

export type Reducer<T, A> =
  (
    state: T,
    action: ReducerAction<A>,
  ) => T;

export class DeterministicReducerStore<
  T,
  A,
> {
  #state: T;
  #reducer: Reducer<T, A>;
  #actions: ReducerAction<A>[] = [];
  readonly maxActions: number;

  constructor(
    initial: T,
    reducer: Reducer<T, A>,
    maxActions = 4096,
  ) {
    this.#state = initial;
    this.#reducer = reducer;
    this.maxActions = Math.max(
      32,
      Math.trunc(maxActions),
    );
  }

  dispatch(
    action: ReducerAction<A>,
  ): Readonly<T> {
    if (!action.type.trim()) {
      throw new Error(
        'REDUCER_ACTION_INVALID',
      );
    }

    const next =
      this.#reducer(
        this.#state,
        action,
      );

    if (next === undefined) {
      throw new Error(
        'REDUCER_RETURNED_UNDEFINED',
      );
    }

    this.#state = next;
    this.#actions.push(
      Object.freeze({
        type: action.type,
        payload: action.payload,
      }),
    );

    while (
      this.#actions.length
      > this.maxActions
    ) {
      this.#actions.shift();
    }

    return this.#state;
  }

  state(): Readonly<T> {
    return this.#state;
  }

  actions():
    readonly ReducerAction<A>[] {
    return Object.freeze([
      ...this.#actions,
    ]);
  }

  replace(state: T): void {
    this.#state = state;
  }

  clear(): void {
    this.#actions = [];
  }

  size(): number {
    return this.#actions.length;
  }
}
