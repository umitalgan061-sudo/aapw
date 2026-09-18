import { describe, expect, it } from 'vitest';
import {
  CommandProcessorV7, DeterministicRngV7, DeterministicWorkerPoolV7, EntityStoreV7, RuntimeCodecV7,
  RuntimeSecurityV7, RuntimeValidatorV7, WorldStateRuntimeV7, entityIdV7, tickV7, vec3V7,
  migrateLegacyWorldV7, checksumV7,
} from '../../src/3d/modern/production-v7/index.ts';

const components = () => ({
  transform: { position: vec3V7(), yaw: 0, pitch: 0, scale: vec3V7(1, 1, 1) },
  kinematics: { velocity: vec3V7(), acceleration: vec3V7(), grounded: true, maxSpeed: 5 },
  vital: { health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, poise: 100, maxPoise: 100, invulnerableUntilTick: tickV7(0) },
  interest: { priority: 0, simulationLod: 1 as const, renderLod: 1 as const, alwaysRelevant: false },
  network: { owner: 'server', dirtyRevision: 0 as never, lastAckedSequence: 0 as never, replicated: true },
  tags: ['test'],
});

describe('production runtime v7 expanded', () => {
  it('keeps RNG streams isolated by fork label', () => {
    const root = new DeterministicRngV7(42);
    const a = root.fork(1);
    const b = root.fork(1);
    const c = root.fork(2);
    expect(a.nextUint()).toBe(b.nextUint());
    expect(a.nextUint()).not.toBe(c.nextUint());
  });

  it('applies and replaces complete world snapshots', () => {
    const store = new EntityStoreV7();
    const world = new WorldStateRuntimeV7(store);
    store.upsert({ id: entityIdV7(1), archetype: 'npc', createdTick: tickV7(0), components: components() });
    const first = world.snapshot();
    store.upsert({ id: entityIdV7(2), archetype: 'npc', createdTick: tickV7(0), components: components() });
    const second = world.snapshot();
    expect(world.applySnapshot(first).removed).toBe(1);
    expect(store.size).toBe(1);
    expect(world.applySnapshot(second).applied).toBe(2);
    expect(store.size).toBe(2);
  });

  it('migrates legacy world payloads deterministically', () => {
    const input = { tick: 15, revision: 2, entities: [{ id: '7', type: 'player', x: 10, y: 0, z: 20, health: 90, tags: ['hero', 'hero'] }, { id: 'x', type: 'npc' }] };
    const a = migrateLegacyWorldV7(input);
    const b = migrateLegacyWorldV7(input);
    expect(a.report.checksum).toBe(b.report.checksum);
    expect(a.snapshot.checksum).toBe(b.snapshot.checksum);
    expect(a.report.imported).toBe(2);
  });

  it('rejects duplicate untrusted sequences', () => {
    const security = new RuntimeSecurityV7();
    const input = { sequence: 1 as never, tick: tickV7(0), move: vec3V7(0, 0, 0), look: { yaw: 0, pitch: 0 }, actions: [] };
    expect(security.validateInput(input)).toBe(true);
    expect(security.validateInput(input)).toBe(false);
    expect(security.audit().reasons.replay).toBe(1);
  });

  it('worker pool distributes jobs deterministically', () => {
    const pool = new DeterministicWorkerPoolV7(4, 99);
    const output: number[] = [];
    for (let i = 0; i < 10; i += 1) pool.submit({ id: `job-${i}`, lane: 'simulation', priority: 10, payload: i, execute: (value) => { output.push(value); return value * 2; }, estimatedMs: 0.01 }, tickV7(1));
    pool.run(tickV7(1), 2);
    expect(pool.stats().completed).toBe(10);
    expect(output.length).toBe(10);
    expect(pool.drainResults()).toHaveLength(10);
  });

  it('codec rejects tampered snapshot bytes', () => {
    const codec = new RuntimeCodecV7();
    const store = new EntityStoreV7();
    const world = new WorldStateRuntimeV7(store);
    store.upsert({ id: entityIdV7(1), archetype: 'npc', createdTick: tickV7(0), components: components() });
    const encoded = codec.encodeSnapshot(world.snapshot());
    expect(() => codec.decodeSnapshot({ ...encoded, payload: encoded.payload.replace('npc', 'enemy') })).toThrow();
  });

  it('command processor records a deterministic receipt history', () => {
    const store = new EntityStoreV7();
    const processor = new CommandProcessorV7(store);
    const first = processor.dispatch({ type: 'spawn', id: entityIdV7(11), archetype: 'npc', components: components() }, tickV7(4));
    const second = processor.dispatch({ type: 'tag', id: entityIdV7(11), tag: 'quest', enabled: true }, tickV7(4));
    expect(first.code).toBe('applied');
    expect(second.code).toBe('applied');
    expect(checksumV7(processor.history())).toBe(checksumV7(processor.history()));
  });
});
