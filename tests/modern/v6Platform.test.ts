import { describe, expect, it } from 'vitest';
import { AssetGraph, makeAssetId, type AssetLoader } from '../../src/3d/modern/v6/assetGraph.ts';
import { CommandPipeline, normalizeInputFrame, quantizeInput } from '../../src/3d/modern/v6/commandPipeline.ts';
import { DeterministicKernel, DeterministicTaskScheduler, digest } from '../../src/3d/modern/v6/deterministicKernel.ts';
import { buildMigrationReport, migrationDigest, validateMigrationReport } from '../../src/3d/modern/v6/migrationBoundary.ts';
import { NetworkSession, NetworkSequenceWindow, SnapshotBuffer, interpolateNumber, interpolateVector3 } from '../../src/3d/modern/v6/networkSession.ts';
import { PerformanceGovernor, chooseInitialQuality, qualityPreset } from '../../src/3d/modern/v6/performanceGovernor.ts';
import { V6_FEATURES, V6Platform, platformHealth } from '../../src/3d/modern/v6/platform.ts';
import { buildWorkerMessage, deterministicGridPath, LoopbackWorkerRuntime, WorkerQueue } from '../../src/3d/modern/v6/workerProtocol.ts';
import { MemorySaveStore, SaveManager, buildSavePayload, checksum, decodeSave, encodeSave, makeSaveSlot } from '../../src/3d/modern/v6/saveCodec.ts';
import { RuntimeSecurityBoundary, sanitizeIdentifier, sanitizeUrl, validatePayload } from '../../src/3d/modern/v6/securityTelemetry.ts';
import { ScenePlanner, cellsInRadius, isInsideFrustum, projectPixels } from '../../src/3d/modern/v6/scenePlanner.ts';
import { UiStore, createInitialUiState, hudHealthPercent, reduceUi, selectedInventory, serializeUi } from '../../src/3d/modern/v6/uiState.ts';
import { WorldState, areHostile, distanceSquared, makeEntityRef } from '../../src/3d/modern/v6/worldState.ts';
import { assertV6Verification, runV6VerificationSuite } from '../../src/3d/modern/v6/verification.ts';

const id = (value: string) => makeAssetId(value);
const descriptor = (value: string, bytes = 10, dependencies: readonly string[] = []) => ({
  id: id(value), kind: 'data' as const, uri: `/assets/${value}.bin`, bytes,
  dependencies: dependencies.map(id), priority: 1, tags: ['streamable'],
});

class Loader implements AssetLoader {
  readonly loaded: string[] = [];
  async load(asset: { id: string }): Promise<unknown> { this.loaded.push(asset.id); return { id: asset.id }; }
}

describe('V6 deterministic kernel', () => {
  it('replays seeded state identically', () => {
    const a = new DeterministicKernel({ seed: 42 }); const b = new DeterministicKernel({ seed: 42 });
    a.start(); b.start();
    const left: number[] = []; const right: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      a.advance(1 / 60, (ctx) => { left.push(ctx.random.nextFloat()); return 0; });
      b.advance(1 / 60, (ctx) => { right.push(ctx.random.nextFloat()); return 0; });
    }
    expect(left).toEqual(right); expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('bounds catch-up and supports restore', () => {
    const kernel = new DeterministicKernel({ tickHz: 10, maxCatchUpTicks: 2 }); kernel.start();
    expect(kernel.advance(1)).toBe(2);
    const checkpoint = kernel.snapshot(); kernel.advance(0.5); kernel.restore(checkpoint);
    expect(kernel.snapshot().tickId).toBe(checkpoint.tickId);
  });

  it('runs tasks in stable lexical order', () => {
    const scheduler = new DeterministicTaskScheduler(); const calls: string[] = [];
    scheduler.register({ id: 'z', cadenceTicks: 1, nextTick: 0, execute: () => calls.push('z') });
    scheduler.register({ id: 'a', cadenceTicks: 1, nextTick: 0, execute: () => calls.push('a') });
    const random = { nextFloat: () => 0.5 } as never;
    scheduler.run({ id: 1 as never, deltaSeconds: 1 / 60, simulationSeconds: 1 / 60, alpha: 0, random });
    expect(calls).toEqual(['a', 'z']);
  });

  it('produces stable digests', () => { expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 })); });
});

