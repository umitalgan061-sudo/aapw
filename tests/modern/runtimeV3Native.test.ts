import { describe, expect, it } from 'vitest';
import { createV3RuntimeKernel } from '../../src/3d/modern/v3/runtimeKernel.js';
import { normalizeV3Action, type V3RuntimeConfig, type V3FrameSource } from '../../src/3d/modern/v3/runtimeContracts.js';

const config = (backend: V3RuntimeConfig['backend'] = 'webgl2'): V3RuntimeConfig => ({
  worldId: 'test-world' as V3RuntimeConfig['worldId'], seed: 42, host: 'headless', mode: 'headless', backend, quality: 'high',
  fixedStepMs: 1000 / 60, maxDeltaMs: 250, maxCatchUpSteps: 6,
  budget: { totalMs: 16.6667, simulationMs: 5, inputMs: 1, streamingMs: 2, presentationMs: 7, saveMs: 1 },
  enableLegacyAdapter: false, enablePersistence: true, enableWorkers: false,
});

const source: V3FrameSource = {
  now: () => 1000,
  viewport: () => ({ width: 1920, height: 1080, dpr: 1 }),
  camera: () => ({ position: { x: 0, y: 80, z: 120 }, target: { x: 0, y: 0, z: 0 }, fov: 60, near: 0.1, far: 30000, dpr: 1 }),
};

const action = normalizeV3Action({ action: 'move.forward', source: 'keyboard', value: 1, phase: 'pressed' }, 1000, 0);

describe('runtime-v3 native kernel', () => {
  it('starts, ticks and emits a deterministic snapshot', async () => {
    const kernel = createV3RuntimeKernel({ config: config(), dependencies: { now: source.now, frameSource: source } });
    const events: string[] = [];
    kernel.on('runtime/tick', event => events.push(`${Number(event.tick)}:${event.deltaMs}`));
    await expect(kernel.start()).resolves.toBe(true);
    kernel.dispatch(action);
    const first = kernel.tick(1017);
    const second = kernel.tick(1034);
    expect(first.running).toBe(true);
    expect(second.frame).toBeGreaterThan(first.frame);
    expect(events.length).toBeGreaterThan(0);
    expect(kernel.renderPacket().backend).toBe('webgl2');
    expect(kernel.snapshot().digest).toMatch(/^[0-9a-f]{8}$/);
    await kernel.dispose();
    expect(() => kernel.tick(1050)).toThrow('V3 runtime disposed');
  });

  it('preserves action ordering independent of dispatch insertion order', async () => {
    const a = createV3RuntimeKernel({ config: config(), dependencies: { now: source.now, frameSource: source } });
    const b = createV3RuntimeKernel({ config: config(), dependencies: { now: source.now, frameSource: source } });
    await a.start();
    await b.start();
    const first = normalizeV3Action({ action: 'move.right', source: 'programmatic', value: 1 }, 1000, 0);
    const second = normalizeV3Action({ action: 'move.left', source: 'programmatic', value: 1 }, 1000, 0);
    a.dispatch(first); a.dispatch(second);
    b.dispatch(second); b.dispatch(first);
    const packetA = a.tick(1017);
    const packetB = b.tick(1017);
    expect(packetA.digest).toBe(packetB.digest);
    expect(packetA.health.recoveryStage).toBe('healthy');
    await a.dispose();
    await b.dispose();
  });

  it('honours pause without advancing simulation', async () => {
    const kernel = createV3RuntimeKernel({ config: config(), dependencies: { now: source.now, frameSource: source } });
    await kernel.start();
    const before = kernel.tick(1017);
    kernel.pause('test');
    const paused = kernel.tick(1117);
    expect(paused.frame).toBe(before.frame);
    expect(paused.paused).toBe(true);
    kernel.resume('test');
    const resumed = kernel.tick(1134);
    expect(resumed.frame).toBeGreaterThan(before.frame);
    await kernel.stop('test');
    expect(kernel.snapshot().running).toBe(false);
    await kernel.dispose();
  });

  it('keeps backend selection explicit', async () => {
    const gpu = createV3RuntimeKernel({ config: config('webgpu'), dependencies: { now: source.now, frameSource: source } });
    await gpu.start();
    expect(gpu.snapshot().backend).toBe('webgpu');
    gpu.setBackend('webgl2');
    expect(gpu.renderPacket().backend).toBe('webgl2');
    await gpu.dispose();
  });
});
