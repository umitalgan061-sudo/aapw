import { describe, expect, it } from 'vitest';
import { RuntimeKernel } from '../../src/3d/nextgen/runtimeKernel';
import { DeterministicRng, deterministicHash, vec3 } from '../../src/3d/nextgen/deterministicMath';
import { buildPredictionScenario, PlayerPredictor, InputSequencer } from '../../src/3d/nextgen/playerPrediction';
import { AiBrain } from '../../src/3d/nextgen/aiSimulation';
import { NavigationRuntimeV3 } from '../../src/3d/nextgen/navigationRuntimeV3';
import { CombatSimulation, createCombatStats } from '../../src/3d/nextgen/combatSimulation';
import { AssetStreamingV3 } from '../../src/3d/nextgen/assetStreamingV3';
import { SaveSystemV3, createWorldSaveState, registerDefaultSaveMigrations } from '../../src/3d/nextgen/saveSystemV3';
import { SnapshotHistory, createNetworkEntity, snapshotDelta, applyDelta, type NetworkSnapshot } from '../../src/3d/nextgen/networkProtocolV3';
import { RingBuffer } from '../../src/3d/nextgen/runtimeTelemetryV3';
import { chunkWork, mergeWorkChunks, encodeWorkerMessage, decodeWorkerMessage } from '../../src/3d/nextgen/workerProtocolV3';

