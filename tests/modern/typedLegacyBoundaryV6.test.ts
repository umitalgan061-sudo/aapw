import { describe, expect, it, vi } from 'vitest';
import { TypedCameraRuntimeV6 } from '../../src/3d/modern/typedCameraRuntimeV6';
import { TypedInputRuntimeV6, installDefaultInputBindingsV6 } from '../../src/3d/modern/typedInputRuntimeV6';
import { TypedWorldRuntimeV6 } from '../../src/3d/modern/typedWorldRuntimeV6';
import { TypedPlayerRuntimeV6 } from '../../src/3d/modern/typedPlayerRuntimeV6';
import { TypedRenderLoopV6 } from '../../src/3d/modern/typedRenderLoopV6';
import { TypedGameRuntimeV6 } from '../../src/3d/modern/typedRuntimeFacadeV6';
import { TypedMigrationGateV6 } from '../../src/3d/modern/typedMigrationGateV6';
import { tickId, runtimeId, vec3V4 } from '../../src/3d/modern/runtimeContractsV4';

describe('typed camera v6', () => {
  it('clamps pitch and distance to configured limits', () => {
    const camera = new TypedCameraRuntimeV6(undefined, { minDistance: 5, maxDistance: 15, minPitch: -0.2, maxPitch: 0.8 });
    camera.applyIntent({ orbitX: 0, orbitY: -10000, zoom: 100, panX: 0, panY: 0, timestamp: 0 });
    const state = camera.state();
    expect(state.pitch).toBeLessThanOrEqual(0.8);
    expect(state.distance).toBeGreaterThanOrEqual(5);
  });

  it('smoothly follows a focused target', () => {
    const camera = new TypedCameraRuntimeV6();
    camera.focus({ target: vec3V4(20, 2, 30), distance: 10, yaw: 0.5, pitch: 0.4 });
    const before = camera.state();
    const after = camera.update(50);
    expect(after.target.x).not.toBe(before.target.x);
    expect(after.distance).toBeLessThanOrEqual(12);
  });

  it('supports collision pullback', () => {
    const camera = new TypedCameraRuntimeV6(undefined, { minDistance: 2, maxDistance: 20, collisionPadding: 0.5 });
    const probe = { distance: () => 5 };
    camera.setDistance(12);
    const state = camera.update(100, probe);
    expect(state.collisionDistance).toBeLessThan(12);
  });
});

describe('typed input v6', () => {
  it('maps keyboard movement deterministically', () => {
    const input = new TypedInputRuntimeV6({ now: () => 10 });
    installDefaultInputBindingsV6(input);
    input.press('keyboard', 'KeyW', 10);
    input.press('keyboard', 'KeyD', 10);
    const snapshot = input.consume(tickId(1), 1);
    expect(snapshot.moveX).toBeGreaterThan(0);
    expect(snapshot.moveZ).toBeLessThan(0);
    expect(snapshot.source).toBe('keyboard');
  });

  it('applies analog dead zones', () => {
    const input = new TypedInputRuntimeV6({ analogDeadZone: 0.2 });
    input.bind({ device: 'gamepad', code: 'axis:leftX', action: 'move.right', deadZone: 0.2 });
    input.axis('gamepad', 'axis:leftX', 0.1);
    expect(input.consume(tickId(1), 1).moveX).toBe(0);
  });

  it('bounds event history and queue', () => {
    const input = new TypedInputRuntimeV6({ maxQueue: 2, maxHistory: 2 });
    input.bind({ device: 'keyboard', code: 'KeyW', action: 'move.forward' });
    input.press('keyboard', 'KeyW'); input.press('keyboard', 'KeyW'); input.press('keyboard', 'KeyW');
    expect(input.metrics().dropped).toBeGreaterThanOrEqual(1);
    input.consume(tickId(1), 1); input.consume(tickId(2), 2); input.consume(tickId(3), 3);
    expect(input.history().length).toBeLessThanOrEqual(2);
  });
});

