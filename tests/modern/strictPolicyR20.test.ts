import { describe, expect, it } from 'vitest';
import {
  normalizePlacementPolicy,
  optionalFinite,
  validateWorldSurfacePolicy,
} from '../../src/3d/world/WorldSurfacePolicySchema.ts';
import {
  checksumProfile,
  gradeDegrees,
  pathIsGradeSafe,
  profileRoadPolyline,
  summarizePolylineCurvature,
} from '../../src/3d/world/roadSurfaceProfile.ts';

describe('R20 strict world policy cores', () => {
  it('normalizes and validates world surface policy safely', () => {
    expect(optionalFinite('12.5')).toBe(12.5);
    expect(optionalFinite('bad')).toBeNull();

    const normalized = normalizePlacementPolicy({
      minSlopeDegrees: '4',
      maxSlopeDegrees: '17',
      allowedBiomes: [' Meadow ', 'forest', 'meadow'],
      minMoisture: 0.2,
      maxMoisture: 0.8,
    });
    expect(normalized.minSlopeDegrees).toBe(4);
    expect(normalized.maxSlopeDegrees).toBe(17);
    expect(normalized.allowedBiomes).toEqual(['forest', 'meadow']);
    expect(validateWorldSurfacePolicy(normalized).ok).toBe(true);

    const invalid = validateWorldSurfacePolicy({
      minSlopeDegrees: 20,
      maxSlopeDegrees: 10,
      minMoisture: 2,
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors).toContain('policy-inverted-slope-range');
    expect(invalid.errors).toContain('policy-invalid-min-moisture');
  });

  it('profiles roads deterministically at dense world-space samples', () => {
    const sampler = (x: number, z: number) => 100 + x * 0.02 + Math.sin(z * 0.03) * 0.25;
    const profileA = profileRoadPolyline({
      points: [{ x: 0, z: 0 }, { x: 120, z: 0 }, { x: 240, z: 80 }],
      sampleHeightMeters: sampler,
      maxSpacingMeters: 6,
    });
    const profileB = profileRoadPolyline({
      points: [{ x: 0, z: 0 }, { x: 120, z: 0 }, { x: 240, z: 80 }],
      sampleHeightMeters: sampler,
      maxSpacingMeters: 6,
    });

    expect(profileA.points).toEqual(profileB.points);
    expect(checksumProfile(profileA)).toBe(checksumProfile(profileB));
    expect(profileA.sampledSubsegments).toBeGreaterThan(0);
    expect(pathIsGradeSafe(profileA, 17)).toBe(true);
    expect(gradeDegrees(10, 10)).toBeCloseTo(45, 8);
    expect(summarizePolylineCurvature(profileA.points).turnCount).toBeGreaterThan(0);
  });
});
