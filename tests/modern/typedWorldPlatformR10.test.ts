import { describe,expect,it } from 'vitest';
import { getR10MigrationSnapshot,R10_MIGRATION_MODULES } from '../../src/3d/modern/migrationLedgerR10.ts';
import { GEOGRAPHIC_ASSET_CLUSTER_POLICY, planGeographicAssetCluster } from '../../src/3d/world/geographicAssetClusterPlanner.ts';
import { GEOGRAPHIC_ASSET_DISTRIBUTION_ADAPTER_POLICY, distributionModes } from '../../src/3d/world/geographicAssetDistributionAdapter.ts';
import { ROAD_ROUTING_POLICY } from '../../src/3d/world/roadPathfinder.ts';

describe('R10 typed world decision layer',()=>{
  it('tracks the full R10 ownership set',()=>{
    const s=getR10MigrationSnapshot();
    expect(s.version).toBe(10);
    expect(s.migratedCount).toBe(R10_MIGRATION_MODULES.length);
    expect(s.coveragePercent).toBe(100);
    expect(GEOGRAPHIC_ASSET_CLUSTER_POLICY.deterministic).toBe(true);
    expect(GEOGRAPHIC_ASSET_DISTRIBUTION_ADAPTER_POLICY.deterministic).toBe(true);
    expect(ROAD_ROUTING_POLICY.deterministic).toBe(true);
  });
  it('keeps cluster planning deterministic for identical seeds and anchors',()=>{
    const options={
      worldX:120,
      worldZ:-80,
      familyIds:['rocks','trees','shrubs'],
      seed:20260921,
      context:{surfaceType:'dryland',waterDistanceMeters:180,roadDistanceMeters:70,settlementDistanceMeters:450},
    };
    const a=planGeographicAssetCluster(options);
    const b=planGeographicAssetCluster(options);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(distributionModes().length).toBeGreaterThan(0);
  });
});
