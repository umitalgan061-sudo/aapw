export type StateId = string;

export interface TransitionContext<TEvent = unknown> {
  readonly from: StateId;
  readonly to: StateId;
  readonly event?: TEvent;
  readonly timestamp: number;
}

export interface StateDefinition<TContext, TEvent = unknown> {
  readonly id: StateId;
  readonly enter?: (context: TContext, transition: TransitionContext<TEvent>) => void;
  readonly update?: (context: TContext, deltaSeconds: number) => void;
  readonly exit?: (context: TContext, transition: TransitionContext<TEvent>) => void;
}

export interface StateTransition<TEvent = unknown> {
  readonly from: StateId | '*';
  readonly event: string;
  readonly to: StateId;
  readonly guard?: (event: TEvent) => boolean;
  readonly priority?: number;
}

export class DeterministicStateMachine<TContext, TEvent = unknown> {
  readonly #states = new Map<StateId, StateDefinition<TContext, TEvent>>();
  readonly #transitions = new Map<StateId | '*', StateTransition<TEvent>[]>();
  #current: StateId;
  #entered = false;

  constructor(initial: StateId, states: readonly StateDefinition<TContext, TEvent>[], transitions: readonly StateTransition<TEvent>[] = []) {
    this.#current = initial;
    for (const state of states) this.addState(state);
    for (const transition of transitions) this.addTransition(transition);
    if (!this.#states.has(initial)) throw new Error(`Unknown initial state: ${initial}`);
  }

  get current(): StateId { return this.#current; }
  get entered(): boolean { return this.#entered; }

  addState(state: StateDefinition<TContext, TEvent>): void {
    if (this.#states.has(state.id)) throw new Error(`Duplicate state: ${state.id}`);
    this.#states.set(state.id, state);
  }

  addTransition(transition: StateTransition<TEvent>): void {
    if (transition.to !== '*' && !this.#states.has(transition.to)) {
      throw new Error(`Transition target not registered: ${transition.to}`);
    }
    const bucket = this.#transitions.get(transition.from) ?? [];
    bucket.push(transition);
    bucket.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.#transitions.set(transition.from, bucket);
  }

  start(context: TContext, timestamp = 0): void {
    if (this.#entered) return;
    const state = this.#states.get(this.#current)!;
    state.enter?.(context, { from: this.#current, to: this.#current, timestamp });
    this.#entered = true;
  }

  dispatch(event: string, payload: TEvent, context: TContext, timestamp: number): boolean {
    const candidates = [
      ...(this.#transitions.get(this.#current) ?? []),
      ...(this.#transitions.get('*') ?? []),
    ];
    const transition = candidates.find((candidate) => candidate.event === event && (!candidate.guard || candidate.guard(payload)));
    if (!transition) return false;
    if (transition.to === this.#current) return false;
    const from = this.#current;
    const fromState = this.#states.get(from)!;
    const toStateId = transition.to;
    if (!this.#states.has(toStateId)) throw new Error(`Unknown transition target: ${toStateId}`);
    const toState = this.#states.get(toStateId)!;
    const detail: TransitionContext<TEvent> = { from, to: toStateId, event: payload, timestamp };
    fromState.exit?.(context, detail);
    this.#current = toStateId;
    toState.enter?.(context, detail);
    return true;
  }

  update(context: TContext, deltaSeconds: number): void {
    if (!this.#entered) this.start(context, 0);
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Invalid state update delta');
    this.#states.get(this.#current)?.update?.(context, deltaSeconds);
  }

  reset(state: StateId, context: TContext, timestamp = 0): void {
    if (!this.#states.has(state)) throw new Error(`Unknown reset state: ${state}`);
    if (this.#entered) this.#states.get(this.#current)?.exit?.(context, { from: this.#current, to: state, timestamp });
    this.#current = state;
    this.#entered = true;
    this.#states.get(state)?.enter?.(context, { from: state, to: state, timestamp });
  }

  describe(): { current: StateId; states: string[]; transitionCount: number } {
    let transitionCount = 0;
    for (const transitions of this.#transitions.values()) transitionCount += transitions.length;
    return { current: this.#current, states: [...this.#states.keys()].sort(), transitionCount };
  }
}

export function transition<TEvent = unknown>(from: StateId | '*', event: string, to: StateId, options: Partial<Pick<StateTransition<TEvent>, 'guard' | 'priority'>> = {}): StateTransition<TEvent> {
  return { from, event, to, guard: options.guard, priority: options.priority ?? 0 };
}

export function state<TContext, TEvent = unknown>(id: StateId, options: Omit<StateDefinition<TContext, TEvent>, 'id'> = {}): StateDefinition<TContext, TEvent> {
  return { id, ...options };
}
