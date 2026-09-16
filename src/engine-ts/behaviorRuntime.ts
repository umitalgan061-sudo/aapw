import type { Disposable, EntityId } from './coreTypes.js';

export type BehaviorStatus = 'idle' | 'running' | 'success' | 'failure';
export type BehaviorKind = 'sequence' | 'selector' | 'condition' | 'action' | 'cooldown' | 'repeat';
export interface BehaviorContext { readonly actor: EntityId; readonly tick: number; readonly facts: ReadonlyMap<string, number | boolean | string>; readonly blackboard: Map<string, unknown>; }
export interface BehaviorNode { readonly id: string; readonly kind: BehaviorKind; readonly children: readonly BehaviorNode[]; readonly condition?: (context: BehaviorContext) => boolean; readonly action?: (context: BehaviorContext) => BehaviorStatus; readonly cooldownTicks?: number; readonly repeatCount?: number; }
export interface BehaviorState { readonly status: BehaviorStatus; readonly runningChild: number; readonly cooldownUntil: number; readonly repeats: number; }
export interface BehaviorResult { readonly actor: EntityId; readonly root: string; readonly status: BehaviorStatus; readonly visited: number; readonly actions: number; }
export interface BehaviorStats { readonly actors: number; readonly ticks: number; readonly nodesVisited: number; readonly actions: number; readonly failures: number; }

function clampInt(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, Math.trunc(Number.isFinite(value) ? value : min))); }

export class BehaviorRuntime implements Disposable {
  #roots = new Map<EntityId, BehaviorNode>();
  #states = new Map<EntityId, Map<string, BehaviorState>>();
  #facts = new Map<EntityId, Map<string, number | boolean | string>>();
  #blackboards = new Map<EntityId, Map<string, unknown>>();
  #ticks = 0;
  #visited = 0;
  #actions = 0;
  #failures = 0;
  #disposed = false;

