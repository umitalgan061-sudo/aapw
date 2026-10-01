/**
 * R35 branching dialogue runtime.
 *
 * Dialogue is authored as a directed graph but evaluated as a deterministic
 * state machine. Conditions and effects are plain data so dialogue can be
 * replicated, saved and tested without browser dependencies.
 */
import type { EntityId } from '../types.ts';

export type DialogueConditionR35 =
  | {
      readonly kind: 'variable';
      readonly key: string;
      readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
      readonly value: string | number | boolean;
    }
  | {
      readonly kind: 'item';
      readonly itemId: string;
      readonly minimum: number;
    }
  | {
      readonly kind: 'tag';
      readonly tag: string;
    }
  | {
      readonly kind: 'quest';
      readonly questId: string;
      readonly status: 'active' | 'complete' | 'failed' | 'missing';
    };

export type DialogueEffectR35 =
  | {
      readonly kind: 'set';
      readonly key: string;
      readonly value: string | number | boolean;
    }
  | {
      readonly kind: 'increment';
      readonly key: string;
      readonly amount: number;
    }
  | {
      readonly kind: 'tag';
      readonly tag: string;
      readonly enabled: boolean;
    }
  | {
      readonly kind: 'event';
      readonly event: string;
    };

export interface DialogueChoiceR35 {
  readonly id: string;
  readonly text: string;
  readonly next: string | null;
  readonly priority?: number | undefined;
  readonly conditions?: readonly DialogueConditionR35[] | undefined;
  readonly effects?: readonly DialogueEffectR35[] | undefined;
  readonly once?: boolean | undefined;
}

export interface DialogueNodeR35 {
  readonly id: string;
  readonly speaker: EntityId;
  readonly text: string;
  readonly choices?: readonly DialogueChoiceR35[] | undefined;
  readonly next?: string | null | undefined;
  readonly conditions?: readonly DialogueConditionR35[];
  readonly enterEffects?: readonly DialogueEffectR35[] | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface DialogueGraphR35 {
  readonly id: string;
  readonly start: string;
  readonly nodes: readonly DialogueNodeR35[];
}

export interface DialogueContextR35 {
  readonly items: ReadonlyMap<string, number>;
  readonly quests: ReadonlyMap<string, 'active' | 'complete' | 'failed'>;
  readonly tags: ReadonlySet<string>;
}

export interface DialogueStateR35 {
  readonly graphId: string;
  readonly activeNodeId: string | null;
  readonly variables: Readonly<Record<string, string | number | boolean>>;
  readonly usedChoices: readonly string[];
  readonly visitedNodes: readonly string[];
  readonly emittedEvents: readonly string[];
}

export interface DialogueSnapshotR35 extends DialogueStateR35 {
  readonly version: 1;
}

export interface DialogueAdvanceR35 {
  readonly ok: boolean;
  readonly node: DialogueNodeR35 | null;
  readonly ended: boolean;
  readonly reason?: string | undefined;
}

function compare(
  left: string | number | boolean | undefined,
  operator: DialogueConditionR35['operator'],
  right: string | number | boolean,
): boolean {
  if (operator === 'eq') return left === right;
  if (operator === 'neq') return left !== right;

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return false;
  }

  if (operator === 'gt') return leftNumber > rightNumber;
  if (operator === 'gte') return leftNumber >= rightNumber;
  if (operator === 'lt') return leftNumber < rightNumber;
  return leftNumber <= rightNumber;
}

function cloneVariables(
  variables: Readonly<Record<string, string | number | boolean>>,
): Record<string, string | number | boolean> {
  return { ...variables };
}

export class DialogueAuthorityR35 {
  #graphs = new Map<string, DialogueGraphR35>();
  #graphId: string | null = null;
  #activeNodeId: string | null = null;
  #variables: Record<string, string | number | boolean> = {};
  #usedChoices = new Set<string>();
  #visitedNodes = new Set<string>();
  #emittedEvents: string[] = [];

