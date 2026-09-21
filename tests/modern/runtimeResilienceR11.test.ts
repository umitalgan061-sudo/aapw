import { describe, expect, it } from 'vitest';
import { RuntimeHealthCoordinator } from '../../src/3d/modern/nextgen/runtimeHealthCoordinator.ts';
import { RuntimeIntegrityMonitor, RecoverySupervisor, scoreToLevel } from '../../src/3d/types/runtimeIntegrity.ts';

describe('R11 runtime resilience', () => {
  it('maps integrity scores to stable severity levels', () => {
    expect(scoreToLevel(1)).toBe('healthy');
    expect(scoreToLevel(0.84)).toBe('degraded');
    expect(scoreToLevel(0.59)).toBe('critical');
    expect(scoreToLevel(0.29)).toBe('corrupt');
  });

  it('produces a controlled recovery decision for repeated degraded state', () => {
    const monitor = new RuntimeIntegrityMonitor({ criticalThreshold: 0.6, maxConsecutiveFailures: 2 });
    monitor.register({
      id: 'critical-state',
      category: 'state',
      critical: true,
      check: () => ({ healthy: false, score: 0.5, recoverable: true, message: 'state drift' }),
    });
    const supervisor = new RecoverySupervisor({ criticalThreshold: 0.6, maxConsecutiveFailures: 2 });

    return (async () => {
      const report = await monitor.run();
      const first = supervisor.decide(report, 1000);
      const second = supervisor.decide(report, 2000);
      expect(report.level).toBe('critical');
      expect(first.action).toBe('reload-assets');
      expect(second.action).toBe('reload-assets');
    })();
  });

  it('combines kernel and integrity health without mutating inputs', async () => {
    const coordinator = new RuntimeHealthCoordinator(
      () => ({ score: 90, status: 'healthy', reasons: ['nominal'] }),
      { probeDefaults: false },
    );
    coordinator.registerProbe({
      id: 'render',
      category: 'render',
      critical: true,
      check: () => ({ healthy: true, score: 1, recoverable: true }),
    });

    const diagnosis = await coordinator.diagnose(5000);
    expect(diagnosis.overallStatus).toBe('healthy');
    expect(diagnosis.overallScore).toBeGreaterThan(0.8);
    expect(diagnosis.integrity.checked).toBe(1);
    expect(diagnosis.recovery.action).toBe('continue');
    expect(diagnosis.health.reasons).toEqual(['nominal']);
  });
});
