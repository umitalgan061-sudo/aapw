import { describe, expect, it } from 'vitest';
import { QUALITY_LEVELS, WORLD_DEFAULTS, WORLD_SCALE } from '../../src/3d/config.ts';
import { mulberry32 } from '../../src/3d/world/terrain.ts';
import { generateRiverPath, detectWaterfalls } from '../../src/3d/world/rivers.ts';
import { getR9MigrationSnapshot, R9_MIGRATION_MODULES } from '../../src/3d/modern/migrationLedgerR9.ts';

describe('R9 production TypeScript platform', () => {
  it('records complete ownership migration for the tracked core/world set', () => {
    const snapshot = getR9MigrationSnapshot();
    expect(snapshot.version).toBe(9);
    expect(snapshot.migratedCount).toBe(R9_MIGRATION_MODULES.length);
    expect(snapshot.coveragePercent).toBe(100);
    expect(WORLD_DEFAULTS.WORLD_SEED).toBe(1337);
    expect(WORLD_SCALE.WORLD_WIDTH_METERS).toBeGreaterThan(10000);
    expect(QUALITY_LEVELS.ULTRA).toBe('ultra');
  });

  it('keeps deterministic PRNG and river topology stable', () => {
    const a = mulberry32(20260921);
    const b = mulberry32(20260921);
    expect([a(), a(), a(), a()]).toEqual([b(), b(), b(), b()]);

    const sampleHeightMeters = (x: number, z: number) => 80 - Math.hypot(x, z) * 0.02;
    const first = generateRiverPath({
      seed: 99,
      sampleHeightMeters,
      seaLevelMeters: 45,
      searchRadiusMeters: 300,
      maxRiverRadiusMeters: 700,
      stepMeters: 40,
      maxSteps: 60,
    });
    const second = generateRiverPath({
      seed: 99,
      sampleHeightMeters,
      seaLevelMeters: 45,
      searchRadiusMeters: 300,
      maxRiverRadiusMeters: 700,
      stepMeters: 40,
      maxSteps: 60,
    });
    expect(first.points.map((point) => point.toArray())).toEqual(second.points.map((point) => point.toArray()));
    expect(detectWaterfalls(first.points)).toEqual(detectWaterfalls(second.points));
  });
});
