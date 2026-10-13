import { describe, expect, it } from 'vitest';
import { resolveSettlementServiceInteraction } from '../../src/3d/modern/settlementServiceInteraction';

describe('settlement service interaction', () => {
  it('allows an open blacksmith craft action', () => {
    const receipt = resolveSettlementServiceInteraction(
      { settlementId: 'amberfall', serviceKind: 'blacksmith', isOpen: true, hasAccess: true },
      'craft',
    );
    expect(receipt.allowed).toBe(true);
    expect(receipt.reason).toBe('allowed');
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it('fails closed with missing quest ids', () => {
    const receipt = resolveSettlementServiceInteraction(
      {
        settlementId: 'amberfall',
        serviceKind: 'market',
        isOpen: true,
        hasAccess: true,
        requiredQuestIds: ['market-intro', 'market-intro'],
        completedQuestIds: [],
      },
      'trade',
    );
    expect(receipt.reason).toBe('quest-locked');
    expect(receipt.missingQuestIds).toEqual(['market-intro']);
  });

  it('rejects unavailable actions without inventing a framework', () => {
    const receipt = resolveSettlementServiceInteraction(
      { settlementId: 'amberfall', serviceKind: 'tavern', isOpen: true, hasAccess: true },
      'trade',
    );
    expect(receipt.reason).toBe('action-unavailable');
  });
});
