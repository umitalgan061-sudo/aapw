import { describe, expect, it } from 'vitest';
import {
  FixedStepAccumulator,
  DeterministicSystemScheduler,
  buildSystem,
} from '../../../src/3d/modern/r27/index.ts';
import {
  entityId,
  systemId,
  zeroInputFrame,
  type RuntimeEvent,
  type RuntimeTick,
} from '../../../src/3d/modern/r27/contracts.ts';

describe('R27 contracts and deterministic scheduler', () => {
  it('validates branded identifiers and deterministic input defaults', () => {
    expect(Number(entityId(4))).toBe(4);
    expect(String(systemId('physics'))).toBe('physics');
    expect(zeroInputFrame(7)).toEqual({
      tick: 7,
      move: { x: 0, y: 0 },
      look: { x: 0, y: 0 },
      buttons: [],
      analog: {},
    });
    expect(() => entityId(0)).toThrow();
    expect(() => systemId('')).toThrow();
  });

  it('orders dependency graph deterministically', () => {
    const scheduler = new DeterministicSystemScheduler({ maxSystems: 8 });
    const seen: string[] = [];
    const run = (name: string) => buildSystem(
      name,
      'simulation',
      0,
      () => seen.push(name),
    );

    scheduler.register({
      ...run('late'),
      after: [systemId('early')],
    });
    scheduler.register({
      ...run('early'),
      order: 1,
    });
    scheduler.register({
      ...run('tie-a'),
      order: 2,
    });
    scheduler.register({
      ...run('tie-b'),
      order: 2,
    });

    const tick: RuntimeTick = { index: 0, dtSeconds: 1 / 60, simulationTimeSeconds: 0 };
    const frame = scheduler.run(tick, zeroInputFrame(0), () => undefined);
    expect(frame.executed.map(String)).toEqual(['early', 'late', 'tie-a', 'tie-b']);
    expect(seen).toEqual(['early', 'late', 'tie-a', 'tie-b']);
  });

  it('rejects dependency cycles instead of producing nondeterministic order', () => {
    const scheduler = new DeterministicSystemScheduler();
    scheduler.register({
      ...buildSystem('a', 'simulation', 0, () => undefined),
      after: [systemId('b')],
    });
    scheduler.register({
      ...buildSystem('b', 'simulation', 0, () => undefined),
      after: [systemId('a')],
    });
    expect(() => scheduler.list()).toThrow(/cycle/i);
  });

  it('caps catch-up work and reports dropped time', () => {
    const accumulator = new FixedStepAccumulator(1 / 60, 2);
    const first = accumulator.advance(0.1);
    expect(first.steps).toBe(2);
    expect(first.droppedSeconds).toBeGreaterThan(0);
    expect(first.alpha).toBeLessThanOrEqual(2);
    const second = accumulator.advance(1 / 60);
    expect(second.steps).toBe(2);
  });

  it('captures system failures as runtime incidents', () => {
    const scheduler = new DeterministicSystemScheduler();
    scheduler.register(buildSystem('fault', 'simulation', 0, () => {
      throw new Error('expected');
    }));
    const events: RuntimeEvent[] = [];
    const frame = scheduler.run(
      { index: 3, dtSeconds: 1 / 60, simulationTimeSeconds: 0.05 },
      zeroInputFrame(3),
      (event) => events.push(event),
    );
    expect(frame.executed).toEqual([]);
    expect(frame.skipped.map(String)).toEqual(['fault']);
    expect(events.some((event) => event.type === 'incident' && event.code === 'R27_SYSTEM_FAILURE')).toBe(true);
  });
});
