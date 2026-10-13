import { describe, expect, it } from 'vitest';
import { buildStructuralSuppressionPlan } from '../../src/3d/world/photorealismStructuralSuppression.ts';

describe('photorealism structural suppression', () => {
  it('is deterministic and prioritises P0/P4 failures', () => {
    const observation = { worldX: 128, worldZ: -64, shorelineGradient: 0.04, waterNormalRepeat: 0.91, skyLuminance: 0.08, visibleGridSeam: true, visibleRectangularWater: true } as const;
    const a = buildStructuralSuppressionPlan(20260922, observation);
    const b = buildStructuralSuppressionPlan(20260922, observation);
    expect(a).toEqual(b);
    expect(a.acceptanceReady).toBe(false);
    expect(a.suppressWaterOverlay).toBe(true);
    expect(a.rotateWaterNormals).toBe(true);
    expect(a.clampSkyLuminance).toBe(0.2);
    expect(a.failures).toEqual(['rectangular-water', 'grid-seam', 'shoreline-step', 'water-moire', 'black-sky']);
  });

  it('fails closed on malformed observations', () => {
    const plan = buildStructuralSuppressionPlan(1, { worldX: Number.NaN, worldZ: Number.POSITIVE_INFINITY, shorelineGradient: Number.NaN, waterNormalRepeat: Number.NaN, skyLuminance: Number.NaN, visibleGridSeam: false, visibleRectangularWater: false });
    expect(plan.acceptanceReady).toBe(false);
    expect(plan.failures).toContain('shoreline-step');
    expect(plan.failures).toContain('water-moire');
    expect(plan.failures).toContain('black-sky');
  });
});
