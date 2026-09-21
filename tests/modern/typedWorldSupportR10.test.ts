import { describe, expect, it } from 'vitest';
import { getR10MigrationSnapshot, R10_MIGRATION_MODULES } from '../../src/3d/modern/migrationLedgerR10.ts';
import { gradeDegrees, segmentSampleCount, pathIsGradeSafe, summarizePolylineCurvature, checksumProfile } from '../../src/3d/world/roadSurfaceProfile.ts';
import { normalizedMapToWorldXZ, sampleReferenceInfluence, REFERENCE_BIOME_ZONES } from '../../src/3d/world/worldReferenceMap.ts';
import { valyriaEcologyProfileAtWorldXZ } from '../../src/3d/world/valyriaEcology.ts';

describe('R10 typed world-support runtime',()=>{
 it('records complete R10 ownership migration',()=>{
  const snapshot=getR10MigrationSnapshot();
  expect(snapshot.version).toBe(10);
  expect(snapshot.migratedCount).toBe(R10_MIGRATION_MODULES.length);
  expect(snapshot.coveragePercent).toBe(100);
 });
 it('keeps road profile math deterministic and bounded',()=>{
  expect(gradeDegrees(10,10)).toBeCloseTo(45,8);
  expect(segmentSampleCount(0)).toBe(1);
  expect(segmentSampleCount(20,5)).toBe(5);
  const profile={points:[{x:0,z:0,y:0},{x:10,z:0,y:5},{x:20,z:5,y:5}],sourcePointCount:3,densifiedPointCount:3,segmentCount:2,sampledSubsegments:2,lengthMeters:25,maxGradeDegrees:26.5650511771,meanGradeDegrees:20,totalAscentMeters:5,totalDescentMeters:0,maxRiseMeters:5,elevationRangeMeters:5,roughnessRmsMeters:3.5355339059};
  expect(pathIsGradeSafe(profile,30)).toBe(true);
  expect(pathIsGradeSafe(profile,20)).toBe(false);
  expect(summarizePolylineCurvature(profile.points).turnCount).toBe(1);
  expect(checksumProfile(profile)).toMatch(/^[0-9a-f]{8}$/);
 });
 it('keeps reference-map conversion and influence bounded',()=>{
  const bounds={minX:0,maxX:9000,minY:0,maxY:7000};
  expect(normalizedMapToWorldXZ(0.5,0.5,bounds,1.477342100713197)).toEqual({x:0,z:0});
  const zone=REFERENCE_BIOME_ZONES[0];
  expect(sampleReferenceInfluence(zone.center[0],zone.center[1],zone)).toBe(1);
  expect(sampleReferenceInfluence(0,0,zone)).toBeGreaterThanOrEqual(0);
  expect(sampleReferenceInfluence(0,0,zone)).toBeLessThanOrEqual(1);
 });
 it('keeps Valyria ecology deterministic and bounded',()=>{
  const first=valyriaEcologyProfileAtWorldXZ(100,100), second=valyriaEcologyProfileAtWorldXZ(100,100);
  expect(second).toEqual(first);
  expect(first.influence).toBeGreaterThanOrEqual(0);
  expect(first.influence).toBeLessThanOrEqual(1);
  expect(first.refugia).toBeGreaterThanOrEqual(0);
  expect(first.refugia).toBeLessThanOrEqual(1);
  if(first.barren){expect(first.ordinaryTreeDensity).toBe(0);expect(first.ordinaryGrassDensity).toBe(0);}
 });
});
