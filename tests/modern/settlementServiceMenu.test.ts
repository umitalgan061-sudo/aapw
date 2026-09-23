import { describe, expect, it } from 'vitest';
import { buildSettlementServiceMenu } from '../../src/3d/modern/settlementServiceMenu';

describe('buildSettlementServiceMenu', () => {
  it('builds a blacksmith menu from the canonical service contract', () => {
    const menu = buildSettlementServiceMenu({
      settlementId: 'northwatch',
      serviceKind: 'blacksmith',
      isOpen: true,
      hasAccess: true,
    });

    expect(menu).toEqual([
      { action: 'craft', label: 'Craft', enabled: true, reason: 'allowed', missingQuestIds: [] },
      { action: 'repair', label: 'Repair', enabled: true, reason: 'allowed', missingQuestIds: [] },
    ]);
    expect(Object.isFrozen(menu)).toBe(true);
    expect(Object.isFrozen(menu[0])).toBe(true);
  });

  it('keeps quest-locked entries visible with their missing quest ids', () => {
    const menu = buildSettlementServiceMenu({
      settlementId: 'northwatch',
      serviceKind: 'market',
      isOpen: true,
      hasAccess: true,
      requiredQuestIds: ['trade-license', 'merchant-charter'],
      completedQuestIds: ['trade-license'],
    });

    expect(menu).toEqual([
      {
        action: 'trade',
        label: 'Trade',
        enabled: false,
        reason: 'quest-locked',
        missingQuestIds: ['merchant-charter'],
      },
    ]);
  });

  it('deduplicates custom actions and preserves fail-closed service state', () => {
    const menu = buildSettlementServiceMenu({
      settlementId: 'northwatch',
      serviceKind: 'tavern',
      isOpen: false,
      hasAccess: true,
      availableActions: ['rest', 'rest'],
    });

    expect(menu).toEqual([
      { action: 'rest', label: 'Rest', enabled: false, reason: 'service-closed', missingQuestIds: [] },
    ]);
  });

  it('drops malformed runtime actions instead of emitting unlabeled menu rows', () => {
    const menu = buildSettlementServiceMenu({
      settlementId: 'northwatch',
      serviceKind: 'market',
      isOpen: true,
      hasAccess: true,
      availableActions: ['trade', 'craft' as never, 'unknown-action' as never],
    });

    expect(menu).toEqual([
      { action: 'trade', label: 'Trade', enabled: true, reason: 'allowed', missingQuestIds: [] },
    ]);
  });
});
