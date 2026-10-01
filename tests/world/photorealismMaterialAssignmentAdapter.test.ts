import { describe, expect, it } from 'vitest';
import {
  buildPhotorealismFrame,
  type EnvironmentSample,
} from '../../src/3d/world/photorealismDirector.ts';
import {
  canApplySharedMaterialAssignmentRequest,
  createSharedMaterialAssignmentRequest,
  createSharedMaterialAssignmentRequestFromSample,
  isSharedMaterialAssignmentRequest,
} from '../../src/3d/world/photorealismMaterialAssignmentAdapter.ts';

const sample: EnvironmentSample = {
  worldX: 128,
  worldZ: -64,
  heightMeters: 18,
  waterLevelMeters: 0,
  slopeDegrees: 12,
  curvature: 0.1,
  moisture: 0.35,
  temperature: 7,
  rockWeight: 0.15,
  snowWeight: 0,
  waterDistanceMeters: 22,
  roadDistanceMeters: 35,
  settlementDistanceMeters: 180,
  forestDensity: 0.68,
  windward: 0.2,
  lee: 0.1,
  biomeHint: 'forest',
};

describe('photorealismMaterialAssignmentAdapter', () => {
  it('builds a deterministic shared-core request from a canonical sample', () => {
    const first = createSharedMaterialAssignmentRequestFromSample('env-tree-01', 20260923, sample);
    const second = createSharedMaterialAssignmentRequestFromSample('env-tree-01', 20260923, sample);

    expect(first).toEqual(second);
    expect(first.provenance.materialAuthority).toBe('MaterialAssignmentCore.js');
    expect(first.provenance.placementAuthority).toBe('WorldAssetPlacementPipeline.js');
    expect(first.surfaceIntents.length).toBeGreaterThan(0);
    expect(canApplySharedMaterialAssignmentRequest(first)).toBe(true);
    expect(isSharedMaterialAssignmentRequest(first)).toBe(true);
  });

  it('preserves P0/P2 validation failures instead of hiding them', () => {
    const frame = buildPhotorealismFrame(20260923, sample);
    const invalidFrame = Object.freeze({
      ...frame,
      manifest: Object.freeze({
        ...frame.manifest,
        materialAuthority: 'wrong-authority',
      }),
    });
    const request = createSharedMaterialAssignmentRequest('env-tree-01', invalidFrame as typeof frame);

    expect(request.validation.ok).toBe(false);
    expect(request.validation.errors).toContain('material-authority');
    expect(canApplySharedMaterialAssignmentRequest(request)).toBe(false);
  });

  it('normalizes invalid mesh indexes and rejects malformed request shapes', () => {
    const request = createSharedMaterialAssignmentRequestFromSample('env-rock-01', 7, sample, -4);

    expect(request.targetMeshIndex).toBe(0);
    expect(isSharedMaterialAssignmentRequest(request)).toBe(true);
    expect(isSharedMaterialAssignmentRequest(null)).toBe(false);
    expect(isSharedMaterialAssignmentRequest({ schemaVersion: 1 })).toBe(false);
  });
});