describe('deterministic runtime stress', () => {
  it('produces the same 240-tick digest for identical seeds', () => {
    const a = buildPredictionScenario(0x123456, 240);
    const b = buildPredictionScenario(0x123456, 240);
    expect(a).toEqual(b);
    expect(deterministicHash(a.map((item) => item.stateHash))).toBe(deterministicHash(b.map((item) => item.stateHash)));
  });

  it('changes the digest when the seed changes', () => {
    const a = buildPredictionScenario(1, 120);
    const b = buildPredictionScenario(2, 120);
    expect(deterministicHash(a.map((item) => item.stateHash))).not.toBe(deterministicHash(b.map((item) => item.stateHash)));
  });

  it('handles a large entity population with stable snapshots', () => {
    const kernel = new RuntimeKernel(1 / 30);
    for (let i = 0; i < 256; i += 1) {
      const id = kernel.world.createEntity();
      kernel.world.setTransform(id, { position: { x: i, y: 0, z: -i }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
      kernel.world.setVelocity(id, { linear: { x: 1, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } });
    }
    const first = kernel.step();
    const second = kernel.step();
    expect(first.entities).toHaveLength(256);
    expect(second.entities).toHaveLength(256);
    expect(second.transforms[255]?.value.position.x).toBeGreaterThan(first.transforms[255]?.value.position.x ?? 0);
  });
});

describe('prediction edge cases', () => {
  it('ignores duplicate input sequences', () => {
    const predictor = new PlayerPredictor();
    const input = new InputSequencer().next(1, { move: { x: 1, y: 0 } });
    predictor.pushInput(input);
    predictor.pushInput(input);
    predictor.step(1, input);
    expect(predictor.state.lastProcessedInput).toBe(input.sequence);
  });

  it('clamps invalid movement magnitude', () => {
    const predictor = new PlayerPredictor();
    const sequence = new InputSequencer();
    const input = sequence.next(1, { move: { x: 100, y: -100 } });
    predictor.pushInput(input);
    expect(() => predictor.step(1, input)).not.toThrow();
  });
});

describe('navigation stress', () => {
  it('reaches opposite corners through an open grid', () => {
    const nav = new NavigationRuntimeV3({ width: 40, height: 40, cellSize: 1, maxSearchNodes: 5000, diagonal: true });
    const path = nav.findPath(0, 1599);
    expect(path.complete).toBe(true);
    expect(path.nodes.length).toBeGreaterThan(0);
  });

  it('returns no path when search budget is exhausted', () => {
    const nav = new NavigationRuntimeV3({ width: 60, height: 60, cellSize: 1, maxSearchNodes: 3, diagonal: false });
    const path = nav.findPath(0, 3599);
    expect(path.complete).toBe(false);
    expect(path.expanded).toBeLessThanOrEqual(3);
  });
});

describe('combat edge cases', () => {
  it('ignores out-of-range attacks', () => {
    const combat = new CombatSimulation(7);
    const attacker = 1 as never; const target = 2 as never;
    combat.spawn(attacker, vec3(0, 0, 0), createCombatStats());
    combat.spawn(target, vec3(20, 0, 0), createCombatStats());
    combat.setPose(attacker, vec3(0, 0, 0), vec3(1, 0, 0));
    combat.startAttack(attacker, 'heavy-1');
    for (let i = 0; i < 30; i += 1) combat.step();
    expect(combat.getState(target)!.health).toBe(100);
  });

  it('does not damage invulnerable dodging targets', () => {
    const combat = new CombatSimulation(8);
    const attacker = 1 as never; const target = 2 as never;
    combat.spawn(attacker, vec3(0, 0, 0), createCombatStats());
    combat.spawn(target, vec3(0, 0, 1), createCombatStats());
    combat.setPose(attacker, vec3(0, 0, 0), vec3(0, 0, 1));
    combat.dodge(target, vec3(1, 0, 0), 30);
    combat.startAttack(attacker, 'light-1');
    for (let i = 0; i < 30; i += 1) combat.step();
    expect(combat.getState(target)!.health).toBe(100);
  });
});

describe('asset loader edges', () => {
  it('retries transient failures and eventually succeeds', async () => {
    const loader = new AssetStreamingV3({ maxConcurrent: 1, maxQueue: 4, maxResidentBytes: 1000, perAssetBytes: 100 });
    let calls = 0;
    const fetcher = async () => { calls += 1; if (calls < 2) return new Response('{"ok":false}', { status: 503 }); return new Response('{"ok":true}', { status: 200 }); };
    loader.request({ id: 'retry', url: 'https://cdn.example/retry.json', kind: 'json', priority: 'high', estimatedBytes: 2, retries: 2 });
    await loader.pump(fetcher as typeof fetch);
    expect(loader.get('retry')?.state).toBe('queued');
    await loader.pump(fetcher as typeof fetch);
    expect(loader.get('retry')?.state).toBe('ready');
    expect(calls).toBe(2);
  });

  it('cancels queued requests', () => {
    const loader = new AssetStreamingV3({ maxQueue: 4 });
    loader.request({ id: 'cancel-me', url: 'https://cdn.example/x.json', kind: 'json', priority: 'low', estimatedBytes: 1 });
    expect(loader.cancel('cancel-me')).toBe(true);
    expect(loader.get('cancel-me')?.state).toBe('cancelled');
  });
});

describe('save system edges', () => {
  it('rejects future schemas', () => {
    const system = new SaveSystemV3(3);
    const world = createWorldSaveState(7);
    const bytes = system.encode(world, 1, 7);
    const altered = new TextDecoder().decode(bytes).replace('"schema":3', '"schema":9');
    expect(system.validate(new TextEncoder().encode(altered)).valid).toBe(false);
  });

  it('preserves stable key ordering across equivalent objects', () => {
    const system = new SaveSystemV3();
    registerDefaultSaveMigrations(system);
    const a = createWorldSaveState(4);
    const b = { ...a, worldFlags: { b: true, a: false } };
    const c = { ...a, worldFlags: { a: false, b: true } };
    expect(system.encode(b, 0, 4)).toEqual(system.encode(c, 0, 4));
  });
});

describe('network history', () => {
  it('bounds stored snapshots', () => {
    const history = new SnapshotHistory(3);
    for (let tick = 0; tick < 10; tick += 1) history.push({ version: 3, serverTick: tick, baselineTick: 0, ackSequence: tick, entities: [] });
    expect(history.values()).toHaveLength(3);
    expect(history.latest()?.serverTick).toBe(9);
    expect(history.find(7)).toBeUndefined();
  });

  it('preserves entity ordering after delta application', () => {
    const baseline: NetworkSnapshot = { version: 3, serverTick: 1, baselineTick: 0, ackSequence: 0, entities: [createNetworkEntity(4, vec3(4, 0, 0)), createNetworkEntity(1, vec3(1, 0, 0))].sort((a, b) => a.id - b.id) };
    const current: NetworkSnapshot = { ...baseline, serverTick: 2, entities: [createNetworkEntity(3, vec3(3, 0, 0)), createNetworkEntity(1, vec3(10, 0, 0))] };
    const result = applyDelta(baseline, snapshotDelta(baseline, current));
    expect(result.entities.map((entity) => entity.id)).toEqual([1, 3]);
  });
});

describe('telemetry ring buffer', () => {
  it('overwrites oldest values after capacity is reached', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1); buffer.push(2); buffer.push(3); buffer.push(4);
    expect(buffer.values()).toEqual([2, 3, 4]);
    expect(buffer.dropped).toBe(1);
  });
});

describe('worker messages', () => {
  it('round trips request messages', () => {
    const message = { kind: 'request' as const, id: 4, domain: 'navigation' as const, operation: 'find', payload: { start: 1, goal: 9 }, issuedTick: 10, deadlineTick: 15 };
    expect(decodeWorkerMessage(encodeWorkerMessage(message))).toEqual(message);
  });

  it('keeps chunk merge order deterministic', () => {
    const chunks = chunkWork(['a','b','c','d','e','f'], 2).reverse();
    expect(mergeWorkChunks(chunks)).toEqual(['a','b','c','d','e','f']);
  });
});
