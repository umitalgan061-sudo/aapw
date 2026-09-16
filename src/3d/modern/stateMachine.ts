export type TransitionTable<S extends string, E extends string> = Readonly<Record<S, Partial<Record<E, S>>>>;

export interface TransitionEvent<S extends string, E extends string> {
  readonly from: S;
  readonly to: S;
  readonly event: E;
}

/** Explicit finite-state machine for game modes, editor modes and async lifecycle gates. */
export class StateMachine<S extends string, E extends string> {
  private stateValue: S;
  private readonly table: TransitionTable<S, E>;
  private readonly history: TransitionEvent<S, E>[] = [];
  private maxHistory: number;

  public constructor(initial: S, table: TransitionTable<S, E>, maxHistory = 128) {
    this.stateValue = initial;
    this.table = table;
    this.maxHistory = Math.max(1, maxHistory);
  }

  public state(): S { return this.stateValue; }
  public can(event: E): boolean { return this.table[this.stateValue]?.[event] !== undefined; }

  public transition(event: E): TransitionEvent<S, E> {
    const next = this.table[this.stateValue]?.[event];
    if (next === undefined) throw new Error(`INVALID_TRANSITION:${String(this.stateValue)}:${String(event)}`);
    const transition = { from: this.stateValue, to: next, event };
    this.stateValue = next;
    this.history.push(transition);
    if (this.history.length > this.maxHistory) this.history.shift();
    return transition;
  }

  public historySnapshot(): readonly TransitionEvent<S, E>[] { return this.history.map((entry) => ({ ...entry })); }
  public reset(initial: S): void { this.stateValue = initial; this.history.length = 0; }
}

export type RuntimeMode = 'gameplay' | 'menu' | 'photo' | 'editor' | 'loading';
export type RuntimeModeEvent = 'open-menu' | 'close-menu' | 'open-photo' | 'close-photo' | 'open-editor' | 'close-editor' | 'load' | 'finish-load';

export const createRuntimeModeMachine = (): StateMachine<RuntimeMode, RuntimeModeEvent> => new StateMachine('loading', {
  loading: { 'finish-load': 'gameplay' },
  gameplay: { 'open-menu': 'menu', 'open-photo': 'photo', 'open-editor': 'editor', 'load': 'loading' },
  menu: { 'close-menu': 'gameplay', 'load': 'loading' },
  photo: { 'close-photo': 'gameplay' },
  editor: { 'close-editor': 'gameplay' },
});

export interface Transaction<T> {
  readonly value: T;
  readonly committed: boolean;
}

export const transactional = <T>(snapshot: () => T, mutate: () => void, restore: (value: T) => void): Transaction<T> => {
  const before = snapshot();
  try {
    mutate();
    return { value: snapshot(), committed: true };
  } catch (error) {
    restore(before);
    throw error;
  }
};
