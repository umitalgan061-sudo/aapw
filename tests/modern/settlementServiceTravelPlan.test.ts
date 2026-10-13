import { describe, expect, it } from 'vitest';
import {
  applySettlementServiceTravel,
  planSettlementServiceTravel,
} from '../../src/3d/modern/settlementServiceTravelPlan';

describe('settlement service travel plan', () => {
  it('creates an executable stable travel plan with deterministic costs', () => {
    const plan = planSettlementServiceTravel({
      service: 'stable',
      action: 'travel',
      distanceMeters: 1250,
      copper: 10,
      stamina: 5,
      destinationUnlocked: true,
      serviceOpen: true,
    });

    expect(plan.allowed).toBe(true);
    expect(plan.reason).toBe('allowed');
    expect(plan.copperCost).toBe(3);
    expect(plan.staminaCost).toBe(2);
    expect(plan.travelMinutes).toBe(5);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it('fails closed for unsupported actions and quest gates', () => {
    const unsupported = planSettlementServiceTravel({ service: 'stable', action: 'rest', distanceMeters: 500 });
    expect(unsupported.allowed).toBe(false);
    expect(unsupported.reason).toBe('unsupported-action');

    const questLocked = planSettlementServiceTravel({
      service: 'stable',
      action: 'travel',
      distanceMeters: 500,
      requiredQuestIds: ['q-2', 'q-1', 'q-1'],
      completedQuestIds: ['q-2'],
      copper: 10,
      stamina: 10,
      destinationUnlocked: true,
    });
    expect(questLocked.reason).toBe('quest-locked');
    expect(questLocked.missingQuestIds).toEqual(['q-1']);
  });

  it('does not mutate player state when the plan is blocked', () => {
    const player = { copper: 1, stamina: 1, worldMinutes: 10 };
    const plan = planSettlementServiceTravel({
      service: 'stable',
      action: 'travel',
      distanceMeters: 2000,
      copper: player.copper,
      stamina: player.stamina,
      destinationUnlocked: true,
    });

    expect(plan.reason).toBe('insufficient-copper');
    expect(applySettlementServiceTravel(plan, player)).toEqual(player);
    expect(player).toEqual({ copper: 1, stamina: 1, worldMinutes: 10 });
  });
});
