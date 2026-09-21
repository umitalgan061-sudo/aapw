import { EntityId, clamp, hashString, stableChecksum, stableStringify } from './types.ts';

export interface DialogueChoice {
  id: string;
  text: string;
  priority: number;
  requires?: DialogueCondition;
  effects?: readonly DialogueEffect[];
  next: string;
}

export interface DialogueNode {
  id: string;
  speaker: EntityId;
  text: string;
  tags: readonly string[];
  choices: readonly DialogueChoice[];
  autoNext?: string;
  delayTicks?: number;
}

export type DialogueCondition =
  | { kind: 'flag'; key: string; equals: boolean }
  | { kind: 'value'; key: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  | { kind: 'has-item'; itemId: string; quantity: number }
  | { kind: 'reputation'; faction: string; op: 'gte' | 'lte'; value: number }
  | { kind: 'all'; conditions: readonly DialogueCondition[] }
  | { kind: 'any'; conditions: readonly DialogueCondition[] };

export interface DialogueEffect {
  kind: 'flag' | 'value' | 'reputation';
  key: string;
  value: boolean | number;
  operation?: 'set' | 'add' | 'subtract';
}

export interface DialogueContext {
  actor: EntityId;
  speaker: EntityId;
  flags: Readonly<Record<string, boolean>>;
  values: Readonly<Record<string, number>>;
  inventory: Readonly<Record<string, number>>;
  reputation: Readonly<Record<string, number>>;
}

export interface DialogueSessionSnapshot {
  id: string;
  actor: EntityId;
  nodeId: string;
  startedTick: number;
  revision: number;
  history: readonly string[];
  checksum: number;
}

export interface DialogueEvent {
  sessionId: string;
  type: 'started' | 'node-entered' | 'choice' | 'effect' | 'ended';
  tick: number;
  nodeId?: string;
  choiceId?: string;
  payload?: unknown;
  checksum: number;
}

function assertId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) throw new RangeError(`${label} must contain 1-128 characters`);
  return normalized;
}

export class DialogueGraphV2 {
  readonly #nodes = new Map<string, DialogueNode>();
  readonly #starts = new Map<string, string>();

