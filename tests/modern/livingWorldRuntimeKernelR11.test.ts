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



  it('fills the configured budget for dense single and non-default buckets', () => {
    const denseActors = Array.from({ length: 128 }, (_, index) => ({
      id: `guard-${index}`,
      urgency: (index % 10) / 10,
      ageTicks: index % 31,
    }));

    const singleBucket = createLivingWorldStimulusWorkBudget({ bucketCount: 1, budget: 128 });
    const singleSelection = singleBucket.select(denseActors, 128);
    expect(singleSelection.selected).toHaveLength(128);
    expect(singleSelection.buckets).toHaveLength(1);
    expect(singleSelection.selected.every((actor) => actor.bucket === 0)).toBe(true);

    const threeBuckets = createLivingWorldStimulusWorkBudget({ bucketCount: 3, budget: 128 });
    const multiSelection = threeBuckets.select(denseActors, 128);
    expect(multiSelection.selected).toHaveLength(128);
    expect(multiSelection.buckets).toHaveLength(3);
    expect(multiSelection.buckets.every((bucket) =>
      bucket.actors.every((actor) => actor.bucket === bucket.bucket),
    )).toBe(true);
  });

  it('counts starvation once per active actor and clears inactive or absent debt', () => {
    const budget = createLivingWorldStimulusWorkBudget({
      bucketCount: 1,
      budget: 1,
      starvationTicks: 2,
    });
    const duplicate = [
      { id: 'same-actor', urgency: 0.2 },
      { id: 'same-actor', urgency: 0.2 },
    ];

    budget.select(duplicate, 0);
    expect(budget.starvationSnapshot().starving).toEqual([]);
    budget.select(duplicate, 0);
    expect(budget.starvationSnapshot().starving).toEqual([{ id: 'same-actor', ticks: 2 }]);

    budget.select([{ id: 'sleeping-actor', active: false }], 0);
    expect(budget.starvationSnapshot().starving).toEqual([]);
    budget.select([], 0);
    expect(budget.starvationSnapshot().starving).toEqual([]);
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
