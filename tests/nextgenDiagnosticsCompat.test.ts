import { describe, expect, it } from 'vitest';
import { DiagnosticsEngine, classifySeverity, pressureRatio } from '../src/engine-ts/nextgen/diagnostics.ts';
import { LegacyBridge } from '../src/engine-ts/nextgen/compat.ts';
import { createRuntime } from '../src/engine-ts/nextgen/runtime.ts';
import { asEntityId } from '../src/engine-ts/nextgen/contracts.ts';

describe('nextgen diagnostics', () => {
  it('detects sustained frame and memory pressure', () => {
    const diagnostics = new DiagnosticsEngine(60);
    for (let frame = 0; frame < 30; frame += 1) diagnostics.record({ frame, tick: frame, cpuMs: 24, simulationMs: 8, renderMs: 10, streamingMs: 3, networkMs: 2, memoryBytes: 950, entities: 101 });
    const report = diagnostics.report(null, { frameMs: 16, simulationMs: 6, renderMs: 8, streamingMs: 2, networkMs: 1 }, { memoryBytes: 1000, entities: 100 });
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.p95CpuMs).toBe(24);
    expect(report.checksum).toMatch(/^[0-9a-f]+$/);
  });

  it('exposes stable pressure helpers', () => {
    expect(pressureRatio(8, 4)).toBe(2);
    expect(classifySeverity(95)).toBe('info');
    expect(classifySeverity(20)).toBe('fatal');
  });
});

describe('legacy bridge', () => {
  it('maps legacy buttons and transforms into typed runtime inputs', () => {
    const runtime = createRuntime('low', 'offline', 11);
    const bridge = new LegacyBridge(runtime);
    const handle = bridge.registerLegacyEntity({ id: '101', position: { x: 1, y: 2, z: 3 }, rotationY: 1.2 });
    expect(handle.id).toBe(asEntityId(101));
    const transform = bridge.migrateTransform({ id: '101', position: { x: 4, y: 5, z: 6 }, rotationY: 0.5 });
    expect(transform.position).toEqual({ x: 4, y: 5, z: 6 });
    const input = bridge.mapInput({ moveX: 2, buttons: ['space', 'attack', 'unknown'] });
    expect(input.moveX).toBe(1);
    expect(input.pressed).toContain('jump');
    expect(input.pressed).toContain('lightAttack');
    expect(bridge.warnings()).toBe(1);
    runtime.stop();
  });
});
