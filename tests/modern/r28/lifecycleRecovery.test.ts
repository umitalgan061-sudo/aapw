import { describe, expect, it } from 'vitest';
import { RuntimeLifecycleController } from '../../../src/3d/modern/r28/lifecycle.ts';
import { RuntimeRecoveryController } from '../../../src/3d/modern/r28/errorRecovery.ts';

describe('R28 lifecycle and recovery', () => {
  it('mounts, starts, pauses, resumes and disposes deterministically', async () => {
    const calls: string[] = [];
    const lifecycle = new RuntimeLifecycleController();
    lifecycle.register({
      id: 'alpha',
      mount: () => calls.push('mount'),
      start: () => calls.push('start'),
      pause: () => calls.push('pause'),
      resume: () => calls.push('resume'),
      stop: () => calls.push('stop'),
      dispose: () => calls.push('dispose'),
    });

    await lifecycle.mount();
    lifecycle.start();
    lifecycle.pause();
    lifecycle.resume();
    await lifecycle.stop();
    await lifecycle.dispose();

    expect(lifecycle.state).toBe('disposed');
    expect(calls).toContain('mount');
    expect(calls).toContain('dispose');
  });

  it('runs the highest-priority eligible recovery action', async () => {
    const recovery = new RuntimeRecoveryController();
    recovery.registerFailure();
    const calls: string[] = [];
    const report = await recovery.recover([
      { id: 'low', priority: 1, maxAttempts: 2, cooldownTicks: 0, execute: () => { calls.push('low'); return true; } },
      { id: 'high', priority: 10, maxAttempts: 2, cooldownTicks: 0, execute: () => { calls.push('high'); return true; } },
    ], 10);

    expect(report.success).toBe(true);
    expect(report.action).toBe('high');
    expect(calls).toEqual(['high']);
    expect(recovery.state()).toBe('healthy');
  });

  it('does not retry an exhausted action indefinitely', async () => {
    const recovery = new RuntimeRecoveryController();
    const action = { id: 'broken', priority: 2, maxAttempts: 1, cooldownTicks: 0, execute: () => false };
    const first = await recovery.recover([action], 1);
    expect(first.success).toBe(false);
    const second = await recovery.recover([action], 2);
    expect(second.state).toBe('failed');
  });
});
