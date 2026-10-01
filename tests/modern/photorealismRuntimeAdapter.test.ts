import { describe, expect, it } from 'vitest';
import {
  buildPhotorealismRuntimePacket,
  isGroundedEnvironmentEligible,
  photorealismAcceptanceFlags,
} from '../../src/3d/world/photorealismRuntimeAdapter.ts';

describe('photorealismRuntimeAdapter', () => {
  const sample = {
    seed: 283,
    worldX: 120,
    worldZ: -80,
    heightMeters: 42,
    waterLevelMeters: 0,
    slopeDegrees: 8,
    curvature: 0.12,
    moisture: 0.35,
    temperature: 7,
    rockWeight: 0.08,
    snowWeight: 0,
    waterDistanceMeters: 32,
    roadDistanceMeters: 40,
    settlementDistanceMeters: 180,
    forestDensity: 0.68,
    windward: 0.2,
    lee: 0.1,
  } as const;

  it('is deterministic and preserves shared provenance', () => {
    const a = buildPhotorealismRuntimePacket(sample);
    const b = buildPhotorealismRuntimePacket(sample);
    expect(a).toEqual(b);
    expect(a.provenance.placementAuthority).toBe('WorldAssetPlacementPipeline.js');
    expect(a.provenance.materialAuthority).toBe('MaterialAssignmentCore.js');
  });

  it('emits a grounded packet with P0-P5 acceptance flags', () => {
    const packet = buildPhotorealismRuntimePacket(sample);
    const flags = photorealismAcceptanceFlags(packet);
    expect(Object.values(flags)).toHaveLength(6);
    expect(packet.materialRecipe.surfaces.length).toBeGreaterThanOrEqual(2);
    expect(isGroundedEnvironmentEligible(packet)).toBe(true);
  });
});
