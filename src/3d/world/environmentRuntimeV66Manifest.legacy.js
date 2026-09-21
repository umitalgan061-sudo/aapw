export const ENVIRONMENT_RUNTIME_V66_MANIFEST = Object.freeze({
  id: 'environment-runtime-v66-2026-09-15',
  version: 66,
  deterministic: true,
  noWorldMutation: true,
  acceptance: Object.freeze({ width: 1536, height: 1024, projection: 'orthographic', fovDegrees: 90, fullWorld: true }),
  sharedAuthorities: Object.freeze({ placement: 'WorldAssetPlacementPipeline.js', material: 'MaterialAssignmentCore.js' }),
  features: Object.freeze([
    'erosion-response', 'hydrology-dynamics', 'wildlife-routing', 'solar-exposure', 'terrain-navigation', 'seasonal-ecology',
    'rain-runoff', 'sediment-budget', 'river-corridor', 'flood-risk', 'habitat-score', 'migration-link', 'canopy-exposure',
    'fog-visibility', 'safe-detour', 'player-safety-envelope', 'biome-ecotone', 'vegetation-layering', 'habitat-resources',
  ]),
  scope: 'world-environment-runtime',
});
