export const ENVIRONMENT_RUNTIME_V65_MANIFEST = Object.freeze({
  id: 'buzul-muhafizi-environment-runtime-v65-20260914',
  version: 65,
  canonicalExtent: Object.freeze({ width: 9000, depth: 7000 }),
  acceptance: Object.freeze({ width: 1536, height: 1024, projection: 'orthographic', fovDegrees: 90 }),
  deterministic: true,
  noWorldMutation: true,
  materialAuthority: 'src/3d/materials/MaterialAssignmentCore.js',
  placementAuthority: 'src/3d/world/WorldAssetPlacementPipeline.js',
  features: Object.freeze(['adaptive-habitat', 'surface-weather', 'chunk-continuity', 'streaming-budget', 'seasonal-phenology', 'query-facade', 'quality-ledger', 'visual-audit']),
  testSuites: Object.freeze(['environment-runtime-v65', 'environment-runtime-v65-edge', 'environment-runtime-v65-contract', 'environment-runtime-v65-visual', 'environment-runtime-v65-performance']),
});

export const getEnvironmentRuntimeV65Manifest = () => ({ ...ENVIRONMENT_RUNTIME_V65_MANIFEST, acceptance: { ...ENVIRONMENT_RUNTIME_V65_MANIFEST.acceptance }, features: [...ENVIRONMENT_RUNTIME_V65_MANIFEST.features], testSuites: [...ENVIRONMENT_RUNTIME_V65_MANIFEST.testSuites] });
