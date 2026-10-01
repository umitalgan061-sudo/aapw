import { describe, expect, it } from 'vitest';
import { R35AssetOrchestrator, R35InputPipeline, encodeInputButtons } from '../../src/3d/nextgen/r35';

describe('R35 asset and input systems', () => {
  it('resolves asset dependencies before the consumer is ready', async () => {
    const assets = new R35AssetOrchestrator({
      maxBytes: 100,
      maxConcurrent: 2,
      retryLimit: 2,
    });
    assets.declare({ key: 'mesh', uri: 'mesh.glb', byteSize: 60, dependencies: ['material'] });
    assets.declare({ key: 'material', uri: 'material.bin', byteSize: 30, priority: 'high' });
    assets.enqueue('mesh');
    await assets.pump(1, async (node) => ({
      key: node.key,
      bytes: node.byteSize,
      ok: true,
      error: null,
    }));
    expect(assets.dependencyReady('mesh')).toBe(true);
    expect(assets.stats().ready).toBe(2);
  });

  it('evicts least recently used unreferenced assets when over budget', async () => {
    const assets = new R35AssetOrchestrator({
      maxBytes: 100,
      maxConcurrent: 4,
    });
    assets.declare({ key: 'a', uri: 'a', byteSize: 60, priority: 'low', tick: 1 });
    assets.declare({ key: 'b', uri: 'b', byteSize: 60, priority: 'normal', tick: 2 });
    assets.enqueue('a');
    assets.enqueue('b');
    await assets.pump(3, async (node) => ({ key: node.key, bytes: node.byteSize, ok: true, error: null }));
    expect(assets.stats().residentBytes).toBeLessThanOrEqual(100);
    expect(assets.stats().evictions).toBeGreaterThan(0);
  });

  it('normalizes mixed keyboard and mouse input', () => {
    const input = new R35InputPipeline();
    input.enqueue({ device: 'keyboard', code: 'KeyD', pressed: true, timestampMs: 1 });
    input.enqueue({ device: 'mouse', code: 'Mouse0', pressed: true, timestampMs: 2 });
    const frame = input.toRuntimeFrame(1, 'mixed');
    expect(frame.moveX).toBeGreaterThan(0);
    expect(frame.pressed).toContain('attack');
    expect(encodeInputButtons(['attack', 'jump']) & (1 << 4)).toBeTruthy();
  });

  it('handles touch/gamepad values through deadzone normalization', () => {
    const input = new R35InputPipeline();
    input.enqueue({ device: 'gamepad', code: 'MoveX', value: 0.05, timestampMs: 1 });
    input.enqueue({ device: 'gamepad', code: 'MoveY', value: 0.95, timestampMs: 2 });
    const frame = input.normalize(2);
    expect(frame.moveX).toBeGreaterThanOrEqual(0);
    expect(frame.moveY).toBeLessThanOrEqual(1);
  });
});
