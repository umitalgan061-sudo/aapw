/**
 * Valyria / the Doom geological profile.
 *
 * This module deliberately contains no Three.js dependency. It is shared by terrain/vegetation
 * placement and the render-only natural-geology layer, so every system agrees on where Valyria is.
 * Coordinates are the owner-map transcription established by the geography branch: a shattered core
 * around VALYRIA/OROS/TYRIA plus the northern Lands of the Long Summer neck. Nothing here changes the
 * canonical sea/land mask; all uplift and volcanic treatment are explicitly dry-land gated.
 *
 * @module world/valyriaGeology
 */

import { WORLD_SCALE } from '../config.js';

const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;

function hash2(ix, iy) {
  const value = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise2(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0);
  const n10 = hash2(x0 + 1, y0);
  const n01 = hash2(x0, y0 + 1);
  const n11 = hash2(x0 + 1, y0 + 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function signedFbmNoise(x, y, octaves) {
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += (valueNoise2(x * frequency, y * frequency) * 2 - 1) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return norm > 0 ? total / norm : 0;
}

const smoothstep = (a, b, value) => {
  if (a === b) return value >= b ? 1 : 0;
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const VALYRIA_GEOLOGY_POLICY = Object.freeze({
  id: 'valyria-asset-informed-doom-geology-2026-08-27-v3-canonical-dry-authority',
  supersedes: 'valyria-asset-informed-doom-geology-2026-08-27-v2',
  geographyAuthorityUnchanged: true,
  canonicalCoastlinePreserved: true,
  canonicalWaterClassificationPreserved: true,
  deterministic: true,
  coreCenter: Object.freeze({ nx: 0.445, ny: 0.735 }),
  coreRadius: Object.freeze({ nx: 0.052, ny: 0.070 }),
  neckCenter: Object.freeze({ nx: 0.442, ny: 0.672 }),
  neckRadius: Object.freeze({ nx: 0.034, ny: 0.045 }),
  falloff: 1.45,
  // Lower than the historical 330m prototype because the current terrain already carries stronger
  // macro relief. This still turns the Doom into a volcanic highland without challenging the global
  // canonical mountain ceiling or turning the shoreline into a cliff.
  upliftMeters: 238,
  shoreRampMeters: 34,
  // Uplift may only act on owner-map samples which are overwhelmingly dry. This is intentionally much
  // stricter than `height > sea`: a blended coastal Pindex may sit numerically above sea while still
  // belonging to the canonical shoreline transition. Full uplift is restored only below 1.5% water;
  // by 10% water the volcanic height term is exact zero.
  canonicalDryWaterWeightFullAtOrBelow: 0.015,
  canonicalDryWaterWeightZeroAtOrAbove: 0.10,
  shatterFrequency: 48,
  shatterOctaves: 3,
  shatterShare: 0.42,
  calderaFrequency: 16,
  calderaCutMeters: 54,
  faultFrequency: 73,
  faultAmplitudeMeters: 18,
  renderSurfaceOffsetMeters: 0.085,
  volcanicSurfaceGridMeters: 46,
  vegetationExclusionInfluence: 0.10,
  geologyDensityBoost: 2.15,
  geologyLargeOutcropBoost: 1.65,
  palette: Object.freeze({
    basalt: Object.freeze([0.075, 0.060, 0.055]),
    weatheredBasalt: Object.freeze([0.145, 0.125, 0.115]),
    ash: Object.freeze([0.305, 0.285, 0.270]),
    sulfurAsh: Object.freeze([0.335, 0.285, 0.165]),
    lava: Object.freeze([1.0, 0.115, 0.018]),
    lavaCooling: Object.freeze([0.48, 0.075, 0.025]),
  }),
});

export function valyriaInfluence01(nx, ny) {
  const P = VALYRIA_GEOLOGY_POLICY;
  const core = Math.hypot((nx - P.coreCenter.nx) / P.coreRadius.nx, (ny - P.coreCenter.ny) / P.coreRadius.ny);
  const neck = Math.hypot((nx - P.neckCenter.nx) / P.neckRadius.nx, (ny - P.neckCenter.ny) / P.neckRadius.ny);
  return 1 - smoothstep(1, P.falloff, Math.min(core, neck));
}

export function normalizedOwnerMapAtWorldXZ(worldX, worldZ) {
  const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
  const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
  const mapX = worldX / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapX;
  const mapY = worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapY;
  return Object.freeze({
    nx: clamp01((mapX - WORLD_SCALE.MAP_BOUNDS.minX) / (WORLD_SCALE.MAP_BOUNDS.maxX - WORLD_SCALE.MAP_BOUNDS.minX)),
    ny: clamp01((mapY - WORLD_SCALE.MAP_BOUNDS.minY) / (WORLD_SCALE.MAP_BOUNDS.maxY - WORLD_SCALE.MAP_BOUNDS.minY)),
    insideOwnerMap: mapX >= WORLD_SCALE.MAP_BOUNDS.minX && mapX <= WORLD_SCALE.MAP_BOUNDS.maxX
      && mapY >= WORLD_SCALE.MAP_BOUNDS.minY && mapY <= WORLD_SCALE.MAP_BOUNDS.maxY,
  });
}

export function valyriaInfluenceAtWorldXZ(worldX, worldZ) {
  const p = normalizedOwnerMapAtWorldXZ(worldX, worldZ);
  return p.insideOwnerMap ? valyriaInfluence01(p.nx, p.ny) : 0;
}

/**
 * Canonical dry-land gate shared by terrain QA and the production height chain.
 *
 * `heightAboveSeaMeters` protects the immediate shoreline in metric space while `waterWeight`
 * protects the actual owner-map classification. The two are deliberately independent: neither a
 * noisy positive height in a wet cell nor a perfectly dry cell only centimetres above the waterline
 * is allowed to receive a full volcanic wall.
 */
export function valyriaCanonicalDryGate01(waterWeight, heightAboveSeaMeters) {
  if (!(heightAboveSeaMeters > 0)) return 0;
  const P = VALYRIA_GEOLOGY_POLICY;
  const water = clamp01(Number.isFinite(waterWeight) ? waterWeight : 1);
  if (water >= P.canonicalDryWaterWeightZeroAtOrAbove) return 0;
  const waterDry = 1 - smoothstep(
    P.canonicalDryWaterWeightFullAtOrBelow,
    P.canonicalDryWaterWeightZeroAtOrAbove,
    water,
  );
  const shoreDry = smoothstep(0, P.shoreRampMeters, heightAboveSeaMeters);
  return waterDry * shoreDry;
}

/**
 * Bounded dry-land volcanic uplift. Returns exact zero at/below sea level and on owner-map samples
 * with meaningful water coverage, so the canonical Smoking Sea and island breakup cannot be filled
 * back in by this profile.
 */
export function valyriaUpliftMeters(nx, ny, heightAboveSeaMeters, waterWeight = 0) {
  const dryGate = valyriaCanonicalDryGate01(waterWeight, heightAboveSeaMeters);
  if (dryGate <= 0) return 0;
  const influence = valyriaInfluence01(nx, ny);
  if (influence <= 0) return 0;
  const P = VALYRIA_GEOLOGY_POLICY;
  const signed = signedFbmNoise(nx * P.shatterFrequency + 41.7, ny * P.shatterFrequency - 88.3, P.shatterOctaves);
  const ridge = 1 - Math.abs(signed);
  const broadMass = (1 - P.shatterShare) + P.shatterShare * ridge;

  // Broad caldera field: a few large basins, not dozens of identical circular craters. Two differently
  // oriented fields interfere so the result reads as collapsed volcanic provinces rather than donuts.
  const calderaA = 1 - Math.abs(signedFbmNoise(nx * P.calderaFrequency + 7.1, ny * P.calderaFrequency - 13.6, 2));
  const calderaB = 1 - Math.abs(signedFbmNoise(nx * (P.calderaFrequency * 0.73) - 21.4, ny * (P.calderaFrequency * 0.91) + 17.2, 2));
  const caldera = smoothstep(0.72, 0.94, calderaA * 0.58 + calderaB * 0.42);

  // Faulting remains medium-scale and bounded; it prevents the range from becoming one smooth mound.
  const fault = signedFbmNoise(nx * P.faultFrequency - 23.9, ny * P.faultFrequency + 51.4, 2);
  const mass = P.upliftMeters * Math.pow(influence, 1.45) * broadMass;
  const cut = P.calderaCutMeters * caldera * Math.pow(influence, 1.8);
  const faulting = P.faultAmplitudeMeters * fault * influence;
  return Math.max(0, mass - cut + faulting) * dryGate;
}

export function valyriaUpliftAtWorldXZ(worldX, worldZ, heightAboveSeaMeters, waterWeight = 0) {
  const p = normalizedOwnerMapAtWorldXZ(worldX, worldZ);
  if (!p.insideOwnerMap) return 0;
  return valyriaUpliftMeters(p.nx, p.ny, heightAboveSeaMeters, waterWeight);
}

export function isValyriaBarrenAtWorldXZ(worldX, worldZ, threshold = VALYRIA_GEOLOGY_POLICY.vegetationExclusionInfluence) {
  return valyriaInfluenceAtWorldXZ(worldX, worldZ) >= threshold;
}

/**
 * Render weights for basalt / ash / lava. No colour object is allocated here; callers may apply the
 * weights to Three.Color, vertex buffers or debug telemetry without importing a renderer dependency.
 */
export function valyriaSurfaceWeights({ nx, ny, heightAboveSeaMeters, concavityMeters = 0, slopeDegrees = 0 }) {
  const influence = valyriaInfluence01(nx, ny);
  if (influence <= 0 || heightAboveSeaMeters <= 0) {
    return Object.freeze({ influence: 0, basalt: 0, ash: 0, sulfur: 0, lava: 0, cooledLava: 0 });
  }
  const ash = smoothstep(110, 330, heightAboveSeaMeters) * influence;
  const sulfur = smoothstep(0.62, 0.96, influence)
    * (1 - smoothstep(20, 42, slopeDegrees))
    * smoothstep(-0.15, 0.75, concavityMeters) * 0.44;
  const heat = smoothstep(0.48, 1, influence);
  const pool = smoothstep(0.35, 1.65, concavityMeters);
  const lava = heat * pool * (1 - smoothstep(36, 55, slopeDegrees));
  const cooledLava = heat * smoothstep(12, 32, slopeDegrees) * (1 - lava) * 0.52;
  return Object.freeze({
    influence,
    basalt: influence,
    ash,
    sulfur,
    lava,
    cooledLava,
  });
}

export function applyValyriaSurfaceColor(target, sample) {
  if (!target) return target;
  const weights = valyriaSurfaceWeights(sample);
  if (weights.influence <= 0) return target;
  const P = VALYRIA_GEOLOGY_POLICY.palette;
  const blend = (rgb, amount) => {
    const t = clamp01(amount);
    target.r += (rgb[0] - target.r) * t;
    target.g += (rgb[1] - target.g) * t;
    target.b += (rgb[2] - target.b) * t;
  };
  blend(P.basalt, weights.basalt * 0.92);
  blend(P.weatheredBasalt, weights.cooledLava * 0.58);
  blend(P.ash, weights.ash * 0.62);
  blend(P.sulfurAsh, weights.sulfur * 0.42);
  blend(P.lavaCooling, weights.lava * 0.30);
  blend(P.lava, weights.lava * 0.74);
  return target;
}

/** World-space convenience used by terrain shading without duplicating owner-map alignment logic. */
export function applyValyriaSurfaceColorAtWorldXZ(target, {
  worldX,
  worldZ,
  heightAboveSeaMeters,
  concavityMeters = 0,
  slopeDegrees = 0,
}) {
  const p = normalizedOwnerMapAtWorldXZ(worldX, worldZ);
  if (!p.insideOwnerMap) return target;
  return applyValyriaSurfaceColor(target, {
    nx: p.nx,
    ny: p.ny,
    heightAboveSeaMeters,
    concavityMeters,
    slopeDegrees,
  });
}

export function valyriaGeologyClassAtWorldXZ(worldX, worldZ, { heightAboveSeaMeters = 0, slopeDegrees = 0 } = {}) {
  const influence = valyriaInfluenceAtWorldXZ(worldX, worldZ);
  if (influence <= 0) return 'outside';
  if (heightAboveSeaMeters <= 0) return 'smoking-sea';
  if (influence > 0.72 && slopeDegrees > 28) return 'fractured-volcanic-scarp';
  if (influence > 0.68) return 'doom-core';
  if (slopeDegrees > 20) return 'basalt-ridge';
  return 'ash-flank';
}
