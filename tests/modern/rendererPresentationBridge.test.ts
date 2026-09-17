import { describe, expect, it, vi } from 'vitest';
import { readLegacyRenderMetrics, RendererPresentationBridge } from '../../src/3d/modern/rendererPresentationBridge';

const snapshot = (quality: 'minimal' | 'balanced' | 'high' | 'ultra', combined: number) => ({
  quality,
  pressure: { cpu: combined, gpu: combined, frame: combined, memory: combined, thermal: combined, combined },
});

describe('RendererPresentationBridge', () => {
  it('reads real renderer counters without inventing byte estimates', () => {
    expect(readLegacyRenderMetrics({ renderer: { info: { render: { calls: 71, triangles: 90210 }, memory: { textures: 23, geometries: 41 } } } })).toEqual({
      drawCalls: 71, triangles: 90210, textureCount: 23, geometryCount: 41,
    });
    expect(readLegacyRenderMetrics(null)).toEqual({ drawCalls: 0, triangles: 0, textureCount: 0, geometryCount: 0 });
  });

  it('applies the quality scale to the real renderer', () => {
    const setPixelRatio = vi.fn();
    const renderer = { setPixelRatio, getPixelRatio: () => 1.82, shadowMap: { enabled: true } };
    const bridge = new RendererPresentationBridge({ renderer, devicePixelRatio: () => 2, minFramesBetweenChanges: 4 });

    bridge.apply(snapshot('high', 0.05));

    expect(setPixelRatio).toHaveBeenCalledTimes(1);
    expect(setPixelRatio.mock.calls[0]?.[0]).toBeCloseTo(1.82, 2);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(bridge.diagnostics().quality).toBe('high');
  });

  it('backs off both pixel cost and shadows under sustained pressure', () => {
    const ratios: number[] = [];
    const renderer = { setPixelRatio: (value: number) => ratios.push(value), getPixelRatio: () => ratios.at(-1) ?? 2.5, shadowMap: { enabled: true } };
    const bridge = new RendererPresentationBridge({ renderer, devicePixelRatio: () => 2, minFramesBetweenChanges: 1 });

    bridge.apply(snapshot('high', 0.95));
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(ratios.at(-1)).toBeLessThan(1.82);
    expect(bridge.diagnostics().appliedScale).toBeLessThan(0.91);
  });

  it('does not re-enable shadows on a renderer that started without them', () => {
    const renderer = { setPixelRatio: vi.fn(), getPixelRatio: () => 1, shadowMap: { enabled: false } };
    const bridge = new RendererPresentationBridge({ renderer });
    bridge.apply(snapshot('ultra', 0.01));
    bridge.apply(snapshot('high', 0.01));
    expect(renderer.shadowMap.enabled).toBe(false);
  });

  it('keeps quality changes sticky instead of oscillating every frame', () => {
    const bridge = new RendererPresentationBridge({ renderer: { setPixelRatio: vi.fn(), getPixelRatio: () => 1, shadowMap: { enabled: true } }, devicePixelRatio: () => 1, minFramesBetweenChanges: 18 });
    bridge.apply(snapshot('high', 0.10));
    const first = bridge.diagnostics().changes;

    for (let i = 0; i < 8; i += 1) bridge.apply(snapshot('high', 0.90));
    expect(bridge.diagnostics().changes).toBe(first);
  });

  it('restores the original shadow policy on dispose', () => {
    const renderer = { setPixelRatio: vi.fn(), getPixelRatio: () => 1, shadowMap: { enabled: true } };
    const bridge = new RendererPresentationBridge({ renderer, minFramesBetweenChanges: 1 });
    bridge.apply(snapshot('minimal', 0.95));
    expect(renderer.shadowMap.enabled).toBe(false);
    bridge.dispose();
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(bridge.diagnostics().quality).toBeNull();
  });
});
