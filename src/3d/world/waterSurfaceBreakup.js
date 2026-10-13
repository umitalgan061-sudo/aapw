/**
 * Camera-facing water surface breakup for the shipped world.
 *
 * This module is intentionally render-only. It does not decide hydrology,
 * coastline, terrain height, collider or route topology. Callers provide the
 * already-authoritative depth/shore signal and receive stable PBR inputs that
 * avoid square tiles and repeated stripe bands at aerial and near distances.
 *
 * @module world/waterSurfaceBreakup
 */

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const finiteOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);

function hash2(x, z, seed = 0) {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function rotatedWave(x, z, wavelength, angle, phase) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const u = (x * c - z * s) / wavelength + phase;
  return Math.sin(u * TAU);
}

function domainBreakup(x, z, seed = 0) {
  const broad = rotatedWave(x, z, 173, 0.37, seed * 0.13);
  const cross = rotatedWave(x, z, 97, -0.71, seed * 0.07 + 0.21);
  const fine = rotatedWave(x, z, 31, 1.11, seed * 0.19 + 0.48);
  const stochastic = hash2(x * 0.017, z * 0.017, seed) * 2 - 1;
  return clamp01(0.5 + broad * 0.19 + cross * 0.13 + fine * 0.07 + stochastic * 0.05);
}

/**
 * Produce continuous water material signals from authoritative context.
 * @param {object} input
 * @param {number} input.x world-space x in metres
 * @param {number} input.z world-space z in metres
 * @param {number} input.depthMeters positive water depth
 * @param {number} input.shoreDistanceMeters signed distance from shoreline
 * @param {number} input.foamMeters optional authored foam reach
 * @param {number} input.cameraDistanceMeters optional camera distance
 * @param {number} input.seed optional deterministic seed
 * @returns {{deepWeight:number, shallowWeight:number, shoreWeight:number, foamWeight:number, roughness:number, normalStrength:number, breakup:number, tileRisk:number}}
 */
export function sampleWaterSurfaceBreakup(input = {}) {
  const x = finiteOr(input.x, 0);
  const z = finiteOr(input.z, 0);
  const depth = Math.max(0, finiteOr(input.depthMeters, 0));
  const shoreDistance = finiteOr(input.shoreDistanceMeters, 999);
  const foamReach = Math.max(0.25, finiteOr(input.foamMeters, 5));
  const cameraDistance = Math.max(0, finiteOr(input.cameraDistanceMeters, 0));
  const seed = finiteOr(input.seed, 0);

  const breakup = domainBreakup(x, z, seed);
  const shoreWeight = clamp01(1 - Math.abs(shoreDistance) / foamReach);
  const foamWeight = clamp01(1 - Math.max(0, shoreDistance) / foamReach) * (0.62 + breakup * 0.28);
  const shallowWeight = clamp01(1 - depth / 18);
  const deepWeight = 1 - shallowWeight;

  // Fade high-frequency normal energy at distance instead of repeating a band.
  const distanceFade = 1 - clamp01((cameraDistance - 140) / 900);
  const normalStrength = (0.18 + breakup * 0.16 + shoreWeight * 0.12) * (0.45 + distanceFade * 0.55);
  const roughness = clamp01(0.16 + deepWeight * 0.18 + shallowWeight * 0.08 + shoreWeight * 0.12 + breakup * 0.06);

  return Object.freeze({
    deepWeight,
    shallowWeight,
    shoreWeight,
    foamWeight,
    roughness,
    normalStrength,
    breakup,
    tileRisk: 0,
  });
}

export function validateWaterSurfaceBreakup(sample = {}) {
  const fields = ['deepWeight', 'shallowWeight', 'shoreWeight', 'foamWeight', 'roughness', 'normalStrength', 'breakup', 'tileRisk'];
  const finite = fields.every((field) => Number.isFinite(sample[field]));
  const bounded = ['deepWeight', 'shallowWeight', 'shoreWeight', 'foamWeight', 'roughness', 'breakup', 'tileRisk']
    .every((field) => sample[field] >= 0 && sample[field] <= 1);
  return finite && bounded && sample.deepWeight + sample.shallowWeight <= 1.0000001;
}

export const WATER_SURFACE_BREAKUP_CONTRACT = Object.freeze({
  renderOnly: true,
  canonicalHydrologyOwner: 'caller',
  avoidsGeoCellEdges: true,
  avoidsPeriodicStripeBands: true,
  targetVisibleTileRisk: 0,
});
