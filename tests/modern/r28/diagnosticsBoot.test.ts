import { describe, expect, it } from 'vitest';
import { RuntimeDiagnosticsBridge } from '../../../src/3d/modern/r28/diagnosticsBridge.ts';
import { RuntimeBootCoordinator } from '../../../src/3d/modern/r28/bootCoordinator.ts';
import { BrowserRuntimeHost } from '../../../src/3d/modern/r28/browserHost.ts';

describe('R28 diagnostics and boot coordination', () => {
  it('classifies healthy and degraded runtime evidence', () => {
    const host = new BrowserRuntimeHost();
    const bridge = new RuntimeDiagnosticsBridge();
    const report = bridge.evaluate({
      host: { ...host.state(), lastFrameMs: 12 },
      snapshot: host.runtime.createSnapshot(),
      resources: { count: 0, bytes: 0, byKind: {} },
      telemetry: { incidents: () => [], points: () => [], spans: () => [], histogram: () => ({ count: 0, sum: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 }), summary: () => ({}) } as never,
    });
    expect(report.status).toBe('healthy');
    expect(bridge.toLogLine(report)).toContain('R28 healthy');
    host.dispose();
  });

  it('boots a browser host through explicit lifecycle ownership', async () => {
    const host = new BrowserRuntimeHost();
    const coordinator = new RuntimeBootCoordinator(host, { autoStart: false });
    const result = await coordinator.boot();
    expect(result.success).toBe(true);
    expect(result.state).toBe('mounted');
    await coordinator.shutdown();
  });
});
