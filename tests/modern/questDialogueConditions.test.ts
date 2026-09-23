import { describe, expect, it } from 'vitest';
import { QuestAuthorityV2 } from '../../src/3d/modern/questAuthorityV2.ts';
import {
  createDialogueConditionGate,
  evaluateDialogueConditionDetailed,
  evaluateDialogueConditions,
  evaluateDialogueConditionsDetailed,
  isDialogueCondition,
  isDialogueConditionMode,
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

  it('exposes stable failure reasons for dialogue UX without changing the boolean gate', () => {
    const quests = new QuestAuthorityV2();
    const context: DialogueConditionContext = { quests, reputation: { merchants: 4 } };
    const missingQuest = { kind: 'quest-completed', questId: 'missing-quest' } as const;
    const lowReputation = { kind: 'reputation-at-least', factionId: 'merchants', value: 10 } as const;

    expect(evaluateDialogueConditionDetailed(missingQuest, context)).toEqual({ passed: false, failure: 'missing-quest' });
    expect(evaluateDialogueConditionDetailed(lowReputation, context)).toEqual({ passed: false, failure: 'reputation-too-low' });
    expect(evaluateDialogueConditionDetailed({ kind: 'settlement-service', settlementId: 'stonewatch', service: 'smithing' as never }, context)).toEqual({ passed: false, failure: 'invalid-condition' });
  });

  it('returns deterministic aggregate failure reasons for all-of and any-of dialogue UX', () => {
    const quests = new QuestAuthorityV2();
    const context: DialogueConditionContext = { quests, reputation: { merchants: 4 } };
    const result = evaluateDialogueConditionsDetailed([
      { kind: 'quest-completed', questId: 'missing-quest' },
      { kind: 'reputation-at-least', factionId: 'merchants', value: 10 },
    ], context);

    expect(result).toEqual({
      passed: false,
      failure: 'missing-quest',
      mode: 'all',
      failures: ['missing-quest', 'reputation-too-low'],
    });
    expect(evaluateDialogueConditionsDetailed([
      { kind: 'quest-completed', questId: 'missing-quest' },
      { kind: 'reputation-at-least', factionId: 'merchants', value: 10 },
    ], context, 'any')).toEqual({
      passed: false,
      failure: 'missing-quest',
      mode: 'any',
      failures: ['missing-quest', 'reputation-too-low'],
    });
    expect(evaluateDialogueConditionsDetailed([
      { kind: 'quest-completed', questId: 'missing-quest' },
      { kind: 'reputation-at-least', factionId: 'merchants', value: 10 },
    ], { quests, reputation: { merchants: 12 } }, 'any')).toEqual({
      passed: true,
      failure: null,
      mode: 'any',
      failures: ['missing-quest'],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.failures)).toBe(true);
  });

  it('fails closed for invalid modes at every evaluation boundary', () => {
    const quests = new QuestAuthorityV2();
    const context: DialogueConditionContext = { quests, reputation: { merchants: 12 } };
    const condition = { kind: 'reputation-at-least', factionId: 'merchants', value: 10 } as const;

    expect(isDialogueConditionMode('all')).toBe(true);
    expect(isDialogueConditionMode('any')).toBe(true);
    expect(isDialogueConditionMode('either')).toBe(false);
    expect(evaluateDialogueConditions([condition], context, 'either' as never)).toBe(false);
    expect(evaluateDialogueConditionsDetailed([condition], context, 'either' as never)).toEqual({
      passed: false,
      failure: 'invalid-condition',
      mode: 'all',
      failures: ['invalid-condition'],
    });
    expect(stableDialogueConditionKey([condition], 'either' as never)).toBe('invalid:');
  });

  it('rejects unknown runtime shapes without throwing', () => {
    expect(normalizeDialogueCondition(null)).toBeNull();
    expect(normalizeDialogueCondition({})).toBeNull();
    expect(normalizeDialogueCondition({ kind: 'unknown' })).toBeNull();
    expect(isDialogueCondition({})).toBe(false);
    expect(isDialogueCondition({ kind: 'unknown' })).toBe(false);
  });

  it('normalizes safe keys and rejects malformed conditions', () => {
    expect(normalizeDialogueCondition({ kind: 'quest-completed', questId: '  road  ' })).toEqual({ kind: 'quest-completed', questId: 'road' });
    expect(normalizeDialogueCondition({ kind: 'quest-objective-progress', questId: 'road', objectiveId: 'repair', amount: 0 })).toBeNull();
    expect(normalizeDialogueCondition({ kind: 'quest-objective-progress', questId: 'road', objectiveId: 'repair', amount: 0.5 })).toBeNull();
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

  it('compiles a reusable immutable gate with boolean and detailed evaluation surfaces', () => {
    const quests = new QuestAuthorityV2();
    const context: DialogueConditionContext = { quests, reputation: { merchants: 12 }, settlementServices: { 'stonewatch-market': ['market'] } };
    const gate = createDialogueConditionGate([
      { kind: 'quest-completed', questId: 'roadside-repair' },
      { kind: 'quest-objective-progress', questId: 'roadside-repair', objectiveId: 'repair-cart', amount: 1 },
      { kind: 'settlement-service', settlementId: 'stonewatch-market', service: 'market' },
    ]);
    expect(gate).not.toBeNull();
    expect(gate?.key).toBe(stableDialogueConditionKey(gate?.conditions ?? [], gate?.mode));
    expect(gate?.mode).toBe('all');
    expect(gate?.evaluate(context)).toBe(false);
    expect(gate?.evaluateDetailed(context)).toEqual({
      passed: false,
      failure: 'missing-quest',
      mode: 'all',
      failures: ['missing-quest'],
    });
    expect(Object.isFrozen(gate)).toBe(true);
    expect(Object.isFrozen(gate?.conditions)).toBe(true);
    expect(Object.isFrozen(gate?.evaluateDetailed(context))).toBe(true);

    const anyGate = createDialogueConditionGate([
      { kind: 'quest-completed', questId: 'missing-quest' },
      { kind: 'settlement-service', settlementId: 'stonewatch-market', service: 'market' },
    ], 'any');
    expect(anyGate?.mode).toBe('any');
    expect(anyGate?.key).toContain('any:');
    expect(anyGate?.evaluateDetailed(context)).toEqual({
      passed: true,
      failure: null,
      mode: 'any',
      failures: ['missing-quest'],
    });

    expect(createDialogueConditionGate([
      { kind: 'settlement-service', settlementId: 'stonewatch-market', service: 'library' as never },
    ])).toBeNull();
    expect(createDialogueConditionGate([], 'invalid' as never)).toBeNull();
  });
});
