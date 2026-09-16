export interface StateContext<TData> { readonly data: TData; readonly tick: number; }
export interface StateDefinition<TData> {
  readonly id: string;
  readonly enter?: (context: StateContext<TData>) => void;
  readonly update?: (context: StateContext<TData>) => string | void;
  readonly exit?: (context: StateContext<TData>) => void;
  readonly transitions?: readonly string[];
}

export interface TransitionRecord { readonly from: string; readonly to: string; readonly tick: number; }

export class StateMachine<TData> {
  #states = new Map<string, StateDefinition<TData>>();
  #current?: string;
  #history: TransitionRecord[] = [];
  #historyLimit: number;

  constructor(historyLimit = 128) { this.#historyLimit = Math.max(8, Math.floor(historyLimit)); }
  register(state: StateDefinition<TData>): void {
    const id = state.id.trim();
    if (!id) throw new TypeError('state id required');
    if (this.#states.has(id)) throw new Error(`duplicate state: ${id}`);
    this.#states.set(id, { ...state, id });
  }
  start(id: string, data: TData, tick: number): void {
    if (this.#current) throw new Error('state machine already started');
    const state = this.#states.get(id);
    if (!state) throw new Error(`state not found: ${id}`);
    this.#current = id;
    state.enter?.({ data, tick });
  }
  transition(id: string, data: TData, tick: number): boolean {
    const next = this.#states.get(id);
    const current = this.#current ? this.#states.get(this.#current) : undefined;
    if (!next || !current || this.#current === id) return false;
    if (current.transitions && !current.transitions.includes(id)) return false;
    current.exit?.({ data, tick });
    const previous = this.#current;
    this.#current = id;
    next.enter?.({ data, tick });
    this.#history.push({ from: previous, to: id, tick });
    if (this.#history.length > this.#historyLimit) this.#history.shift();
    return true;
  }
  update(data: TData, tick: number): string | undefined {
    const state = this.#current ? this.#states.get(this.#current) : undefined;
    if (!state) return undefined;
    const requested = state.update?.({ data, tick });
    if (requested && requested !== this.#current) this.transition(requested, data, tick);
    return this.#current;
  }
  current(): string | undefined { return this.#current; }
  history(): readonly TransitionRecord[] { return this.#history; }
  reset(): void { this.#current = undefined; this.#history.length = 0; }
}

export type LifecyclePhase = 'created' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
export class LifecycleGuard {
  #phase: LifecyclePhase = 'created';
  get phase(): LifecyclePhase { return this.#phase; }
  start(): boolean {
    if (this.#phase !== 'created' && this.#phase !== 'stopped') return false;
    this.#phase = 'starting';
    this.#phase = 'running';
    return true;
  }
  stop(): boolean {
    if (this.#phase !== 'running') return false;
    this.#phase = 'stopping';
    this.#phase = 'stopped';
    return true;
  }
  fail(): void { this.#phase = 'failed'; }
  canUpdate(): boolean { return this.#phase === 'running'; }
}
