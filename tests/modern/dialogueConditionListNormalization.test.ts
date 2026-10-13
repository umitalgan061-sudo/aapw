import { describe, expect, it } from 'vitest';
import {
  normalizeDialogueConditions,
  type DialogueCondition,
} from '../../src/3d/modern/questDialogueConditions.ts';

describe('dialogue condition list normalization', () => {
  it('normalizes and freezes a valid runtime list once', () => {
    const conditions = normalizeDialogueConditions([
      { kind: 'quest-completed', questId: '  road  ' },
      { kind: 'reputation-at-least', factionId: 'guild', value: 5 },
    ]);

    expect(conditions).toEqual([
      { kind: 'quest-completed', questId: 'road' },
      { kind: 'reputation-at-least', factionId: 'guild', value: 5 },
    ] satisfies DialogueCondition[]);
    expect(Object.isFrozen(conditions)).toBe(true);
  });

  it('fails closed for non-arrays and malformed members', () => {
    expect(normalizeDialogueConditions(null)).toBeNull();
    expect(normalizeDialogueConditions({})).toBeNull();
    expect(normalizeDialogueConditions([
      { kind: 'quest-completed', questId: 'road' },
      { kind: 'settlement-service', settlementId: 'town', service: 'library' },
    ])).toBeNull();
  });
});
