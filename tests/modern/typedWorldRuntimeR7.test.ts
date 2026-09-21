import { describe, expect, it } from 'vitest';

import {
  CURRENT_TERRAIN_POLICY,
  mulberry32,
  terrainMapUvAt,
} from '../../src/3d/world/terrain.ts';
import {
  RAIN_DROP_COUNT,
  createWeatherSystem,
} from '../../src/3d/world/weather.ts';
import {
  detectWaterfalls,
  generateRiverPath,
} from '../../src/3d/world/rivers.ts';
import {
  ChunkManager,
} from '../../src/3d/world/chunkManager.ts';

describe('R7 typed world runtime', () => {
  it('keeps terrain mapping and seeded randomness deterministic', () => {
    const randomA = mulberry32(12345);
    const randomB = mulberry32(12345);
    expect([randomA(), randomA(), randomA()]).toEqual([randomB(), randomB(), randomB()]);

    expect(terrainMapUvAt(0, 0)).toEqual(terrainMapUvAt(0, 0));
    expect(CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage).toBe(true);
    expect(CURRENT_TERRAIN_POLICY.legacyProceduralFallback).toBe(false);
  });

  it('keeps river generation deterministic over the terrain authority', () => {
    const sampleHeightMeters = (x: number, z: number) => 80 - Math.hypot(x, z) * 0.01;
    const first = generateRiverPath({
      seed: 77,
      sampleHeightMeters,
      seaLevelMeters: 45,
      searchRadiusMeters: 200,
      maxRiverRadiusMeters: 600,
      stepMeters: 40,
      maxSteps: 80,
    });
    const second = generateRiverPath({
      seed: 77,
      sampleHeightMeters,
      seaLevelMeters: 45,
      searchRadiusMeters: 200,
      maxRiverRadiusMeters: 600,
      stepMeters: 40,
      maxSteps: 80,
    });
    expect(first.points.length).toBeGreaterThan(0);
    expect(first.points.map((p) => p.toArray())).toEqual(second.points.map((p) => p.toArray()));
    expect(detectWaterfalls(first.points)).toEqual(detectWaterfalls(second.points));
  });

  it('exposes bounded weather and chunk-streaming production contracts', () => {
    expect(RAIN_DROP_COUNT).toBe(900);
    expect(typeof createWeatherSystem).toBe('function');
    expect(typeof ChunkManager.prototype.getStreamingStats).toBe('function');
  });
});
