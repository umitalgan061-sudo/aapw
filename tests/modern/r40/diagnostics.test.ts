import { describe, expect, it } from 'vitest';
import { DiagnosticCollector, tick } from '../../../src/3d/modern/r40';

describe('R40 diagnostics', () => {
  it('records bounded diagnostic data', () => {
    const diagnostics = new DiagnosticCollector(16);
    const record = diagnostics.record('render', 'render', true, 2.5, tick(4), { backend: 'webgpu' });
    expect(record.ok).toBe(true);
    expect(record.digest).toHaveLength(16);
  });
  it('keeps a bounded history', () => {
    const diagnostics = new DiagnosticCollector(16);
    for (let i = 0; i < 40; i += 1) diagnostics.record('engine', 'simulation', true, i, tick(i));
    expect(diagnostics.latest(100)).toHaveLength(16);
  });
  it('summarizes failed records', () => {
    const diagnostics = new DiagnosticCollector();
    diagnostics.record('network', 'network', false, 1, tick(2), { severity: 'error' });
    diagnostics.record('audio', 'audio', false, 1, tick(2), { severity: 'warning' });
    const summary = diagnostics.summary();
    expect(summary.ok).toBe(false);
    expect(summary.errors).toBe(2);
    expect(summary.warnings).toBe(1);
  });
  it('emits stable summary digests', () => {
    const left = new DiagnosticCollector();
    const right = new DiagnosticCollector();
    left.record('x', 'input', true, 1, tick(1));
    right.record('x', 'input', true, 1, tick(1));
    expect(left.summary().digest).toBe(right.summary().digest);
  });
  it('imports runtime health signals', () => {
    const diagnostics = new DiagnosticCollector();
    const records = diagnostics.fromHealth({
      generatedAt: 0 as never,
      tick: tick(5),
      digest: 'x',
      signals: [{ subsystem: 'runtime', ok: false, severity: 'error', code: 'R', message: 'failed', tick: tick(5) }],
      quality: { tier: 3, renderScale: 0.9, shadows: true, foliageDensity: 0.75, postFx: 0.8, maxAudioVoices: 64 },
      queueDepth: 0,
      residentAssets: 0,
      activeEntities: 0,
    });
    expect(records[0]?.details.code).toBe('R');
  });
  it('clears records', () => {
    const diagnostics = new DiagnosticCollector();
    diagnostics.record('x', 'telemetry', true, 0, tick(1));
    diagnostics.clear();
    expect(diagnostics.latest()).toHaveLength(0);
  });
});
