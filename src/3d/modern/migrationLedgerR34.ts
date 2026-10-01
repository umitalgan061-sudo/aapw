/**
 * R34 world payload migration manifest.
 *
 * These modules had TypeScript boundary files but their production payload still lived in
 * *.legacy.js. R34 makes the TypeScript files the actual source of truth and reduces legacy
 * files to compatibility-only re-exports.
 */
export const R34_WORLD_PAYLOADS = Object.freeze([
  { id: 'water-depth-field', legacy: 'src/3d/world/waterDepthField.legacy.js', owner: 'src/3d/world/waterDepthField.ts', sizeClass: 'large', status: 'promoted' },
  { id: 'ice-geometry-breakup', legacy: 'src/3d/world/iceLandmarkGeometryBreakup.legacy.js', owner: 'src/3d/world/iceLandmarkGeometryBreakup.ts', sizeClass: 'large', status: 'promoted' },
  { id: 'groundwater-fixture-transitions', legacy: 'src/3d/world/terrainGroundwaterSurfaceDetailFixturesTransitions.legacy.js', owner: 'src/3d/world/terrainGroundwaterSurfaceDetailFixturesTransitions.ts', sizeClass: 'large', status: 'promoted' },
  { id: 'seasonal-erosion-ledger', legacy: 'src/3d/world/terrainSeasonalErosionScenarioLedger.legacy.js', owner: 'src/3d/world/terrainSeasonalErosionScenarioLedger.ts', sizeClass: 'large', status: 'promoted' },
  { id: 'sediment-calibration', legacy: 'src/3d/world/terrainSurfaceSedimentCalibration.legacy.js', owner: 'src/3d/world/terrainSurfaceSedimentCalibration.ts', sizeClass: 'large', status: 'promoted' },
  { id: 'distribution-telemetry', legacy: 'src/3d/world/geographicAssetDistributionTelemetry.legacy.js', owner: 'src/3d/world/geographicAssetDistributionTelemetry.ts', sizeClass: 'large', status: 'promoted' },
] as const);

export function getR34WorldPayloadMigrationSnapshot() {
  const total = R34_WORLD_PAYLOADS.length;
  const promoted = R34_WORLD_PAYLOADS.filter((entry) => entry.status === 'promoted').length;
  return Object.freeze({
    version: 34,
    total,
    promoted,
    coveragePercent: total === 0 ? 100 : Number(((promoted / total) * 100).toFixed(2)),
  });
}
