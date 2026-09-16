import { describe, expect, it } from 'vitest';
import { NextGenRuntimeKernel, createNullResourceLoader } from '../../src/3d/modern/nextgen/runtimeKernel.ts';
import { createSystem } from '../../src/3d/modern/nextgen/scheduler.ts';
import { EntityComponentWorld, TransformComponent, createTransformEntity } from '../../src/3d/modern/nextgen/ecs.ts';
import { LegacyRuntimeAdapter } from '../../src/3d/modern/nextgen/legacyAdapter.ts';
import { tickValue } from '../../src/3d/modern/nextgen/types.ts';

describe('nextgen integration boundaries', () => {
  it('runs a user system through the kernel', () => {
    const ticks: number[] = [];
    const kernel = new NextGenRuntimeKernel({
      resources: createNullResourceLoader(),
      initialSystems: [createSystem('test.counter', 'simulation', ({ tick }) => ticks.push(Number(tick)), { priority: 1 })],
    });
    kernel.boot();
    kernel.start();
    kernel.frame(1 / 30);
    expect(ticks.length).toBeGreaterThan(0);
  });

  it('produces stable digests for identical deterministic worlds', () => {
    const build = () => {
      const world = new EntityComponentWorld();
      const entity = createTransformEntity(world, 'hero');
      world.upsertTransform(entity, { x: 4, y: 2, z: -3 });
      return JSON.stringify(world.snapshot());
    };
    expect(build()).toBe(build());
  });

  it('adapts legacy position input with movement bounds', () => {
    const kernel = new NextGenRuntimeKernel({ resources: createNullResourceLoader() });
    kernel.boot();
    const adapter = new LegacyRuntimeAdapter(kernel, { maxPositionDeltaMeters: 4 });
    const safe = adapter.sanitizePosition({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 });
    expect(Math.hypot(safe.x, safe.y, safe.z)).toBe(4);
  });

  it('keeps lifecycle transitions explicit', () => {
    const transitions: string[] = [];
    const kernel = new NextGenRuntimeKernel({ resources: createNullResourceLoader() }, { onLifecycle: (state) => transitions.push(state.phase) });
    kernel.boot();
    kernel.start();
    kernel.pause('test');
    kernel.stop();
    expect(transitions).toEqual(['booting', 'ready', 'running', 'paused', 'stopping', 'stopped']);
  });

  it('captures a valid baseline snapshot', () => {
    const kernel = new NextGenRuntimeKernel({ resources: createNullResourceLoader() });
    kernel.boot();
    const entity = kernel.world.spawn();
    kernel.world.add(entity, TransformComponent, { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
    const snapshot = kernel.snapshot();
    expect(snapshot.entities).toHaveLength(1);
    expect(snapshot.checksum).toBeTypeOf('number');
    expect(snapshot.tick).toBe(tickValue(0));
  });
});
