import { describe, expect, it } from 'vitest';
import { buildSettlementServiceMenu } from '../../src/3d/modern/settlementServiceMenu';

describe('settlement service menu', () => {
  it('projects blacksmith craft and repair in canonical order', () => {
    const menu = buildSettlementServiceMenu({
      settlementId: 'amberfall',
      serviceKind: 'blacksmith',
      isOpen: true,
      hasAccess: true,
    });
    expect(menu.map((entry) => entry.action)).toEqual(['craft', 'repair']);
    expect(menu.every((entry) => entry.enabled)).toBe(true);
  });

  it('keeps quest locks visible with a concrete hint', () => {
    const menu = buildSettlementServiceMenu({
      settlementId: 'amberfall',
      serviceKind: 'market',
      isOpen: true,
      hasAccess: true,
      requiredQuestIds: ['market-intro'],
      completedQuestIds: [],
    });
    expect(menu[0]).toMatchObject({
      action: 'trade',
      enabled: false,
      reason: 'quest-locked',
      hint: 'Requires quest: market-intro',
    });
  });

  it('filters malformed custom actions and preserves canonical ordering', () => {
    const menu = buildSettlementServiceMenu({
      settlementId: 'amberfall',
      serviceKind: 'blacksmith',
      isOpen: true,
      hasAccess: true,
      availableActions: ['repair', 'bogus' as never, 'craft', 'repair'],
    });
    expect(menu.map((entry) => entry.action)).toEqual(['craft', 'repair']);
  });
});
