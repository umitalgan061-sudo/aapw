import { describe, expect, it } from 'vitest';
import { StrictRenderFramePlanner } from '../../../src/3d/strict/renderFramePlanner.ts';
import { StrictRenderBackendRuntime, buildStrictRenderPolicy, probeRenderCapabilities } from '../../../src/3d/strict/renderBackendRuntime.ts';
import { entityId } from '../../../src/3d/strict/liveCoreTypes.ts';

const policy = buildStrictRenderPolicy(
  probeRenderCapabilities({
    secureContext: true,
    gpuAdapterAvailable: true,
    webgl2ContextAvailable: true,
    hardwareConcurrency: 16,
    memoryGiB: 16,
    devicePixelRatio: 2,
  }),
  { backend: 'webgpu', quality: 'high' },
);

describe('render planning', () => {
  it('deduplicates candidates by stable id', () => {
    const planner = new StrictRenderFramePlanner();
    const result = planner.plan(policy, [
      { id: 'hero', distance: 1, importance: 10, triangles: 1000, instances: 1 },
      { id: 'hero', distance: 2, importance: 2, triangles: 9000, instances: 1 },
    ]);
    expect(result.visible).toHaveLength(1);
    expect(result.visible[0]?.triangles).toBe(1000);
  });
  it('prioritizes important nearby candidates', () => {
    const planner = new StrictRenderFramePlanner({ maxCandidates: 100, maxVisible: 2, triangleBudget: 100_000, passBudgetMs: 8, shadowDistance: 100 });
    const result = planner.plan(policy, [
      { id: 'far', distance: 100, importance: 1, triangles: 1000, instances: 1 },
      { id: 'near', distance: 2, importance: 5, triangles: 1000, instances: 1 },
      { id: 'hero', distance: 1, importance: 10, triangles: 1000, instances: 1 },
    ]);
    expect(result.visible.map(c => c.id)).toEqual(['hero', 'near']);
    expect(result.omitted.map(c => c.id)).toEqual(['far']);
  });
  it('enforces triangle budget', () => {
    const planner = new StrictRenderFramePlanner({ maxCandidates: 100, maxVisible: 100, triangleBudget: 1500, passBudgetMs: 8, shadowDistance: 100 });
    const result = planner.plan(policy, [
      { id: 'a', distance: 1, importance: 2, triangles: 1000, instances: 1 },
      { id: 'b', distance: 2, importance: 1, triangles: 1000, instances: 1 },
    ]);
    expect(result.visible).toHaveLength(1);
    expect(result.omitted).toHaveLength(1);
  });
  it('selects render passes from policy features', () => {
    const planner = new StrictRenderFramePlanner();
    const result = planner.plan(policy, []);
    expect(result.passes).toContain('depth');
    expect(result.passes).toContain('opaque');
    expect(result.passes).toContain('ui');
  });
  it('is stable for the same input', () => {
    const planner = new StrictRenderFramePlanner();
    const candidates = [
      { id: 'a', distance: 3, importance: 4, triangles: 100, instances: 2 },
      { id: 'b', distance: 4, importance: 4, triangles: 100, instances: 2 },
    ];
    expect(planner.plan(policy, candidates, 10).digest).toBe(
      planner.plan(policy, candidates, 10).digest,
    );
  });
  it('falls back from WebGPU on device loss', () => {
    const runtime = new StrictRenderBackendRuntime(
      probeRenderCapabilities({ secureContext: true, gpuAdapterAvailable: true, webgl2ContextAvailable: true }),
      { backend: 'auto', quality: 'high' },
    );
    expect(runtime.policy().backend).toBe('webgpu');
    runtime.markDeviceLost();
    expect(runtime.policy().backend).toBe('webgl2');
  });
  it('keeps renderer identity independent of entity ids', () => {
    expect(entityId('one')).not.toBe(entityId('two'));
    expect(policy.backend).toBe('webgpu');
  });
});