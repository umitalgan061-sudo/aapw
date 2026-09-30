import { describe, expect, it } from 'vitest';
import { SpatialHash2D } from '../../src/3d/modern/worldSpatialIndex.ts';
import { WorldChunkRuntime } from '../../src/3d/modern/worldChunkRuntime.ts';
import { findWeightedPath, buildFlowField, sampleFlowDirection, type WeightedNavGrid } from '../../src/3d/modern/navigationRuntime.ts';
import { PlayerAuthority, defaultPlayerState } from '../../src/3d/modern/playerAuthority.ts';
import { AnimationAuthority } from '../../src/3d/modern/animationAuthority.ts';
import { CombatAuthority, makeCombatActor, makeCombatTarget } from '../../src/3d/modern/combatAuthority.ts';
import { RuntimeIntegrationV2 } from '../../src/3d/modern/runtimeIntegrationV2.ts';
import { SnapshotBuffer, applyDelta, createDelta, decodeSnapshot, encodeSnapshot, playerToNetworkEntity } from '../../src/3d/modern/networkRuntimeV2.ts';
import { diagnoseRuntime, MetricRing } from '../../src/3d/modern/runtimeDiagnosticsV2.ts';
import { AiAuthority } from '../../src/3d/modern/aiAuthority.ts';
import { WorldClock } from '../../src/3d/modern/worldSimulation.ts';
import { WeatherTransitionController, composeWeatherPresentation } from '../../src/3d/modern/weatherRuntime.ts';

const grid = (): WeightedNavGrid => Object.freeze({
  width: 5,
  height: 5,
  origin: Object.freeze({ x: 0, y: 0 }),
  cellSize: 1,
  cells: Object.freeze(Array.from({ length: 25 }, (_, index) => Object.freeze({ blocked: index === 12, cost: 1, height: 0, slope: 0, danger: 0 }))),
});

describe('spatial hash', () => {
  it('indexes and updates moving objects deterministically', () => {
    const hash = new SpatialHash2D<{ kind: string }>(10);
    hash.set({ id: 'b', x: 11, y: 0, radius: 1, value: { kind: 'npc' } });
    hash.set({ id: 'a', x: 0, y: 0, radius: 1, value: { kind: 'player' } });
    expect(hash.queryCircle({ x: 0, y: 0 }, 4).map((item) => item.id)).toEqual(['a']);
    hash.update('b', { x: 1, y: 1 });
    expect(hash.queryCircle({ x: 0, y: 0 }, 4).map((item) => item.id).sort()).toEqual(['a', 'b']);
  });

  it('removes an object from all occupied cells', () => {
    const hash = new SpatialHash2D(2);
    hash.set({ id: 'large', x: 0, y: 0, radius: 5, value: {} });
    expect(hash.cells().length).toBeGreaterThan(1);
    hash.remove('large');
    expect(hash.size).toBe(0);
    expect(hash.cells()).toHaveLength(0);
  });
});

