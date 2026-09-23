import { describe, expect, it } from 'vitest';
import { evaluatePhotorealismRuntimeSafety } from '../../src/3d/world/photorealismRuntimeSafety.ts';

const base = {
  waterNormalRepeat: 0.2,
  skyLuminance: 0.7,
  renderedHeightMeters: 10,
  colliderHeightMeters: 10.1,
  visibleRectangularWater: false,
  visibleGridSeam: false,
} as any;

describe('photorealism runtime safety', () => {
  it('accepts bounded observations', () => {
    expect(evaluatePhotorealismRuntimeSafety(base)).toEqual({ safeToApply: true, reason: null });
  });

  it('fails closed for visible P0/P5 failures', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, visibleRectangularWater: true })).toEqual({
      safeToApply: false,
      reason: 'visible-p0-p5-failure',
    });
  });

  it('fails closed for terrain/collider parity drift', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, colliderHeightMeters: 10.36 })).toEqual({
      safeToApply: false,
      reason: 'terrain-collider-parity-out-of-bounds',
    });
  });

  it('fails closed for malformed numeric observations', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, skyLuminance: Number.NaN })).toEqual({
      safeToApply: false,
      reason: 'malformed-observation',
    });
  });

  it('fails closed for out-of-range normalized observations', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, waterNormalRepeat: 1.01 })).toEqual({
      safeToApply: false,
      reason: 'malformed-observation',
    });
  });

  it('fails closed for non-boolean visibility flags', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, visibleGridSeam: 0 })).toEqual({
      safeToApply: false,
      reason: 'malformed-observation',
    });
  });
});
