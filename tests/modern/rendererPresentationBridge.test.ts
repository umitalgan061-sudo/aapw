import { describe, expect, it, vi } from 'vitest';
import { readLegacyRenderMetrics, RendererPresentationBridge } from '../../src/3d/modern/rendererPresentationBridge';

const pressureSnapshot = (quality: 'minimal' | 'balanced' | 'high' | 'ultra', combined: number) => ({
  quality,
  pressure: { cpu: combined, gpu: combined, frame: combined, memory: combined, thermal: combined, combined },
});

describe('RendererPresentationBridge', () => {
  it('reads only renderer counters actually exposed by Three.js', () => {
    expect(readLegacyRenderMetrics({ renderer: { info: { render: { calls: 71, triangles: 90210 }, memory: { textures: 23, geometries: 41 } } } })).toEqual({
      drawCalls: 71,
      triangles: 90210,
      textureCount: 23,
      geometryCount: 41,
    });
    expect(readLegacyRenderMetrics(null)).toEqual({ drawCalls: 0, triangles: 0, textureCount: 0, geometryCount: 0 });
  });

  it('maps quality and pressure to a real renderer pixel ratio', () => {
    const setPixelRatio = vi.fn();
    const renderer = { setPixelRatio, getPixelRatio: () => 1.89, shadowMap: { enabled: true } };
    const bridge = new RendererPresentationBridge({ renderer, devicePixelRatio: () => 2, minFramesBetweenChanges: 4 });

    bridge.apply(pressureSnapshot('high', 0.05));

    expect(setPixelRatio).toHaveBeenCalledTimes(1);
    expect(setPixelRatio.mock.calls[0]?.[0]).toBeCloseTo(1.82, 1);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(bridge.diagnostics().quality).toBe('high');
  });

  it('reduces render cost and shadows under strong sustained pressure', () => {
    const ratios: number[] = [];
    const renderer = {
      setPixelRatio: (value: number) => ratios.push(value),
      getPixelRatio: () => ratios.at(-1) ?? 2.5,
      shadowMap: { enabled: true },
    };
    const bridge = new RendererPresentationBridge({ renderer, devicePixelRatio: () => 2, minFramesBetweenChanges: 1 });

    bridge.apply(pressureSnapshot('high', 0.95));

    expect(renderer.shadowMap.enabled).toBe(false);
    expect(ratios.at(-1)).toBeLessThan(1.82);
    expect(bridge.diagnostics().appliedScale).toBeLessThan(0.91);
  });

  it('keeps a renderer without a shadow baseline disabled', () => {
    const renderer = { setPixelRatio: vi.fn(), getPixelRatio: () => 1, shadowMap: { enabled: false } };
    const bridge = new RendererPresentationBridge({ renderer });
    bridge.apply(pressureSnapshot('ultra', 0.01));
    bridge.apply(pressureSnapshot('high', 0.01));
    expect(renderer.shadowMap.enabled).toBe(false);
  });

  it('prevents presentation oscillation during its cooldown window', () => {
    const bridge = new RendererPresentationBridge({
      renderer: { setPixelRatio: vi.fn(), getPixelRatio: () => 1, shadowMap: { enabled: true } },
      devicePixelRatio: () => 1,
      minFramesBetweenChanges: 18,
    });
    bridge.apply(pressureSnapshot('high', 0.10));
    const first = bridge.diagnostics().changes;

    for (let i = 0; i < 8; i += 1) bridge.apply(pressureSnapshot('high', 0.90));
    expect(bridge.diagnostics().changes).toBe(first);
  });

  it('restores the original shadow policy on dispose', () => {
    const renderer = { setPixelRatio: vi.fn(), getPixelRatio: () => 1, shadowMap: { enabled: true } };
    const bridge = new RendererPresentationBridge({ renderer, minFramesBetweenChanges: 1 });
    bridge.apply(pressureSnapshot('minimal', 0.95));
    expect(renderer.shadowMap.enabled).toBe(false);
    bridge.dispose();
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(bridge.diagnostics().quality).toBeNull();
    expect(bridge.diagnostics().appliedScale).toBe(1);
  });
});
