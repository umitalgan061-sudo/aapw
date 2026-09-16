import { describe, expect, it } from 'vitest';
import { RuntimeControlPlane } from '../../src/engine-ts/runtimeControlPlane.js';
import { PerformanceRuntime } from '../../src/engine-ts/performanceRuntime.js';
import { ReleaseRuntime } from '../../src/engine-ts/releaseRuntime.js';
import { RecoveryRuntime } from '../../src/engine-ts/recoveryRuntime.js';
import { SecurityRuntime } from '../../src/engine-ts/securityRuntime.js';
import { TelemetryRuntime } from '../../src/engine-ts/telemetryRuntime.js';
import { ENTITY_ID } from '../../src/engine-ts/coreTypes.js';

describe('engine-ts control plane', () => {
  it('changes quality deterministically through an operator command', async () => {
    const plane = new RuntimeControlPlane();
    expect(await plane.execute({ id: '1', command: 'set-quality', payload: 'low', issuedAt: 0, operator: 'test' })).toMatchObject({ accepted: true });
    expect(plane.performance.tier).toBe('low');
    expect(plane.engine.render.quality).toBe('low');
    plane.dispose();
  });

  it('runs a coordinated recovery across registered domains', async () => {
    const plane = new RuntimeControlPlane();
    expect(await plane.boot()).toBe(true);
    const result = await plane.execute({ id: '2', command: 'recover', payload: 'test-fault', issuedAt: 0, operator: 'test' });
    expect(result.accepted).toBe(true);
    expect(plane.snapshot().recovery.attempts).toBe(1);
    plane.dispose();
  });

  it('rejects unsafe operator payloads', async () => {
    const plane = new RuntimeControlPlane();
    let nested: unknown = { ok: true };
    for (let i = 0; i < 30; i += 1) nested = { nested };
    const result = await plane.execute({ id: '3', command: 'security-check', payload: nested, issuedAt: 0, operator: 'test' });
    expect(result.accepted).toBe(false);
    plane.dispose();
  });
});

describe('performance and release', () => {
  it('downgrades after sustained pressure and can recover through headroom', () => {
    const perf = new PerformanceRuntime({}, 'high');
    const overload = { frameMs: 40, cpuMs: 30, gpuMs: 30, drawCalls: 2000, triangles: 3_000_000, memoryBytes: 900_000_000 };
    expect(perf.sample(overload).tier).toBe('high');
    expect(perf.sample(overload).downgraded).toBe(false);
    expect(perf.sample(overload).downgraded).toBe(true);
    expect(perf.tier).toBe('medium');
  });

  it('blocks releases when mandatory gates fail', () => {
    const release = new ReleaseRuntime({}, () => 10);
    const report = release.evaluate('test-build', { typecheck: true, tests: false, build: true, deterministic: true, errorRate: 0, p95FrameMs: 10, memoryRatio: 0.5, unhandledExceptions: 0, legacySurfaces: 0 });
    expect(report.passed).toBe(false);
    expect(report.summary.blockingFailures).toBeGreaterThan(0);
  });

  it('passes a clean production release', () => {
    const release = new ReleaseRuntime({}, () => 10);
    const report = release.evaluate('test-build', { typecheck: true, tests: true, build: true, deterministic: true, errorRate: 0, p95FrameMs: 10, memoryRatio: 0.5, unhandledExceptions: 0, legacySurfaces: 0 });
    expect(report.passed).toBe(true);
    expect(report.score).toBe(1);
  });
});

describe('telemetry', () => {
  it('calculates a stable aggregate and health score', () => {
    const telemetry = new TelemetryRuntime();
    for (let i = 0; i < 20; i += 1) telemetry.sample({ name: 'runtime.frame.ms', value: 10 + i % 3, unit: 'ms', tick: i, frame: i, tags: {} });
    telemetry.sample({ name: 'runtime.errors', value: 0, unit: 'count', tick: 20, frame: 20, tags: {} });
    expect(telemetry.aggregate('runtime.frame.ms').count).toBe(20);
    expect(telemetry.health().score).toBeGreaterThan(0.7);
  });
});

describe('security', () => {
  it('allows normal payloads and blocks credentials', () => {
    const security = new SecurityRuntime();
    expect(security.validate({ actor: String(ENTITY_ID('player')), state: 'running' }).ok).toBe(true);
    expect(security.checkUrl('https://user:pass@example.com/data', 'network').decision).toBe('deny');
  });
});

describe('recovery', () => {
  it('orders domains by priority and records failures', () => {
    const now = (() => { let value = 0; return () => value += 1; })();
    const recovery = new RecoveryRuntime(now);
    const calls: string[] = [];
    recovery.register({ id: 'late', priority: 20, diagnose: () => true, quiesce: () => calls.push('late:q'), reset: () => calls.push('late:r'), restore: () => calls.push('late:s'), resume: () => calls.push('late:x') });
    recovery.register({ id: 'early', priority: 10, diagnose: () => true, quiesce: () => calls.push('early:q'), reset: () => calls.push('early:r'), restore: () => calls.push('early:s'), resume: () => calls.push('early:x') });
    const attempt = recovery.recover('test');
    expect(attempt.phase).toBe('idle');
    expect(attempt.domains).toEqual(['early', 'late']);
    expect(calls[0]).toBe('early:q');
  });
});
