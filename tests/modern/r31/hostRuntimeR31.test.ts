import { describe, expect, it } from 'vitest';
import { RuntimeHostR31 } from '../../../src/3d/strict/r31/runtimeHostR31.ts';
import { evaluateRuntimeAcceptanceR31 } from '../../../src/3d/strict/r31/runtimeAcceptanceR31.ts';
import { createCriticalRuntimePluginR31 } from '../../../src/3d/strict/r31/runtimeHostR31.ts';

describe('R31 runtime host', () => {
  it('starts, runs plugins and records health samples', async () => {
    let now = 0;
    const host = new RuntimeHostR31({}, { nowMs: () => now });
    let updates = 0;
    host.register(createCriticalRuntimePluginR31('test', 'simulation', () => { updates++; }));
    await host.start();
    now = 20;
    await host.frame(now);
    expect(updates).toBeGreaterThan(0);
    expect(host.diagnostics().started).toBe(true);
    expect(host.diagnostics().kernel.health.samples).toBeGreaterThan(0);
    await host.stop();
  });

  it('contains repeated plugin failures instead of crashing the host', async () => {
    const host = new RuntimeHostR31();
    let attempts = 0;
    host.register(createCriticalRuntimePluginR31('unstable', 'gameplay', () => {
      attempts++;
      throw new Error('boom');
    }), 2, 10);
    await host.start();
    for (let i = 0; i < 5; i++) await host.frame(i * 20 + 20);
    const state = host.diagnostics().failures.find((item) => item.id === 'unstable');
    expect(attempts).toBeGreaterThan(0);
    expect(state?.failures).toBeGreaterThanOrEqual(2);
    await host.stop();
  });

  it('evaluates the host lifecycle through the acceptance contract', async () => {
    const host = new RuntimeHostR31();
    await host.start();
    const report = evaluateRuntimeAcceptanceR31(host.diagnostics(), { requireHealthy: false });
    expect(report.checks.find((check) => check.id === 'lifecycle')?.ok).toBe(true);
    await host.stop();
  });
});