describe('chunk runtime', () => {
  it('limits concurrent loads and tracks successful residency', async () => {
    let now = 0;
    let activeLoads = 0;
    let peakLoads = 0;
    const runtime = new WorldChunkRuntime({ loadRadius: 1, unloadRadius: 2, maxLoadsPerFrame: 8, maxUnloadsPerFrame: 8, maxConcurrentLoads: 2, now: () => now }, async (_id) => {
      activeLoads += 1;
      peakLoads = Math.max(peakLoads, activeLoads);
      await Promise.resolve();
      activeLoads -= 1;
      return { bytes: 10 };
    });
    runtime.plan({ x: 0, y: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peakLoads).toBeLessThanOrEqual(2);
    expect(runtime.metrics().loadSuccesses).toBeGreaterThan(0);
    runtime.dispose();
  });
});

describe('navigation runtime', () => {
  it('finds a weighted path around blockers', () => {
    const result = findWeightedPath(grid(), { x: 0, z: 0 }, { x: 4, z: 4 });
    expect(result).not.toBeNull();
    expect(result?.nodes.at(-1)).toEqual({ x: 4, z: 4 });
    expect(result?.nodes.some((node) => node.x === 2 && node.z === 2)).toBe(false);
  });

  it('builds a deterministic flow field', () => {
    const field = buildFlowField(grid(), [{ x: 4, z: 4 }]);
    expect(sampleFlowDirection(field, 0, 0)).toEqual([1, 0]);
    expect(field.cells.filter(Boolean).length).toBeGreaterThan(20);
  });

  it('honors slope restrictions', () => {
    const source = grid();
    const cells = [...source.cells];
    cells[6] = Object.freeze({ ...cells[6]!, slope: 1.2 });
    const result = findWeightedPath(Object.freeze({ ...source, cells }), { x: 0, z: 0 }, { x: 4, z: 4 }, { maxSlope: 0.5 });
    expect(result).not.toBeNull();
    expect(result?.nodes.some((node) => node.x === 1 && node.z === 1)).toBe(false);
  });
});

describe('player authority', () => {
  it('accelerates, jumps and lands with fixed-step state', () => {
    const player = new PlayerAuthority({ collision: (_x, y, _z) => ({ grounded: y <= 0, y: Math.max(0, y) }) });
    const run = player.step({ moveX: 1, moveZ: 0, sprint: false, jumpPressed: false, dodgePressed: false, attackPressed: false, heavyPressed: false, block: false }, 16);
    expect(run.state.velocity.x).toBeGreaterThan(0);
    const jump = player.step({ moveX: 0, moveZ: 0, sprint: false, jumpPressed: true, dodgePressed: false, attackPressed: false, heavyPressed: false, block: false }, 16);
    expect(jump.events.some((event) => event.type === 'jump')).toBe(true);
    expect(jump.state.velocity.y).toBeGreaterThan(0);
  });

  it('blocks damage while invulnerable and dies deterministically', () => {
    const player = new PlayerAuthority();
    player.reset({ ...defaultPlayerState('p'), invulnerableMs: 100 });
    expect(player.applyDamage(100)).toBeNull();
    player.reset();
    expect(player.applyDamage(100)?.type).toBe('dead');
    expect(player.state.stats.health).toBe(0);
  });
});

describe('animation authority', () => {
  it('changes clip from locomotion without changing gameplay ownership', () => {
    const authority = new AnimationAuthority();
    const walk = authority.update({ locomotion: 'walk', speed: 1, grounded: true, attack: false, stunned: false, dead: false, aimWeight: 0 }, 16);
    expect(walk.states[0]?.clipId).toBe('walk');
    const aim = authority.update({ locomotion: 'walk', speed: 1, grounded: true, attack: false, stunned: false, dead: false, aimWeight: 0.8 }, 16);
    expect(aim.states.some((state) => state.layer === 'additive' && state.clipId === 'aim')).toBe(true);
  });
});

describe('combat authority', () => {
  it('resolves a directional hit only for hostile targets in range', () => {
    const combat = new CombatAuthority(undefined, { now: () => 1 });
    combat.registerActor(makeCombatActor('a', 'one'));
    combat.registerTarget(Object.freeze({ ...makeCombatTarget('b', 'two'), x: 0, z: 1 }));
    combat.registerTarget(Object.freeze({ ...makeCombatTarget('c', 'two'), x: 5, z: 0 }));
    expect(combat.startAttack('a')).toHaveLength(1);
    let events = combat.step(200);
    expect(events.some((event) => event.type === 'attackActive')).toBe(true);
    events = combat.step(1);
    expect(events.some((event) => event.type === 'hit' && event.hit?.targetId === 'b')).toBe(true);
    expect(events.some((event) => event.type === 'hit' && event.hit?.targetId === 'c')).toBe(false);
  });
});

describe('runtime integration', () => {
  it('produces stable digests for equivalent input sequences', () => {
    const first = new RuntimeIntegrationV2({ now: () => 0 });
    const second = new RuntimeIntegrationV2({ now: () => 0 });
    const input = { moveX: 1, moveZ: 0, sprint: false, jumpPressed: false, dodgePressed: false, attackPressed: false, heavyPressed: false, block: false };
    const a = first.tick({ deltaMs: 16, player: input });
    const b = second.tick({ deltaMs: 16, player: input });
    expect(a.digest).toBe(b.digest);
    first.dispose();
    second.dispose();
  });
});

describe('network snapshots', () => {
  it('creates and applies a delta without changing checksum semantics', () => {
    const player = defaultPlayerState('p');
    const previous = encodeSnapshot({ protocol: 2, sessionId: 's', tick: 1, ack: 0, createdAt: 1, entities: [playerToNetworkEntity(player)], player });
    const changed = { ...player, revision: 1, transform: { ...player.transform, x: 2 } };
    const next = encodeSnapshot({ protocol: 2, sessionId: 's', tick: 2, ack: 1, createdAt: 2, entities: [{ ...playerToNetworkEntity(changed), x: 2 }], player: changed });
    const delta = createDelta(previous, next);
    const applied = applyDelta(previous, delta);
    expect(applied.checksum).toBe(next.checksum);
    expect(decodeSnapshot(applied).tick).toBe(2);
  });

  it('keeps a bounded snapshot history', () => {
    const player = defaultPlayerState('p');
    const buffer = new SnapshotBuffer({ capacity: 3 });
    for (let tick = 0; tick < 6; tick += 1) buffer.push(encodeSnapshot({ protocol: 2, sessionId: 's', tick, ack: tick, createdAt: tick, entities: [], player }));
    expect(buffer.metrics().snapshots).toBe(3);
    expect(buffer.oldest()?.tick).toBe(3);
  });
});

describe('diagnostics', () => {
  it('raises a critical issue when frame time is severely over budget', () => {
    const snapshot = diagnoseRuntime({ integration: { frame: 1, elapsedMs: 16, playerRevision: 1, spatialItems: 0, nearbyQueries: 1, chunkResidentBytes: 0, chunkActive: 1, combatActors: 1, combatTargets: 0, digest: 'x' }, chunks: { frame: 1, declared: 1, active: 1, queued: 0, loading: 0, retiring: 0, failed: 0, residentBytes: 0, peakResidentBytes: 0, loadSuccesses: 1, loadFailures: 0, unloads: 0, evictions: 0 }, spatial: { items: 0, cells: 0, queries: 1, visitedCells: 1, returnedItems: 0, updates: 0, removals: 0 }, frameTimeMs: 40 });
    expect(snapshot.issues.some((issue) => issue.severity === 'critical')).toBe(true);
    expect(snapshot.score).toBeLessThan(100);
  });

  it('maintains a bounded metric ring', () => {
    const ring = new MetricRing(3);
    ring.push(1); ring.push(3); ring.push(5); ring.push(7);
    expect(ring.values()).toHaveLength(3);
    expect(ring.average()).toBe(5);
    expect(ring.percentile(0.5)).toBe(5);
  });
});

describe('AI authority', () => {
  it('prioritizes survival under threat and respects thinker budget', () => {
    const ai = new AiAuthority({ maxThinkersPerFrame: 1, now: () => 1000 });
    for (const id of ['a', 'b', 'c']) ai.register({ id, faction: 'one', mode: 'idle', priority: 'normal', transform: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, memory: { targetId: null, targetLastSeenAt: 0, targetLastSeen: null, threat: 0, confidence: 0 }, health: 20, maxHealth: 100, morale: 30, hunger: 20, fatigue: 20, alertness: 100, desiredTarget: null, revision: 0 });
    ai.pushStimulus({ id: 'danger', type: 'damage', position: { x: 2, y: 0, z: 0 }, strength: 1, faction: 'two', timestamp: 1000 });
    const decisions = ai.tick(16, 1000);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.mode).toBe('flee');
  });
});

describe('weather runtime', () => {
  it('maps deterministic weather to bounded presentation values', () => {
    const clock = new WorldClock({ seed: 42 });
    const state = clock.update(1);
    const presentation = composeWeatherPresentation(state);
    expect(presentation.particles.rain).toBeGreaterThanOrEqual(0);
    expect(presentation.audio.rainGain).toBeGreaterThanOrEqual(0);
  });

  it('smooths weather transitions', () => {
    const transition = new WeatherTransitionController();
    transition.set('storm', 1000);
    transition.update(500);
    expect(transition.factor()).toBe(0.5);
    expect(transition.blendedProfile().rainRate).toBeGreaterThan(0);
  });
});
