import { describe, expect, it } from 'vitest';
import {
  acceptanceSampleIds,
  createPhotorealismAcceptanceSampleSet,
} from '../../src/3d/world/photorealismAcceptanceSampler.ts';
import type { CanonicalEnvironmentObservation } from '../../src/3d/world/photorealismEnvironmentPass.ts';

const observation: CanonicalEnvironmentObservation = {
  sample: {
    worldX: 120,
    worldZ: -80,
    heightMeters: 240,
    waterLevelMeters: 180,
    slopeDegrees: 18,
    curvature: 0.22,
    moisture: 0.42,
    temperature: 6,
    rockWeight: 0.18,
    snowWeight: 0.04,
    waterDistanceMeters: 36,
    roadDistanceMeters: 42,
    settlementDistanceMeters: 260,
    forestDensity: 0.62,
    windward: 0.35,
    lee: 0.2,
    biomeHint: 'forest',
  },
  renderedHeightMeters: 240.04,
  colliderHeightMeters: 240,
  shorelineGradient: 0.72,
  waterNormalRepeat: 0.24,
  skyLuminance: 0.74,
  visibleGridSeam: false,
  visibleRectangularWater: false,
  visibleSmoothWall: false,
  visibleFlatGround: false,
  visibleSnowSheet: false,
  visibleSparseCanopy: false,
  visibleRoadRibbon: false,
  visibleFloatingAsset: false,
  visibleMaterialMismatch: false,
};

describe('photorealism acceptance sampler', () => {
  it('keeps the same deterministic four-view contract for before/after captures', () => {
    const first = createPhotorealismAcceptanceSampleSet(observation, { seed: 283 });
    const second = createPhotorealismAcceptanceSampleSet(observation, { seed: 283 });

    expect(first).toEqual(second);
    expect(first.cameraContract).toEqual({
      projection: 'orthographic',
      viewport: [1536, 1024],
      sameSeedBeforeAfter: true,
    });
    expect(acceptanceSampleIds(first)).toEqual([
      'full-world',
      'far-center',
      'terrain-near-center',
      'northwest-near',
    ]);
  });

  it('preserves the caller viewport and canonical sample coordinate', () => {
    const result = createPhotorealismAcceptanceSampleSet(observation, {
      seed: 17,
      viewport: [800, 600],
    });

    expect(result.samples[0]?.coordinate).toEqual([120, -80]);
    expect(result.samples.every((sample) => sample.viewport.join('x') === '800x600')).toBe(true);
    expect(result.samples.every((sample) => sample.orthographic)).toBe(true);
  });
});
