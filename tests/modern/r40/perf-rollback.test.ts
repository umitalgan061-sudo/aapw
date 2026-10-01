import { describe, expect, it } from 'vitest';
import { PerformanceGovernor, frameBudgetFromFps, RollbackRing, tick, commandId } from '../../../src/3d/modern/r40';

describe('R40 performance and rollback', () => {
  it('computes a frame budget from target fps', () => {
    expect(frameBudgetFromFps(60)).toBeCloseTo(16.6667, 3);
  });
  it('records pressure and exposes fps', () => {
    const governor = new PerformanceGovernor({ sampleWindow: 4 });
    for (let i = 0; i < 4; i += 1) governor.record({ frameMs: 10, cpuMs: 5, gpuMs: 6, drawCalls: 100, triangles: 1000, memoryBytes: 1000 });
    expect(governor.state().fps).toBeGreaterThan(90);
    expect(governor.state().pressure).toBeLessThan(1);
  });
  it('lowers quality ceiling after sustained pressure', () => {
    const governor = new PerformanceGovernor({ sampleWindow: 8, sustainedFrames: 3 });
    for (let i = 0; i < 4; i += 1) governor.record({ frameMs: 30, cpuMs: 20, gpuMs: 25, drawCalls: 20000, triangles: 10000000, memoryBytes: 1000000000 });
    expect(governor.state(4).qualityCeiling).toBe(3);
  });
  it('resets performance history', () => {
    const governor = new PerformanceGovernor({ sampleWindow: 4 });
    governor.record({ frameMs: 30, cpuMs: 20, gpuMs: 25, drawCalls: 20000, triangles: 10000000, memoryBytes: 1000000000 });
    governor.reset();
    expect(governor.state().sampleCount).toBe(0);
  });
  it('stores bounded rollback snapshots', () => {
    const ring = new RollbackRing<{ x: number }>({ capacity: 2 });
    ring.push(tick(1), { x: 1 }, []);
    ring.push(tick(2), { x: 2 }, []);
    ring.push(tick(3), { x: 3 }, []);
    expect(ring.latest()?.snapshot.state).toEqual({ x: 3 });
    expect(ring.range(tick(1), tick(3))).toHaveLength(2);
  });
  it('finds nearest prior rollback frame', () => {
    const ring = new RollbackRing<{ x: number }>();
    ring.push(tick(10), { x: 10 }, []);
    ring.push(tick(20), { x: 20 }, []);
    expect(ring.nearest(tick(17))?.snapshot.state.x).toBe(10);
  });
  it('removes post-correction history', () => {
    const ring = new RollbackRing<{ x: number }>();
    ring.push(tick(1), { x: 1 }, []);
    ring.push(tick(2), { x: 2 }, []);
    expect(ring.removeAfter(tick(1))).toBe(1);
    expect(ring.latest()?.snapshot.state.x).toBe(1);
  });
  it('changes digest when rollback contents change', () => {
    const a = new RollbackRing<{ x: number }>(); const b = new RollbackRing<{ x: number }>();
    a.push(tick(1), { x: 1 }, [String(commandId('a'))]);
    b.push(tick(1), { x: 2 }, [String(commandId('a'))]);
    expect(a.digest()).not.toBe(b.digest());
  });
  it('does not allocate beyond configured history', () => {
    const ring = new RollbackRing<{ x: number }>({ capacity: 4 });
    for (let i = 0; i < 20; i += 1) ring.push(tick(i), { x: i }, []);
    expect(ring.range(tick(0), tick(100))).toHaveLength(4);
  });
});
