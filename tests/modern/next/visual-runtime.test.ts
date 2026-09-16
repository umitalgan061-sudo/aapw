import { describe, expect, it } from 'vitest';
import { AnimationMixerState, locomotionClipId, solveFootPlant } from '../../../src/3d/modern/next/animation.ts';
import { ThirdPersonCameraSolver, orbitDirection } from '../../../src/3d/modern/next/camera.ts';
import { evaluateBudget, RollingBudgetMetrics } from '../../../src/3d/modern/next/metrics.ts';

describe('next visual runtime', () => {
  it('blends animation layers toward their targets', () => {
    const mixer = new AnimationMixerState();
    mixer.registerClip({ id: 'locomotion.idle', durationSeconds: 1, loop: true });
    mixer.registerClip({ id: 'locomotion.run', durationSeconds: 0.8, loop: true });
    mixer.setLayerClip('base', locomotionClipId('run'), 1);
    mixer.setLocomotion('run', 0.8);
    mixer.update(0.2);
    const sample = mixer.sample('base');
    expect(sample.clip?.id).toBe('locomotion.run');
    expect(sample.weight).toBeGreaterThan(0.9);
    expect(sample.normalizedTime).toBeGreaterThan(0);
  });

  it('computes alternating foot-plant weights', () => {
    const first = solveFootPlant(1, 0);
    const second = solveFootPlant(1, 0.5);
    expect(first.left).toBeGreaterThan(second.left);
    expect(second.right).toBeGreaterThan(first.right);
  });

  it('solves a camera target with pitch and distance constraints', () => {
    const camera = new ThirdPersonCameraSolver({ minDistance: 3, maxDistance: 10 });
    const state = camera.update({ position: { x: 0, y: 0, z: 0 }, yawRadians: 0, velocity: { x: 1, y: 0, z: 0 } }, 1 / 60, { zoomDelta: -20, pitchDelta: 1 });
    expect(state.distance).toBeGreaterThanOrEqual(3);
    expect(state.distance).toBeLessThanOrEqual(10);
    expect(state.pitch).toBeLessThanOrEqual(1.15);
    expect(orbitDirection(0, 0).z).toBe(1);
  });

  it('reports performance health and actionable recommendations', () => {
    const health = evaluateBudget({ simulationMs: 8, renderMs: 15, streamingMs: 3, networkMs: 1, workerMs: 4, memoryBytes: 2 * 1024 * 1024 * 1024, targetFrameMs: 16.6 });
    expect(['degraded', 'critical']).toContain(health.status);
    expect(health.recommendations.length).toBeGreaterThan(0);
  });

  it('tracks a rolling metrics window', () => {
    const metrics = new RollingBudgetMetrics(16);
    const health = evaluateBudget({ simulationMs: 2, renderMs: 3, streamingMs: 1, networkMs: 1, workerMs: 1, memoryBytes: 64 * 1024 * 1024, targetFrameMs: 16.6 });
    metrics.add(health);
    metrics.add(health);
    expect(metrics.count()).toBe(2);
    expect(metrics.averageFrameMs()).toBeCloseTo(7);
    expect(metrics.latest()?.status).toBe('healthy');
  });
});
