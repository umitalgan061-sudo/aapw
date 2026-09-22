import type { QuestAuthorityV2, QuestStatus } from './questAuthorityV2.ts';

export type SettlementService = 'blacksmith' | 'tavern' | 'market' | 'stable' | 'farm' | 'barracks';
export type DialogueConditionMode = 'all' | 'any';

export type DialogueCondition =
  | Readonly<{ kind: 'quest-status'; questId: string; status: QuestStatus }>
  | Readonly<{ kind: 'quest-completed'; questId: string }>
  | Readonly<{ kind: 'quest-objective-progress'; questId: string; objectiveId: string; amount: number }>
  | Readonly<{ kind: 'reputation-at-least'; factionId: string; value: number }>
  | Readonly<{ kind: 'settlement-service'; settlementId: string; service: SettlementService }>;

export interface DialogueConditionContext {
  readonly quests: QuestAuthorityV2;
  readonly reputation?: Readonly<Record<string, number>>;
  readonly settlementServices?: Readonly<Record<string, readonly string[]>>;
}

export interface DialogueConditionGate {
  readonly conditions: readonly DialogueCondition[];
  readonly mode: DialogueConditionMode;
  readonly key: string;
  evaluate(context: DialogueConditionContext): boolean;
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim().slice(0, 96) : '');
const positiveFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const services = new Set<SettlementService>(['blacksmith', 'tavern', 'market', 'stable', 'farm', 'barracks']);
const statuses = new Set<QuestStatus>(['locked', 'available', 'active', 'completed', 'failed', 'abandoned']);

export const isDialogueConditionMode = (mode: unknown): mode is DialogueConditionMode => mode === 'all' || mode === 'any';

export const normalizeDialogueCondition = (condition: unknown): DialogueCondition | null => {
  if (!condition || typeof condition !== 'object') return null;
  const candidate = condition as Partial<DialogueCondition> & { kind?: unknown };
  if (candidate.kind === 'quest-status') {
    const questId = clean(candidate.questId);
    return questId && statuses.has(candidate.status as QuestStatus)
      ? { kind: candidate.kind, questId, status: candidate.status as QuestStatus }
      : null;
  }
  if (candidate.kind === 'quest-completed') {
    const questId = clean(candidate.questId);
    return questId ? { kind: candidate.kind, questId } : null;
  }
  if (candidate.kind === 'quest-objective-progress') {
    const questId = clean(candidate.questId);
    const objectiveId = clean(candidate.objectiveId);
    return questId && objectiveId && positiveFinite(candidate.amount)
      ? { kind: candidate.kind, questId, objectiveId, amount: Math.floor(candidate.amount) }
      : null;
  }
  if (candidate.kind === 'reputation-at-least') {
    const factionId = clean(candidate.factionId);
    return factionId && typeof candidate.value === 'number' && Number.isFinite(candidate.value)
      ? { kind: candidate.kind, factionId, value: candidate.value }
      : null;
  }
  if (candidate.kind !== 'settlement-service') return null;
  const settlementId = clean(candidate.settlementId);
  return settlementId && services.has(candidate.service as SettlementService)
    ? { kind: candidate.kind, settlementId, service: candidate.service as SettlementService }
    : null;
};

export const isDialogueCondition = (condition: unknown): condition is DialogueCondition => normalizeDialogueCondition(condition) !== null;

export const evaluateDialogueCondition = (
  condition: DialogueCondition,
  context: DialogueConditionContext,
): boolean => {
  const normalized = normalizeDialogueCondition(condition);
  if (!normalized) return false;
  if (normalized.kind === 'quest-status') {
    return context.quests.get(normalized.questId)?.status === normalized.status;
  }
  if (normalized.kind === 'quest-completed') {
    return context.quests.get(normalized.questId)?.status === 'completed';
  }
  if (normalized.kind === 'quest-objective-progress') {
    const objective = context.quests.get(normalized.questId)?.objectives.find((entry) => entry.id === normalized.objectiveId);
    return objective !== undefined && objective.progress >= normalized.amount;
  }
  if (normalized.kind === 'reputation-at-least') {
    const value = context.reputation?.[normalized.factionId] ?? 0;
    return Number.isFinite(value) && value >= normalized.value;
  }
  const available = context.settlementServices?.[normalized.settlementId] ?? [];
  return available.includes(normalized.service);
};

export const evaluateDialogueConditions = (
  conditions: readonly DialogueCondition[],
  context: DialogueConditionContext,
  mode: DialogueConditionMode = 'all',
): boolean => {
  if (!isDialogueConditionMode(mode)) return false;
  if (conditions.length === 0) return mode === 'all';
  const results = conditions.map((condition) => evaluateDialogueCondition(condition, context));
  return mode === 'any' ? results.some(Boolean) : results.every(Boolean);
};

export const stableDialogueConditionKey = (
  conditions: readonly DialogueCondition[],
  mode: DialogueConditionMode = 'all',
): string => {
  if (!isDialogueConditionMode(mode)) return 'invalid:';
  return `${mode}:${conditions
    .map(normalizeDialogueCondition)
    .filter((condition): condition is DialogueCondition => condition !== null)
    .map((condition) => JSON.stringify(condition))
    .sort()
    .join('|')}`;
};

export const createDialogueConditionGate = (
  conditions: readonly DialogueCondition[],
  mode: DialogueConditionMode = 'all',
): DialogueConditionGate | null => {
  if (!isDialogueConditionMode(mode)) return null;
  const normalized = conditions.map(normalizeDialogueCondition);
  if (normalized.some((condition) => condition === null)) return null;
  const safeConditions = Object.freeze(normalized as DialogueCondition[]);
  const key = stableDialogueConditionKey(safeConditions, mode);
  return Object.freeze({
    conditions: safeConditions,
    mode,
    key,
    evaluate: (context: DialogueConditionContext): boolean => evaluateDialogueConditions(safeConditions, context, mode),
  });
};
