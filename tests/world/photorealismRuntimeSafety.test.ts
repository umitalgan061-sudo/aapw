import { describe, expect, it } from 'vitest';
import { evaluatePhotorealismRuntimeSafety } from '../../src/3d/world/photorealismRuntimeSafety.ts';

const base = {
  shorelineGradient: 0.8,
  waterNormalRepeat: 0.2,
  skyLuminance: 0.7,
  renderedHeightMeters: 10,
  colliderHeightMeters: 10.1,
  visibleRectangularWater: false,
  visibleGridSeam: false,
  visibleSmoothWall: false,
  visibleFlatGround: false,
  visibleSnowSheet: false,
  visibleSparseCanopy: false,
  visibleRoadRibbon: false,
  visibleFloatingAsset: false,
  visibleMaterialMismatch: false,
} as any;

describe('photorealism runtime safety', () => {
  it('accepts bounded observations and returns no failed checks', () => {
    expect(evaluatePhotorealismRuntimeSafety(base)).toEqual({
      safeToApply: true,
      reason: null,
      failedChecks: [],
    });
  });

  it('reports the exact visible failure key before blocking mutation', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, visibleRectangularWater: true })).toEqual({
      safeToApply: false,
      reason: 'visible-p0-p5-failure',
      failedChecks: ['rectangularWater'],
    });
  });

  it('reports stepped shoreline and water moire together when both are visible', () => {
    expect(
      evaluatePhotorealismRuntimeSafety({
        ...base,
        shorelineGradient: 0.17,
        waterNormalRepeat: 0.73,
      }),
    ).toEqual({
      safeToApply: false,
      reason: 'visible-p0-p5-failure',
      failedChecks: ['shorelineStep', 'waterMoire'],
    });
  });

  it('fails closed for any visible P1-P4 acceptance failure', () => {
    const cases = [
      ['visibleSmoothWall', 'smoothWall'],
      ['visibleFlatGround', 'flatGround'],
      ['visibleSnowSheet', 'snowSheet'],
      ['visibleSparseCanopy', 'sparseCanopy'],
      ['visibleRoadRibbon', 'roadRibbon'],
      ['visibleFloatingAsset', 'floatingAsset'],
      ['visibleMaterialMismatch', 'materialMismatch'],
    ] as const;
    for (const [inputKey, failureKey] of cases) {
      expect(evaluatePhotorealismRuntimeSafety({ ...base, [inputKey]: true })).toEqual({
        safeToApply: false,
        reason: 'visible-p0-p5-failure',
        failedChecks: [failureKey],
      });
    }
  });

  it('fails closed for terrain/collider parity drift with a stable diagnostic key', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, colliderHeightMeters: 10.36 })).toEqual({
      safeToApply: false,
      reason: 'terrain-collider-parity-out-of-bounds',
      failedChecks: ['terrain-collider-parity'],
    });
  });

  it('fails closed for malformed numeric observations', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, skyLuminance: Number.NaN })).toEqual({
      safeToApply: false,
      reason: 'malformed-observation',
      failedChecks: ['numeric-finiteness'],
    });
  });

  it('fails closed for out-of-range normalized observations', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, waterNormalRepeat: 1.01 })).toEqual({
      safeToApply: false,
      reason: 'malformed-observation',
      failedChecks: ['normalized-range'],
    });
  });

  it('fails closed for non-boolean visibility flags', () => {
    expect(evaluatePhotorealismRuntimeSafety({ ...base, visibleGridSeam: 0 })).toEqual({
      safeToApply: false,
      reason: 'malformed-observation',
      failedChecks: ['visibility-flag-shape'],
    });
  });

  it('fails closed for null or primitive observations at the runtime boundary', () => {
    expect(evaluatePhotorealismRuntimeSafety(null as any)).toEqual({
      safeToApply: false,
      reason: 'malformed-observation',
      failedChecks: ['observation-shape'],
    });
    expect(evaluatePhotorealismRuntimeSafety('invalid' as any)).toEqual({
      safeToApply: false,
      reason: 'malformed-observation',
      failedChecks: ['observation-shape'],
    });
  });
});
