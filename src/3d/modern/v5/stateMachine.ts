export interface StateDefinition<TState extends string, TContext> {
  readonly id: TState;
  readonly enter?: (context: TContext) => void | Promise<void>;
  readonly update?: (context: TContext, deltaSeconds: number) => void | Promise<void>;
  readonly exit?: (context: TContext) => void | Promise<void>;
}

export interface TransitionDefinition<TState extends string, TContext> {
  readonly from: TState;
  readonly to: TState;
  readonly priority: number;
  readonly guard?: (context: TContext) => boolean;
}

export interface StateTransition<TState extends string> {
  readonly from: TState;
  readonly to: TState;
  readonly accepted: boolean;
}

export class StateMachineV5<TState extends string, TContext> {
  readonly #states = new Map<TState, StateDefinition<TState, TContext>>();
  readonly #transitions: readonly TransitionDefinition<TState, TContext>[];
  #current: TState;
  #entered = false;

  constructor(definitions: readonly StateDefinition<TState, TContext>[], transitions: readonly TransitionDefinition<TState, TContext>[], initial: TState) {
    for (const definition of definitions) {
      if (this.#states.has(definition.id)) throw new Error(`duplicate state: ${definition.id}`);
      this.#states.set(definition.id, definition);
    }
    if (!this.#states.has(initial)) throw new Error(`unknown initial state: ${initial}`);
    this.#transitions = [...transitions];
    this.#current = initial;
  }

  get current(): TState { return this.#current; }

  async start(context: TContext): Promise<void> {
    if (this.#entered) return;
    this.#entered = true;
    await this.#states.get(this.#current)?.enter?.(context);
  }

  async update(context: TContext, deltaSeconds: number): Promise<StateTransition<TState> | null> {
    if (!this.#entered) await this.start(context);
    await this.#states.get(this.#current)?.update?.(context, Math.max(0, deltaSeconds));
    const transition = this.#transitions
      .filter((candidate) => candidate.from === this.#current)
      .filter((candidate) => !candidate.guard || candidate.guard(context))
      .sort((a, b) => b.priority - a.priority || a.to.localeCompare(b.to))[0];
    if (!transition) return null;
    const from = this.#current;
    await this.#states.get(from)?.exit?.(context);
    this.#current = transition.to;
    await this.#states.get(this.#current)?.enter?.(context);
    return { from, to: this.#current, accepted: true };
  }

  async force(state: TState, context: TContext): Promise<StateTransition<TState>> {
    if (!this.#states.has(state)) throw new Error(`unknown state: ${state}`);
    const from = this.#current;
    if (from === state) return { from, to: state, accepted: true };
    if (this.#entered) await this.#states.get(from)?.exit?.(context);
    this.#current = state;
    if (this.#entered) await this.#states.get(state)?.enter?.(context);
    return { from, to: state, accepted: true };
  }

  has(state: TState): boolean { return this.#states.has(state); }
  states(): readonly TState[] { return [...this.#states.keys()].sort(); }
}

export const state = <TState extends string, TContext>(id: TState, hooks: Omit<StateDefinition<TState, TContext>, 'id'> = {}): StateDefinition<TState, TContext> => ({ id, ...hooks });
export const transition = <TState extends string, TContext>(from: TState, to: TState, priority = 0, guard?: (context: TContext) => boolean): TransitionDefinition<TState, TContext> => ({ from, to, priority, guard });
