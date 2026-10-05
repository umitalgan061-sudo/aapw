import { describe, expect, it } from 'vitest';
import { FixedStepClock, FrameBudgetMeter } from '../../src/engine-ts/r43/clock.ts';
import { SimulationKernel } from '../../src/engine-ts/r43/simulation.ts';

describe('r43 clock', () => {
  it('converts frame time into bounded fixed steps', () => {
    const clock = new FixedStepClock({ hz: 60, maxSubSteps: 5, maxDeltaSeconds: 0.25 });
    const result = clock.advance(0.2);
    expect(result.frame).toBe(1);
    expect(result.steps).toBe(5);
    expect(result.tick).toBe(5);
    expect(result.droppedSteps).toBe(7);
    expect(result.interpolationAlpha).toBeGreaterThanOrEqual(0);
    expect(result.interpolationAlpha).toBeLessThanOrEqual(1);
  });

  it('resets all counters for deterministic replay', () => {
    const clock = new FixedStepClock({ hz: 30, maxSubSteps: 4, maxDeltaSeconds: 0.2 });
    clock.advance(0.1);
    clock.reset(10, 20, 2);
    expect(clock.frame()).toBe(10);
    expect(clock.tick()).toBe(20);
    expect(clock.simTimeSeconds()).toBe(2);
    expect(clock.droppedSteps()).toBe(0);
  });

  it('tracks average and p95 frame budget', () => {
    const meter = new FrameBudgetMeter(8);
    meter.observe(10, 16.67);
    meter.observe(20, 16.67);
    meter.observe(30, 16.67);
    expect(meter.average()).toBeCloseTo(20, 6);
    expect(meter.p95()).toBe(30);
  });
}

describe('r43 simulation kernel', () => {
  it('runs a fixed-step system and advances components', () => {
    const simulation = new SimulationKernel({
      clock: new FixedStepClock({ hz: 60, maxSubSteps: 5, maxDeltaSeconds: 0.25 }),
    });
    const position = simulation.world.defineComponent<{ x: number }>('position');
    const entity = simulation.world.create();
    position.set(entity, { x: 0 });
    simulation.scheduler.add({
      id: 'movement',
      phase: 'simulation',
      priority: 'critical',
      update: () => {
        const current = simulation.world.getComponent<{ x: number }>(entity, 'position');
        if (current) simulation.world.addComponent(entity, 'position', { x: current.x + 1 });
      },
    });

    const advance = simulation.advance(0.05);
    expect(advance.clock.steps).toBe(3);
    expect(simulation.world.getComponent<{ x: number }>(entity, 'position')?.x).toBe(3);
    expect(advance.snapshot.tick).toBe(3);
    expect(advance.snapshot.entities).toHaveLength(1);
    expect(advance.snapshot.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('queues commands until the next deterministic step', () => {
    const observed: string[] = [];
    const simulation = new SimulationKernel({
      clock: new FixedStepClock({ hz: 60, maxSubSteps: 2, maxDeltaSeconds: 0.25 }),
      hooks: {
        onCommand: (command) => observed.push(command.type),
      },
    });
    simulation.enqueue({ type: 'resume' });
    expect(simulation.commandCount()).toBe(1);
    simulation.advance(0.0167);
    expect(observed).toEqual(['resume']);
    expect(simulation.commandCount()).toBe(0);
  });

  it('restores snapshots without changing their digest input', () => {
    const simulation = new SimulationKernel();
    const entity = simulation.world.create();
    simulation.world.addComponent(entity, 'value', 42);
    simulation.advance(0.02);
    const snapshot = simulation.snapshot();
    const clone = new SimulationKernel();
    clone.restore(snapshot);
    expect(clone.snapshot().digest).toBe(snapshot.digest);
  });

  it('collects events by frame window', () => {
    const simulation = new SimulationKernel();
    simulation.emit('one', { ok: true });
    simulation.advance(0.02);
    simulation.emit('two');
    const recent = simulation.eventsSince(simulation.clock.frame());
    expect(recent.map((event) => event.type)).toContain('two');
  });
});
