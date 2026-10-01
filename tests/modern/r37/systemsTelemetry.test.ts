import { describe, expect, it } from 'vitest';
import { SimulationPipelineR37, createMovementSystemR37, createStaminaSystemR37 } from '../../../src/3d/strict/r37/simulationSystems.ts';
import { ResourceBudgetR37 } from '../../../src/3d/strict/r37/resourceBudget.ts';
import { EventTimelineR37 } from '../../../src/3d/strict/r37/eventTimeline.ts';
import { TelemetryRingR37 } from '../../../src/3d/strict/r37/telemetry.ts';

describe('R37 systems/budget/telemetry', () => {
  it('runs ordered simulation systems over mutable actors', () => {
    const position = { x: 0, y: 0, z: 0 };
    const velocity = { x: 0, y: 0, z: 0 };
    const actor = {
      id: 'p',
      get position() { return position; },
      get velocity() { return velocity; },
      health: 100,
      maxHealth: 100,
      stamina: 100,
      maxStamina: 100,
      alive: true,
      setPosition(next: typeof position) { position.x = next.x; position.y = next.y; position.z = next.z; },
      setVelocity(next: typeof velocity) { velocity.x = next.x; velocity.y = next.y; velocity.z = next.z; },
      setHealth() {},
      setStamina() {},
    };
    const pipeline = new SimulationPipelineR37();
    pipeline.register(createMovementSystemR37());
    pipeline.register(createStaminaSystemR37());
    pipeline.run({
      tick: 1,
      deltaSeconds: 1 / 60,
      input: {
        tick: 1, sequence: 1, move: { x: 1, y: 0 }, look: { x: 0, y: 0 },
        jump: false, sprint: false, guard: false, attack: false, dodge: false, interact: false, timestampMs: 0,
      },
      commands: [],
      actors: [actor],
      emit: (type, payload) => ({ id: type, tick: 1, type, source: 'test', payload }),
    });
    expect(position.x).toBeGreaterThan(0);
    expect(pipeline.executedCount()).toBe(2);
  });

  it('protects critical resource capacity and tracks timeline continuity', () => {
    const budget = new ResourceBudgetR37({ maxUnits: 10, reserveCritical: 4 });
    budget.beginTick(5);
    expect(budget.request({ id: 'ui', class: 'background', cost: 7, priority: 1 }).granted).toBe(false);
    expect(budget.request({ id: 'sim', class: 'critical', cost: 7, priority: 100 }).granted).toBe(true);

    const timeline = new EventTimelineR37();
    timeline.append({ id: 'e1', tick: 1, type: 'boot', source: 'test', payload: {} });
    timeline.append({ id: 'e2', tick: 2, type: 'ready', source: 'test', payload: {} });
    expect(timeline.verifyContinuity()).toBe(true);
    expect(timeline.between(1, 2).entries).toHaveLength(2);
  });

  it('summarizes bounded telemetry samples', () => {
    const telemetry = new TelemetryRingR37({ capacity: 4 });
    telemetry.record('frame', 10, {}, 0);
    telemetry.record('frame', 20, {}, 1);
    telemetry.record('frame', 30, {}, 2);
    const summary = telemetry.summarize('frame');
    expect(summary?.average).toBe(20);
    expect(telemetry.window(1, 2)).toHaveLength(2);
  });
});