  register(actor: EntityId, root: BehaviorNode): boolean {
    if (this.#disposed || this.#roots.has(actor) || !root.id) return false;
    this.#roots.set(actor, root);
    this.#states.set(actor, new Map());
    this.#facts.set(actor, new Map());
    this.#blackboards.set(actor, new Map());
    return true;
  }

  setFact(actor: EntityId, key: string, value: number | boolean | string): void { const facts = this.#facts.get(actor); if (facts) facts.set(key, value); }
  setBlackboard(actor: EntityId, key: string, value: unknown): void { const board = this.#blackboards.get(actor); if (board) board.set(key, value); }
  fact(actor: EntityId, key: string): number | boolean | string | undefined { return this.#facts.get(actor)?.get(key); }
  blackboard(actor: EntityId, key: string): unknown { return this.#blackboards.get(actor)?.get(key); }

  tick(actor: EntityId, tick: number): BehaviorResult | null {
    const root = this.#roots.get(actor); if (!root || this.#disposed) return null;
    this.#ticks += 1;
    const context: BehaviorContext = Object.freeze({ actor, tick, facts: this.#facts.get(actor) ?? new Map(), blackboard: this.#blackboards.get(actor) ?? new Map() });
    const state = this.#visit(root, context);
    return Object.freeze({ actor, root: root.id, status: state.status, visited: 1, actions: state.status === 'success' || state.status === 'running' ? 1 : 0 });
  }

  tickAll(tick: number): readonly BehaviorResult[] {
    if (this.#disposed) return [];
    const results: BehaviorResult[] = [];
    for (const actor of [...this.#roots.keys()].sort((a, b) => String(a).localeCompare(String(b)))) { const result = this.tick(actor, tick); if (result) results.push(result); }
    return Object.freeze(results);
  }

  state(actor: EntityId, nodeId: string): BehaviorState { return this.#states.get(actor)?.get(nodeId) ?? Object.freeze({ status: 'idle', runningChild: 0, cooldownUntil: 0, repeats: 0 }); }
  stats(): BehaviorStats { return Object.freeze({ actors: this.#roots.size, ticks: this.#ticks, nodesVisited: this.#visited, actions: this.#actions, failures: this.#failures }); }
  reset(actor?: EntityId): void { if (actor === undefined) { for (const states of this.#states.values()) states.clear(); return; } this.#states.get(actor)?.clear(); }
  dispose(): void { this.#disposed = true; this.#roots.clear(); this.#states.clear(); this.#facts.clear(); this.#blackboards.clear(); }

  #visit(node: BehaviorNode, context: BehaviorContext): BehaviorState {
    this.#visited += 1;
    const states = this.#states.get(context.actor)!;
    const previous = states.get(node.id) ?? { status: 'idle', runningChild: 0, cooldownUntil: 0, repeats: 0 };
    if (node.kind === 'condition') {
      const success = Boolean(node.condition?.(context));
      const state: BehaviorState = Object.freeze({ status: success ? 'success' : 'failure', runningChild: 0, cooldownUntil: 0, repeats: 0 });
      states.set(node.id, state); if (!success) this.#failures += 1; return state;
    }
    if (node.kind === 'action') {
      const status = node.action?.(context) ?? 'failure';
      this.#actions += 1;
      const state = Object.freeze({ status, runningChild: 0, cooldownUntil: 0, repeats: previous.repeats });
      states.set(node.id, state); if (status === 'failure') this.#failures += 1; return state;
    }
    if (node.kind === 'cooldown') {
      if (context.tick < previous.cooldownUntil) return previous;
      const child = node.children[0]; if (!child) return this.#store(context.actor, node, { status: 'failure', runningChild: 0, cooldownUntil: 0, repeats: 0 });
      const result = this.#visit(child, context);
      const until = result.status === 'success' ? context.tick + clampInt(node.cooldownTicks ?? 1, 1, 100000) : 0;
      return this.#store(context.actor, node, { ...result, cooldownUntil: until });
    }
    if (node.kind === 'repeat') {
      const child = node.children[0]; if (!child) return this.#store(context.actor, node, { status: 'failure', runningChild: 0, cooldownUntil: 0, repeats: 0 });
      const limit = clampInt(node.repeatCount ?? 1, 1, 1000);
      let repeats = previous.repeats;
      const result = this.#visit(child, context);
      if (result.status === 'success') repeats += 1;
      if (repeats >= limit) repeats = 0;
      return this.#store(context.actor, node, { ...result, repeats });
    }
    if (node.kind === 'sequence') {
      let runningChild = 0;
      for (let i = 0; i < node.children.length; i += 1) {
        const child = this.#visit(node.children[i]!, context);
        if (child.status === 'failure') return this.#store(context.actor, node, { status: 'failure', runningChild: i, cooldownUntil: 0, repeats: 0 });
        if (child.status === 'running') { runningChild = i; return this.#store(context.actor, node, { status: 'running', runningChild, cooldownUntil: 0, repeats: 0 }); }
      }
      return this.#store(context.actor, node, { status: 'success', runningChild, cooldownUntil: 0, repeats: 0 });
    }
    let fallback = this.#store(context.actor, node, { status: 'failure', runningChild: 0, cooldownUntil: 0, repeats: 0 });
    for (let i = 0; i < node.children.length; i += 1) {
      const child = this.#visit(node.children[i]!, context);
      if (child.status === 'success') return this.#store(context.actor, node, { status: 'success', runningChild: i, cooldownUntil: 0, repeats: 0 });
      if (child.status === 'running') return this.#store(context.actor, node, { status: 'running', runningChild: i, cooldownUntil: 0, repeats: 0 });
      fallback = this.#store(context.actor, node, { status: 'failure', runningChild: i, cooldownUntil: 0, repeats: 0 });
    }
    return fallback;
  }

  #store(actor: EntityId, node: BehaviorNode, state: BehaviorState): BehaviorState { const frozen = Object.freeze(state); this.#states.get(actor)?.set(node.id, frozen); return frozen; }
}
