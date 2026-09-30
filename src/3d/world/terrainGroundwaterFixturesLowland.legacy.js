/** Groundwater regression fixtures: Lowland. */
const freeze = Object.freeze;

export const TERRAIN_GROUNDWATER_LOWLAND_FIXTURE_POLICY = freeze({
  id: 'terrain-groundwater-fixtures-lowland-2026-09-15-v1',
  deterministic: true,
  renderOnly: true,
  source: 'terrain-groundwater-regime-2026-09-15-v1',
});

export const TERRAIN_GROUNDWATER_FIXTURES = freeze([
  freeze({
    id: 'gw-lowland-001',
    worldX: -318,
    worldZ: -214,
    heightMeters: 6,
    slopeDegrees: 1.0,
    moisture: 0.16,
    rainfall: 0.2,
    runoff: 0.0,
    soilDepth: 0.28, permeability: 0.12,
    waterDistanceMeters: 5, groundwaterDepthMeters: 3,
    wetDays: 0, dryDays: 0, dayOfYear: 0,
    temperatureC: -6.0, drainage: 0.12,
    substrate: 'loam',
    biome: 'temperate',
  }),
  freeze({ id: 'gw-lowland-002', worldX: -227, worldZ: -214, heightMeters: 33, slopeDegrees: 5.7, moisture: 0.25, rainfall: 0.305, runoff: 0.13, soilDepth: 0.62, permeability: 0.205, waterDistanceMeters: 24, groundwaterDepthMeters: 9, wetDays: 1, dryDays: 5, dayOfYear: 19, temperatureC: -2.4, drainage: 0.22, substrate: 'clay', biome: 'mediterranean' }),
  freeze({ id: 'gw-lowland-003', worldX: -136, worldZ: -214, heightMeters: 60, slopeDegrees: 10.4, moisture: 0.34, rainfall: 0.41, runoff: 0.26, soilDepth: 0.96, permeability: 0.29, waterDistanceMeters: 43, groundwaterDepthMeters: 15, wetDays: 2, dryDays: 10, dayOfYear: 38, temperatureC: 1.2, drainage: 0.32, substrate: 'sand', biome: 'alpine' }),
  freeze({ id: 'gw-lowland-004', worldX: -45, worldZ: -214, heightMeters: 87, slopeDegrees: 15.1, moisture: 0.43, rainfall: 0.515, runoff: 0.39, soilDepth: 1.3, permeability: 0.375, waterDistanceMeters: 62, groundwaterDepthMeters: 21, wetDays: 3, dryDays: 15, dayOfYear: 57, temperatureC: 4.8, drainage: 0.42, substrate: 'gravel', biome: 'boreal' }),
  freeze({ id: 'gw-lowland-005', worldX: 46, worldZ: -214, heightMeters: 114, slopeDegrees: 19.8, moisture: 0.52, rainfall: 0.62, runoff: 0.52, soilDepth: 1.64, permeability: 0.46, waterDistanceMeters: 81, groundwaterDepthMeters: 27, wetDays: 4, dryDays: 20, dayOfYear: 76, temperatureC: 8.4, drainage: 0.52, substrate: 'peat', biome: 'steppe' }),
  freeze({ id: 'gw-lowland-006', worldX: 137, worldZ: -214, heightMeters: 141, slopeDegrees: 24.5, moisture: 0.61, rainfall: 0.725, runoff: 0.65, soilDepth: 1.98, permeability: 0.545, waterDistanceMeters: 100, groundwaterDepthMeters: 33, wetDays: 5, dryDays: 25, dayOfYear: 95, temperatureC: 12.0, drainage: 0.62, substrate: 'marl', biome: 'humid' }),
  freeze({ id: 'gw-lowland-007', worldX: 228, worldZ: -214, heightMeters: 168, slopeDegrees: 29.2, moisture: 0.7, rainfall: 0.83, runoff: 0.0, soilDepth: 2.32, permeability: 0.63, waterDistanceMeters: 119, groundwaterDepthMeters: 39, wetDays: 6, dryDays: 30, dayOfYear: 114, temperatureC: 15.6, drainage: 0.72, substrate: 'shale', biome: 'monsoon' }),
  freeze({ id: 'gw-lowland-008', worldX: 319, worldZ: -214, heightMeters: 6, slopeDegrees: 33.9, moisture: 0.79, rainfall: 0.935, runoff: 0.13, soilDepth: 2.66, permeability: 0.715, waterDistanceMeters: 138, groundwaterDepthMeters: 45, wetDays: 7, dryDays: 35, dayOfYear: 133, temperatureC: 19.2, drainage: 0.82, substrate: 'limestone', biome: 'coastal' }),
  freeze({ id: 'gw-lowland-009', worldX: -318, worldZ: -107, heightMeters: 33, slopeDegrees: 38.6, moisture: 0.88, rainfall: 0.2, runoff: 0.26, soilDepth: 0.28, permeability: 0.8, waterDistanceMeters: 157, groundwaterDepthMeters: 51, wetDays: 8, dryDays: 40, dayOfYear: 152, temperatureC: 22.8, drainage: 0.92, substrate: 'loam', biome: 'temperate' }),
  freeze({ id: 'gw-lowland-010', worldX: -227, worldZ: -107, heightMeters: 60, slopeDegrees: 43.3, moisture: 0.16, rainfall: 0.305, runoff: 0.39, soilDepth: 0.62, permeability: 0.885, waterDistanceMeters: 176, groundwaterDepthMeters: 57, wetDays: 9, dryDays: 45, dayOfYear: 171, temperatureC: 26.4, drainage: 0.12, substrate: 'clay', biome: 'mediterranean' }),
  freeze({ id: 'gw-lowland-011', worldX: -136, worldZ: -107, heightMeters: 87, slopeDegrees: 1.0, moisture: 0.25, rainfall: 0.41, runoff: 0.52, soilDepth: 0.96, permeability: 0.12, waterDistanceMeters: 195, groundwaterDepthMeters: 63, wetDays: 10, dryDays: 50, dayOfYear: 190, temperatureC: 30.0, drainage: 0.22, substrate: 'sand', biome: 'alpine' }),
  freeze({ id: 'gw-lowland-012', worldX: -45, worldZ: -107, heightMeters: 114, slopeDegrees: 5.7, moisture: 0.34, rainfall: 0.515, runoff: 0.65, soilDepth: 1.3, permeability: 0.205, waterDistanceMeters: 214, groundwaterDepthMeters: 69, wetDays: 11, dryDays: 2, dayOfYear: 209, temperatureC: 33.6, drainage: 0.32, substrate: 'gravel', biome: 'boreal' }),
  freeze({ id: 'gw-lowland-013', worldX: 46, worldZ: -107, heightMeters: 141, slopeDegrees: 10.4, moisture: 0.43, rainfall: 0.62, runoff: 0.0, soilDepth: 1.64, permeability: 0.29, waterDistanceMeters: 233, groundwaterDepthMeters: 75, wetDays: 12, dryDays: 7, dayOfYear: 228, temperatureC: 37.2, drainage: 0.42, substrate: 'peat', biome: 'steppe' }),
  freeze({ id: 'gw-lowland-014', worldX: 137, worldZ: -107, heightMeters: 168, slopeDegrees: 15.1, moisture: 0.52, rainfall: 0.725, runoff: 0.13, soilDepth: 1.98, permeability: 0.375, waterDistanceMeters: 5, groundwaterDepthMeters: 81, wetDays: 13, dryDays: 12, dayOfYear: 247, temperatureC: 40.8, drainage: 0.52, substrate: 'marl', biome: 'humid' }),
  freeze({ id: 'gw-lowland-015', worldX: 228, worldZ: -107, heightMeters: 6, slopeDegrees: 19.8, moisture: 0.61, rainfall: 0.83, runoff: 0.26, soilDepth: 2.32, permeability: 0.46, waterDistanceMeters: 24, groundwaterDepthMeters: 87, wetDays: 14, dryDays: 17, dayOfYear: 266, temperatureC: 44.4, drainage: 0.62, substrate: 'shale', biome: 'monsoon' }),
  freeze({ id: 'gw-lowland-016', worldX: 319, worldZ: -107, heightMeters: 33, slopeDegrees: 24.5, moisture: 0.7, rainfall: 0.935, runoff: 0.39, soilDepth: 2.66, permeability: 0.545, waterDistanceMeters: 43, groundwaterDepthMeters: 93, wetDays: 15, dryDays: 22, dayOfYear: 285, temperatureC: -6.0, drainage: 0.72, substrate: 'limestone', biome: 'coastal' }),
  freeze({ id: 'gw-lowland-017', worldX: -318, worldZ: 0, heightMeters: 60, slopeDegrees: 29.2, moisture: 0.79, rainfall: 0.2, runoff: 0.52, soilDepth: 0.28, permeability: 0.63, waterDistanceMeters: 62, groundwaterDepthMeters: 99, wetDays: 16, dryDays: 27, dayOfYear: 304, temperatureC: -2.4, drainage: 0.82, substrate: 'loam', biome: 'temperate' }),
  freeze({ id: 'gw-lowland-018', worldX: -227, worldZ: 0, heightMeters: 87, slopeDegrees: 33.9, moisture: 0.88, rainfall: 0.305, runoff: 0.65, soilDepth: 0.62, permeability: 0.715, waterDistanceMeters: 81, groundwaterDepthMeters: 3, wetDays: 17, dryDays: 32, dayOfYear: 323, temperatureC: 1.2, drainage: 0.92, substrate: 'clay', biome: 'mediterranean' }),
  freeze({ id: 'gw-lowland-019', worldX: -136, worldZ: 0, heightMeters: 114, slopeDegrees: 38.6, moisture: 0.16, rainfall: 0.41, runoff: 0.0, soilDepth: 0.96, permeability: 0.8, waterDistanceMeters: 100, groundwaterDepthMeters: 9, wetDays: 18, dryDays: 37, dayOfYear: 342, temperatureC: 4.8, drainage: 0.12, substrate: 'sand', biome: 'alpine' }),
  freeze({ id: 'gw-lowland-020', worldX: -45, worldZ: 0, heightMeters: 141, slopeDegrees: 43.3, moisture: 0.25, rainfall: 0.515, runoff: 0.13, soilDepth: 1.3, permeability: 0.885, waterDistanceMeters: 119, groundwaterDepthMeters: 15, wetDays: 19, dryDays: 42, dayOfYear: 1, temperatureC: 8.4, drainage: 0.22, substrate: 'gravel', biome: 'boreal' }),
  freeze({ id: 'gw-lowland-021', worldX: 46, worldZ: 0, heightMeters: 168, slopeDegrees: 1.0, moisture: 0.34, rainfall: 0.62, runoff: 0.26, soilDepth: 1.64, permeability: 0.12, waterDistanceMeters: 138, groundwaterDepthMeters: 21, wetDays: 20, dryDays: 47, dayOfYear: 20, temperatureC: 12.0, drainage: 0.32, substrate: 'peat', biome: 'steppe' }),
  freeze({ id: 'gw-lowland-022', worldX: 137, worldZ: 0, heightMeters: 6, slopeDegrees: 5.7, moisture: 0.43, rainfall: 0.725, runoff: 0.39, soilDepth: 1.98, permeability: 0.205, waterDistanceMeters: 157, groundwaterDepthMeters: 27, wetDays: 21, dryDays: 52, dayOfYear: 39, temperatureC: 15.6, drainage: 0.42, substrate: 'marl', biome: 'humid' }),
  freeze({ id: 'gw-lowland-023', worldX: 228, worldZ: 0, heightMeters: 33, slopeDegrees: 10.4, moisture: 0.52, rainfall: 0.83, runoff: 0.52, soilDepth: 2.32, permeability: 0.29, waterDistanceMeters: 176, groundwaterDepthMeters: 33, wetDays: 22, dryDays: 4, dayOfYear: 58, temperatureC: 19.2, drainage: 0.52, substrate: 'shale', biome: 'monsoon' }),
  freeze({ id: 'gw-lowland-024', worldX: 319, worldZ: 0, heightMeters: 60, slopeDegrees: 15.1, moisture: 0.61, rainfall: 0.935, runoff: 0.65, soilDepth: 2.66, permeability: 0.375, waterDistanceMeters: 195, groundwaterDepthMeters: 39, wetDays: 23, dryDays: 9, dayOfYear: 77, temperatureC: 22.8, drainage: 0.62, substrate: 'limestone', biome: 'coastal' }),
]);

