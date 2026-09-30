import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/3d/world/terrain.ts';
import { distancePointToSegment2D, pickSpeciesIndexForWorldXZ, vegetationSpeciesId } from '../../src/3d/world/vegetation.ts';
import { northClimateWeightsAtWorldXZ } from '../../src/3d/world/terrainBiomeShading.ts';
import { getR12MigrationSnapshot } from '../../src/3d/modern/migrationLedgerR12World.ts';

describe('R12 world surface TypeScript owners', () => {
  it('reports complete migration coverage', () => {
    const snapshot = getR12MigrationSnapshot();
    expect(snapshot.version).toBe(12);
    expect(snapshot.migrated).toBe(snapshot.tracked);
    expect(snapshot.coveragePercent).toBe(100);
  });

  it('keeps seeded vegetation decisions deterministic', () => {
    const first = pickSpeciesIndexForWorldXZ(0.61, 120, -85);
    const second = pickSpeciesIndexForWorldXZ(0.61, 120, -85);
    expect(second).toBe(first);
    expect(vegetationSpeciesId(first)).toMatch(/pine|round|snow-pine/);
    expect(distancePointToSegment2D(1, 1, 0, 0, 2, 2)).toBeCloseTo(0);

    const a = mulberry32(912);
    const b = mulberry32(912);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('returns bounded canonical climate weights', () => {
    const sample = northClimateWeightsAtWorldXZ(100, 100);
    for (const value of Object.values(sample)) {
      expect(Number(value)).toBeGreaterThanOrEqual(0);
      expect(Number(value)).toBeLessThanOrEqual(1);
    }
  });
});
