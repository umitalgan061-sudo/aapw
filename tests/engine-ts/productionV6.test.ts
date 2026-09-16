import { describe, expect, it } from 'vitest';
import { EngineRuntime } from '../../src/engine-ts/engineRuntime.js';
import { InputRuntime } from '../../src/engine-ts/inputRuntime.js';
import { SceneRuntime } from '../../src/engine-ts/sceneRuntime.js';
import { SecurityRuntime } from '../../src/engine-ts/securityRuntime.js';
import { StreamingRuntime } from '../../src/engine-ts/streamingRuntime.js';
import { ENTITY_ID } from '../../src/engine-ts/coreTypes.js';

describe('production lifecycle contracts', () => {
  it('pauses and resumes without advancing gameplay while paused', async () => {
    const engine = new EngineRuntime();
    await engine.boot();
    expect(engine.pause()).toBe(true);
    expect(engine.frame({ deltaSeconds: 1, camera: { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 }, near: 0.1, far: 100, width: 320, height: 200, pixelRatio: 1 } })).resolves.toBeNull();
    expect(engine.resume()).toBe(true);
    expect(await engine.frame({ deltaSeconds: 1 / 60, camera: { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 }, near: 0.1, far: 100, width: 320, height: 200, pixelRatio: 1 } })).not.toBeNull();
    engine.dispose();
  });

  it('recovers runtime state through the public facade', async () => {
    const engine = new EngineRuntime();
    await engine.boot();
    expect(engine.recover('test-failure')).toBe(true);
    expect(engine.runtime.health.phase).toBe('ready');
    engine.dispose();
  });
});

describe('input and scene contracts', () => {
  it('keeps pause binding available in every mode', () => {
    const input = new InputRuntime();
    input.bindDefaults();
    input.setMode('menu');
    input.push({ device: 'keyboard', code: 'Escape', value: 1, pressed: true, timestamp: 1 });
    expect(input.consume(1).actions).toContain('pause');
  });

  it('preserves scene visibility ordering by layer and id', () => {
    const scene = new SceneRuntime();
    scene.create({ id: 'z', type: 'entity', parent: 'scene', position: { x: 0, y: 0, z: 0 }, visible: true, layer: 2 });
    scene.create({ id: 'a', type: 'entity', parent: 'scene', position: { x: 0, y: 0, z: 0 }, visible: true, layer: 1 });
    expect(scene.visibleNodes().map(node => node.id)).toEqual(['scene', 'a', 'z']);
  });
});

describe('security and streaming', () => {
  it('blocks unsupported asset protocols', () => {
    const security = new SecurityRuntime();
    expect(security.checkUrl('data:text/plain,unsafe', 'asset').decision).toBe('deny');
    expect(security.checkUrl('https://example.com/a.glb', 'asset').decision).toBe('allow');
  });

  it('prioritizes visible streaming requests', () => {
    const streaming = new StreamingRuntime({ maxConcurrent: 1 });
    const visible = ENTITY_ID('visible');
    const prefetch = ENTITY_ID('prefetch');
    streaming.register({ id: visible, priority: 1, bytes: 1024, distance: 1, required: false });
    streaming.register({ id: prefetch, priority: 100, bytes: 1024, distance: 100, required: false });
    streaming.request({ id: visible, priority: 1, reason: 'visible' });
    streaming.request({ id: prefetch, priority: 1, reason: 'prefetch' });
    expect(streaming.begin()).toEqual([visible]);
  });
});
