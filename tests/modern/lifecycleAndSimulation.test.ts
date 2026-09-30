import { describe, expect, it } from 'vitest';
import { RuntimeLifecycleController } from '../../src/3d/modern/runtimeLifecycleController';
import { RuntimeObservability } from '../../src/3d/modern/runtimeObservability';
import { ProductionSimulation, integrateVelocity } from '../../src/3d/modern/productionSimulation';
import { LegacyStateBridge } from '../../src/3d/modern/legacyStateBridge';
import type { SessionSnapshot } from '../../src/3d/modern/runtimeContracts';
import type { FrameId, UnixMillis } from '../../src/3d/modern/types';

function clock(): () => UnixMillis {
  let value = 0;
  return () => (value += 10) as UnixMillis;
}

function snapshot(): SessionSnapshot {
  return {
    schema: 'aapw.session',
    schemaVersion: 1,
    frame: 12 as FrameId,
    timestamp: 100 as UnixMillis,
    deltaSeconds: 1 / 60,
    quality: 'high',
    player: { position: { x: 1, y: 2, z: 3 }, velocity: { x: 0, y: 0, z: 1 }, grounded: true, health: 90, maxHealth: 100 },
    camera: { position: { x: 5, y: 4, z: 6 }, target: { x: 1, y: 2, z: 3 }, yaw: 0.2, pitch: 0.1, zoom: 6 },
    world: { timeOfDaySeconds: 120, weather: 'clear', loadedCells: ['0:0'], discoveredSettlements: ['winterfell'] },
    digest: 'digest',
    playtimeMs: 1200,
    totalFrames: 12,
    runtime: {
      frame: 12 as FrameId,
      absoluteSeconds: 0.2,
      deltaSeconds: 1 / 60,
      quality: 'high',
      pressure: { cpu: 0, gpu: 0, frame: 0, memory: 0, thermal: 0, combined: 0 },
      camera: { position: { x: 5, y: 4, z: 6 }, target: { x: 1, y: 2, z: 3 }, fov: 60, near: 0.1, far: 5000, viewportWidth: 1280, viewportHeight: 720, dpr: 1 },
      entities: [],
      commands: [],
      streamedCells: ['0:0'],
    },
  } as SessionSnapshot;
}

describe('RuntimeObservability', () => {
  it('records successful spans and counters', () => {
    const now = clock();
    const observer = new RuntimeObservability({ now });
    const span = observer.start('frame', 1 as FrameId, { source: 'test' });
    span.end();
    observer.count('frames', 1, 1 as FrameId);
    const result = observer.snapshot();
    expect(result.spans).toHaveLength(1);
    expect(result.counters.some((item) => item.name === 'frames')).toBe(true);
  });

  it('rejects closing a span twice', () => {
    const observer = new RuntimeObservability({ now: clock() });
    const span = observer.start('simulation', 1 as FrameId);
    span.end();
    expect(() => span.end()).toThrow(/already ended/);
  });
});

describe('RuntimeLifecycleController', () => {
  it('suspends, saves, flushes and resumes in browser-independent mode', async () => {
    const calls: string[] = [];
    const controller = new RuntimeLifecycleController({
      now: clock(),
      onSuspend: () => calls.push('suspend'),
      onResume: () => calls.push('resume'),
      onSave: () => calls.push('save'),
      onFlush: () => calls.push('flush'),
      debounceMs: 0,
    });
    controller.start();
    await controller.dispatch('visibility:hidden', 'test');
    await controller.dispatch('visibility:visible', 'test');
    expect(calls).toEqual(['save', 'suspend', 'flush', 'resume']);
    expect(controller.stats().suspends).toBe(1);
    expect(controller.stats().resumes).toBe(1);
    await controller.stop();
  });

  it('tracks online and offline transitions', async () => {
    let online = true;
    const controller = new RuntimeLifecycleController({ now: clock(), onNetworkChange: (value) => { online = value; }, debounceMs: 0 });
    controller.start();
    await controller.dispatch('offline', 'test');
    expect(online).toBe(false);
    await controller.dispatch('online', 'test');
    expect(online).toBe(true);
  });
});

describe('ProductionSimulation', () => {
  it('does not run a partial step before accumulator reaches fixed step', () => {
    const simulation = new ProductionSimulation({ fixedStepMs: 10 });
    simulation.add({ id: 'hero', position: { x: 0, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, active: true });
    let updates = 0;
    simulation.step(5, () => { updates += 1; });
    expect(updates).toBe(0);
    simulation.step(5, () => { updates += 1; });
    expect(updates).toBe(1);
  });

  it('drops pathological catch-up instead of spiraling', () => {
    const simulation = new ProductionSimulation({ fixedStepMs: 10, maxStepsPerFrame: 2, maxFrameDeltaMs: 100 });
    simulation.add({ id: 'hero', position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, active: true });
    simulation.step(100, () => undefined);
    expect(simulation.stats().droppedMs).toBeGreaterThan(0);
  });

  it('integrates velocity with bounded delta', () => {
    const entity = { id: 'hero', position: { x: 0, y: 10, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, active: true };
    integrateVelocity(entity, 0.016, -9.81);
    expect(entity.position.x).toBeGreaterThan(0);
    expect(entity.position.y).toBeLessThan(10);
    expect(entity.velocity.y).toBeLessThan(0);
  });
});

describe('LegacyStateBridge', () => {
  it('mirrors an immutable session snapshot into legacy state', () => {
    const state = new Map<string, unknown>();
    const bridge = new LegacyStateBridge({ state: { set: (key, value) => state.set(key, value), get: (key) => state.get(key) } });
    const mirrored = bridge.mirror(snapshot(), 'webgpu');
    expect(mirrored.frame).toBe(12);
    expect(state.get('modern.quality')).toBe('high');
    expect(state.get('modern.backend')).toBe('webgpu');
    expect(bridge.compareLegacy({ frame: 12, quality: 'high', backend: 'webgpu' })).toBe(true);
  });

  it('records parity failures instead of mutating the source', () => {
    const bridge = new LegacyStateBridge();
    bridge.mirror(snapshot(), 'webgpu');
    expect(bridge.compareLegacy({ frame: 99 })).toBe(false);
    expect(bridge.stats().parityFailures).toBe(1);
    expect(snapshot().player.position.x).toBe(1);
  });
});
