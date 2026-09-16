import { describe, expect, it } from 'vitest';
import { QUALITY_TIERS, clampQualityScale, createPlatformConfig, tierForDevice } from '../../src/3d/modern/v5/config.ts';
import { AnimationGraphV5, clip, state, when } from '../../src/3d/modern/v5/animationGraph.ts';
import { UtilityAiV5 } from '../../src/3d/modern/v5/ai.ts';
import { EcsWorldV5 } from '../../src/3d/modern/v5/ecs.ts';
import { SpatialIndexV5, WorldQueryV5 } from '../../src/3d/modern/v5/worldQuery.ts';
import { migrationSummary } from '../../src/3d/modern/v5/migrationManifest.ts';

describe('modern-v5 quality contracts', () => {
  it('selects conservative quality for constrained devices', () => {
    expect(tierForDevice(4, 1, true).id).toBe('mobile');
    expect(createPlatformConfig({ hardwareConcurrency: 16, devicePixelRatio: 1, touch: false }).quality.id).toBe('ultra');
    expect(QUALITY_TIERS).toHaveLength(5);
    expect(clampQualityScale(3)).toBe(1);
    expect(clampQualityScale(0.1)).toBe(0.5);
  });

  it('transitions animation states deterministically', () => {
    const graph = new AnimationGraphV5({
      layers: {
        locomotion: [state('idle', clip('idle', 1)), state('run', clip('run', 0.8))],
        upperBody: [state('empty', clip('empty', 1))],
        additive: [state('none', clip('none', 1))],
        facial: [state('neutral', clip('neutral', 1))],
      },
      transitions: [{ from: 'idle', to: 'run', durationSeconds: 0.1, exitTime: 0, priority: 1, conditions: [when('moving', true)] }],
    });
    graph.update(0.016, { moving: true });
    expect(graph.state('locomotion')?.state).toBe('run');
    expect(graph.component().locomotion).toBe('run');
  });

  it('produces a bounded AI decision with no target memory requirement', () => {
    const world = new EcsWorldV5();
    const index = new SpatialIndexV5();
    const query = new WorldQueryV5(world, index, () => ({ height: 0, normal: { x: 0, y: 1, z: 0 }, material: 'plain' }));
    const ai = new UtilityAiV5(world, query);
    const id = world.spawnWithDefaults(['transform', 'health', 'stamina', 'ai']);
    const decision = ai.decide({ self: id, position: { x: 0, y: 0, z: 0 }, health: 1, stamina: 1, target: null, targetDistance: Number.POSITIVE_INFINITY, targetVisible: false, alertness: 0, memory: [] });
    expect(decision.scores.length).toBeGreaterThan(4);
    expect(decision.target).toBeNull();
  });

  it('keeps migration inventory explicit and measurable', () => {
    const summary = migrationSummary();
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.bridge).toBeGreaterThan(0);
    expect(summary.legacy).toBeGreaterThan(0);
    expect(summary.completion).toBeGreaterThanOrEqual(0);
    expect(summary.completion).toBeLessThanOrEqual(1);
  });
});
