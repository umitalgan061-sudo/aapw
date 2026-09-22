import { describe, expect, it } from 'vitest';
import { QuestAuthorityV2 } from '../../src/3d/modern/questAuthorityV2.ts';
import {
  createDialogueConditionGate,
  evaluateDialogueConditions,
  isDialogueCondition,
  normalizeDialogueCondition,
  stableDialogueConditionKey,
  type DialogueConditionContext,
} from '../../src/3d/modern/questDialogueConditions.ts';

describe('quest dialogue conditions', () => {
  it('uses the existing quest authority and settlement service context', () => {
    const quests = new QuestAuthorityV2();
    quests.register({
      id: 'roadside-repair',
      title: 'Roadside Repair',
      description: 'Repair the market cart.',
      level: 1,
      prerequisites: [],
      rewards: { gold: 20 },
      objectives: [{ id: 'repair-cart', kind: 'interact', target: 'market-cart', amount: 2, progress: 0, optional: false }],
    });
    quests.accept('roadside-repair', 10);

    const context: DialogueConditionContext = {
      quests,
      reputation: { merchants: 12 },
      settlementServices: { 'stonewatch-market': ['market', 'blacksmith'] },
    };

    expect(evaluateDialogueConditions([
      { kind: 'quest-status', questId: 'roadside-repair', status: 'active' },
      { kind: 'quest-objective-progress', questId: 'roadside-repair', objectiveId: 'repair-cart', amount: 2 },
      { kind: 'reputation-at-least', factionId: 'merchants', value: 10 },
      { kind: 'settlement-service', settlementId: 'stonewatch-market', service: 'blacksmith' },
    ], context)).toBe(false);

    quests.progress('roadside-repair', 'repair-cart', 1, 15);
    expect(evaluateDialogueConditions([{ kind: 'quest-objective-progress', questId: 'roadside-repair', objectiveId: 'repair-cart', amount: 1 }], context)).toBe(true);
    expect(evaluateDialogueConditions([{ kind: 'quest-objective-progress', questId: 'roadside-repair', objectiveId: 'repair-cart', amount: 2 }], context)).toBe(false);

    quests.progress('roadside-repair', 'repair-cart', 1, 20);
    expect(evaluateDialogueConditions([{ kind: 'quest-completed', questId: 'roadside-repair' }], context)).toBe(true);
  });

  it('supports any-of dialogue branches without changing the default all-of semantics', () => {
    const quests = new QuestAuthorityV2();
    const context: DialogueConditionContext = {
      quests,
      reputation: { merchants: 12 },
      settlementServices: { 'stonewatch-market': ['market'] },
    };
    const blockedQuest = { kind: 'quest-completed', questId: 'missing-quest' } as const;
    const merchantGate = { kind: 'reputation-at-least', factionId: 'merchants', value: 10 } as const;

    expect(evaluateDialogueConditions([blockedQuest, merchantGate], context)).toBe(false);
    expect(evaluateDialogueConditions([blockedQuest, merchantGate], context, 'any')).toBe(true);
    expect(evaluateDialogueConditions([], context, 'any')).toBe(false);
    expect(evaluateDialogueConditions([], context)).toBe(true);
  });

  it('normalizes safe keys and rejects malformed conditions', () => {
    expect(normalizeDialogueCondition({ kind: 'quest-completed', questId: '  road  ' })).toEqual({ kind: 'quest-completed', questId: 'road' });
    expect(normalizeDialogueCondition({ kind: 'quest-objective-progress', questId: 'road', objectiveId: 'repair', amount: 0 })).toBeNull();
    expect(normalizeDialogueCondition({ kind: 'reputation-at-least', factionId: 'guild', value: Number.NaN })).toBeNull();
    expect(isDialogueCondition({ kind: 'settlement-service', settlementId: 'town', service: 'tavern' })).toBe(true);
    expect(isDialogueCondition({ kind: 'settlement-service', settlementId: 'town', service: 'library' })).toBe(false);
  });

  it('produces order-independent deterministic keys after normalization and includes mode', () => {
    const a = [
      { kind: 'quest-completed', questId: ' a ' } as const,
      { kind: 'quest-objective-progress', questId: 'road', objectiveId: 'repair', amount: 2.9 } as const,
      { kind: 'reputation-at-least', factionId: 'b', value: 2 } as const,
    ];
    const b = [...a].reverse();
    expect(stableDialogueConditionKey(a)).toBe(stableDialogueConditionKey(b));
    expect(stableDialogueConditionKey(a)).not.toBe(stableDialogueConditionKey(a, 'any'));
    expect(stableDialogueConditionKey(a)).toContain('"amount":2');
  });

  it('compiles a reusable immutable gate and fails closed on malformed input', () => {
    const gate = createDialogueConditionGate([
      { kind: 'quest-completed', questId: 'roadside-repair' },
      { kind: 'quest-objective-progress', questId: 'roadside-repair', objectiveId: 'repair-cart', amount: 1 },
      { kind: 'settlement-service', settlementId: 'stonewatch-market', service: 'market' },
    ]);
    expect(gate).not.toBeNull();
    expect(gate?.key).toBe(stableDialogueConditionKey(gate?.conditions ?? [], gate?.mode));
    expect(gate?.mode).toBe('all');
    expect(Object.isFrozen(gate)).toBe(true);
    expect(Object.isFrozen(gate?.conditions)).toBe(true);

    const anyGate = createDialogueConditionGate([
      { kind: 'quest-completed', questId: 'missing-quest' },
      { kind: 'settlement-service', settlementId: 'stonewatch-market', service: 'market' },
    ], 'any');
    expect(anyGate?.mode).toBe('any');
    expect(anyGate?.key).toContain('any:');

    expect(createDialogueConditionGate([
      { kind: 'settlement-service', settlementId: 'stonewatch-market', service: 'library' as never },
    ])).toBeNull();
    expect(createDialogueConditionGate([], 'invalid' as never)).toBeNull();
  });
});
