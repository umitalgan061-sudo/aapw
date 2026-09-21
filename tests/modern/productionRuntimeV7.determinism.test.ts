import { describe, expect, it } from 'vitest';
import { AdaptiveRenderPolicyV7, BudgetSchedulerV7, EntityStoreV7, SpatialIndexV7, checksumV7, entityIdV7, tickV7, vec3V7, resolveRenderProfileV7, platformProfileForTestsV7 } from '../../src/3d/modern/production-v7/index.ts';

const makeEntity = (id: number) => ({
  id: entityIdV7(id), archetype: 'npc', createdTick: tickV7(0),
  components: {
    transform: { position: vec3V7(id, 0, id * 2), yaw: id * 0.1, pitch: 0, scale: vec3V7(1, 1, 1) },
    kinematics: { velocity: vec3V7(id * 0.1, 0, 0), acceleration: vec3V7(), grounded: true, maxSpeed: 5 },
    vital: { health: 100 - id, maxHealth: 100, stamina: 90, maxStamina: 100, poise: 100, maxPoise: 100, invulnerableUntilTick: tickV7(0) },
    interest: { priority: id % 5, simulationLod: (id % 4) as 0 | 1 | 2 | 3, renderLod: (id % 4) as 0 | 1 | 2 | 3, alwaysRelevant: false },
    network: { owner: 'test', dirtyRevision: 0 as never, lastAckedSequence: 0 as never, replicated: true },
    tags: ['npc', id % 2 ? 'odd' : 'even'],
  },
});

describe('production runtime v7 deterministic contracts', () => {
  it('sort order is stable regardless of insertion order', () => {
    const a = new EntityStoreV7();
    const b = new EntityStoreV7();
    for (const id of [7, 2, 11, 3, 1]) a.upsert(makeEntity(id));
    for (const id of [1, 3, 11, 2, 7]) b.upsert(makeEntity(id));
    expect(checksumV7(a.digestInput())).toBe(checksumV7(b.digestInput()));
  });

  it('spatial query order is stable for equal distance', () => {
    const spatial = new SpatialIndexV7(10);
    for (const id of [8, 4, 6, 2]) spatial.upsert({ id: entityIdV7(id), layer: 0, active: true, bounds: { min: vec3V7(id, 0, 0), max: vec3V7(id + 1, 2, 1) } });
    const first = spatial.nearest(vec3V7(0, 0, 0), 100, 10).map((value) => Number(value.id));
    const second = spatial.nearest(vec3V7(0, 0, 0), 100, 10).map((value) => Number(value.id));
    expect(first).toEqual(second);
  });

  it('scheduler tie-breakers are deterministic', () => {
    const a = new BudgetSchedulerV7(7); const b = new BudgetSchedulerV7(7);
    for (const scheduler of [a, b]) for (let i = 0; i < 20; i += 1) scheduler.enqueue({ id: `t-${i}`, lane: i < 10 ? 'simulation' : 'background', priority: 1, costEstimateMs: 0.01, budgetClass: 'preferred', maxDeferrals: 1, payload: i, run: (payload) => ({ outcome: 'executed', costMs: payload * 0.001 }) });
    expect(a.runTick(tickV7(3), 2)).toEqual(b.runTick(tickV7(3), 2));
  });

  it('adaptive render policy converges toward lower scale under pressure', () => {
    const policy = new AdaptiveRenderPolicyV7(resolveRenderProfileV7(platformProfileForTestsV7('full')));
    const budget = { frameMs: 30, drawCalls: 4000, triangles: 9_000_000, textureBytes: 500_000_000, gpuMemoryBytes: 800_000_000 };
    const scales: number[] = [];
    for (let i = 0; i < 12; i += 1) scales.push(policy.decide(budget).effectiveScale);
    expect(scales.at(-1)).toBeLessThan(scales[0]!);
  });
});
