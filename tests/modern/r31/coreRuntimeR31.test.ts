import { describe, expect, it } from 'vitest';
import { EventBusR31 } from '../../../src/3d/strict/r31/eventBusR31.ts';
import { DeterministicClockR31 } from '../../../src/3d/strict/r31/deterministicClockR31.ts';
import { SchedulerR31 } from '../../../src/3d/strict/r31/schedulerR31.ts';
import { R31_DEFAULT_BUDGET, asR31Id } from '../../../src/3d/strict/r31/applicationTypesR31.ts';

describe('R31 core runtime', () => {
  it('delivers bounded typed events and exposes diagnostics', () => {
    const bus = new EventBusR31(2);
    const seen: number[] = [];
    bus.on<number>('tick', (event) => seen.push(event.payload));
    bus.setTick(7);
    expect(bus.emit('tick', 1)).toBe(true);
    expect(bus.emit('tick', 2)).toBe(true);
    expect(bus.emit('tick', 3)).toBe(false);
    expect(seen).toEqual([1, 2]);
    expect(bus.diagnostics().dropped).toBe(1);
  });

  it('runs a fixed-step clock deterministically and protects catch-up', () => {
    const clock = new DeterministicClockR31({ fixedStepSeconds: 0.1, maxCatchUpSteps: 2 });
    const ticks: number[] = [];
    const result = clock.advance(0.35, (_step, tick) => ticks.push(tick));
    expect(ticks).toEqual([1, 2]);
    expect(result.steps).toBe(2);
    expect(result.droppedSeconds).toBeGreaterThanOrEqual(0.1);
    const snapshot = clock.snapshot();
    clock.reset();
    clock.restore(snapshot);
    expect(clock.tick).toBe(2);
  });

  it('orders scheduler work by priority and deterministic registration order', () => {
    const scheduler = new SchedulerR31(R31_DEFAULT_BUDGET);
    const ran: string[] = [];
    scheduler.register({ id: 'normal', phase: 'gameplay', priority: 'normal', enabled: true, maxWorkMs: 20, update: () => ran.push('normal') });
    scheduler.register({ id: 'critical', phase: 'simulation', priority: 'critical', enabled: true, maxWorkMs: 20, update: () => ran.push('critical') });
    scheduler.register({ id: 'background', phase: 'diagnostics', priority: 'background', enabled: true, maxWorkMs: 20, update: () => ran.push('background') });
    scheduler.runFrame({ frame: 1, simulationTick: 1, deltaSeconds: 1 / 60, elapsedSeconds: 0.01, alpha: 0, phase: 'simulation' }, 3);
    expect(ran).toEqual(['critical', 'normal', 'background']);
    expect(scheduler.diagnostics().updates).toBe(3);
  });

  it('produces opaque stable runtime identifiers', () => {
    const a = asR31Id('r31.test.1');
    expect(String(a)).toBe('r31.test.1');
  });
});
