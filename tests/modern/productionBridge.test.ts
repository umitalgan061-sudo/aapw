import { describe, expect, it, vi } from 'vitest';
import { ProductionRuntimeBridge, dispatchRuntimeAction, dispatchRuntimeFrame } from '../../src/3d/modern/productionBridge';

function runtimeStub() {
  return {
    frame: vi.fn(async () => ({ lifecycle: 'running' })),
    dispatchAction: vi.fn(() => true),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => true),
  } as never;
}

describe('ProductionRuntimeBridge', () => {
  it('attaches frame and action listeners', async () => {
    const target = new EventTarget();
    const runtime = runtimeStub();
    const bridge = new ProductionRuntimeBridge({ runtime, target });
    bridge.attach();
    dispatchRuntimeFrame(target, 16.7);
    dispatchRuntimeAction(target, 'move.forward', 1, 'keyboard');
    await Promise.resolve();
    expect(runtime.frame).toHaveBeenCalledTimes(1);
    expect(runtime.frame).toHaveBeenCalledWith(16.7);
    expect(runtime.dispatchAction).toHaveBeenCalledWith({ type: 'move.forward', payload: 1, source: 'ui' });
    expect(bridge.attached).toBe(true);
  });

  it('maps pause and resume events to runtime lifecycle', async () => {
    const target = new EventTarget();
    const runtime = runtimeStub();
    const bridge = new ProductionRuntimeBridge({ runtime, target });
    bridge.attach();
    target.dispatchEvent(new Event('aapw-runtime-pause'));
    target.dispatchEvent(new Event('aapw-runtime-resume'));
    await Promise.resolve();
    expect(runtime.pause).toHaveBeenCalledWith('bridge');
    expect(runtime.resume).toHaveBeenCalledWith('bridge');
  });

  it('detaches every listener and becomes idempotent', async () => {
    const target = new EventTarget();
    const runtime = runtimeStub();
    const bridge = new ProductionRuntimeBridge({ runtime, target });
    bridge.attach();
    bridge.attach();
    bridge.detach();
    dispatchRuntimeFrame(target, 16);
    await Promise.resolve();
    expect(runtime.frame).not.toHaveBeenCalled();
    expect(bridge.attached).toBe(false);
  });

  it('auto-attaches from the factory', () => {
    const target = new EventTarget();
    const runtime = runtimeStub();
    const bridge = new ProductionRuntimeBridge({ runtime, target });
    expect(bridge.attached).toBe(false);
  });
});
