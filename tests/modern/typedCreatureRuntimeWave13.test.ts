import { describe, expect, it } from 'vitest';
import { CREATURE_BODY_PLANS, CREATURE_BODY_PLAN_IDS, findBodyPlan } from '../../src/3d/gameplay/creatureBodyPlans.ts';
import { CHOICES_BY_NPC_ID } from '../../src/3d/gameplay/dialogueChoices.ts';
import { CREATURE_RUNTIME_R13 } from '../../src/3d/modern/creatureRuntimeContractsR13.ts';

describe('typed creature runtime wave 13', () => {
  it('keeps the complete procedural species catalog bounded and typed', () => {
    expect(CREATURE_RUNTIME_R13.version).toBe(13);
    expect(CREATURE_BODY_PLAN_IDS).toHaveLength(19);
    for (const id of CREATURE_BODY_PLAN_IDS) {
      const plan = findBodyPlan(id);
      expect(plan.id).toBe(id);
      expect(plan.bodyLengthMeters).toBeGreaterThan(0);
      expect(plan.shoulderHeightMeters).toBeGreaterThan(0);
      expect(Number.isFinite(plan.strideHz.walk)).toBe(true);
      expect(Number.isFinite(plan.strideHz.run)).toBe(true);
    }
    expect(CREATURE_BODY_PLANS.kedi?.restGait).toBe('prowl');
    expect(CREATURE_BODY_PLANS.zurafa?.neckLengthFactor).toBeGreaterThan(1);
  });

  it('keeps dialogue choice data non-empty and placeholder-safe', () => {
    const ids = Object.keys(CHOICES_BY_NPC_ID);
    expect(ids.length).toBeGreaterThanOrEqual(13);
    for (const choices of Object.values(CHOICES_BY_NPC_ID)) {
      expect(choices.length).toBeGreaterThanOrEqual(2);
      for (const choice of choices) {
        expect(choice.label.trim().length).toBeGreaterThan(0);
        expect(choice.response).toContain('{name}');
      }
    }
  });
});
