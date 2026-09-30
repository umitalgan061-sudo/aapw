import { describe, expect, it, vi } from 'vitest';
import { R29AssetCache } from '../../src/3d/modern/r29/assetCache.ts';
import { R29BudgetDirector } from '../../src/3d/modern/r29/budgetDirector.ts';
import { R29EventBus } from '../../src/3d/modern/r29/eventBus.ts';
import { R29FixedStepClock } from '../../src/3d/modern/r29/clock.ts';
import { R29InputRuntime } from '../../src/3d/modern/r29/inputRuntime.ts';
import { R29NetworkCoordinator } from '../../src/3d/modern/r29/networkCoordinator.ts';
import { R29ServiceRegistry } from '../../src/3d/modern/r29/serviceRegistry.ts';
import { R29WorldRuntime } from '../../src/3d/modern/r29/worldRuntime.ts';

describe('R29 deterministic primitives', () => {
  it('caps a spiral-of-death frame and reports dropped steps', () => {
    const clock = new R29FixedStepClock({ tickRate: 60, maxStepsPerFrame: 2, maxFrameDeltaSeconds: 1 });
    const result = clock.advance(0.25);
    expect(result.steps).toBe(2);
    expect(result.droppedSteps).toBeGreaterThan(0);
  });

  it('maintains FIFO-equivalent sequencing after sorting by tick and sequence', () => {
    const input = new R29InputRuntime();
    expect(input.enqueue({ tick: 2, sequence: 2, moveX: 0, moveY: 0, lookX: 0, lookY: 0 }).accepted).toBe(true);
    expect(input.enqueue({ tick: 1, sequence: 3, moveX: 1, moveY: 0, lookX: 0, lookY: 0 }).accepted).toBe(true);
    expect(input.drain().map((value) => value.tick)).toEqual([1, 2]);
  });

  it('prevents duplicate network sequences', () => {
    const input = new R29InputRuntime();
    expect(input.enqueue({ tick: 0, sequence: 1, moveX: 0, moveY: 0, lookX: 0, lookY: 0 }).accepted).toBe(true);
    expect(input.enqueue({ tick: 0, sequence: 1, moveX: 0, moveY: 0, lookX: 0, lookY: 0 }).accepted).toBe(false);
  });

  it('evicts cold assets without evicting required or retained assets', () => {
    const cache = new R29AssetCache({ maxResidentBytes: 16 * 1024 * 1024, coldTicks: 1 });
    cache.declare({ id: 'required', url: '/required.bin', kind: 'binary', bytes: 4, priority: 100, required: true, version: '1' });
    cache.declare({ id: 'cold', url: '/cold.bin', kind: 'binary', bytes: 4, priority: 1, required: false, version: '1' });
    const fetcher = vi.fn(async () => 4);
    await cache.load('required', fetcher, 0);
    await cache.load('cold', fetcher, 0);
    cache.release('cold');
    const evicted = cache.sweep(2);
    expect(evicted).toContain('cold');
    expect(cache.get('required')?.state).toBe('resident');
  });

  it('steps budget tiers down under sustained pressure and back up after recovery', () => {
    const director = new R29BudgetDirector({ initialTier: 'ultra', degradeFrames: 2, recoveryFrames: 2 });
    director.observe({ frameMs: 40, simulationMs: 10, renderMs: 20, networkMs: 2, telemetryMs: 2, memoryBytes: 900_000_000, visibleObjects: 3000, drawCalls: 6000 });
    director.observe({ frameMs: 40, simulationMs: 10, renderMs: 20, networkMs: 2, telemetryMs: 2, memoryBytes: 900_000_000, visibleObjects: 3000, drawCalls: 6000 });
    const degradedTier = director.snapshot().quality.tier;
    expect(['safe', 'low', 'medium', 'high']).toContain(degradedTier);
    director.observe({ frameMs: 8, simulationMs: 2, renderMs: 2, networkMs: 0.1, telemetryMs: 0.1, memoryBytes: 200_000_000, visibleObjects: 300, drawCalls: 500 });
    director.observe({ frameMs: 8, simulationMs: 2, renderMs: 2, networkMs: 0.1, telemetryMs: 0.1, memoryBytes: 200_000_000, visibleObjects: 300, drawCalls: 500 });
    expect(['medium', 'high', 'ultra']).toContain(director.snapshot().quality.tier);
  });

  it('dispatches nested events without re-entrant corruption', () => {
    const bus = new R29EventBus();
    const calls: string[] = [];
    bus.on('runtime.started', () => {
      calls.push('a');
      bus.emit('runtime.paused', { tick: 1 });
    });
    bus.on('runtime.paused', () => calls.push('b'));
    bus.emit('runtime.started', { tick: 1 });
    expect(calls).toEqual(['a', 'b']);
  });

  it('detects missing service dependencies before startup', () => {
    const registry = new R29ServiceRegistry();
    registry.register({
      service: { id: 'a', start: () => undefined, stop: () => undefined, dispose: () => undefined },
      dependencies: ['missing'],
    });
    expect(registry.validate()).toEqual(['a->missing:missing']);
  });

  it('sorts nearest world entities deterministically', () => {
    const world = new R29WorldRuntime();
    world.createEntity({ kind: 'far', position: { x: 8, y: 0, z: 0 } });
    world.createEntity({ kind: 'near', position: { x: 2, y: 0, z: 0 } });
    expect(world.entitiesWithin({ x: 0, y: 0, z: 0 }, 10).map((e) => e.kind)).toEqual(['near', 'far']);
  });
});
