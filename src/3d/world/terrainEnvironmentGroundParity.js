const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const TERRAIN_ENVIRONMENT_GROUND_PARITY_POLICY = freeze({
  id: 'terrain-environment-ground-parity-2026-09-07-v1',
  canonicalHeightAuthority: 'src/3d/world/terrain.js',
  toleranceMeters: 0.075,
  maxStructureSlopeDegrees: 12,
  maxDryAssetWaterDepth: 0.05,
  noFloatingAssets: true,
  noBuriedAssets: true,
});

export function sampleGroundParity({ terrainSampler, colliderSampler, worldX = 0, worldZ = 0, assetBaseY = 0, footprintOffsets = [[0, 0]], toleranceMeters = TERRAIN_ENVIRONMENT_GROUND_PARITY_POLICY.toleranceMeters } = {}) {
  if (typeof terrainSampler !== 'function' || typeof colliderSampler !== 'function') return freeze({ ok: false, errors: ['missing-sampler'] });
  const errors = [];
  const samples = [];
  for (const [offsetX, offsetZ] of footprintOffsets) {
    const x = finite(worldX) + finite(offsetX);
    const z = finite(worldZ) + finite(offsetZ);
    const terrain = finite(terrainSampler(x, z), NaN);
    const collider = finite(colliderSampler(x, z), NaN);
    const delta = Math.abs(terrain - collider);
    samples.push({ x, z, terrain, collider, delta });
    if (!Number.isFinite(delta) || delta > toleranceMeters) errors.push(`height-mismatch:${x.toFixed(2)}:${z.toFixed(2)}`);
  }
  const center = samples[0];
  if (center && Number.isFinite(center.terrain) && Math.abs(finite(assetBaseY) - center.terrain) > toleranceMeters) errors.push('asset-base-not-grounded');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), samples: freeze(samples), toleranceMeters });
}

export function slopeFromFourSamples({ sample, spacingMeters = 1 } = {}) {
  if (typeof sample !== 'function') return NaN;
  const d = Math.max(0.01, finite(spacingMeters, 1));
  const west = finite(sample(-d, 0), NaN);
  const east = finite(sample(d, 0), NaN);
  const north = finite(sample(0, -d), NaN);
  const south = finite(sample(0, d), NaN);
  if (![west, east, north, south].every(Number.isFinite)) return NaN;
  return Math.atan(Math.hypot((east - west) / (2 * d), (south - north) / (2 * d))) * 180 / Math.PI;
}

export function assetGroundClearance({ assetMinY = 0, terrainHeight = 0, assetHeight = 1 } = {}) {
  const clearance = finite(assetMinY) - finite(terrainHeight);
  const height = Math.max(0.001, finite(assetHeight, 1));
  const buried = clearance < -TERRAIN_ENVIRONMENT_GROUND_PARITY_POLICY.toleranceMeters;
  const floating = clearance > Math.max(0.16, height * 0.035);
  return freeze({ clearance, buried, floating, ok: !buried && !floating });
}

export function waterAssetParity({ waterDepth = 0, category = 'tree' } = {}) {
  const depth = Math.max(0, finite(waterDepth));
  const allowed = depth <= TERRAIN_ENVIRONMENT_GROUND_PARITY_POLICY.maxDryAssetWaterDepth || category === 'bridge';
  return freeze({ waterDepth: depth, category, ok: allowed });
}

export function environmentFootprintOffsets(category = 'rock', radiusMeters = 1) {
  const r = Math.max(0.1, finite(radiusMeters, 1));
  if (category === 'house') return freeze([[r, r], [r, -r], [-r, r], [-r, -r], [0, 0]]);
  return freeze([[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]);
}

export function validateEnvironmentGroundContact({ category = 'rock', slopeDegrees = 0, waterDepth = 0, terrainHeight = 0, assetMinY = terrainHeight, assetHeight = 1 } = {}) {
  const errors = [];
  const slope = finite(slopeDegrees);
  if (category === 'house' && slope > TERRAIN_ENVIRONMENT_GROUND_PARITY_POLICY.maxStructureSlopeDegrees) errors.push('structure-slope-too-steep');
  const water = waterAssetParity({ waterDepth, category });
  if (!water.ok) errors.push('asset-in-water');
  const clearance = assetGroundClearance({ assetMinY, terrainHeight, assetHeight });
  if (!clearance.ok) errors.push(clearance.buried ? 'asset-buried' : 'asset-floating');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), slopeDegrees: slope, water, clearance });
}

export function buildGroundParityManifest(samples = []) {
  const reports = samples.map(validateEnvironmentGroundContact);
  const errors = reports.flatMap((report) => report.errors);
  return freeze({ version: 1, policyId: TERRAIN_ENVIRONMENT_GROUND_PARITY_POLICY.id, reports, errors: freeze(errors), acceptance: freeze({ ok: errors.length === 0, errorCount: errors.length }) });
}
