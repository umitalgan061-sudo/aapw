import { describe, expect, it } from 'vitest';
import { FrameGraph, GpuResourceLifecycle, RenderQualityGovernor, estimateTextureBytes, estimateBufferBytes, qualityTier } from '../../../src/3d/modern/r40';

const resource = (id: string, bytes: number, transient = false) => ({ id, bytes, transient, format: 'rgba8', width: 1, height: 1, samples: 1, usage: ['sampled'] as const });
const pass = (id: string, optional = false) => ({ id, phase: 'render' as const, reads: ['color'], writes: ['color'], estimatedGpuMs: 2, drawCalls: 10, triangles: 1000, optional });

describe('R40 rendering budget', () => {
  it('registers resources before passes', () => {
    const graph = new FrameGraph();
    expect(graph.registerResource(resource('color', 1024))).toBe(true);
    expect(graph.registerPass(pass('main'))).toBe(true);
  });
  it('rejects passes that reference missing resources', () => {
    const graph = new FrameGraph();
    expect(graph.registerPass(pass('main'))).toBe(false);
  });
  it('compiles a stable plan digest', () => {
    const graph = new FrameGraph();
    graph.registerResource(resource('color', 1024));
    graph.registerPass(pass('main'));
    expect(graph.compile().digest).toBe(graph.compile().digest);
  });
  it('prunes optional passes when budget is exhausted', () => {
    const graph = new FrameGraph({ targetGpuMs: 3 });
    graph.registerResource(resource('color', 1024));
    graph.registerPass(pass('required'));
    graph.registerPass({ ...pass('optional', true), estimatedGpuMs: 50 });
    const plan = graph.compile(3);
    expect(plan.passes.map((p) => p.id)).toEqual(['required']);
  });
  it('retains non-optional pass even above soft gpu cap', () => {
    const graph = new FrameGraph({ targetGpuMs: 1 });
    graph.registerResource(resource('color', 1024));
    graph.registerPass({ ...pass('required'), estimatedGpuMs: 50 });
    expect(graph.compile(1).passes).toHaveLength(1);
  });
  it('prevents removing a resource referenced by a pass', () => {
    const graph = new FrameGraph();
    graph.registerResource(resource('color', 1024));
    graph.registerPass(pass('main'));
    expect(graph.removeResource('color')).toBe(false);
  });
  it('clears transient resources', () => {
    const graph = new FrameGraph();
    graph.registerResource(resource('temp', 1024, true));
    graph.registerResource(resource('persist', 1024, false));
    expect(graph.clearTransient()).toBe(1);
    expect(graph.snapshot().resources.map((r) => r.id)).toEqual(['persist']);
  });
  it('estimates mipmapped texture memory', () => {
    expect(estimateTextureBytes(1024, 1024, 4, true)).toBeGreaterThan(4 * 1024 * 1024);
  });
  it('estimates vertex buffer memory', () => {
    expect(estimateBufferBytes(1000, 32)).toBe(32000);
  });
  it('maps quality tiers consistently', () => {
    expect(qualityTier(0).renderScale).toBeLessThan(qualityTier(4).renderScale);
    expect(qualityTier(4).maxAudioVoices).toBeGreaterThan(qualityTier(0).maxAudioVoices);
  });
  it('downgrades after sustained pressure', () => {
    const governor = new RenderQualityGovernor({ frameMs: 16.67, cpuMs: 9, gpuMs: 14, drawCalls: 12000, triangles: 8000000, memoryBytes: 1000000 }, 4);
    for (let i = 0; i < 8; i += 1) governor.evaluate({ frameMs: 30, cpuMs: 20, gpuMs: 24, drawCalls: 16000, triangles: 10000000, memoryBytes: 1000000 });
    expect(governor.current().tier).toBe(3);
  });
  it('panics down multiple tiers on severe pressure', () => {
    const governor = new RenderQualityGovernor({ frameMs: 16.67, cpuMs: 9, gpuMs: 14, drawCalls: 12000, triangles: 8000000, memoryBytes: 1000000 }, 4);
    expect(governor.evaluate({ frameMs: 100, cpuMs: 100, gpuMs: 100 }).reason).toBe('panic');
    expect(governor.current().tier).toBe(2);
  });
  it('upgrades only after sustained healthy frames', () => {
    const governor = new RenderQualityGovernor({ frameMs: 16.67, cpuMs: 9, gpuMs: 14, drawCalls: 12000, triangles: 8000000, memoryBytes: 1000000 }, 2);
    for (let i = 0; i < 60; i += 1) governor.evaluate({ frameMs: 8, cpuMs: 4, gpuMs: 6 });
    expect(governor.current().tier).toBe(3);
  });
  it('allocates gpu generations monotonically', () => {
    const gpu = new GpuResourceLifecycle('webgpu');
    const first = gpu.acquire('a', 10);
    gpu.release('a');
    const second = gpu.acquire('a', 10);
    expect(second.generation).toBeGreaterThan(first.generation);
  });
  it('evicts oldest gpu resources first', () => {
    const gpu = new GpuResourceLifecycle('webgpu');
    gpu.acquire('a', 100);
    gpu.acquire('b', 100);
    gpu.release('b');
    const evicted = gpu.evictToBudget(50);
    expect(evicted).toEqual(['a']);
  });
});
