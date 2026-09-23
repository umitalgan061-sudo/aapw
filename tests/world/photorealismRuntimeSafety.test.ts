import { describe, expect, it } from 'vitest';
import { evaluatePhotorealismRuntimeSafety } from '../../src/3d/world/photorealismRuntimeSafety.ts';

const base = {
  visibleFailures: { rectangularWater: false, gridSeam: false, waterMoire: false, blackSky: false },
  renderedColliderParityMeters: 0.1,
} as any;

describe('photorealism runtime safety', () => {
  it('accepts bounded observations', () => {
    expect(evaluatePhotorealismRuntimeSafety(base)).toEqual({ safeToApply: true, reason: null });
  });

  it('fails closed for visible P0/P5 failures', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, visibleFailures: { ...base.visibleFailures, rectangularWater: true } })).toEqual({
      safeToApply: false,
      reason: 'visible-p0-p5-failure',
    });
  });

  it('fails closed for terrain/collider parity drift', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, renderedColliderParityMeters: 0.36 })).toEqual({
      safeToApply: false,
      reason: 'terrain-collider-parity-out-of-bounds',
    });
  });
});
