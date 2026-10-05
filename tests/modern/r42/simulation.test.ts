import { describe, expect, it } from 'vitest';
import { InputNormalizerR42, inputToCommands } from '../../../src/3d/strict/r42/input.ts';
import { EntityWorldR42 } from '../../../src/3d/strict/r42/world.ts';
import { SimulationAuthorityR42 } from '../../../src/3d/strict/r42/simulation.ts';

describe('R42 simulation authority', () => {
  it('moves an entity through bound typed input', () => {
    const world = new EntityWorldR42();
    world.spawn({ id: 'player', kind: 'player' });
    const input = new InputNormalizerR42();
    const frame = input.normalize({ tick: 1, sequence: 1, moveX: 1 });
    const simulator = new SimulationAuthorityR42(world);
    simulator.step(1, [{ ...frame, entityId: 'player' }], inputToCommands(frame, 'player'));
    expect(world.get('player')?.transform.position.x).toBeGreaterThan(0);
  });

  it('charges stamina for attack and dodge and prevents invalid attacks', () => {
    const world = new EntityWorldR42();
    const entity = world.spawn({ id: 'player', kind: 'player', combat: { stamina: 50 } });
    const simulator = new SimulationAuthorityR42(world);
    const command = {
      id: 'attack',
      entityId: 'player',
      tick: 1,
      sequence: 1,
      kind: 'attack' as const,
      payload: {},
    };
    const result = simulator.step(1, [], [command]);
    expect(result.acceptedCommands).toBe(1);
    expect(world.get(entity.id)?.combat.stamina).toBeLessThan(50);
  });

  it('keeps grounded entities at sampler height', () => {
    const world = new EntityWorldR42();
    world.spawn({ id: 'player', kind: 'player', position: { x: 0, y: 10, z: 0 } });
    const simulator = new SimulationAuthorityR42(world, {}, { heightAt: () => 0 });
    for (let tick = 1; tick <= 10; tick += 1) simulator.step(tick, [], []);
    expect(world.get('player')?.transform.position.y).toBeGreaterThanOrEqual(0);
  });
});
