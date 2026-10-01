import { describe, expect, it } from 'vitest';

import {
  WATER_DEPTH_FIELD_RESOLUTION,
  createCoverageSubsampleOffsets,
} from '../../src/3d/world/waterDepthField.ts';
import {
  TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER_POLICY,
  scenarioLedgerStats,
  validateScenarioLedger,
} from '../../src/3d/world/terrainSeasonalErosionScenarioLedger.ts';
import {
  TERRAIN_SEDIMENT_CALIBRATION,
  sedimentCalibrationAt,
} from '../../src/3d/world/terrainSurfaceSedimentCalibration.ts';
import {
  GEOGRAPHIC_ASSET_DISTRIBUTION_TELEMETRY_POLICY,
  measureGeographicAssetDistribution,
  assertTelemetryDeterminism,
} from '../../src/3d/world/geographicAssetDistributionTelemetry.ts';
import { getR34WorldPayloadMigrationSnapshot } from '../../src/3d/modern/migrationLedgerR34.ts';

describe('R34 promoted world payloads', () => {
  it('makes the TypeScript source-of-truth migration explicit', () => {
    const snapshot = getR34WorldPayloadMigrationSnapshot();
    expect(snapshot.version).toBe(34);
    expect(snapshot.promoted).toBe(snapshot.total);
    expect(snapshot.coveragePercent).toBe(100);
  });

  it('keeps water-depth field primitives deterministic and bounded', () => {
    expect(WATER_DEPTH_FIELD_RESOLUTION).toBeGreaterThan(128);
    expect(createCoverageSubsampleOffsets()).toHaveLength(4);
    expect(createCoverageSubsampleOffsets(3)).toHaveLength(9);
  });

  it('keeps seasonal erosion contracts internally valid', () => {
    expect(TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER_POLICY.deterministic).toBe(true);
    expect(TERRAIN_SEASONAL_EROSION_SCENARIO_LEDGER_POLICY.renderOnly).toBe(true);
    const validation = validateScenarioLedger();
    expect(validation.ok).toBe(true);
    expect(validation.count).toBeGreaterThan(0);
    expect(scenarioLedgerStats().length).toBeGreaterThan(0);
  });

  it('keeps sediment calibration and distribution telemetry reproducible', () => {
    expect(TERRAIN_SEDIMENT_CALIBRATION.length).toBeGreaterThan(0);
    expect(sedimentCalibrationAt(0).deposit).toBeGreaterThanOrEqual(0);
    expect(GEOGRAPHIC_ASSET_DISTRIBUTION_TELEMETRY_POLICY.deterministic).toBe(true);

    const first = measureGeographicAssetDistribution([
      { accepted: true, familyId: 'rock', distanceMeters: 12 },
      { accepted: true, familyId: 'tree', distanceMeters: 24 },
      { accepted: false, familyId: 'tree', reason: 'water' },
    ]);
    const second = measureGeographicAssetDistribution([
      { accepted: true, familyId: 'rock', distanceMeters: 12 },
      { accepted: true, familyId: 'tree', distanceMeters: 24 },
      { accepted: false, familyId: 'tree', reason: 'water' },
    ]);

    expect(first).toEqual(second);
    expect(assertTelemetryDeterminism(first, second)).toBe(true);
  });
});
