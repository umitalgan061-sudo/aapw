import { describe, expect, it } from 'vitest';
import { createTransformEntity, EntityComponentWorld, TransformComponent } from '../../src/3d/modern/nextgen/ecs.ts';
import { FixedStepClock, runDeterministicTicks } from '../../src/3d/modern/nextgen/fixedStep.ts';
import { DeterministicInputBuffer, InputButton, buttonPressed } from '../../src/3d/modern/nextgen/input.ts';
import { NextGenRuntimeKernel, createNullResourceLoader } from '../../src/3d/modern/nextgen/runtimeKernel.ts';
import { tickValue } from '../../src/3d/modern/nextgen/types.ts';

describe('nextgen core', () => {
  it('creates and queries typed entities', () => {
    const world = new EntityComponentWorld();
    const hero = createTransformEntity(world, 'hero', { position: { x: 10, y: 2, z: 5 } });
    expect(world.entityCount).toBe(1);
    expect(world.has(hero, TransformComponent)).toBe(true);
    expect(world.require(hero, TransformComponent).position).toEqual({ x: 10, y: 2, z: 5 });
    expect(world.query({ required: [TransformComponent], excluded: [] })).toEqual([hero]);
    expect(world.destroy(hero)).toBe(true);
    expect(world.entityCount).toBe(0);
  });

  it('limits fixed step catch-up deterministically', () => {
    const clock = new FixedStepClock({ tickRate: 60, maxCatchUpTicks: 2, maxFrameDeltaSeconds: 1, deterministicSeed: 1 });
    const ticks: number[] = [];
    const frame = clock.pushFrameDelta(0.2, { onTick: (tick) => ticks.push(Number(tick)) });
    expect(frame.simulatedTicks).toBe(2);
    expect(ticks).toEqual([1, 2]);
    expect(clock.droppedSeconds).toBeGreaterThan(0);
  });

  it('replays a deterministic tick count', () => {
    const values: number[] = [];
    const result = runDeterministicTicks(5, { tickRate: 30 }, (tick) => values.push(Number(tick)));
    expect(result.ticks).toBe(5);
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it('buffers, predicts and drops input frames', () => {
    const input = new DeterministicInputBuffer({ capacity: 4, inputLeadTicks: 2 });
    const frame = input.capture(tickValue(4), {
      moveX: 2,
      moveY: 0,
      lookX: 4,
      lookY: -2,
      buttons: InputButton.Jump | InputButton.Primary,
      axes: [2, -2, 0.5],
    });
    expect(frame.move.x).toBe(1);
    expect(buttonPressed(frame, InputButton.Jump)).toBe(true);
    expect(input.predicted(tickValue(4)).length).toBe(3);
    expect(input.dropThrough(tickValue(4))).toBe(1);
  });

  it('boots and advances the unified kernel', () => {
    const kernel = new NextGenRuntimeKernel({ resources: createNullResourceLoader() });
    expect(kernel.lifecycle.phase).toBe('cold');
    kernel.boot();
    expect(kernel.lifecycle.phase).toBe('ready');
    kernel.start();
    const frame = kernel.frame(1 / 30);
    expect(frame.simulatedTicks).toBeGreaterThan(0);
    expect(kernel.clock.tick).toBe(frame.tick);
    expect(kernel.health().status).toMatch(/healthy|degraded|critical/);
  });
});
