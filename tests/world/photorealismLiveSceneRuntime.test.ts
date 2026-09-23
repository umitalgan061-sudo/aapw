import { describe, expect, it } from 'vitest';
import { createPhotorealismSceneIntegration } from '../../src/3d/world/photorealismSceneIntegration.ts';
import {
  applyLivePhotorealismFrame,
  type LiveSceneRuntimeOwners,
} from '../../src/3d/world/photorealismLiveSceneRuntime.ts';

describe('photorealism live scene runtime', () => {
  const observation = {
    sample: {
      worldX: 120,
      worldZ: -80,
      heightMeters: 42,
      waterLevelMeters: 0,
      slopeDegrees: 18,
      curvature: 0.08,
      moisture: 0.34,
      temperature: 4,
      rockWeight: 0.22,
      snowWeight: 0.08,
      waterDistanceMeters: 38,
      roadDistanceMeters: 24,
      settlementDistanceMeters: 260,
      forestDensity: 0.62,
      windward: 0.4,
      lee: 0.2,
      biomeHint: 'forest' as const,
    },
    renderedHeightMeters: 42.02,
    colliderHeightMeters: 42,
    shorelineGradient: 0.8,
    waterNormalRepeat: 0.18,
    skyLuminance: 0.72,
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

  function owners(): LiveSceneRuntimeOwners {
    return {
      renderer: {},
      fog: { userData: {} },
      sun: {},
      moon: {},
      material: { userData: {} },
      water: { userData: {} },
      vegetation: { userData: {} },
      placement: { userData: {} },
    };
  }

  it('applies accepted production decisions to existing owners', () => {
    const liveOwners = owners();
    const integration = createPhotorealismSceneIntegration({ seed: 20260923, rejectVisibleFailures: true });
    const receipt = applyLivePhotorealismFrame(integration, liveOwners, observation);
    expect(receipt.accepted).toBe(true);
    expect(receipt.appliedOperations).toBeGreaterThan(0);
    expect(liveOwners.renderer.toneMappingExposure).toBeTypeOf('number');
    expect(liveOwners.fog?.density).toBeTypeOf('number');
    expect(liveOwners.material?.userData?.photorealismMaterialRecipe).toBeDefined();
    expect(liveOwners.water?.userData?.photorealismWaterPolicy).toBeDefined();
    expect(liveOwners.vegetation?.userData?.photorealismVegetationBudget).toBeDefined();
    expect(liveOwners.placement?.userData?.photorealismPlacementQuery).toBeDefined();
  });

  it('fails closed and performs no mutation when a visible P0/P5 failure is observed', () => {
    const liveOwners = owners();
    const before = JSON.stringify(liveOwners);
    const integration = createPhotorealismSceneIntegration({ seed: 20260923, rejectVisibleFailures: true });
    const receipt = applyLivePhotorealismFrame(integration, liveOwners, { ...observation, visibleRectangularWater: true, skyLuminance: 0.05 });
    expect(receipt.accepted).toBe(false);
    expect(receipt.appliedOperations).toBe(0);
    expect(JSON.stringify(liveOwners)).toBe(before);
  });
});
