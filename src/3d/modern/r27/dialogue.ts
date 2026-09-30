import { dialogueNodeId, type DialogueNodeId, type EntityId, type DialogueState } from './contracts.ts';

export type DialogueCondition =
  | { readonly kind: 'variable'; readonly key: string; readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; readonly value: number | string | boolean }
  | { readonly kind: 'tag'; readonly tag: string; readonly present?: boolean }
  | { readonly kind: 'all'; readonly conditions: readonly DialogueCondition[] }
  | { readonly kind: 'any'; readonly conditions: readonly DialogueCondition[] };

export interface DialogueChoice {
  readonly id: string;
  readonly text: string;
  readonly next: DialogueNodeId;
  readonly conditions?: readonly DialogueCondition[];
  readonly setVariables?: Readonly<Record<string, number | string | boolean>>;
  readonly addTags?: readonly string[];
  readonly removeTags?: readonly string[];
}

export interface DialogueNode {
  readonly id: DialogueNodeId;
  readonly speaker: string;
  readonly text: string;
  readonly choices: readonly DialogueChoice[];
  readonly terminal?: boolean;
}

export interface DialogueGraph {
  readonly id: string;
  readonly start: DialogueNodeId;
  readonly nodes: ReadonlyMap<DialogueNodeId, DialogueNode>;
}

export interface DialogueTransition {
  readonly entity: EntityId;
  readonly from: DialogueNodeId;
  readonly to: DialogueNodeId;
  readonly choice: string;
  readonly state: DialogueState;
}

function compareScalar(
  actual: number | string | boolean | undefined,
  operator: DialogueCondition & { readonly kind: 'variable' }['operator'],
  expected: number | string | boolean,
): boolean {
  switch (operator) {
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
    case 'gt': return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt': return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    default: return false;
  }
}

export function evaluateDialogueCondition(
  state: DialogueState,
  condition: DialogueCondition,
): boolean {
  switch (condition.kind) {
    case 'variable':
      return compareScalar(state.variables[condition.key], condition.operator, condition.value);
    case 'tag':
      return state.tags.includes(condition.tag) === (condition.present ?? true);
    case 'all':
      return condition.conditions.every((child) => evaluateDialogueCondition(state, child));
    case 'any':
      return condition.conditions.some((child) => evaluateDialogueCondition(state, child));
    default:
      return false;
  }
}

export class DialogueRuntime {
  readonly graph: DialogueGraph;

  constructor(graph: DialogueGraph) {
    if (!graph.nodes.has(graph.start)) throw new Error('Dialogue start node does not exist');
    this.graph = graph;
  }

  start(entity: EntityId, variables: Readonly<Record<string, number | string | boolean>> = {}, tags: readonly string[] = []): DialogueState {
    return {
      graphId: this.graph.id,
      current: this.graph.start,
      variables: { ...variables },
      tags: [...new Set(tags)].sort(),
      history: [this.graph.start],
    };
  }

  current(state: DialogueState): DialogueNode {
    if (state.graphId !== this.graph.id) throw new Error('Dialogue state belongs to another graph');
    const node = this.graph.nodes.get(state.current);
    if (!node) throw new Error(`Unknown dialogue node: ${String(state.current)}`);
    return node;
  }

  availableChoices(state: DialogueState): readonly DialogueChoice[] {
    return this.current(state).choices
      .filter((choice) => (choice.conditions ?? []).every((condition) => evaluateDialogueCondition(state, condition)))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  choose(entity: EntityId, state: DialogueState, choiceId: string): DialogueTransition {
    const choices = this.availableChoices(state);
    const choice = choices.find((item) => item.id === choiceId);
    if (!choice) throw new Error(`Dialogue choice unavailable: ${choiceId}`);

    const variables = { ...state.variables, ...(choice.setVariables ?? {}) };
    const tags = new Set(state.tags);
    for (const tag of choice.addTags ?? []) tags.add(tag);
    for (const tag of choice.removeTags ?? []) tags.delete(tag);

    const next = {
      ...state,
      current: dialogueNodeId(String(choice.next)),
      variables,
      tags: [...tags].sort(),
      history: [...state.history, dialogueNodeId(String(choice.next))],
    };

    if (!this.graph.nodes.has(next.current)) throw new Error('Dialogue choice points to an unknown node');

    return {
      entity,
      from: state.current,
      to: next.current,
      choice: choice.id,
      state: next,
    };
  }

  isTerminal(state: DialogueState): boolean {
    const node = this.current(state);
    return Boolean(node.terminal || node.choices.length === 0);
  }

  fingerprint(state: DialogueState): string {
    const variables = Object.entries(state.variables)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('|');
    return [state.graphId, String(state.current), variables, [...state.tags].sort().join(','), state.history.map(String).join('>')].join(';');
  }
}

export function createDialogueGraph(
  id: string,
  start: string,
  nodes: readonly DialogueNode[],
): DialogueGraph {
  const map = new Map<DialogueNodeId, DialogueNode>();
  for (const node of nodes) {
    if (map.has(node.id)) throw new Error(`Duplicate dialogue node: ${String(node.id)}`);
    map.set(node.id, {
      ...node,
      id: dialogueNodeId(String(node.id)),
      choices: [...node.choices].sort((a, b) => a.id.localeCompare(b.id)),
    });
  }
  const startId = dialogueNodeId(start);
  if (!map.has(startId)) throw new Error('Dialogue start does not exist');
  return { id, start: startId, nodes: map };
}
