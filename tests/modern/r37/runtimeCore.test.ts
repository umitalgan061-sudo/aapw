import { describe, expect, it } from 'vitest';
import { DeterministicClockR37 } from '../../../src/3d/strict/r37/deterministicClock.ts';
import { CommandBusR37 } from '../../../src/3d/strict/r37/commandBus.ts';
import { InputModelR37 } from '../../../src/3d/strict/r37/inputModel.ts';
import { WorldStateR37 } from '../../../src/3d/strict/r37/worldState.ts';

describe('R37 runtime core', () => {
  it('keeps fixed-step progression deterministic', () => {
    const run = () => {
      const clock = new DeterministicClockR37({ fixedStepSeconds: 1 / 60, maxCatchUpSteps: 4 });
      const ticks: number[] = [];
      clock.pushFrameDelta(0.2, (step) => ticks.push(step.tick));
      return { ticks, snapshot: clock.snapshot() };
    };
    expect(run()).toEqual(run());
  });

  it('bounds command payloads and per-tick pressure', () => {
    const bus = new CommandBusR37({ maxCommandsPerTick: 2 });
    expect(bus.dispatch({ tick: 1, kind: 'custom', source: 'test', payload: { ok: true } }).accepted).toBe(true);
    expect(bus.dispatch({ tick: 1, kind: 'custom', source: 'test', payload: { ok: true } }).accepted).toBe(true);
    expect(bus.dispatch({ tick: 1, kind: 'custom', source: 'test', payload: { ok: true } }).accepted).toBe(false);
  });

  it('normalizes input and persists world snapshots', () => {
    const input = new InputModelR37();
    input.push({ tick: 4, move: { x: 10, y: 0 }, look: { x: 2, y: -2 }, jump: true, sprint: true, guard: false, attack: false, dodge: false, interact: false, timestampMs: 100 });
    expect(input.peek().move.x).toBe(1);
    const world = new WorldStateR37({ seed: 99 });
    expect(world.entities.create({ id: 'player', kind: 'player' })).toBeTruthy();
    world.advance(4);
    const snapshot = world.snapshot();
    const restored = new WorldStateR37({ seed: 1 });
    restored.restore(snapshot);
    expect(restored.checksum()).toBe(world.checksum());
  });
});
