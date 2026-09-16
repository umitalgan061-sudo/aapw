import { describe, expect, it } from 'vitest';
import { EcsRuntime } from '../../src/engine-ts/ecsRuntime.js';
import { EngineRuntime } from '../../src/engine-ts/engineRuntime.js';
import { GameplayRuntime } from '../../src/engine-ts/gameplayRuntime.js';
import { InputRuntime } from '../../src/engine-ts/inputRuntime.js';
import { NavigationRuntime } from '../../src/engine-ts/aiRuntime.js';
import { NetworkRuntime } from '../../src/engine-ts/networkRuntime.js';
import { PersistenceRuntime } from '../../src/engine-ts/persistenceRuntime.js';
import { RenderRuntime, defaultCameraView } from '../../src/engine-ts/renderRuntime.js';
import { ReplayRuntime } from '../../src/engine-ts/replayRuntime.js';
import { SecurityRuntime } from '../../src/engine-ts/securityRuntime.js';
import { WorldRuntime } from '../../src/engine-ts/worldRuntime.js';
import { ENTITY_ID } from '../../src/engine-ts/coreTypes.js';

describe('Engine TS v6 world runtime', () => {
  it('indexes entities and classifies interest tiers deterministically', () => {
    const world = new WorldRuntime(16);
    world.register({ id: ENTITY_ID('near'), position: { x: 2, y: 0, z: 2 }, radius: 1, layer: 0, tags: [], active: true });
    world.register({ id: ENTITY_ID('mid'), position: { x: 40, y: 0, z: 0 }, radius: 1, layer: 0, tags: [], active: true });
    world.register({ id: ENTITY_ID('far'), position: { x: 150, y: 0, z: 0 }, radius: 1, layer: 0, tags: [], active: true });
    const result = world.query({ x: 0, y: 0, z: 0 });
    expect(result.near).toContain(ENTITY_ID('near'));
    expect(result.mid).toContain(ENTITY_ID('mid'));
    expect(result.far).toContain(ENTITY_ID('far'));
    expect(result.touchedCells).toBeGreaterThan(0);
  });

  it('updates cell membership without losing entity identity', () => {
    const world = new WorldRuntime(8);
    const id = ENTITY_ID('a');
    world.register({ id, position: { x: 1, y: 0, z: 1 }, radius: 1, layer: 0, tags: [], active: true });
    expect(world.update({ id, position: { x: 32, y: 0, z: 32 }, radius: 1, layer: 0, tags: [], active: true })).toBe(true);
    expect(world.entity(id)?.position.x).toBe(32);
    expect(world.stats().cells).toBeGreaterThan(0);
  });
});

describe('Engine TS v6 ECS', () => {
  it('caches stable queries and invalidates on mutation', () => {
    const ecs = new EcsRuntime();
    const id = ecs.spawn(ENTITY_ID('player'));
    ecs.attach(id, 'transform', { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, scale: 1 });
    ecs.attach(id, 'velocity', { value: { x: 4, y: 0, z: 0 }, maxSpeed: 8, acceleration: 10, damping: 10 });
    expect(ecs.query({ all: ['transform', 'velocity'] })).toEqual([id]);
    expect(ecs.query({ all: ['transform', 'velocity'] })).toEqual([id]);
    expect(ecs.stats().queryHits).toBe(1);
    ecs.detach(id, 'velocity');
    expect(ecs.query({ all: ['transform', 'velocity'] })).toEqual([]);
  });

  it('integrates transform from bounded velocity', () => {
    const ecs = new EcsRuntime();
    const id = ecs.spawn(ENTITY_ID('mover'));
    ecs.attach(id, 'transform', { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, scale: 1 });
    ecs.attach(id, 'velocity', { value: { x: 2, y: 0, z: 0 }, maxSpeed: 8, acceleration: 1, damping: 1 });
    expect(ecs.integrate(0.5)).toBe(1);
    expect(ecs.transform(id)?.position.x).toBeCloseTo(1);
  });
});

describe('Engine TS v6 gameplay', () => {
  it('moves, jumps and applies deterministic damage', () => {
    const gameplay = new GameplayRuntime();
    const a = ENTITY_ID('a');
    const b = ENTITY_ID('b');
    gameplay.spawnActor({ id: a, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, health: 100, stamina: 100, maxHealth: 100, maxStamina: 100, inventory: ['sword'], faction: 'player' });
    gameplay.spawnActor({ id: b, position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, health: 20, stamina: 100, maxHealth: 100, maxStamina: 100, inventory: [], faction: 'enemy' });
    gameplay.dispatch({ type: 'attack', actor: a, target: b });
    expect(gameplay.actor(b)?.health).toBe(10);
    gameplay.dispatch({ type: 'attack', actor: a, target: b });
    expect(gameplay.actor(b)?.state).toBe('dead');
  });

  it('regenerates stamina while not sprinting', () => {
    const gameplay = new GameplayRuntime();
    const id = ENTITY_ID('actor');
    gameplay.spawnActor({ id, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, health: 100, stamina: 40, maxHealth: 100, maxStamina: 100, inventory: [], faction: 'neutral' });
    gameplay.update(1);
    expect(gameplay.actor(id)?.stamina).toBeGreaterThan(40);
  });
});

