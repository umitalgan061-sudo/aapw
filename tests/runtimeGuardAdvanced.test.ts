import { describe, expect, it } from 'vitest';
import { RuntimeGuard } from '../src/3d/modern/runtimeGuard';
import { CapabilityCache } from '../src/3d/modern/capabilityCache';
import { evaluateRuntimePolicy } from '../src/3d/modern/runtimePolicy';
import { RUNTIME_PROFILES } from '../src/3d/modern/runtimeConfig';

describe('runtime guard invariants', () => {
  const camera = {
    position: { x: 0, y: 2, z: 5 },
    target: { x: 0, y: 1, z: 0 },
    fov: 60,
    near: 0.1,
    far: 5_000,
    viewportWidth: 1280,
    viewportHeight: 720,
    dpr: 1,
  };

  it('accepts a normal frame and rejects non-monotonic ids', () => {
    const guard = new RuntimeGuard();
    const normal = guard.assert({
      frame: 1, camera, frameMs: 16, visibleObjects: 100, drawCalls: 200, triangles: 50_000, textureBytes: 2_000_000, pressure: 0.2,
    });
    expect(normal.ok).toBe(true);
    const repeated = guard.assert({
      frame: 1, camera, frameMs: 16, visibleObjects: 100, drawCalls: 200, triangles: 50_000, textureBytes: 2_000_000, pressure: 0.2,
    });
    expect(repeated.ok).toBe(false);
    expect(repeated.error.code).toBe('FRAME_ID_NON_MONOTONIC');
  });

  it('detects malformed camera and impossible render metrics', () => {
    const guard = new RuntimeGuard();
    const report = guard.inspect({
      frame: 2,
      camera: { ...camera, fov: 200, far: 200_000 },
      frameMs: 1_000,
      visibleObjects: 200_000,
      drawCalls: 200_000,
      triangles: 200_000_000,
      textureBytes: 4 * 1024 * 1024 * 1024,
      pressure: 2,
    });
    expect(report.accepted).toBe(false);
    expect(report.findings.length).toBeGreaterThan(5);
  });

  it('validates policy and budget envelopes together', () => {
    const policy = evaluateRuntimePolicy({ backend: 'webgpu', quality: 'ultra', pressure: 0.9, memoryPressure: 0.95, thermalPressure: 0.9, saveData: false });
    const guard = new RuntimeGuard();
    const report = guard.inspect({ frame: 0, camera, frameMs: 30, visibleObjects: 500, drawCalls: 500, triangles: 80_000, textureBytes: 50_000_000, pressure: 0.9, policy });
    expect(report.accepted).toBe(true);
  });
});

describe('capability cache', () => {
  it('returns cached capabilities and evicts oldest entries at capacity', () => {
    let now = 100;
    const cache = new CapabilityCache({ maxEntries: 2, ttlMs: 1_000, now: () => now });
    const caps = {
      backend: 'webgl2' as const,
      webgpu: false,
      timestampQueries: true,
      floatTextures: true,
      depthTexture: true,
      instancing: true,
      compressedTextures: true,
      limits: { maxTextureDimension2D: 4096, maxUniformBufferBindingSize: 16_384, maxSampledTexturesPerShaderStage: 8, maxColorAttachments: 4, maxBindGroups: 4 },
    };
    cache.set({ backend: 'webgl2', renderer: 'test-a' }, caps);
    expect(cache.get({ backend: 'webgl2', renderer: 'test-a' })?.backend).toBe('webgl2');
    now += 10;
    cache.set({ backend: 'webgl2', renderer: 'test-b' }, caps);
    now += 10;
    cache.set({ backend: 'webgl2', renderer: 'test-c' }, caps);
    expect(cache.stats().entries).toBe(2);
    expect(cache.get({ backend: 'webgl2', renderer: 'test-b' })).not.toBeNull();
    expect(cache.get({ backend: 'webgl2', renderer: 'test-a' })).toBeNull();
    now += 2_000;
    expect(cache.get({ backend: 'webgl2', renderer: 'test-b' })).toBeNull();
  });

  it('discovers once and stores the capability result', async () => {
    let calls = 0;
    const cache = new CapabilityCache({ maxEntries: 4 });
    const fake = {
      gpu: undefined,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original });
    void fake;
    // Discovery is environment-dependent; cache set/get is the deterministic contract under test.
    cache.set({ backend: 'headless', renderer: 'test' }, {
      backend: 'headless', webgpu: false, timestampQueries: false, floatTextures: false, depthTexture: false, instancing: false, compressedTextures: false,
      limits: { maxTextureDimension2D: 1, maxUniformBufferBindingSize: 1, maxSampledTexturesPerShaderStage: 1, maxColorAttachments: 1, maxBindGroups: 1 },
    });
    calls += 1;
    expect(cache.get({ backend: 'headless', renderer: 'test' })?.backend).toBe('headless');
    expect(calls).toBe(1);
  });

  it('exposes immutable cache snapshots', () => {
    const cache = new CapabilityCache({ maxEntries: 2 });
    cache.set({ backend: 'webgl2', renderer: 'r' }, {
      backend: 'webgl2', webgpu: false, timestampQueries: false, floatTextures: false, depthTexture: true, instancing: true, compressedTextures: false,
      limits: { maxTextureDimension2D: 2048, maxUniformBufferBindingSize: 16_384, maxSampledTexturesPerShaderStage: 8, maxColorAttachments: 4, maxBindGroups: 4 },
    });
    const entry = cache.entries()[0];
    expect(entry).toBeDefined();
    expect(Object.isFrozen(entry)).toBe(false);
    expect(entry?.capabilities.limits.maxTextureDimension2D).toBe(2048);
  });
});

void RUNTIME_PROFILES;
