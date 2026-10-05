import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../../src/engine-ts/r43/clock.ts';
import { EcsWorld } from '../../src/engine-ts/r43/ecs.ts';
import { R43Runtime } from '../../src/engine-ts/r43/runtime.ts';
import { RenderBudgetGovernor, RenderGraph } from '../../src/engine-ts/r43/render.ts';

describe('r43 hardening edges', () => {
  it('allocates the next entity id correctly after restoring a snapshot', () => {
    const world = new EcsWorld();
    const first = world.create();
    world.create();
    world.destroy(first);
    const snapshot = world.snapshot();
    const clone = new EcsWorld();
    clone.restore({ entities: [2], stores: snapshot });
    expect(clone.create()).toBe(3);
  });

  it('drops excess fixed-step work instead of spiraling', () => {
    const clock = new FixedStepClock({ hz: 60, maxSubSteps: 2, maxDeltaSeconds: 1 });
    const result = clock.advance(0.5);
    expect(result.steps).toBe(2);
    expect(result.droppedSteps).toBeGreaterThan(0);
    expect(result.interpolationAlpha).toBeLessThan(1);
  });

  it('does not queue stale control commands across pause and resume', () => {
    const runtime = new R43Runtime();
    runtime.initialize();
    runtime.pause('menu');
    const pausedTick = runtime.clock.tick();
    runtime.frame(0.5, 40, 30, 30);
    expect(runtime.clock.tick()).toBe(pausedTick);
    runtime.resume();
    runtime.frame(0.02, 10, 3, 3);
    expect(runtime.clock.tick()).toBeGreaterThan(pausedTick);
  });

  it('uses explicit render priority rather than lexical priority ordering', () => {
    const graph = new RenderGraph();
    const order: string[] = [];
    graph.add({ id: 'normal-pass', phase: 'opaque', priority: 'normal', execute: () => order.push('normal') });
    graph.add({ id: 'high-pass', phase: 'opaque', priority: 'high', execute: () => order.push('high') });
    graph.add({ id: 'critical-pass', phase: 'opaque', priority: 'critical', execute: () => order.push('critical') });
    graph.execute({
      frame: 1,
      quality: { tier: 'high', renderScale: 1, particleScale: 1, shadowScale: 1, reason: 'test' },
      submit: () => {},
    }, 8);
    expect(order).toEqual(['critical', 'high', 'normal']);
  });

  it('recovers quality monotonically after pressure is removed', () => {
    const governor = new RenderBudgetGovernor('medium', 0.5, 1);
    governor.force('low', 0.55);
    const before = governor.scale();
    for (let i = 0; i < 120; i += 1) governor.observe(8, 16.67, 1 / 60);
    expect(governor.scale()).toBeGreaterThan(before);
  });
});