export function findFixture(id) { return TERRAIN_GROUNDWATER_FIXTURES.find((fixture) => fixture.id === id) ?? null; }
export function fixtureIds() { return TERRAIN_GROUNDWATER_FIXTURES.map((fixture) => fixture.id); }
export function fixtureCount() { return TERRAIN_GROUNDWATER_FIXTURES.length; }
export function fixtureByIndex(index) { const safe = Math.max(0, Math.min(TERRAIN_GROUNDWATER_FIXTURES.length - 1, Math.floor(index))); return TERRAIN_GROUNDWATER_FIXTURES[safe]; }
export function fixtureRange(start, end) { return freeze(TERRAIN_GROUNDWATER_FIXTURES.slice(start, end)); }
export function fixtureEnvelope() { return freeze({ minHeight: Math.min(...TERRAIN_GROUNDWATER_FIXTURES.map((fixture) => fixture.heightMeters)), maxHeight: Math.max(...TERRAIN_GROUNDWATER_FIXTURES.map((fixture) => fixture.heightMeters)), minSlope: Math.min(...TERRAIN_GROUNDWATER_FIXTURES.map((fixture) => fixture.slopeDegrees)), maxSlope: Math.max(...TERRAIN_GROUNDWATER_FIXTURES.map((fixture) => fixture.slopeDegrees)), minGroundwaterDepth: Math.min(...TERRAIN_GROUNDWATER_FIXTURES.map((fixture) => fixture.groundwaterDepthMeters)), maxGroundwaterDepth: Math.max(...TERRAIN_GROUNDWATER_FIXTURES.map((fixture) => fixture.groundwaterDepthMeters)), substrateCount: new Set(TERRAIN_GROUNDWATER_FIXTURES.map((fixture) => fixture.substrate)).size, biomeCount: new Set(TERRAIN_GROUNDWATER_FIXTURES.map((fixture) => fixture.biome)).size }); }