describe('Engine TS v6 networking', () => {
  it('rejects unknown peers and supports reliable acknowledgement', async () => {
    const network = new NetworkRuntime();
    expect(network.addPeer({ id: 'peer', authority: 'client', maxPending: 32, timeoutMs: 100, retryLimit: 2 }).ok).toBe(true);
    expect(network.connect('peer')).toBe(true);
    const packet = await network.send('peer', 'state', { x: 1 }, 1 as never);
    expect(packet.ok).toBe(true);
    expect(network.stats().pending).toBe(1);
    expect(network.acknowledge('peer', packet.ok ? packet.value.sequence : -1)).toBe(true);
    expect(network.stats().pending).toBe(0);
  });
});

describe('Engine TS v6 persistence', () => {
  it('round-trips payloads and rejects invalid slots', async () => {
    const saves = new PersistenceRuntime<{ score: number }>({ schema: 'test', version: 1 });
    expect((await saves.save(0, { score: 42 })).ok).toBe(true);
    const loaded = await saves.load(0);
    expect(loaded.ok && loaded.value).toEqual({ score: 42 });
    expect((await saves.load(99)).ok).toBe(false);
  });
});

describe('Engine TS v6 replay', () => {
  it('creates checkpoints and verifies frames', () => {
    const replay = new ReplayRuntime<{ score: number }>();
    const frame = replay.record(1, 1 / 60, [], { score: 10 });
    expect(frame).not.toBeNull();
    expect(replay.verify(frame!)).toBe(true);
    expect(replay.nearestCheckpoint(10)?.tick).toBe(1);
    expect(replay.stats().frames).toBe(1);
  });
});

describe('Engine TS v6 input', () => {
  it('routes default bindings into stable action output', () => {
    const input = new InputRuntime();
    input.bindDefaults();
    input.push({ device: 'keyboard', code: 'Space', value: 1, pressed: true, timestamp: 1 });
    const frame = input.consume(1);
    expect(frame.actions).toContain('jump');
  });
});

describe('Engine TS v6 render', () => {
  it('caps output using quality budget', () => {
    const render = new RenderRuntime({ initialQuality: 'low' });
    const items = Array.from({ length: 100 }, (_, index) => ({ entity: ENTITY_ID(String(index)), position: { x: index, y: 0, z: -10 }, radius: 0.5, material: 'm', geometry: 'g', priority: 1, transparent: false, layer: 0 }));
    const packet = render.build(defaultCameraView(), items);
    expect(packet.items.length).toBeLessThan(100);
    expect(packet.culled).toBeGreaterThan(0);
  });
});

describe('Engine TS v6 security', () => {
  it('rejects hostile payload depth and credential URLs', () => {
    const security = new SecurityRuntime();
    let value: unknown = 'leaf';
    for (let i = 0; i < 20; i += 1) value = { child: value };
    expect(security.validate(value).ok).toBe(false);
    expect(security.checkUrl('https://user:pass@example.com/model.glb', 'asset').decision).toBe('deny');
  });
});

describe('Engine TS v6 navigation', () => {
  it('finds deterministic grid paths', () => {
    const nav = new NavigationRuntime({ width: 10, height: 10, cellSize: 1, walkable: (x, y) => x >= 0 && y >= 0 && x < 10 && y < 10, cost: () => 1 });
    const path = nav.findPath({ x: 0.5, y: 0, z: 0.5 }, { x: 5.5, y: 0, z: 5.5 });
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]?.x).toBe(0.5);
  });
});

describe('Engine TS v6 composition', () => {
  it('boots and produces a typed frame', async () => {
    const engine = new EngineRuntime();
    engine.addPlayer('player', { x: 0, y: 0, z: 0 });
    engine.addEntity('tree', { x: 2, y: 0, z: -4 }, ['vegetation']);
    const frame = await engine.frame({ deltaSeconds: 1 / 60, camera: defaultCameraView(), inputTick: 1 });
    expect(frame).not.toBeNull();
    expect(frame?.world.entities).toBe(2);
    engine.dispose();
  });
});
