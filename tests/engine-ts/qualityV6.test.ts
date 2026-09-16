import { describe, expect, it } from 'vitest';
import { RuntimeQualityInspector } from '../../src/engine-ts/qaRuntime.js';
import { EngineRuntime } from '../../src/engine-ts/engineRuntime.js';

describe('runtime quality inspector', () => {
  it('accepts a healthy engine frame', async () => {
    const engine = new EngineRuntime();
    await engine.boot();
    const report = new RuntimeQualityInspector({}, () => 10).inspect(engine, 'test');
    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(0.8);
    engine.dispose();
  });

  it('flags excessive world size without throwing', async () => {
    const engine = new EngineRuntime({ targetEntityBudget: 128 });
    await engine.boot();
    for (let i = 0; i < 12; i += 1) engine.addEntity(`e-${i}`, { x: i, y: 0, z: 0 });
    const inspector = new RuntimeQualityInspector({ maxEntities: 4 }, () => 20);
    const report = inspector.inspect(engine, 'oversized');
    expect(report.findings.some(finding => finding.id === 'entity-budget')).toBe(true);
    engine.dispose();
  });

  it('keeps the latest report available for operator tooling', async () => {
    const engine = new EngineRuntime();
    await engine.boot();
    const inspector = new RuntimeQualityInspector({}, () => 30);
    const report = inspector.inspect(engine, 'latest');
    expect(inspector.latest()).toEqual(report);
    inspector.clear();
    expect(inspector.latest()).toBeNull();
    engine.dispose();
  });
});
