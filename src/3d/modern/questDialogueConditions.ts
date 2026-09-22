import type { QuestAuthorityV2, QuestStatus } from './questAuthorityV2.ts';

export type DialogueCondition =
  | Readonly<{ kind: 'quest-status'; questId: string; status: QuestStatus }>
  | Readonly<{ kind: 'quest-completed'; questId: string }>
  | Readonly<{ kind: 'reputation-at-least'; factionId: string; value: number }>
  | Readonly<{ kind: 'settlement-service'; settlementId: string; service: 'blacksmith' | 'tavern' | 'market' | 'stable' | 'farm' | 'barracks' }>;

export interface DialogueConditionContext {
  readonly quests: QuestAuthorityV2;
  readonly reputation?: Readonly<Record<string, number>>;
  readonly settlementServices?: Readonly<Record<string, readonly string[]>>;
}

const clean = (value: string): string => value.trim().slice(0, 96);

export const evaluateDialogueCondition = (
  condition: DialogueCondition,
  context: DialogueConditionContext,
): boolean => {
  if (condition.kind === 'quest-status') {
    return context.quests.get(clean(condition.questId))?.status === condition.status;
  }
  if (condition.kind === 'quest-completed') {
    return context.quests.get(clean(condition.questId))?.status === 'completed';
  }
  if (condition.kind === 'reputation-at-least') {
    const value = context.reputation?.[clean(condition.factionId)] ?? 0;
    return Number.isFinite(value) && value >= condition.value;
  }
  const services = context.settlementServices?.[clean(condition.settlementId)] ?? [];
  return services.includes(condition.service);
};

export const evaluateDialogueConditions = (
  conditions: readonly DialogueCondition[],
  context: DialogueConditionContext,
): boolean => conditions.every((condition) => evaluateDialogueCondition(condition, context));

export const stableDialogueConditionKey = (conditions: readonly DialogueCondition[]): string =>
  conditions
    .map((condition) => JSON.stringify(condition))
    .sort()
    .join('|');