describe('V6 asset graph', () => {
  it('preloads dependencies', async () => {
    const loader = new Loader(); const graph = new AssetGraph(loader, { maxConcurrentLoads: 1 });
    graph.register(descriptor('child')); graph.register(descriptor('parent', 20, ['child']));
    await graph.preload([id('parent')]);
    expect(graph.budget().residentCount).toBe(2); expect(loader.loaded[0]).toBe('child');
  });

  it('detects cycles and exposes manifests', () => {
    const graph = new AssetGraph(new Loader()); graph.register(descriptor('a', 1, ['b']));
    expect(() => graph.register(descriptor('b', 1, ['a']))).toThrow(/cycle/);
    expect(graph.manifest()).toHaveLength(2);
  });
});

describe('V6 scene and commands', () => {
  const camera = { position: { x: 0, y: 0, z: 10 }, forward: { x: 0, y: 0, z: -1 }, horizontalFovRadians: Math.PI / 2, verticalFovRadians: Math.PI / 2, nearDistance: 0.1, farDistance: 1000 };
  it('plans stable LOD and cells', () => {
    const planner = new ScenePlanner(); planner.upsert({ id: 'hero', position: { x: 0, y: 0, z: 0 }, radius: 2, importance: 1, tags: ['streamable'], alwaysVisible: true });
    const plan = planner.plan(camera, 1); expect(plan.visibleCount).toBe(1); expect(plan.decisions[0]?.tier).toBe(0);
    expect(projectPixels(2, 20, 800)).toBe(80); expect(cellsInRadius({ x: 0, y: 0, z: 0 }, 20, 10)).toHaveLength(25);
    expect(isInsideFrustum(plan.decisions[0] ? { id: 'hero', position: { x: 0, y: 0, z: 0 }, radius: 2, importance: 1, tags: [], alwaysVisible: true } : { id: 'hero', position: { x: 0, y: 0, z: 0 }, radius: 2, importance: 1, tags: [] }, camera)).toBe(true);
  });

  it('normalizes axes, buttons and quantization', () => {
    const commands = normalizeInputFrame({ tick: 4, pressed: ['Space', 'Mouse0'], released: [], axes: { moveX: 0.5, moveY: -0.5 }, source: 'keyboard' });
    expect(commands.map((command) => command.name)).toEqual(['move', 'jump', 'primaryAction']);
    expect(quantizeInput(0.333333)).toBeCloseTo(0.333);
    const pipeline = new CommandPipeline({ maxHistory: 2 });
    pipeline.enqueue({ tick: 1, sequence: 0, domain: 'system', name: 'pause', payload: null, client: 'local', reliable: true }, 1);
    pipeline.enqueue({ tick: 2, sequence: 0, domain: 'system', name: 'resume', payload: null, client: 'local', reliable: true }, 2);
    pipeline.enqueue({ tick: 3, sequence: 0, domain: 'movement', name: 'jump', payload: null, client: 'local', reliable: true }, 3);
    expect(pipeline.history()).toHaveLength(2);
  });
});

describe('V6 network', () => {
  it('deduplicates packets and tracks health', () => {
    const window = new NetworkSequenceWindow(); expect(window.accept(1)).toBe(true); expect(window.accept(1)).toBe(false); expect(window.includes(1)).toBe(true);
    const session = new NetworkSession('client', { degradedRttMs: 100 }); session.open();
    const packet = session.send('state', { x: 1 }, 1, 0, 'reliable'); session.receive(packet, 0.2);
    expect(session.metrics().rttMs).toBe(200); expect(session.state).toBe('degraded');
  });

  it('interpolates snapshot values', () => {
    const buffer = new SnapshotBuffer<{ x: number }>(8);
    buffer.push({ tick: 10, serverTimeSeconds: 1, state: { x: 0 } }); buffer.push({ tick: 20, serverTimeSeconds: 2, state: { x: 10 } });
    expect(buffer.sample(15, (a, b, alpha) => ({ x: interpolateNumber(a.x, b.x, alpha) }))?.state.x).toBe(5);
    expect(interpolateVector3({ x: 0, y: 0, z: 0 }, { x: 10, y: 5, z: -5 }, 0.5)).toEqual({ x: 5, y: 2.5, z: -2.5 });
  });
});

