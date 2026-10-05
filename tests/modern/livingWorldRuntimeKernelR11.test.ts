import { describe, expect, it } from 'vitest';
import {
  evaluateFaunaActivityBudget,
  faunaActivityBudgetDigest,
} from '../../src/3d/gameplay/livingWorldFaunaActivityBudget.ts';
import {
  createLivingWorldStimulusWorkBudget,
  assignStimulusWorkBucket,
} from '../../src/3d/gameplay/livingWorldStimulusWorkBudget.ts';
import {
  createLivingWorldRuntimeKernel,
  replayLivingWorldRuntimeKernel,
} from '../../src/3d/gameplay/livingWorldRuntimeKernel.ts';

const actors = Object.freeze([
  { id: 'wolf-1', urgency: 0.9, ageTicks: 5 },
  { id: 'deer-1', urgency: 0.2, ageTicks: 18 },
  { id: 'horse-1', urgency: 0.4, ageTicks: 2 },
  { id: 'bear-1', urgency: 0.95, ageTicks: 1 },
  { id: 'fox-1', urgency: 0.1, ageTicks: 30 },
]);

const faunaCandidates = Object.freeze([
  { id: 'wolf-1', species: 'wolf', kind: 'threat', lod: 'near', threat: 0.9, recentWorkTicks: 0 },
  { id: 'deer-1', species: 'deer', kind: 'resource', lod: 'distant', resourceNeed: 0.8, recentWorkTicks: 9 },
  { id: 'horse-1', species: 'horse', kind: 'movement', lod: 'far', movementPressure: 0.5, recentWorkTicks: 2 },
  { id: 'bear-1', species: 'bear', kind: 'threat', lod: 'near', threat: 0.95, recentWorkTicks: 3 },
  { id: 'fox-1', species: 'fox', kind: 'ambient', lod: 'culled', recentWorkTicks: 30 },
]);

describe('R11 living-world runtime kernel', () => {
  it('is deterministic across repeated stimulus scheduling', () => {
    const first = assignStimulusWorkBucket('wolf-1', 8);
    const second = assignStimulusWorkBucket('wolf-1', 8);
    expect(first).toBe(second);

    const budget = createLivingWorldStimulusWorkBudget({ bucketCount: 8, budget: 4 });
    const a = budget.select(actors, 4);
    budget.reset();
    const b = budget.select(actors, 4);
    expect(a).toEqual(b);
  });

  it('keeps fauna activity selection bounded and replayable', () => {
    const result = evaluateFaunaActivityBudget(faunaCandidates, {
      tick: 12,
      seed: 'r11-seed',
      budget: 4,
      maxSelected: 4,
      globalThreat: 0.25,
    });
    expect(result.deterministic).toBe(true);
    expect(result.selected.length).toBeLessThanOrEqual(4);
    expect(result.deferred.length).toBeGreaterThan(0);
    expect(faunaActivityBudgetDigest(result)).toBe(faunaActivityBudgetDigest(result));

    const replay = replayLivingWorldRuntimeKernel(
      () => createLivingWorldRuntimeKernel({ stimulusBudget: 4, bucketCount: 8 }),
      [
        {
          tick: 1,
          actors,
          faunaCandidates,
          budget: 4,
          context: { seed: 'r11-seed', budget: 4, globalThreat: 0.2 },
        },
        {
          tick: 2,
          actors,
          faunaCandidates,
          budget: 4,
          context: { seed: 'r11-seed', budget: 4, globalThreat: 0.4 },
        },
      ],
    );
    expect(replay.deterministic).toBe(true);
    expect(replay.ticks).toBe(2);
    expect(replay.lastDigest).toMatch(/^[0-9a-f]{8}$/);
  });
});
