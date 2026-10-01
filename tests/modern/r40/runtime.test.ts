import { describe, expect, it } from 'vitest';
import { R40Engine, R40Runtime, createDefaultRuntimeConfig, detectR40Capabilities, classifyPlatform, commandId, entityId, makeEntity, tick } from '../../../src/3d/modern/r40';

const cap = detectR40Capabilities();

describe('R40 runtime integration', () => {
  it('classifies a normal desktop profile', () => {
    const platform = classifyPlatform({ ...cap, hardwareConcurrency: 16, deviceMemoryGb: 16, saveData: false }, 1920, 0);
    expect(platform).toBe('desktop');
  });
  it('classifies constrained hardware safely', () => {
    const platform = classifyPlatform({ ...cap, hardwareConcurrency: 2, deviceMemoryGb: 2, saveData: true }, 390, 5);
    expect(platform).toBe('constrained');
  });
  it('creates a desktop-safe default config', () => {
    const config = createDefaultRuntimeConfig('desktop', cap);
    expect(config.fixedHz).toBe(60);
    expect(config.maxEntities).toBeGreaterThan(1000);
    expect(config.frameBudget.gpuMs).toBeGreaterThan(0);
  });
  it('steps a runtime without a browser scheduler', () => {
    const runtime = new R40Runtime(createDefaultRuntimeConfig('desktop', cap), { now: () => 100 });
    const first = runtime.step(16.67);
    const second = runtime.step(16.67);
    expect(Number(second.tick)).toBeGreaterThanOrEqual(Number(first.tick));
  });
  it('rejects malformed command code paths', () => {
    const runtime = new R40Runtime(createDefaultRuntimeConfig('desktop', cap));
    expect(runtime.submit({ id: commandId('cmd-1'), tick: tick(1), actor: null, type: 'bad command!', payload: {}, sequence: 1, predictionKey: null })).toBe(false);
  });
  it('accepts valid bounded commands', () => {
    const runtime = new R40Runtime(createDefaultRuntimeConfig('desktop', cap));
    expect(runtime.submit({ id: commandId('cmd-2'), tick: tick(1), actor: entityId('player'), type: 'player.move', payload: { x: 1 }, sequence: 1, predictionKey: 'p:1' })).toBe(true);
  });
  it('emits frame listeners exactly once per frame', () => {
    const runtime = new R40Runtime(createDefaultRuntimeConfig('desktop', cap));
    let seen = 0;
    const unsubscribe = runtime.addFrameListener(() => { seen += 1; });
    runtime.step(20);
    unsubscribe();
    runtime.step(20);
    expect(seen).toBe(1);
  });
  it('stops a scheduled runtime', () => {
    let queued = false;
    const runtime = new R40Runtime(createDefaultRuntimeConfig('desktop', cap), { now: () => 0, requestFrame: () => { queued = true; return 1; }, cancelFrame: () => { queued = false; } });
    runtime.start();
    expect(runtime.running()).toBe(true);
    runtime.stop();
    expect(runtime.running()).toBe(false);
    expect(queued).toBe(false);
  });
  it('supports deterministic task execution order', () => {
    const engine = new R40Engine();
    const seen: string[] = [];
    engine.attachTask({ id: commandId('task-b'), lane: 'interactive', phase: 'simulation', costUnits: 1, deadlineTick: null, enqueuedAt: tick(0), run: () => { seen.push('b'); return { consumedUnits: 1, completed: true, reschedule: false }; } });
    engine.attachTask({ id: commandId('task-a'), lane: 'interactive', phase: 'simulation', costUnits: 1, deadlineTick: null, enqueuedAt: tick(0), run: () => { seen.push('a'); return { consumedUnits: 1, completed: true, reschedule: false }; } });
    engine.step(20);
    expect(seen).toEqual(['a', 'b']);
  });
  it('keeps command sequence monotonic', () => {
    const engine = new R40Engine();
    expect(engine.enqueue('player.move', { x: 1 })?.sequence).toBe(1);
    expect(engine.enqueue('player.move', { x: 2 })?.sequence).toBe(2);
  });
  it('rejects oversized untrusted command payloads', () => {
    expect(new R40Engine().enqueue('player.move', { value: 'x'.repeat(100000) })).toBeNull();
  });
  it('commits command payloads to the bounded state graph', () => {
    const engine = new R40Engine();
    const command = engine.enqueue('camera.fov', { path: 'camera.fov', value: 60 });
    expect(command).not.toBeNull();
    if (command) engine.state.applyCommand(command, tick(1));
    expect(engine.state.read('camera.fov')).toBe(60);
  });
  it('resets runtime-owned subsystems', () => {
    const engine = new R40Engine();
    engine.enqueue('player.move', { x: 1 });
    engine.step(20);
    engine.reset();
    expect(engine.running()).toBe(false);
    expect(Number(engine.clock.tick)).toBe(0);
    expect(engine.scheduler.pending()).toBe(0);
    expect(engine.state.patchCount()).toBe(0);
  });
  it('registers world entities in the facade', async () => {
    const { R40GameFacade } = await import('../../../src/3d/modern/r40/api');
    const facade = new R40GameFacade();
    expect(facade.registerEntity(makeEntity(entityId('npc'), { x: 0, y: 0, z: 0 }, { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } }))).toBe(true);
    facade.dispose();
    expect(facade.disposed()).toBe(true);
  });
});