  registerNode(node: DialogueNode): void {
    const id = assertId(node.id, 'node id');
    if (this.#nodes.has(id)) throw new Error(`Dialogue node ${id} already exists`);
    if (!node.text.trim()) throw new RangeError(`Dialogue node ${id} has empty text`);
    this.#nodes.set(id, {
      ...node,
      tags: [...node.tags],
      choices: node.choices.map((choice) => ({ ...choice, effects: choice.effects ? [...choice.effects] : choice.effects })),
    });
  }

  registerNodes(nodes: readonly DialogueNode[]): void { for (const node of nodes) this.registerNode(node); }

  setStart(graphId: string, nodeId: string): void {
    assertId(graphId, 'graph id');
    if (!this.#nodes.has(nodeId)) throw new Error(`Unknown dialogue node ${nodeId}`);
    this.#starts.set(graphId, nodeId);
  }

  node(id: string): DialogueNode | undefined {
    const node = this.#nodes.get(id);
    return node ? { ...node, tags: [...node.tags], choices: node.choices.map((choice) => ({ ...choice, effects: choice.effects ? [...choice.effects] : choice.effects })) } : undefined;
  }

  startNode(graphId: string): string | undefined { return this.#starts.get(graphId); }

  validate(): string[] {
    const errors: string[] = [];
    for (const node of this.#nodes.values()) {
      if (node.autoNext && !this.#nodes.has(node.autoNext)) errors.push(`${node.id}:missing_autoNext:${node.autoNext}`);
      for (const choice of node.choices) {
        if (!this.#nodes.has(choice.next)) errors.push(`${node.id}:${choice.id}:missing_next:${choice.next}`);
      }
    }
    for (const [graphId, nodeId] of this.#starts) if (!this.#nodes.has(nodeId)) errors.push(`${graphId}:missing_start:${nodeId}`);
    return errors;
  }

  digest(): number { return hashString(stableStringify([...this.#nodes.values()].sort((a, b) => a.id.localeCompare(b.id)))); }
}

export class DialogueRuntimeV2 {
  readonly #graph: DialogueGraphV2;
  readonly #sessions = new Map<string, DialogueSessionSnapshot>();
  readonly #events: DialogueEvent[] = [];
  readonly #stateFlags = new Map<string, boolean>();
  readonly #stateValues = new Map<string, number>();
  readonly #inventory = new Map<string, number>();
  readonly #reputation = new Map<string, number>();
  #sequence = 0;

  constructor(graph: DialogueGraphV2) {
    const errors = graph.validate();
    if (errors.length) throw new Error(`Invalid dialogue graph: ${errors.join(', ')}`);
    this.#graph = graph;
  }

  setFlag(key: string, value: boolean): void { this.#stateFlags.set(assertId(key, 'flag'), Boolean(value)); }
  setValue(key: string, value: number): void { this.#stateValues.set(assertId(key, 'value'), clamp(value, -1_000_000, 1_000_000)); }
  addItem(itemId: string, quantity: number): void { this.#inventory.set(assertId(itemId, 'itemId'), Math.max(0, Math.floor((this.#inventory.get(itemId) ?? 0) + quantity))); }
  setReputation(faction: string, value: number): void { this.#reputation.set(assertId(faction, 'faction'), clamp(value, -10000, 10000)); }

  context(actor: EntityId, speaker: EntityId): DialogueContext {
    return {
      actor,
      speaker,
      flags: Object.fromEntries(this.#stateFlags),
      values: Object.fromEntries(this.#stateValues),
      inventory: Object.fromEntries(this.#inventory),
      reputation: Object.fromEntries(this.#reputation),
    };
  }

  start(graphId: string, actor: EntityId, tick: number): DialogueSessionSnapshot {
    if ([...this.#sessions.values()].some((session) => session.actor === actor)) throw new Error(`Actor ${Number(actor)} already has a dialogue session`);
    const nodeId = this.#graph.startNode(graphId);
    if (!nodeId) throw new Error(`Dialogue graph ${graphId} has no start node`);
    const id = `dialogue-${actor}-${++this.#sequence}`;
    const snapshotBody = { id, actor, nodeId, startedTick: tick, revision: 1, history: [nodeId] as readonly string[] };
    const snapshot = { ...snapshotBody, checksum: stableChecksum(snapshotBody) };
    this.#sessions.set(id, snapshot);
    this.#pushEvent({ sessionId: id, type: 'started', tick, nodeId });
    this.#pushEvent({ sessionId: id, type: 'node-entered', tick, nodeId });
    return this.snapshot(id)!;
  }

  session(id: string): DialogueSessionSnapshot | undefined {
    const value = this.#sessions.get(id);
    return value ? { ...value, history: [...value.history] } : undefined;
  }

  choices(id: string): DialogueChoice[] {
    const session = this.#sessions.get(id);
    if (!session) return [];
    const node = this.#graph.node(session.nodeId);
    if (!node) return [];
    const context = this.context(session.actor, node.speaker);
    return node.choices.filter((choice) => !choice.requires || this.#condition(choice.requires, context)).sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));
  }

  choose(id: string, choiceId: string, tick: number): DialogueSessionSnapshot | undefined {
    const session = this.#sessions.get(id);
    if (!session) return undefined;
    const node = this.#graph.node(session.nodeId);
    if (!node) throw new Error(`Missing node ${session.nodeId}`);
    const choice = this.choices(id).find((candidate) => candidate.id === choiceId);
    if (!choice) throw new Error(`Choice ${choiceId} is unavailable`);
    const context = this.context(session.actor, node.speaker);
    this.#pushEvent({ sessionId: id, type: 'choice', tick, nodeId: node.id, choiceId });
    for (const effect of choice.effects ?? []) this.#applyEffect(id, effect, tick);
    this.#enter(id, choice.next, tick);
    return this.snapshot(id);
  }

  advance(id: string, tick: number): DialogueSessionSnapshot | undefined {
    const session = this.#sessions.get(id);
    if (!session) return undefined;
    const node = this.#graph.node(session.nodeId);
    if (!node?.autoNext) return session;
    this.#enter(id, node.autoNext, tick);
    return this.snapshot(id);
  }

  end(id: string, tick: number): boolean {
    if (!this.#sessions.delete(id)) return false;
    this.#pushEvent({ sessionId: id, type: 'ended', tick });
    return true;
  }

  events(): DialogueEvent[] { return this.#events.map((event) => ({ ...event })); }
  drainEvents(): DialogueEvent[] { const events = this.events(); this.#events.length = 0; return events; }

  snapshot(id: string): DialogueSessionSnapshot | undefined { return this.session(id); }

  restore(snapshot: DialogueSessionSnapshot): void {
    const body = { id: snapshot.id, actor: snapshot.actor, nodeId: snapshot.nodeId, startedTick: snapshot.startedTick, revision: snapshot.revision, history: snapshot.history };
    if (stableChecksum(body) !== snapshot.checksum) throw new Error('Dialogue snapshot checksum mismatch');
    if (!this.#graph.node(snapshot.nodeId)) throw new Error(`Cannot restore unknown dialogue node ${snapshot.nodeId}`);
    this.#sessions.set(snapshot.id, { ...snapshot, history: [...snapshot.history] });
  }

  stateDigest(): number {
    return stableChecksum({
      sessions: [...this.#sessions.values()].sort((a, b) => a.id.localeCompare(b.id)),
      flags: [...this.#stateFlags.entries()].sort(),
      values: [...this.#stateValues.entries()].sort(),
      inventory: [...this.#inventory.entries()].sort(),
      reputation: [...this.#reputation.entries()].sort(),
    });
  }

  #enter(id: string, nodeId: string, tick: number): void {
    const session = this.#sessions.get(id);
    const node = this.#graph.node(nodeId);
    if (!session || !node) throw new Error(`Cannot enter dialogue node ${nodeId}`);
    const history = [...session.history, nodeId];
    const next = { ...session, nodeId, history, revision: session.revision + 1 };
    const body = { id: next.id, actor: next.actor, nodeId: next.nodeId, startedTick: next.startedTick, revision: next.revision, history: next.history };
    this.#sessions.set(id, { ...next, checksum: stableChecksum(body) });
    this.#pushEvent({ sessionId: id, type: 'node-entered', tick, nodeId });
  }

  #condition(condition: DialogueCondition, context: DialogueContext): boolean {
    switch (condition.kind) {
      case 'flag': return Boolean(context.flags[condition.key]) === condition.equals;
      case 'value': {
        const actual = context.values[condition.key] ?? 0;
        return condition.op === 'eq' ? actual === condition.value : condition.op === 'neq' ? actual !== condition.value : condition.op === 'gt' ? actual > condition.value : condition.op === 'gte' ? actual >= condition.value : condition.op === 'lt' ? actual < condition.value : actual <= condition.value;
      }
      case 'has-item': return (context.inventory[condition.itemId] ?? 0) >= condition.quantity;
      case 'reputation': {
        const actual = context.reputation[condition.faction] ?? 0;
        return condition.op === 'gte' ? actual >= condition.value : actual <= condition.value;
      }
      case 'all': return condition.conditions.every((entry) => this.#condition(entry, context));
      case 'any': return condition.conditions.some((entry) => this.#condition(entry, context));
    }
  }

  #applyEffect(id: string, effect: DialogueEffect, tick: number): void {
    const operation = effect.operation ?? 'set';
    if (effect.kind === 'flag') {
      const next = typeof effect.value === 'boolean' ? effect.value : Boolean(effect.value);
      this.#stateFlags.set(effect.key, operation === 'set' ? next : Boolean(next));
    } else if (effect.kind === 'value') {
      const current = this.#stateValues.get(effect.key) ?? 0;
      const numeric = Number(effect.value);
      const next = operation === 'add' ? current + numeric : operation === 'subtract' ? current - numeric : numeric;
      this.#stateValues.set(effect.key, clamp(next, -1_000_000, 1_000_000));
    } else {
      const current = this.#reputation.get(effect.key) ?? 0;
      const numeric = Number(effect.value);
      const next = operation === 'add' ? current + numeric : operation === 'subtract' ? current - numeric : numeric;
      this.#reputation.set(effect.key, clamp(next, -10000, 10000));
    }
    this.#pushEvent({ sessionId: id, type: 'effect', tick, payload: effect });
  }

  #pushEvent(input: Omit<DialogueEvent, 'checksum'>): void {
    const sequence = this.#events.length + 1;
    this.#events.push({ ...input, checksum: stableChecksum({ ...input, sequence }) });
    if (this.#events.length > 4096) this.#events.splice(0, this.#events.length - 4096);
  }
}

export function createDialogueNode(
  id: string,
  speaker: EntityId,
  text: string,
  options: Partial<Omit<DialogueNode, 'id' | 'speaker' | 'text'>> = {},
): DialogueNode {
  return {
    id,
    speaker,
    text,
    tags: options.tags ?? [],
    choices: options.choices ?? [],
    autoNext: options.autoNext,
    delayTicks: options.delayTicks,
  };
}