describe('V6 world and save', () => {
  it('keeps entity generations and query invariants', () => {
    const world = new WorldState(); const hero = world.spawn(1);
    world.set(hero, 'transform', { x: 1, y: 2, z: 3, yaw: 0, pitch: 0 }); world.set(hero, 'tags', { values: ['hero'] });
    expect(world.isAlive(hero)).toBe(true); expect(makeEntityRef(1, 1)).toBe(hero);
    expect(world.query({ components: ['transform'], tags: ['hero'] })).toEqual([hero]);
    expect(distanceSquared(world.get(hero, 'transform')!, world.get(hero, 'transform')!)).toBe(0);
    expect(areHostile({ id: 'a', relationMask: 1 }, { id: 'b', relationMask: 1 })).toBe(true);
  });

  it('round-trips and detects save tampering', () => {
    const payload = buildSavePayload({
      player: { position: { x: 1, y: 2, z: 3 }, health: 80, stamina: 50, level: 3, experience: 20, inventory: [] },
      world: { seed: 4, simulationTick: 9, discovered: ['x'], quests: [], flags: {} }, settings: { quality: 'high' },
    });
    const slot = makeSaveSlot('slot1'); const raw = encodeSave(slot, 9, payload); const decoded = decodeSave(raw);
    expect(decoded.payload.player.level).toBe(3);
    expect(decoded.checksum).toBe(checksum({ magic: 'AAPW-V6-SAVE', schema: 1, slot, createdTick: 9, payload: decoded.payload }));
    const tampered = JSON.parse(raw) as Record<string, unknown>; tampered.createdTick = 10; expect(() => decodeSave(JSON.stringify(tampered))).toThrow(/checksum/);
    const manager = new SaveManager(new MemorySaveStore()); return manager.save(makeSaveSlot('slot2'), 2, payload).then(() => expect(manager.slots()).resolves.toEqual(['slot2']));
  });
});

describe('V6 performance, workers and security', () => {
  it('adapts quality to device and load', () => {
    expect(chooseInitialQuality({ coarsePointer: true, hardwareConcurrency: 2, screenPixels: 2_000_000, saveData: true })).toBe(0); expect(qualityPreset(4).name).toBe('ultra');
    const governor = new PerformanceGovernor(4, { holdFrames: 2 }); governor.sample({ frameMs: 40, gpuMs: 35, memoryMb: 2000, drawCalls: 3000, visibleObjects: 900 });
    expect(governor.sample({ frameMs: 40, gpuMs: 35, memoryMb: 2000, drawCalls: 3000, visibleObjects: 900 }).level).toBeLessThan(4);
  });

  it('executes bounded worker requests', async () => {
    const queue = new WorkerQueue({ maxQueue: 4, maxOutstanding: 4 }); const worker = new LoopbackWorkerRuntime(queue);
    worker.register({ channel: 'navigation', kind: 'path', handle: (payload) => deterministicGridPath(payload as never) });
    const request = queue.enqueue('navigation', 'path', 1, { start: { x: 0, z: 0 }, goal: { x: 3, z: 2 }, maxNodes: 20 });
    const response = await worker.pump(1); expect(response[0]?.id).toBe(request.id); expect((response[0]?.payload as { reached: boolean }).reached).toBe(true);
    expect(buildWorkerMessage('PING', 3).requestId).toBe('ping-3');
  });

  it('blocks malformed payloads and records security receipts', () => {
    expect(sanitizeIdentifier('a b\n')).toBe('a_b_'); expect(sanitizeUrl('javascript:alert(1)')).toBeUndefined();
    expect(validatePayload({ ok: true }).decision).toBe('allow');
    const boundary = new RuntimeSecurityBoundary({ maxStringLength: 8 }); expect(boundary.guard('chat', { text: 'way-too-long' }, 1).decision).not.toBe('allow');
    expect(boundary.telemetry.values().length).toBe(1);
  });
});

describe('V6 UI, migration and platform', () => {
  it('keeps UI state immutable and accessible', () => {
    const initial = createInitialUiState(); const inventory = reduceUi(initial, { type: 'inventory/set', items: [{ id: 'p', name: 'Potion', quantity: 2, selected: true, usable: true, equipped: false, rarity: 'common' }] });
    const store = new UiStore(inventory); store.dispatch({ type: 'hud/update', patch: { health: 50 } });
    expect(selectedInventory(store.state)?.id).toBe('p'); expect(hudHealthPercent(store.state)).toBe(0.5); expect(JSON.parse(serializeUi(store.state)).tick).toBe(0);
  });

  it('validates migration and the full V6 suite', () => {
    const report = buildMigrationReport(); expect(validateMigrationReport(report)).toEqual([]); expect(migrationDigest(report)).toMatch(/^[0-9a-f]{8}$/);
    const verification = runV6VerificationSuite(); expect(verification.passed).toBe(true); expect(() => assertV6Verification()).not.toThrow();
    const platform = new V6Platform(); platform.start(); platform.frame(1 / 60); expect(platform.lastFrame.tick).toBeGreaterThan(0); expect(platformHealth(platform).healthy).toBe(true); platform.dispose();
    expect(V6_FEATURES.length).toBeGreaterThanOrEqual(9);
  });
});
