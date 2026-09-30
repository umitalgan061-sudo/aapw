import { describe, expect, it } from 'vitest';
import { StrictStreamingRuntime, buildStreamRegions } from '../../../src/3d/strict/streamingRuntime.ts';
import { StrictWorldQueryRuntime } from '../../../src/3d/strict/worldQueryRuntime.ts';
import { StrictEntityBudgetRuntime } from '../../../src/3d/strict/entityBudgetRuntime.ts';
import { aabbCollider, circleCollider } from '../../../src/3d/strict/physicsRuntime.ts';
import { entityId, vec3 } from '../../../src/3d/strict/liveCoreTypes.ts';

describe('world runtime primitives', () => {
  it('builds deterministic predictive regions', () => {
    const a = buildStreamRegions(vec3(0, 0, 0), 256);
    const b = buildStreamRegions(vec3(0, 0, 0), 256);
    expect(a.map(region => region.key)).toEqual(b.map(region => region.key));
    expect(a[0]?.priority).toBeGreaterThanOrEqual(a.at(-1)?.priority ?? 0);
  });
  it('limits concurrent stream loads', () => {
    const runtime = new StrictStreamingRuntime(256, {
      criticalRadius: 1,
      nearRadius: 2,
      midRadius: 3,
      farRadius: 4,
      hysteresis: .75,
      maxResidentRegions: 100,
      maxConcurrentLoads: 2,
      maxResidentBytes: 100000,
      staleTicks: 10,
    });
    const plan = runtime.plan(1, vec3(0, 0, 0), vec3(40, 0, 0));
    expect(plan.loads.length).toBeLessThanOrEqual(2);
    expect(plan.desired.length).toBeGreaterThan(0);
  });
  it('tracks stream residency', () => {
    const runtime = new StrictStreamingRuntime(64);
    const region = buildStreamRegions(vec3(0, 0, 0), 64)[0]!;
    expect(runtime.enqueue(region, 1)).toBe(true);
    expect(runtime.complete(region.key, 1024, 2)).toBe(true);
    expect(runtime.record(region.key)?.state).toBe('resident');
    expect(runtime.diagnostics().residentBytes).toBe(1024);
  });
  it('rejects duplicate stream requests', () => {
    const runtime = new StrictStreamingRuntime();
    const region = buildStreamRegions(vec3(0, 0, 0), 256)[0]!;
    expect(runtime.enqueue(region, 1)).toBe(true);
    expect(runtime.enqueue(region, 2)).toBe(false);
  });
  it('queries circle and box geometry deterministically', () => {
    const runtime = new StrictWorldQueryRuntime([
      circleCollider(entityId('near'), 1, 0, 1),
      circleCollider(entityId('far'), 10, 0, 1),
      aabbCollider(entityId('box'), { minX: -2, maxX: 2, minZ: -2, maxZ: 2 }),
    ]);
    const hits = runtime.query({
      type: 'circle',
      center: { x: 0, z: 0, radius: 2 },
    });
    expect(hits.map(hit => hit.id)).toEqual(['box', 'near']);
  });
  it('returns the nearest world hit', () => {
    const runtime = new StrictWorldQueryRuntime([
      circleCollider(entityId('far'), 10, 0, 1),
      circleCollider(entityId('near'), 2, 0, 1),
    ]);
    expect(runtime.nearest(vec3(0, 0, 0))?.id).toBe('near');
  });
  it('respects collision layer masks', () => {
    const runtime = new StrictWorldQueryRuntime([
      circleCollider(entityId('a'), 0, 0, 1, 1),
      circleCollider(entityId('b'), 0, 0, 1, 2),
    ]);
    expect(runtime.query(
      { type: 'circle', center: { x: 0, z: 0, radius: 1 } },
      { layerMask: 2 },
    ).map(hit => hit.id)).toEqual(['b']);
  });
  it('selects important entities under update budgets', () => {
    const runtime = new StrictEntityBudgetRuntime({
      maxEntities: 10,
      maxResidentBytes: 10000,
      maxUpdateMs: 1,
      lodDistances: [20, 50, 100],
    });
    const plan = runtime.plan('high', [
      { id: entityId('hero'), distance: 2, importance: 10, estimatedBytes: 1000, updateCostMs: .3, alwaysResident: true },
      { id: entityId('npc-a'), distance: 25, importance: 2, estimatedBytes: 1000, updateCostMs: .3 },
      { id: entityId('npc-b'), distance: 120, importance: 1, estimatedBytes: 1000, updateCostMs: .3 },
    ]);
    expect(plan.resident.some(entity => entity.id === 'hero')).toBe(true);
    expect(plan.dormant).toContain('npc-b');
    expect(plan.updateMs).toBeLessThanOrEqual(1);
  });
  it('emits stable diagnostics', () => {
    const runtime = new StrictWorldQueryRuntime([
      circleCollider(entityId('one'), 0, 0, 1),
    ]);
    expect(runtime.diagnostics().digest).toBe(runtime.diagnostics().digest);
  });
});