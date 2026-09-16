import { describe, expect, it, vi } from 'vitest';
import { NextRuntime, Transform, Velocity } from '../../../src/3d/modern/next/index.ts';
import { entityId, tick } from '../../../src/3d/modern/next/types.ts';

describe('next runtime', () => {
  it('starts idempotently and exposes health state', () => {
    const runtime = new NextRuntime({ simulationHz: 30, resourceEntries: 8 });
    expect(runtime.running).toBe(false);
    runtime.start();
    runtime.start();
    expect(runtime.running).toBe(true);
    expect(runtime.healthPayload().entities).toBe(0);
  });

  it('advances fixed-step simulation deterministically', () => {
    const runtime = new NextRuntime({ simulationHz: 60 });
    const id = runtime.world.createEntity();
    runtime.world.component<typeof Velocity>('velocity' as never).set(id, { x: 2, y: 0, z: 0 });
    runtime.world.component<typeof Transform>('transform' as never).set(id, { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 });
    runtime.start();
    const result = runtime.frame(1 / 30, { simulationMs: 2, renderMs: 3, streamingMs: 1, networkMs: 1, totalMs: 7 });
    expect(result.steps).toBeGreaterThan(0);
    const transform = runtime.world.component<typeof Transform>('transform' as never).get(id);
    expect(transform?.position.x).toBeGreaterThan(0);
  });

  it('emits world events', () => {
    const runtime = new NextRuntime();
    const events: number[] = [];
    runtime.events.on('world:tick', (event) => events.push(event.tick));
    runtime.start();
    runtime.frame(1 / 60, { simulationMs: 1, renderMs: 1, streamingMs: 1, networkMs: 0, totalMs: 3 });
    expect(events.length).toBeGreaterThan(0);
  });

  it('indexes entities spatially', () => {
    const runtime = new NextRuntime();
    runtime.indexEntity(1, 0, 0, 1);
    runtime.indexEntity(2, 100, 0, 1);
    expect(runtime.spatial.queryCircle(0, 0, 10).map((item) => item.id)).toEqual([entityId(1)]);
  });

  it('validates and throttles command payloads', () => {
    const runtime = new NextRuntime({ security: { maxCommandsPerSecond: 2 } });
    expect(runtime.validateCommandPayload({ ok: true, values: [1, 2, 3] })).toBe(true);
    expect(runtime.commandAllowed('player', 0)).toBe(true);
    expect(runtime.commandAllowed('player', 1)).toBe(true);
    expect(runtime.commandAllowed('player', 2)).toBe(false);
  });

  it('accepts input commands and tracks sequence', () => {
    const runtime = new NextRuntime();
    const command = runtime.submitInput({ tick: tick(3), moveX: 1.4, moveZ: -1.3, lookX: 0.5, lookY: -0.7, buttons: 7 });
    expect(command.sequence).toBe(1);
    expect(command.moveX).toBe(1);
    expect(runtime.lastInputSequence()).toBe(1);
  });

  it('loads resources and emits readiness', async () => {
    const runtime = new NextRuntime({ resourceEntries: 4, resourceBytes: 128 });
    const ready = vi.fn();
    runtime.events.on('resource:ready', ready);
    await runtime.loadResource('hero', async () => ({ value: { name: 'hero' }, bytes: 32 }));
    expect(runtime.resources.stats().ready).toBe(1);
    expect(ready).toHaveBeenCalledTimes(1);
  });
});
