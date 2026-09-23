import { describe, expect, it } from 'vitest';
import {
  evaluateDialogueConditionDetailed,
  type DialogueConditionContext,
} from '../../src/3d/modern/questDialogueConditions.ts';

const condition = {
  kind: 'quest-objective-progress' as const,
  questId: 'settle-supplies',
  objectiveId: 'deliver-wood',
  amount: 2,
};

const contextWithQuest = (quest: unknown): DialogueConditionContext => ({
  quests: {
    get: () => quest,
  } as DialogueConditionContext['quests'],
});

describe('dialogue objective progress safety', () => {
  it('fails closed instead of throwing when objectives access throws', () => {
    const quest = new Proxy({}, {
      get(_target, property) {
        if (property === 'objectives') throw new Error('objectives unavailable');
        return undefined;
      },
    });

    expect(() => evaluateDialogueConditionDetailed(condition, contextWithQuest(quest))).not.toThrow();
    expect(evaluateDialogueConditionDetailed(condition, contextWithQuest(quest))).toEqual({
      passed: false,
      failure: 'objective-missing',
    });
  });

  it('ignores malformed objective entries and accepts a later valid match', () => {
    const quest = {
      objectives: [
        null,
        { id: 'other', progress: 9 },
        { id: 'deliver-wood', progress: 2 },
      ],
    };

    expect(evaluateDialogueConditionDetailed(condition, contextWithQuest(quest))).toEqual({
      passed: true,
      failure: null,
    });
  });
});
