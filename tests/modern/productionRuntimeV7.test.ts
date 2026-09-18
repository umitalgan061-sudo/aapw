import { describe, expect, it } from 'vitest';
import {
  AdaptiveRenderPolicyV7, AssetCacheV7, BudgetSchedulerV7, CommandProcessorV7, EntityStoreV7,
  ProductionRuntimeV7, RuntimeCodecV7, RuntimeRecoveryV7, RuntimeSecurityV7, RuntimeTelemetryV7,
  RuntimeValidatorV7, SpatialIndexV7, createProductionRuntimeV7, entityIdV7, revisionV7, tickV7, vec3V7,
} from '../../src/3d/modern/production-v7/index.ts';

const components = () => ({
  transform: { position: vec3V7(), yaw: 0, pitch: 0, scale: vec3V7(1, 1, 1) },
  kinematics: { velocity: vec3V7(), acceleration: vec3V7(), grounded: true, maxSpeed: 5 },
  vital: { health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, poise: 100, maxPoise: 100, invulnerableUntilTick: tickV7(0) },
  interest: { priority: 10, simulationLod: 0 as const, renderLod: 0 as const, alwaysRelevant: true },
  network: { owner: 'test', dirtyRevision: revisionV7(0), lastAckedSequence: 0 as never, replicated: true },
  tags: ['player'],
});

describe('production runtime v7', () => {
  it('spawns, moves, damages and restores deterministic state', () => {
    const runtime = createProductionRuntimeV7({ profile: { mode: 'full', hardwareConcurrency: 8, deviceMemoryGb: 8, webgpu: true, offscreenCanvas: true, reducedMotion: false, saveData: false } });
    runtime.boot();
    expect(runtime.spawn(entityIdV7(1), 'player', components())).toBe(true);
    expect(runtime.enqueue({ type: 'move', id: entityIdV7(1), position: vec3V7(3, 0, 4), velocity: vec3V7(1, 0, 0) })).toBe(true);
    expect(runtime.enqueue({ type: 'damage', id: entityIdV7(1), amount: 12 }, tickV7(1))).toBe(true);
    const snapshot = runtime.snapshot();
    const clone = createProductionRuntimeV7({ seed: 0x1234, profile: { mode: 'full', hardwareConcurrency: 8, deviceMemoryGb: 8, webgpu: true, offscreenCanvas: true, reducedMotion: false, saveData: false } });
    clone.restore(snapshot);
    expect(clone.digest()).toBe(runtime.digest());
  });

  it('rejects malformed input at the validation boundary', () => {
    const validator = new RuntimeValidatorV7();
    const report = validator.validateCommand({ type: 'damage', id: -1, amount: Number.NaN });
    expect(report.ok).toBe(false);
    expect(report.failures.length).toBeGreaterThan(0);
  });

  it('keeps the command processor idempotent', () => {
    const entities = new EntityStoreV7();
    const processor = new CommandProcessorV7(entities);
    const spawn = { type: 'spawn' as const, id: entityIdV7(2), archetype: 'npc', components: components() };
    const first = processor.dispatch(spawn, tickV7(0));
    const second = processor.dispatch(spawn, tickV7(0));
    expect(first.code).toBe('applied');
    expect(second.code).toBe('duplicate');
    expect(entities.size).toBe(1);
  });

  it('limits per-tick command flooding', () => {
    const entities = new EntityStoreV7();
    const processor = new CommandProcessorV7(entities, undefined, undefined, { maxCommandsPerTick: 2 });
    const spawn = (id: number) => processor.dispatch({ type: 'spawn', id: entityIdV7(id), archetype: 'npc', components: components() }, tickV7(2));
    expect(spawn(3).code).toBe('applied');
    expect(spawn(4).code).toBe('applied');
    expect(spawn(5).code).toBe('rate-limited');
  });

  it('queries spatial state deterministically', () => {
    const spatial = new SpatialIndexV7(10);
    spatial.upsert({ id: entityIdV7(1), active: true, layer: 1, bounds: { min: vec3V7(0, 0, 0), max: vec3V7(2, 2, 2) } });
    spatial.upsert({ id: entityIdV7(2), active: true, layer: 1, bounds: { min: vec3V7(20, 0, 0), max: vec3V7(22, 2, 2) } });
    expect(spatial.nearest(vec3V7(1, 0, 1), 5, 4).map((item) => Number(item.id))).toEqual([1]);
  });

  it('evicts assets without violating the resident budget', () => {
    const cache = new AssetCacheV7({ maxBytes: 100, reserveBytes: 10, maxEntries: 4 });
    const descriptor = (id: string, bytes: number, critical = false) => ({ id, url: `/${id}.glb`, kind: 'glb' as const, bytes, hash: `hash-${id}` as never, critical, tags: [] });
    expect(cache.put(descriptor('a', 40), {}, tickV7(1))).toBe(true);
    expect(cache.put(descriptor('b', 40), {}, tickV7(2))).toBe(true);
    cache.put(descriptor('c', 40), {}, tickV7(3));
    expect(cache.stats().bytes).toBeLessThanOrEqual(100);
  });
});
