import type { Disposable, FrameId, StateContext, StateDefinition, TickId, Transition } from './types.js';
import { FRAME_ID, TICK_ID } from './types.js';
import { stableSort } from './deterministic.js';

export interface StateSnapshot<TData> { readonly state: string; readonly previousState?: string; readonly enteredAtTick: TickId; readonly ageTicks: number; readonly revision: number; readonly data: TData; }
export interface TransitionRecord { readonly from: string; readonly to: string; readonly tick: TickId; readonly accepted: boolean; readonly reason: string; }

export class StateMachine<TData = unknown> implements Disposable {
  private readonly definitions = new Map<string, StateDefinition<TData>>();
  private readonly transitions: Transition<TData>[] = [];
  private readonly history: TransitionRecord[] = [];
  private readonly maxHistory: number;
  private current = '';
  private previous: string | undefined;
  private enteredAt = 0 as TickId;
  private revision = 0;
  private tick = 0 as TickId;
  private frame = 0 as FrameId;
  private data: TData;
  private _disposed = false;

  public constructor(initialData: TData, options: { maxHistory?: number } = {}) {
    this.data = initialData;
    this.maxHistory = Math.max(1, Math.trunc(options.maxHistory ?? 128));
  }
  public get disposed(): boolean { return this._disposed; }
  public get state(): string { return this.current; }
  public get stateRevision(): number { return this.revision; }
  public get stateData(): Readonly<TData> { return this.data; }

  public define(definition: StateDefinition<TData>): boolean {
    if (this._disposed || !definition.id || this.definitions.has(definition.id)) return false;
    this.definitions.set(definition.id, Object.freeze({ ...definition }));
    if (!this.current) this.current = definition.id;
    return true;
  }

  public addTransition(transition: Transition<TData>): boolean {
    if (this._disposed || !transition.from || !transition.to) return false;
    this.transitions.push(Object.freeze({ ...transition }));
    return true;
  }

  public initialize(tick: TickId = TICK_ID(0), frame: FrameId = FRAME_ID(0)): boolean {
    if (this._disposed || !this.definitions.has(this.current)) return false;
    this.tick = tick;
    this.frame = frame;
    const definition = this.definitions.get(this.current)!;
    try { definition.enter?.(this.context()); return true; } catch { return false; }
  }

  public update(tick: TickId, frame: FrameId): void {
    if (this._disposed) return;
    this.tick = tick;
    this.frame = frame;
    const currentDefinition = this.definitions.get(this.current);
    if (!currentDefinition) return;
    try { currentDefinition.update?.(this.context()); } catch { return; }
    this.resolveTransitions();
  }

  public transition(target: string, reason = 'requested'): boolean {
    if (this._disposed || target === this.current || !this.definitions.has(target)) {
      this.record(this.current, target, false, !this.definitions.has(target) ? 'missing-state' : 'no-op');
      return false;
    }
    const candidates = this.transitions.filter(item => item.from === this.current && item.to === target);
    const context = this.context();
    const allowed = candidates.length === 0 ? true : stableSort(candidates, (a, b) => (b.priority ?? 0) - (a.priority ?? 0)).some(candidate => {
      try { return candidate.guard?.(context) ?? true; } catch { return false; }
    });
    if (!allowed) { this.record(this.current, target, false, 'guard'); return false; }
    return this.change(target, reason);
  }

  public snapshot(): StateSnapshot<TData> {
    return Object.freeze({ state: this.current, ...(this.previous ? { previousState: this.previous } : {}), enteredAtTick: this.enteredAt, ageTicks: Math.max(0, Number(this.tick) - Number(this.enteredAt)), revision: this.revision, data: structuredClone(this.data) });
  }

  public transitionHistory(): readonly TransitionRecord[] { return this.history.map(item => Object.freeze({ ...item })); }
  public setData(data: TData): void { if (!this._disposed) this.data = data; }
  public reset(state = this.current): boolean {
    if (this._disposed || !this.definitions.has(state)) return false;
    this.current = state;
    this.previous = undefined;
    this.enteredAt = this.tick;
    this.revision = 0;
    this.history.length = 0;
    return true;
  }
  public dispose(): void { if (this._disposed) return; this.definitions.clear(); this.transitions.length = 0; this.history.length = 0; this._disposed = true; }

  private resolveTransitions(): void {
    const candidates = this.transitions.filter(item => item.from === this.current);
    const sorted = stableSort(candidates, (a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const candidate of sorted) {
      let allowed = true;
      try { allowed = candidate.guard?.(this.context()) ?? true; } catch { allowed = false; }
      if (allowed && this.change(candidate.to, 'guarded')) break;
    }
  }

  private change(target: string, reason: string): boolean {
    const previousDefinition = this.definitions.get(this.current);
    try { previousDefinition?.exit?.(this.context()); } catch { this.record(this.current, target, false, 'exit-error'); return false; }
    const from = this.current;
    this.previous = from;
    this.current = target;
    this.enteredAt = this.tick;
    this.revision += 1;
    const nextDefinition = this.definitions.get(target)!;
    try { nextDefinition.enter?.(this.context()); } catch { /* state remains selected; caller can recover */ }
    this.record(from, target, true, reason);
    return true;
  }

  private context(): StateContext<TData> { return Object.freeze({ tick: this.tick, frame: this.frame, data: this.data }); }
  private record(from: string, to: string, accepted: boolean, reason: string): void {
    this.history.push(Object.freeze({ from, to, tick: this.tick, accepted, reason }));
    while (this.history.length > this.maxHistory) this.history.shift();
  }
}