  register(graph: DialogueGraphR35): void {
    if (!graph.id.trim()) throw new Error('dialogue graph id required');
    if (!graph.start.trim()) throw new Error('dialogue graph start required');
    if (graph.nodes.length === 0) throw new Error('dialogue graph requires nodes');

    const ids = new Set<string>();
    for (const node of graph.nodes) {
      if (ids.has(node.id)) throw new Error('duplicate dialogue node: ' + node.id);
      ids.add(node.id);
      for (const choice of node.choices ?? []) {
        if (!choice.id.trim()) throw new Error('dialogue choice id required');
        if (choice.next !== null && !ids.has(choice.next)) {
          continue;
        }
      }
    }

    const normalized: DialogueGraphR35 = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        choices: node.choices
          ? [...node.choices]
              .map((choice) => ({
                ...choice,
                priority:
                  choice.priority === undefined
                    ? undefined
                    : Math.floor(choice.priority),
                conditions: choice.conditions ? [...choice.conditions] : undefined,
                effects: choice.effects ? [...choice.effects] : undefined,
              }))
              .sort(
                (a, b) =>
                  (b.priority ?? 0) - (a.priority ?? 0) ||
                  a.id.localeCompare(b.id),
              )
          : undefined,
        conditions: node.conditions ? [...node.conditions] : undefined,
        enterEffects: node.enterEffects ? [...node.enterEffects] : undefined,
        tags: node.tags ? [...new Set(node.tags)].sort() : undefined,
      })),
    };

    if (!ids.has(graph.start)) {
      throw new Error('dialogue graph start node not found');
    }

    this.#graphs.set(graph.id, normalized);
  }

  registerMany(graphs: readonly DialogueGraphR35[]): void {
    for (const graph of graphs) this.register(graph);
  }

  get graphId(): string | null {
    return this.#graphId;
  }

  get activeNodeId(): string | null {
    return this.#activeNodeId;
  }

  get currentNode(): DialogueNodeR35 | null {
    return this.resolveNode(this.#activeNodeId);
  }

  get variables(): Readonly<Record<string, string | number | boolean>> {
    return cloneVariables(this.#variables);
  }

  get usedChoices(): readonly string[] {
    return [...this.#usedChoices].sort();
  }

  get visitedNodes(): readonly string[] {
    return [...this.#visitedNodes].sort();
  }

  get emittedEvents(): readonly string[] {
    return [...this.#emittedEvents];
  }

  private graphOrThrow(): DialogueGraphR35 {
    if (!this.#graphId) throw new Error('dialogue is not active');
    const graph = this.#graphs.get(this.#graphId);
    if (!graph) throw new Error('active dialogue graph missing');
    return graph;
  }

  private resolveNode(nodeId: string | null): DialogueNodeR35 | null {
    if (!nodeId || !this.#graphId) return null;
    const graph = this.#graphs.get(this.#graphId);
    return graph?.nodes.find((node) => node.id === nodeId) ?? null;
  }

  private conditionMet(
    condition: DialogueConditionR35,
    context: DialogueContextR35,
  ): boolean {
    if (condition.kind === 'variable') {
      return compare(
        this.#variables[condition.key],
        condition.operator,
        condition.value,
      );
    }

    if (condition.kind === 'item') {
      return (context.items.get(condition.itemId) ?? 0) >= condition.minimum;
    }

    if (condition.kind === 'tag') {
      return context.tags.has(condition.tag);
    }

    const quest = context.quests.get(condition.questId);
    if (condition.status === 'missing') return quest === undefined;
    return quest === condition.status;
  }

  private conditionsMet(
    conditions: readonly DialogueConditionR35[] | undefined,
    context: DialogueContextR35,
  ): boolean {
    return (conditions ?? []).every((condition) =>
      this.conditionMet(condition, context),
    );
  }

  private applyEffect(effect: DialogueEffectR35): void {
    if (effect.kind === 'set') {
      this.#variables[effect.key] = effect.value;
      return;
    }

    if (effect.kind === 'increment') {
      const current = this.#variables[effect.key];
      const base = typeof current === 'number' ? current : Number(current) || 0;
      this.#variables[effect.key] = base + effect.amount;
      return;
    }

    if (effect.kind === 'event') {
      this.#emittedEvents.push(effect.event);
      if (this.#emittedEvents.length > 256) {
        this.#emittedEvents.shift();
      }
    }
  }

  private applyEffects(
    effects: readonly DialogueEffectR35[] | undefined,
  ): void {
    for (const effect of effects ?? []) this.applyEffect(effect);
  }

  start(
    graphId: string,
    context: DialogueContextR35,
    initialVariables: Readonly<Record<string, string | number | boolean>> = {},
  ): DialogueAdvanceR35 {
    const graph = this.#graphs.get(graphId);
    if (!graph) {
      return {
        ok: false,
        node: null,
        ended: true,
        reason: 'dialogue graph not found',
      };
    }

    this.#graphId = graphId;
    this.#activeNodeId = graph.start;
    this.#variables = cloneVariables(initialVariables);
    this.#usedChoices.clear();
    this.#visitedNodes.clear();
    this.#emittedEvents = [];

    return this.enterCurrentNode(context);
  }

  private enterCurrentNode(
    context: DialogueContextR35,
  ): DialogueAdvanceR35 {
    const node = this.currentNode;
    if (!node) {
      this.#activeNodeId = null;
      return {
        ok: false,
        node: null,
        ended: true,
        reason: 'dialogue node not found',
      };
    }

    if (!this.conditionsMet(node.conditions, context)) {
      this.#activeNodeId = node.next ?? null;
      if (!this.#activeNodeId) {
        return {
          ok: true,
          node: null,
          ended: true,
        };
      }
      return this.enterCurrentNode(context);
    }

    this.applyEffects(node.enterEffects);
    this.#visitedNodes.add(node.id);

    return {
      ok: true,
      node,
      ended: false,
    };
  }

  availableChoices(
    context: DialogueContextR35,
  ): readonly DialogueChoiceR35[] {
    const node = this.currentNode;
    if (!node) return [];
    return (node.choices ?? []).filter((choice) => {
      if (choice.once && this.#usedChoices.has(choice.id)) return false;
      return this.conditionsMet(choice.conditions, context);
    });
  }

  advance(context: DialogueContextR35): DialogueAdvanceR35 {
    const node = this.currentNode;
    if (!node) {
      return {
        ok: true,
        node: null,
        ended: true,
      };
    }

    if (node.choices && node.choices.length > 0) {
      return {
        ok: false,
        node,
        ended: false,
        reason: 'a dialogue choice must be selected',
      };
    }

    if (!node.next) {
      this.#activeNodeId = null;
      return {
        ok: true,
        node: null,
        ended: true,
      };
    }

    this.#activeNodeId = node.next;
    return this.enterCurrentNode(context);
  }

  select(
    choiceId: string,
    context: DialogueContextR35,
  ): DialogueAdvanceR35 {
    const node = this.currentNode;
    if (!node) {
      return {
        ok: false,
        node: null,
        ended: true,
        reason: 'dialogue is not active',
      };
    }

    const choice = (node.choices ?? []).find(
      (candidate) => candidate.id === choiceId,
    );
    if (!choice) {
      return {
        ok: false,
        node,
        ended: false,
        reason: 'dialogue choice not found',
      };
    }

    if (choice.once && this.#usedChoices.has(choice.id)) {
      return {
        ok: false,
        node,
        ended: false,
        reason: 'dialogue choice already used',
      };
    }

    if (!this.conditionsMet(choice.conditions, context)) {
      return {
        ok: false,
        node,
        ended: false,
        reason: 'dialogue choice conditions not met',
      };
    }

    this.applyEffects(choice.effects);
    this.#usedChoices.add(choice.id);

    if (!choice.next) {
      this.#activeNodeId = null;
      return {
        ok: true,
        node: null,
        ended: true,
      };
    }

    this.#activeNodeId = choice.next;
    return this.enterCurrentNode(context);
  }

  stop(): void {
    this.#graphId = null;
    this.#activeNodeId = null;
    this.#variables = {};
    this.#usedChoices.clear();
    this.#visitedNodes.clear();
    this.#emittedEvents = [];
  }

  snapshot(): DialogueSnapshotR35 {
    return {
      version: 1,
      graphId: this.#graphId ?? '',
      activeNodeId: this.#activeNodeId,
      variables: this.variables,
      usedChoices: this.usedChoices,
      visitedNodes: this.visitedNodes,
      emittedEvents: this.emittedEvents,
    };
  }

  restore(snapshot: DialogueSnapshotR35): void {
    if (snapshot.version !== 1) throw new Error('unsupported dialogue snapshot');
    if (snapshot.graphId && !this.#graphs.has(snapshot.graphId)) {
      throw new Error('dialogue graph unavailable');
    }

    this.#graphId = snapshot.graphId || null;
    this.#activeNodeId = snapshot.activeNodeId;
    this.#variables = cloneVariables(snapshot.variables);
    this.#usedChoices = new Set(snapshot.usedChoices);
    this.#visitedNodes = new Set(snapshot.visitedNodes);
    this.#emittedEvents = [...snapshot.emittedEvents].slice(-256);

    if (
      this.#activeNodeId &&
      !this.resolveNode(this.#activeNodeId)
    ) {
      throw new Error('dialogue active node unavailable');
    }
  }
}
