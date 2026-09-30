import { describe, expect, it } from 'vitest';
import { getR10BWorldMigrationSnapshot, R10B_WORLD_MODULES } from '../../src/3d/modern/migrationLedgerR10b.ts';
import { TERRAIN_MACRO_WEATHERING_POLICY, terrainMacroWeatheringResidualMeters } from '../../src/3d/world/terrainMacroWeathering.ts';
import { WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY, sampleNormalizedReferenceMountainReliefMeters } from '../../src/3d/world/worldReferenceMountainRelief.ts';
import { TERRAIN_GROUNDWATER_POLICY, groundwaterFieldSignal } from '../../src/3d/world/terrainGroundwaterRegime.ts';
describe('R10b world migration',()=>{
 it('reports complete TypeScript ownership for the migrated world payloads',()=>{
  const s=getR10BWorldMigrationSnapshot();
  expect(s.migratedCount).toBe(R10B_WORLD_MODULES.length);
  expect(s.coveragePercent).toBe(100);
 });
 it('keeps core world policies deterministic and finite',()=>{
  expect(TERRAIN_MACRO_WEATHERING_POLICY.deterministicWorldSpace).toBe(true);
  expect(Number.isFinite(terrainMacroWeatheringResidualMeters(.5,.5))).toBe(true);
  expect(WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id).toContain('owner-map');
  expect(Number.isFinite(sampleNormalizedReferenceMountainReliefMeters(.5,.5))).toBe(true);
  expect(TERRAIN_GROUNDWATER_POLICY.deterministic).toBe(true);
  expect(Number.isFinite(groundwaterFieldSignal(0,0))).toBe(true);
 });
});
