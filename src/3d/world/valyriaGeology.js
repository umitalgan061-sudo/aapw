/**
 * Valyria / the Doom geological profile.
 *
 * Renderer-independent authority shared by canonical terrain, ecology and asset-informed geology.
 * The owner-map shoreline/water classification remains immutable: every volcanic height term is
 * dry-gated before it can enter the canonical terrain sampler.
 *
 * v4 replaces the old mostly-isotropic volcanic mass with a small hierarchy of geological processes:
 * broad shattered uplift, broken caldera basins, strike-oriented fault escarpments, lava-drainage
 * incision and erosion gullies. The fields are deliberately incommensurate and anisotropic so Valyria
 * reads as one damaged volcanic province rather than a collection of cones, donuts or noise blobs.
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
  id: 'valyria-asset-informed-doom-geology-2026-08-28-v4-natural-volcanic-morphology',
  supersedes: 'valyria-asset-informed-doom-geology-2026-08-27-v3-canonical-dry-authority',
  geographyAuthorityUnchanged: true,
  canonicalCoastlinePreserved: true,
  canonicalWaterClassificationPreserved: true,
  deterministic: true,
  coreCenter: Object.freeze({ nx: 0.445, ny: 0.735 }),
  coreRadius: Object.freeze({ nx: 0.052, ny: 0.070 }),
  neckCenter: Object.freeze({ nx: 0.442, ny: 0.672 }),
  neckRadius: Object.freeze({ nx: 0.034, ny: 0.045 }),
  falloff: 1.45,
  upliftMeters: 224,
  shoreRampMeters: 36,
  canonicalDryWaterWeightFullAtOrBelow: 0.015,
  canonicalDryWaterWeightZeroAtOrAbove: 0.10,
  shatterFrequency: 47,
  shatterOctaves: 3,
  shatterShare: 0.38,
  calderaFrequency: 15.5,
  calderaCutMeters: 48,
  brokenCalderaShoulderMeters: 13,
  faultFrequency: 68,
  faultAmplitudeMeters: 15,
  faultStrikeRadians: -0.61,
  faultScarpMeters: 19,
  faultScarpAcrossFrequency: 8.6,
  faultScarpAlongFrequency: 2.15,
  lavaDrainageFrequency: 34,
  lavaDrainageIncisionMeters: 14,
  erosionGullyFrequency: 79,
  erosionGullyCutMeters: 9,
  renderSurfaceOffsetMeters: 0.085,
  volcanicSurfaceGridMeters: 46,
  vegetationExclusionInfluence: 0.10,
  geologyDensityBoost: 2.15,
  geologyLargeOutcropBoost: 1.65,
  palette: Object.freeze({
    basalt: Object.freeze([0.090, 0.082, 0.078]),
    weatheredBasalt: Object.freeze([0.125, 0.113, 0.106]),
    ash: Object.freeze([0.240, 0.230, 0.220]),
    sulfurAsh: Object.freeze([0.250, 0.225, 0.145]),
    lava: Object.freeze([0.340, 0.075, 0.032]),
    lavaCooling: Object.freeze([0.200, 0.065, 0.045]),
  }),
});

function valyriaRegionalFrame(nx, ny) {
  const P = VALYRIA_GEOLOGY_POLICY;
  const dx = (nx - P.coreCenter.nx) / P.coreRadius.nx;
  const dy = (ny - P.coreCenter.ny) / P.coreRadius.ny;
  const c = Math.cos(P.faultStrikeRadians);
  const s = Math.sin(P.faultStrikeRadians);
  return Object.freeze({
    along: dx * c + dy * s,
    across: -dx * s + dy * c,
  });
}

export function valyriaInfluence01(nx, ny) {
  const P = VALYRIA_GEOLOGY_POLICY;
  const core = Math.hypot((nx - P.coreCenter.nx) / P.coreRadius.nx, (ny - P.coreCenter.ny) / P.coreRadius.ny);
  const neck = Math.hypot((nx - P.neckCenter.nx) / P.neckRadius.nx, (ny - P.neckCenter.ny) / P.neckRadius.ny);
  return 1 - smoothstep(1, P.falloff, Math.min(core, neck));
}

export function valyriaMorphologySignals(nx, ny) {
  const P = VALYRIA_GEOLOGY_POLICY;
  const frame = valyriaRegionalFrame(nx, ny);

  const collapseA = 1 - Math.abs(signedFbmNoise(nx * P.calderaFrequency + 7.1, ny * P.calderaFrequency - 13.6, 2));
  const collapseB = 1 - Math.abs(signedFbmNoise(nx * (P.calderaFrequency * 0.73) - 21.4, ny * (P.calderaFrequency * 0.91) + 17.2, 2));
  const collapseField = clamp01(collapseA * 0.58 + collapseB * 0.42);
  const calderaBasin = smoothstep(0.72, 0.94, collapseField);
  const shoulderBand = smoothstep(0.49, 0.73, collapseField) * (1 - smoothstep(0.74, 0.92, collapseField));
  const shoulderBreakup = 0.42 + 0.58 * clamp01(0.5 + signedFbmNoise(nx * 51.7 - 3.2, ny * 43.1 + 8.4, 2) * 0.5);
  const brokenCalderaShoulder = shoulderBand * shoulderBreakup;

  const faultWarp = signedFbmNoise(frame.along * 1.37 + 5.2, frame.across * 1.11 - 2.7, 2) * 0.22;
  const faultCarrier = signedFbmNoise(
    (frame.along + faultWarp) * P.faultScarpAlongFrequency + 11.3,
    frame.across * P.faultScarpAcrossFrequency - 7.9,
    2,
  );
  const faultEdge = smoothstep(0.58, 0.90, 1 - Math.abs(faultCarrier));
  const faultSide = faultCarrier >= 0 ? 1 : -1;
  const faultEscarpment = faultEdge * faultSide;
  const faultActivity = faultEdge * (0.55 + 0.45 * Math.abs(signedFbmNoise(nx * 37.2, ny * 29.8, 2)));

  const lavaWarp = signedFbmNoise(nx * 12.7 + 3.9, ny * 10.9 - 5.1, 2) * 0.014;
  const lavaField = signedFbmNoise(
    (nx + lavaWarp) * P.lavaDrainageFrequency + 19.1,
    (ny - lavaWarp * 0.73) * (P.lavaDrainageFrequency * 0.77) - 28.6,
    3,
  );
  const lavaChannelCore = smoothstep(0.78, 0.965, 1 - Math.abs(lavaField));
  const lavaBreakup = smoothstep(0.28, 0.78, valueNoise2(nx * 71.3 - 8.2, ny * 59.7 + 13.4));
  const lavaDrainage = lavaChannelCore * (0.38 + 0.62 * lavaBreakup);

  const gullyWarp = signedFbmNoise(nx * 18.2 - 7.1, ny * 21.6 + 4.6, 2) * 0.009;
  const gullyField = signedFbmNoise(
    (nx + gullyWarp) * P.erosionGullyFrequency + 41.6,
    (ny - gullyWarp) * (P.erosionGullyFrequency * 0.83) - 12.8,
    2,
  );
  const erosionGully = smoothstep(0.86, 0.985, 1 - Math.abs(gullyField));

  return Object.freeze({
    calderaBasin,
    brokenCalderaShoulder,
    faultEscarpment,
    faultActivity,
    lavaDrainage,
    erosionGully,
  });
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
  return waterDry * smoothstep(0, P.shoreRampMeters, heightAboveSeaMeters);
}

export function valyriaUpliftMeters(nx, ny, heightAboveSeaMeters, waterWeight = 0) {
  const dryGate = valyriaCanonicalDryGate01(waterWeight, heightAboveSeaMeters);
  if (dryGate <= 0) return 0;
  const influence = valyriaInfluence01(nx, ny);
  if (influence <= 0) return 0;
  const P = VALYRIA_GEOLOGY_POLICY;
  const signed = signedFbmNoise(nx * P.shatterFrequency + 41.7, ny * P.shatterFrequency - 88.3, P.shatterOctaves);
  const ridge = 1 - Math.abs(signed);
  const broadMass = (1 - P.shatterShare) + P.shatterShare * ridge;
  const morphology = valyriaMorphologySignals(nx, ny);
  const legacyFault = signedFbmNoise(nx * P.faultFrequency - 23.9, ny * P.faultFrequency + 51.4, 2);

  const mass = P.upliftMeters * Math.pow(influence, 1.45) * broadMass;
  const calderaCut = P.calderaCutMeters * morphology.calderaBasin * Math.pow(influence, 1.8);
  const shoulderLift = P.brokenCalderaShoulderMeters * morphology.brokenCalderaShoulder * influence;
  const faulting = P.faultAmplitudeMeters * legacyFault * influence;
  const scarp = P.faultScarpMeters * morphology.faultEscarpment * Math.pow(influence, 1.18);
  const lavaIncision = P.lavaDrainageIncisionMeters * morphology.lavaDrainage * Math.pow(influence, 1.25);
  const gullyCut = P.erosionGullyCutMeters * morphology.erosionGully * influence;
  return Math.max(0, mass - calderaCut + shoulderLift + faulting + scarp - lavaIncision - gullyCut) * dryGate;
}

export function valyriaUpliftAtWorldXZ(worldX, worldZ, heightAboveSeaMeters, waterWeight = 0) {
  const p = normalizedOwnerMapAtWorldXZ(worldX, worldZ);
  if (!p.insideOwnerMap) return 0;
  return valyriaUpliftMeters(p.nx, p.ny, heightAboveSeaMeters, waterWeight);
}

export function isValyriaBarrenAtWorldXZ(worldX, worldZ, threshold = VALYRIA_GEOLOGY_POLICY.vegetationExclusionInfluence) {
  return valyriaInfluenceAtWorldXZ(worldX, worldZ) >= threshold;
}

export function valyriaSurfaceWeights({ nx, ny, heightAboveSeaMeters, concavityMeters = 0, slopeDegrees = 0 }) {
  const influence = valyriaInfluence01(nx, ny);
  if (influence <= 0 || heightAboveSeaMeters <= 0) {
    return Object.freeze({ influence: 0, basalt: 0, ash: 0, sulfur: 0, lava: 0, cooledLava: 0, fault: 0, drainage: 0 });
  }
  const morphology = valyriaMorphologySignals(nx, ny);
  const ash = smoothstep(105, 325, heightAboveSeaMeters) * influence;
  const faultSulfur = morphology.faultActivity * smoothstep(0.56, 0.94, influence);
  const sulfur = smoothstep(0.62, 0.96, influence)
    * (1 - smoothstep(20, 42, slopeDegrees))
    * Math.max(smoothstep(-0.15, 0.75, concavityMeters), faultSulfur * 0.72) * 0.44;
  const heat = smoothstep(0.48, 1, influence);
  const pool = smoothstep(0.35, 1.65, concavityMeters);
  const drainage = morphology.lavaDrainage;
  const lavaPath = clamp01(pool * 0.38 + drainage * 0.88);
  const lava = heat * lavaPath * (1 - smoothstep(34, 53, slopeDegrees));
  const cooledLava = heat
    * clamp01(drainage * 0.62 + morphology.brokenCalderaShoulder * 0.32 + smoothstep(11, 31, slopeDegrees) * 0.24)
    * (1 - lava * 0.82) * 0.58;
  return Object.freeze({
    influence,
    basalt: influence,
    ash,
    sulfur,
    lava,
    cooledLava,
    fault: morphology.faultActivity,
    drainage,
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
  blend(P.weatheredBasalt, weights.cooledLava * 0.32);
  blend(P.ash, weights.ash * 0.42);
  blend(P.sulfurAsh, weights.sulfur * 0.28);
  blend(P.lavaCooling, weights.lava * 0.18);
  blend(P.lava, weights.lava * 0.35);
  return target;
}

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
  const p = normalizedOwnerMapAtWorldXZ(worldX, worldZ);
  const influence = p.insideOwnerMap ? valyriaInfluence01(p.nx, p.ny) : 0;
  if (influence <= 0) return 'outside';
  if (heightAboveSeaMeters <= 0) return 'smoking-sea';
  const morphology = valyriaMorphologySignals(p.nx, p.ny);
  if (morphology.faultActivity > 0.72 && slopeDegrees > 24) return 'faulted-basalt-escarpment';
  if (morphology.lavaDrainage > 0.70 && slopeDegrees < 34) return 'lava-drainage-corridor';
  if (influence > 0.72 && slopeDegrees > 28) return 'fractured-volcanic-scarp';
  if (influence > 0.68) return 'doom-core';
  if (slopeDegrees > 20) return 'basalt-ridge';
  return 'ash-flank';
}
