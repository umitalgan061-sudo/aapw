import { describe, expect, it } from 'vitest';
import { resolveSettlementServiceActionPlan } from '../../src/3d/modern/settlementServiceActionPlan';

describe('settlement service action plan', () => {
  it('keeps an allowed blacksmith action executable when funds and items are present', () => {
    const plan = resolveSettlementServiceActionPlan(
      {
        settlementId: 'northwatch',
        serviceKind: 'blacksmith',
        isOpen: true,
        hasAccess: true,
        canAfford: true,
        requiredItemIds: ['iron_ingot'],
        ownedItemIds: ['iron_ingot'],
      },
      'craft',
    );

    expect(plan.allowed).toBe(true);
    expect(plan.affordability).toBe('satisfied');
    expect(plan.missingItemIds).toEqual([]);
    expect(plan.executable).toBe(true);
  });

  it('fails closed when the shop is reachable but affordability is unknown', () => {
    const plan = resolveSettlementServiceActionPlan(
      {
        settlementId: 'market-square',
        serviceKind: 'market',
        isOpen: true,
        hasAccess: true,
      },
      'trade',
    );

    expect(plan.allowed).toBe(true);
    expect(plan.affordability).toBe('insufficient-data');
    expect(plan.executable).toBe(false);
  });

  it('reports missing ingredients without mutating input collections', () => {
    const requiredItemIds = ['oak', 'rope', 'oak'];
    const ownedItemIds = ['oak'];
    const plan = resolveSettlementServiceActionPlan(
      {
        settlementId: 'farmstead',
        serviceKind: 'farm',
        isOpen: true,
        hasAccess: true,
        canAfford: true,
        requiredItemIds,
        ownedItemIds,
      },
      'gather',
    );

    expect(plan.missingItemIds).toEqual(['rope']);
    expect(plan.executable).toBe(false);
    expect(requiredItemIds).toEqual(['oak', 'rope', 'oak']);
    expect(ownedItemIds).toEqual(['oak']);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.missingItemIds)).toBe(true);
  });
});