describe('typed world v6', () => {
  it('creates a deterministic chunk ring', () => {
    const world = new TypedWorldRuntimeV6({ cellSize: 10, prefetchRadius: 2, activeRadius: 1 });
    world.setPlayerPosition(vec3V4(0, 0, 0));
    const requests = world.requests();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]?.reason).toBe('active');
  });

  it('keeps resident memory within budget', () => {
    const world = new TypedWorldRuntimeV6({ cellSize: 10, maxResidentChunks: 2, chunkBytes: 1024 * 1024, maxResidentBytes: 2 * 1024 * 1024 });
    world.ensureChunk(0,0); world.ensureChunk(1,0); world.ensureChunk(2,0);
    world.instantiateChunk(world.ensureChunk(0,0), ['tree','tree']);
    world.instantiateChunk(world.ensureChunk(1,0), ['tree']);
    world.instantiateChunk(world.ensureChunk(2,0), ['tree']);
    expect(world.metrics().residentChunks).toBeLessThanOrEqual(2);
    expect(world.metrics().residentBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('supports bounded nearest queries', () => {
    const world = new TypedWorldRuntimeV6({ cellSize: 10 });
    const chunk = world.ensureChunk(0,0);
    const ids = world.instantiateChunk(chunk, ['npc','animal','tree']);
    expect(ids.length).toBe(3);
    const hits = world.nearest(vec3V4(5,0,5), 100, 2);
    expect(hits.length).toBe(2);
  });
});

describe('typed player v6', () => {
  it('snaps to deterministic ground height', () => {
    const player = new TypedPlayerRuntimeV6({ heightAt: (x,z) => Math.sin(x * 0.01) + Math.cos(z * 0.01) });
    player.spawn(vec3V4(10,100,10));
    expect(player.state().position.y).toBeCloseTo(Math.sin(0.1) + Math.cos(0.1));
  });

  it('moves, jumps and consumes stamina', () => {
    const player = new TypedPlayerRuntimeV6({ heightAt: () => 0 });
    player.spawn(vec3V4(0,0,0));
    const before = player.state();
    const input = { tick: tickId(1), frame: 1 as any, moveX: 0, moveZ: -1, cameraX: 0, cameraY: 0, sprint: true, jump: true, interact: false, pause: false, debug: false, source: 'keyboard' as const };
    const after = player.tick(input, 1/60, tickId(1));
    expect(after.position.z).not.toBe(before.position.z);
    expect(after.stamina).toBeLessThan(before.stamina);
    expect(player.metrics().jumps).toBe(1);
  });

  it('supports damage, death and revival', () => {
    const player = new TypedPlayerRuntimeV6({ heightAt: () => 0 });
    player.damage(120, tickId(1));
    expect(player.state().alive).toBe(false);
    expect(player.revive()).toBe(true);
    expect(player.state().health).toBe(player.state().maxHealth);
  });
});

describe('typed render loop v6', () => {
  it('executes bounded fixed-step simulation', async () => {
    let now = 0;
    const loop = new TypedRenderLoopV6({ now: () => now }, { fixedStepMs: 10, maxCatchUpSteps: 3 });
    let simulation = 0;
    loop.start(0);
    now = 35;
    const result = await loop.step(() => ({ frame: loop.frame(), submitted: true, drawCalls: 10, triangles: 100, visible: 5, culled: 2, cpuMs: 1, budgetMs: 10, quality: loop.quality() }), () => { simulation += 1; }, now);
    expect(simulation).toBe(3);
    expect(result?.submitted).toBe(true);
    expect(loop.metrics().ticks).toBe(3);
  });

  it('clamps pathological frame deltas', async () => {
    let now = 0;
    const loop = new TypedRenderLoopV6({ now: () => now }, { fixedStepMs: 10, maxDeltaMs: 50 });
    loop.start(0); now = 500;
    await loop.step(() => ({ frame: loop.frame(), submitted: true, drawCalls: 0, triangles: 0, visible: 0, culled: 0, cpuMs: 0, budgetMs: 10, quality: loop.quality() }), () => undefined, now);
    expect(loop.metrics().clampedDeltas).toBe(1);
  });
});

describe('typed migration gate v6', () => {
  it('requires repeated parity before promotion', () => {
    const gate = new TypedMigrationGateV6(runtimeId('test'));
    for (let i = 0; i < 59; i += 1) gate.observe('camera', { x: i }, { x: i }, i, 1, i);
    expect(gate.evaluate('camera').phase).toBe('shadow');
    gate.observe('camera', { x: 59 }, { x: 59 }, 59, 1, 59);
    expect(gate.evaluate('camera').phase).toBe('parity');
    expect(gate.promote('camera')).toBe(true);
    expect(gate.evaluate('camera').phase).toBe('promoted');
  });

  it('blocks a surface on mismatched evidence', () => {
    const gate = new TypedMigrationGateV6(runtimeId('test'));
    gate.configure({ surface: 'audio', owner: 'audio', risk: 'critical', requiredSamples: 2, maxMismatchRate: 0, enabled: true });
    gate.observe('audio', { a: 1 }, { a: 2 }, 1, 2, 1);
    expect(gate.evaluate('audio').phase).toBe('blocked');
    expect(gate.promote('audio')).toBe(false);
  });
});

describe('typed game facade v6', () => {
  it('boots without a renderer and exposes deterministic diagnostics', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const runtime = new TypedGameRuntimeV6({ runtimeId: 'test-v6', now: () => 100 });
    runtime.start();
    expect(runtime.running()).toBe(true);
    const diagnostics = runtime.diagnostics();
    expect(diagnostics.version).toBe(6);
    expect(diagnostics.runtime).toBe('test-v6');
    runtime.dispose();
    vi.restoreAllMocks();
  });
});
