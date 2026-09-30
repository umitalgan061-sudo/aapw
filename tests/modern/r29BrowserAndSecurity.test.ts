import { describe, expect, it } from 'vitest';
import { R29SecurityBoundary } from '../../src/3d/modern/r29/security.ts';
import { R29Runtime } from '../../src/3d/modern/r29/runtime.ts';
import { R29BrowserBridge } from '../../src/3d/modern/r29/browserBridge.ts';

describe('R29 browser and security boundaries', () => {
  it('clamps hostile input without accepting out-of-window ticks', () => {
    const security = new R29SecurityBoundary({ maxLookDelta: 45 });
    const accepted = security.validateInput({
      tick: 0,
      sequence: 1,
      moveX: 9,
      moveY: -9,
      lookX: 500,
      lookY: -500,
    }, 0);
    expect(accepted.ok).toBe(true);
    expect(accepted.sanitized).toBe(true);
    expect(accepted.value?.moveX).toBe(1);
    expect(accepted.value?.lookX).toBe(45);
    expect(security.validateInput({ tick: 999, sequence: 2, moveX: 0, moveY: 0, lookX: 0, lookY: 0 }, 0).ok).toBe(false);
  });

  it('rejects stale snapshots and strips control characters from text', () => {
    const security = new R29SecurityBoundary({ maxSnapshotAgeTicks: 5 });
    expect(security.validateSnapshotAge(20, 10).ok).toBe(false);
    const clean = security.sanitizeText('  hello\u0000 world  ');
    expect(clean.ok).toBe(true);
    expect(clean.value).toBe('hello world');
    expect(clean.sanitized).toBe(true);
  });

  it('can construct the browser bridge in a non-browser test host without starting a frame loop', () => {
    const bridge = new R29BrowserBridge({ backend: 'headless' });
    expect(bridge.snapshot().runtimeVersion).toBe('r29');
    bridge.dispose();
  });

  it('accepts a complete input frame through the runtime facade', async () => {
    const runtime = new R29Runtime({ backend: 'headless' });
    expect(runtime.enqueueInput({
      tick: 0,
      sequence: 1,
      moveX: 0.25,
      moveY: 0.5,
      lookX: 1,
      lookY: 2,
      jump: true,
      sprint: true,
      primary: false,
      secondary: false,
      interact: false,
      pause: false,
    })).toBe(true);
    await runtime.frame(1 / 60);
    expect(runtime.snapshot().tick).toBe(1);
    runtime.dispose();
  });
});
