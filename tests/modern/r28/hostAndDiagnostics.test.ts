import { describe, expect, it } from 'vitest';
import { BrowserRuntimeHost } from '../../../src/3d/modern/r28/browserHost.ts';
import { RuntimeDiagnosticsPanel } from '../../../src/3d/modern/r28/diagnosticsPanel.ts';
import { R27Runtime } from '../../../src/3d/modern/r27/runtime.ts';

describe('R28 browser host boundaries', () => {
  it('constructs a host with an engine-agnostic runtime', () => {
    const host = new BrowserRuntimeHost({ qualityLevel: 2, maxFrameDeltaSeconds: 0.1 });
    expect(host.runtime).toBeInstanceOf(R27Runtime);
    expect(host.maxFrameDeltaSeconds).toBe(0.1);
    expect(host.state().running).toBe(false);
    host.dispose();
  });

  it('steps a host in a non-running environment', () => {
    const host = new BrowserRuntimeHost({ tickRate: 60 });
    const state = host.step(1 / 60);
    expect(state.frameCount).toBe(1);
    expect(state.tick).toBeGreaterThanOrEqual(0);
    host.dispose();
  });

  it('keeps diagnostics panel DOM creation behind an explicit document check', () => {
    expect(() => {
      if (typeof document === 'undefined') return;
      const container = document.createElement('div');
      const panel = new RuntimeDiagnosticsPanel(container);
      panel.update({ title: 'test', values: { fps: 60, ok: true } }, performance.now());
      panel.dispose();
    }).not.toThrow();
  });
});
