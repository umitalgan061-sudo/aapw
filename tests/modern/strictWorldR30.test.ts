import { describe, expect, it } from 'vitest';
import { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } from '../../src/3d/config.ts';
import { gradeDegrees, segmentSampleCount } from '../../src/3d/world/roadSurfaceProfile.ts';
import { normalizePlacementPolicy, validateWorldSurfacePolicy } from '../../src/3d/world/WorldSurfacePolicySchema.ts';
import { buildStreamRegions, DEFAULT_STREAM_POLICY } from '../../src/3d/strict/streamingRuntime.ts';
import {
  createWorldRuntimeContract,
  validateWorldRuntimeContract,
} from '../../src/3d/strict/worldRuntimeContractR30.ts';

describe('R30 strict world/platform contract', () => {
  it('accepts the shipped world partition and render budget', () => {
    const report = validateWorldRuntimeContract({
      farPlane: WORLD_DEFAULTS.FAR_PLANE,
      maxDrawDistance: 1200,
      worldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
      worldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
      chunkSizeMeters: CHUNK_CONFIG.CHUNK_SIZE_METERS,
      gridColumns: CHUNK_CONFIG.GRID_COLUMNS,
      gridRows: CHUNK_CONFIG.GRID_ROWS,
      streamRadiusChunks: CHUNK_CONFIG.STREAM_RADIUS_CHUNKS,
      waterLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
      streamPolicy: DEFAULT_STREAM_POLICY,
    });
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(createWorldRuntimeContract({
      farPlane: WORLD_DEFAULTS.FAR_PLANE,
      maxDrawDistance: 1200,
      worldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
      worldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
      chunkSizeMeters: CHUNK_CONFIG.CHUNK_SIZE_METERS,
      gridColumns: CHUNK_CONFIG.GRID_COLUMNS,
      gridRows: CHUNK_CONFIG.GRID_ROWS,
      streamRadiusChunks: CHUNK_CONFIG.STREAM_RADIUS_CHUNKS,
      waterLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
      streamPolicy: DEFAULT_STREAM_POLICY,
    }).status).toBe('valid');
  });

  it('keeps strict road and placement validation deterministic', () => {
    expect(gradeDegrees(10, 10)).toBeCloseTo(45, 10);
    expect(segmentSampleCount(100, 4)).toBe(25);

    const policy = normalizePlacementPolicy({
      maxSlopeDegrees: 18,
      allowedBiomes: ['Forest', 'forest', ' Meadow '],
    });
    expect(policy.allowedBiomes).toEqual(['forest', 'meadow']);
    expect(validateWorldSurfacePolicy(policy).ok).toBe(true);
  });

  it('produces bounded deterministic stream regions', () => {
    const first = buildStreamRegions({ x: 100, y: 0, z: -200 }, 256);
    const second = buildStreamRegions({ x: 100, y: 0, z: -200 }, 256);
    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual((Math.ceil(DEFAULT_STREAM_POLICY.farRadius) * 2 + 1) ** 2);
    expect(first.every((region) => region.radius === 256)).toBe(true);
  });
});
