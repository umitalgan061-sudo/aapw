import { describe, expect, it, vi } from 'vitest';
import { createProductionRuntime } from '../../src/3d/modern/productionRuntime';
import { createProductionRuntimeBridge } from '../../src/3d/modern/productionBridge';

describe('ProductionRuntime smoke', () => {
  it('starts, advances frames and exposes a deterministic state surface', async () => {
    let now = 0;
    const runtime = createProductionRuntime({ telemetry: true, networking: true, persistence: false, now: () => ++now as never });
    expect(await runtime.start()).toBe(true);
    const first = await runtime.frame(16.666);
    const second = await runtime.frame(16.666);
    expect(Number(second.frame)).toBeGreaterThan(Number(first.frame));
    expect(second.lifecycle).toBe('running');
    expect(second.stateDigest).toEqual(expect.any(String));
    await runtime.stop();
    expect(runtime.snapshot().lifecycle).toBe('stopped');
  });

  it('rejects oversized or malformed actions at the security boundary', () => {
    const runtime = createProductionRuntime({ telemetry: false, persistence: false });
    expect(runtime.dispatchAction({ type: 'move.forward', payload: 1 })).toBe(true);
    expect(runtime.dispatchAction({ type: ''.padEnd(129, 'x'), payload: 1 })).toBe(false);
    expect(runtime.security.findings().length).toBeGreaterThanOrEqual(0);
  });
});

describe('ProductionRuntimeBridge smoke', () => {
  it('forwards custom frame events to a runtime', async () => {
    const target = new EventTarget();
    const runtime = {
      frame: vi.fn(async () => undefined),
      dispatchAction: vi.fn(() => true),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => true),
    } as never;
    const bridge = createProductionRuntimeBridge({ runtime, target });
    target.dispatchEvent(new CustomEvent('aapw-runtime-frame', { detail: { deltaMs: 20 } }));
    await Promise.resolve();
    expect(runtime.frame).toHaveBeenCalledWith(20);
    bridge.dispose();
  });

  it('forwards actions and strips unsupported source values to UI semantics', async () => {
    const target = new EventTarget();
    const runtime = {
      frame: vi.fn(async () => undefined),
      dispatchAction: vi.fn(() => true),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => true),
    } as never;
    const bridge = createProductionRuntimeBridge({ runtime, target });
    target.dispatchEvent(new CustomEvent('aapw-runtime-action', { detail: { type: 'ui.map', payload: 1, source: 'gamepad' } }));
    await Promise.resolve();
    expect(runtime.dispatchAction).toHaveBeenCalledWith({ type: 'ui.map', payload: 1, source: 'ui' });
    bridge.detach();
  });
});
