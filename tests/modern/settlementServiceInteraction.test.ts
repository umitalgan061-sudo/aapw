import { describe, expect, it } from 'vitest';
import { resolveSettlementServiceInteraction } from '../../src/3d/modern/settlementServiceInteraction';

describe('resolveSettlementServiceInteraction', () => {
  it('allows the canonical blacksmith craft action', () => {
    const result = resolveSettlementServiceInteraction(
      {
        settlementId: 'northwatch',
        serviceKind: 'blacksmith',
        isOpen: true,
        hasAccess: true,
      },
      'craft',
    );

    expect(result).toMatchObject({ allowed: true, reason: 'allowed' });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects actions that do not belong to the service', () => {
    const result = resolveSettlementServiceInteraction(
      {
        settlementId: 'northwatch',
        serviceKind: 'tavern',
        isOpen: true,
        hasAccess: true,
      },
      'trade',
    );

    expect(result).toMatchObject({ allowed: false, reason: 'action-unavailable' });
  });

  it('fails closed for closed, inaccessible, or quest-locked services', () => {
    expect(
      resolveSettlementServiceInteraction(
        { settlementId: 'northwatch', serviceKind: 'market', isOpen: false, hasAccess: true },
        'trade',
      ).reason,
    ).toBe('service-closed');

    expect(
      resolveSettlementServiceInteraction(
        { settlementId: 'northwatch', serviceKind: 'stable', isOpen: true, hasAccess: false },
        'travel',
      ).reason,
    ).toBe('access-denied');

    expect(
      resolveSettlementServiceInteraction(
        {
          settlementId: 'northwatch',
          serviceKind: 'market',
          isOpen: true,
          hasAccess: true,
          requiredQuestIds: ['trade-license'],
          completedQuestIds: [],
        },
        'trade',
      ).reason,
    ).toBe('quest-locked');
  });

  it('allows quest-gated services once every requirement is complete', () => {
    const result = resolveSettlementServiceInteraction(
      {
        settlementId: 'northwatch',
        serviceKind: 'market',
        isOpen: true,
        hasAccess: true,
        requiredQuestIds: ['trade-license', 'trade-license'],
        completedQuestIds: ['trade-license'],
      },
      'trade',
    );

    expect(result).toMatchObject({ allowed: true, reason: 'allowed' });
    expect(result.requiredQuestIds).toEqual(['trade-license']);
  });

  it('deduplicates quest requirements and rejects malformed contexts', () => {
    const gated = resolveSettlementServiceInteraction(
      {
        settlementId: 'northwatch',
        serviceKind: 'market',
        isOpen: true,
        hasAccess: true,
        requiredQuestIds: ['trade-license', 'trade-license', ''],
        completedQuestIds: ['trade-license'],
      },
      'trade',
    );

    expect(gated.requiredQuestIds).toEqual(['trade-license']);

    const invalid = resolveSettlementServiceInteraction(
      { settlementId: '', serviceKind: 'market', isOpen: true, hasAccess: true },
      'trade',
    );

    expect(invalid).toMatchObject({ allowed: false, reason: 'invalid-context' });
  });
});
