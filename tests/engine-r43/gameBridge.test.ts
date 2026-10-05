import { describe, expect, it, vi } from 'vitest';
import { createR43GameBridge } from '../../src/engine-ts/r43/gameBridge.ts';

describe('r43 game bridge', () => {
  it('mirrors runtime state into a legacy adapter and renderer adapter', () => {
    const state = new Map<string, unknown>();
    const renderer = {
      setPixelRatio: vi.fn(),
      setQuality: vi.fn(),
    };
    const bridge = createR43GameBridge({
      seed: 42,
      state: { set: (key, value) => state.set(key, value) },
      renderer,
    });

    const init = bridge.initialize();
    expect(init.ok).toBe(true);
    const frame = bridge.frame({
      deltaSeconds: 0.02,
      frameMs: 12,
      cpuMs: 5,
      gpuMs: 4,
      input: { axes: { horizontal: 1, vertical: 0 }, buttons: {} },
    });
    expect(frame.ok).toBe(true);
    expect(state.get('r43Tick')).toBe(1);
    expect(state.get('r43Digest')).toMatch(/^[0-9a-f]{8}$/);
    expect(renderer.setQuality).toHaveBeenCalled();
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(expect.any(Number));
    bridge.dispose();
  });

  it('keeps command flow inside the runtime security boundary', () => {
    const bridge = createR43GameBridge();
    bridge.initialize();
    expect(bridge.command({ type: 'pause', reason: 'test' }).ok).toBe(true);
    expect(bridge.health().score).toBeGreaterThanOrEqual(0);
    bridge.resume();
    bridge.dispose();
  });

  it('produces a deterministic bridge digest for identical frames', () => {
    const a = createR43GameBridge({ seed: 7 });
    const b = createR43GameBridge({ seed: 7 });
    a.initialize();
    b.initialize();
    const input = { axes: { horizontal: 0.5, vertical: 0.25 }, buttons: { attack: true } };
    const ra = a.frame({ deltaSeconds: 0.02, frameMs: 16, cpuMs: 5, gpuMs: 5, input });
    const rb = b.frame({ deltaSeconds: 0.02, frameMs: 16, cpuMs: 5, gpuMs: 5, input });
    expect(ra.value?.digest).toBe(rb.value?.digest);
    a.dispose();
    b.dispose();
  });
});
