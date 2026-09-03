/**
 * Pure deterministic placement for sparse Valyria volcanic render features.
 *
 * Canonical terrain owns all continuous height and albedo. This module only decides where a small
 * number of lava-crust ribbons and fault scarps may be rendered. Keeping placement renderer-free
 * makes the anti-grid, shoreline, determinism and morphology contracts testable in Node.
 *
 * @module world/valyriaVolcanicFeatures
 */

import {
  geologyHash01,
  sampleTerrainFrame,
} from './naturalGeologyPlacement.js';
import {
  VALYRIA_GEOLOGY_POLICY,
  normalizedOwnerMapAtWorldXZ,
  valyriaInfluenceAtWorldXZ,
  valyriaMorphologySignals,
  valyriaSurfaceWeights,
} from './valyriaGeology.js';

export const VALYRIA_VOLCANIC_FEATURE_POLICY = Object.freeze({
  id: 'valyria-volcanic-render-features-2026-08-31-v1-sparse-morphology',
  renderOnly: true,
  deterministic: true,
  geographyAuthorityUnchanged: true,
  canonicalTerrainOwnsContinuousSurface: true,
  blanketGridOverlayForbidden: true,
  valyriaPolicyId: VALYRIA_GEOLOGY_POLICY.id,
  gridMetersDesktop: 34,
  gridMetersMobile: 58,
  minimumDryClearanceMeters: 2.5,
  minimumInfluence: 0.14,
  lavaDrainageThreshold: 0.66,
  lavaWeightThreshold: 0.24,
  faultActivityThreshold: 0.44,
  faultEdgeThreshold: 0.32,
  minimumLavaSpacingMeters: 17,
  minimumFaultSpacingMeters: 31,
  maximumFeaturesDesktop: 190,
  maximumFeaturesMobile: 64,
});

function spacingAccepts(accepted, x, z, minimumMeters) {
  const minimumSquared = minimumMeters * minimumMeters;
  for (const feature of accepted) {
    const dx = feature.x - x;
    const dz = feature.z - z;
    if (dx * dx + dz * dz < minimumSquared) return false;
  }
  return true;
}

function worldFaultStrikeYaw(worldWidthMeters, worldDepthMeters) {
  const P = VALYRIA_GEOLOGY_POLICY;
  const dx = Math.cos(P.faultStrikeRadians) * P.coreRadius.nx * worldWidthMeters;
  const dz = Math.sin(P.faultStrikeRadians) * P.coreRadius.ny * worldDepthMeters;
  return Math.atan2(dz, dx);
}

function lavaChannelYaw(nx, ny, worldWidthMeters, worldDepthMeters, fallbackYaw) {
  const epsilon = 0.00075;
  const dx = valyriaMorphologySignals(nx + epsilon, ny).lavaDrainage
    - valyriaMorphologySignals(nx - epsilon, ny).lavaDrainage;
  const dz = valyriaMorphologySignals(nx, ny + epsilon).lavaDrainage
    - valyriaMorphologySignals(nx, ny - epsilon).lavaDrainage;
  const tangentX = -dz * worldWidthMeters;
  const tangentZ = dx * worldDepthMeters;
  return Math.hypot(tangentX, tangentZ) > 1e-7
    ? Math.atan2(tangentZ, tangentX)
    : fallbackYaw;
}

export function checksumValyriaVolcanicFeatures(features) {
  let hash = 2166136261 >>> 0;
  for (const feature of features ?? []) {
    const values = [
      feature.type === 'lava' ? 1 : 2,
      feature.x,
      feature.y,
      feature.z,
      feature.yawRadians,
      feature.scale?.x,
      feature.scale?.y,
      feature.scale?.z,
    ];
    for (const value of values) {
      const q = Math.round((Number(value) || 0) * 1000) | 0;
      hash ^= q;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

export function generateValyriaVolcanicFeatures({
  sampleHeightMeters,
  seaLevelMeters,
  seed,
  worldWidthMeters,
  worldDepthMeters,
  isMobileClass = false,
}) {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  const P = VALYRIA_GEOLOGY_POLICY;
  const F = VALYRIA_VOLCANIC_FEATURE_POLICY;
  const gridMeters = isMobileClass ? F.gridMetersMobile : F.gridMetersDesktop;
  const maximumFeatures = isMobileClass ? F.maximumFeaturesMobile : F.maximumFeaturesDesktop;
  const minNx = P.coreCenter.nx - P.coreRadius.nx * P.falloff;
  const maxNx = P.coreCenter.nx + P.coreRadius.nx * P.falloff;
  const minNy = Math.min(
    P.neckCenter.ny - P.neckRadius.ny * P.falloff,
    P.coreCenter.ny - P.coreRadius.ny * P.falloff,
  );
  const maxNy = P.coreCenter.ny + P.coreRadius.ny * P.falloff;
  const minX = (minNx - 0.5) * worldWidthMeters;
  const maxX = (maxNx - 0.5) * worldWidthMeters;
  const minZ = (minNy - 0.5) * worldDepthMeters;
  const maxZ = (maxNy - 0.5) * worldDepthMeters;
  const cols = Math.max(2, Math.ceil((maxX - minX) / gridMeters));
  const rows = Math.max(2, Math.ceil((maxZ - minZ) / gridMeters));
  const faults = [];
  const lava = [];
  const faultBaseYaw = worldFaultStrikeYaw(worldWidthMeters, worldDepthMeters);

  for (let row = 0; row < rows && faults.length + lava.length < maximumFeatures; row += 1) {
    for (let col = 0; col < cols && faults.length + lava.length < maximumFeatures; col += 1) {
      const jitterX = 0.18 + geologyHash01(seed, col, row, 811) * 0.64;
      const jitterZ = 0.18 + geologyHash01(seed, col, row, 823) * 0.64;
      const x = minX + ((col + jitterX) / cols) * (maxX - minX);
      const z = minZ + ((row + jitterZ) / rows) * (maxZ - minZ);
      const influence = valyriaInfluenceAtWorldXZ(x, z);
      if (influence < F.minimumInfluence) continue;
      const y = sampleHeightMeters(x, z);
      const heightAboveSeaMeters = y - seaLevelMeters;
      if (heightAboveSeaMeters <= F.minimumDryClearanceMeters) continue;
      const frame = sampleTerrainFrame(sampleHeightMeters, x, z, 8);
      const owner = normalizedOwnerMapAtWorldXZ(x, z);
      if (!owner.insideOwnerMap) continue;
      const morphology = valyriaMorphologySignals(owner.nx, owner.ny);
      const weights = valyriaSurfaceWeights({
        nx: owner.nx,
        ny: owner.ny,
        heightAboveSeaMeters,
        concavityMeters: frame.curvatureMeters,
        slopeDegrees: frame.slopeDegrees,
      });

      const faultScore = morphology.faultActivity * Math.abs(morphology.faultEscarpment) * influence;
      const lavaScore = Math.max(weights.lava, morphology.lavaDrainage * influence * 0.72);
      const faultEligible = faultScore >= F.faultEdgeThreshold
        && morphology.faultActivity >= F.faultActivityThreshold
        && frame.slopeDegrees >= 8
        && frame.slopeDegrees <= 57;
      const lavaEligible = morphology.lavaDrainage >= F.lavaDrainageThreshold
        && lavaScore >= F.lavaWeightThreshold
        && frame.slopeDegrees <= 34;

      if (faultEligible && (faultScore >= lavaScore * 0.82 || !lavaEligible)) {
        if (!spacingAccepts(faults, x, z, F.minimumFaultSpacingMeters)) continue;
        const scaleNoiseA = geologyHash01(seed, col, row, 839);
        const scaleNoiseB = geologyHash01(seed, col, row, 853);
        const yawJitter = (geologyHash01(seed, col, row, 857) - 0.5) * 0.22;
        faults.push(Object.freeze({
          id: `valyria-fault-${row}-${col}`,
          type: 'fault',
          x,
          y: y + 0.08,
          z,
          yawRadians: faultBaseYaw + yawJitter,
          tiltRadians: Math.min(0.26, frame.slopeRadians * 0.34),
          tiltAxisRadians: frame.downhillAngleRadians + Math.PI * 0.5,
          scale: Object.freeze({
            x: 11 + scaleNoiseA * 18 + morphology.faultActivity * 8,
            y: 5.5 + scaleNoiseB * 10 + Math.abs(morphology.faultEscarpment) * 7,
            z: 2.8 + geologyHash01(seed, col, row, 859) * 4.8,
          }),
          score: faultScore,
          influence,
          slopeDegrees: frame.slopeDegrees,
          faultActivity: morphology.faultActivity,
        }));
        continue;
      }

      if (lavaEligible) {
        if (!spacingAccepts(lava, x, z, F.minimumLavaSpacingMeters)) continue;
        const yaw = lavaChannelYaw(
          owner.nx,
          owner.ny,
          worldWidthMeters,
          worldDepthMeters,
          frame.downhillAngleRadians,
        );
        const lengthNoise = geologyHash01(seed, col, row, 863);
        const widthNoise = geologyHash01(seed, col, row, 877);
        lava.push(Object.freeze({
          id: `valyria-lava-${row}-${col}`,
          type: 'lava',
          x,
          y: y + 0.11,
          z,
          yawRadians: yaw + (geologyHash01(seed, col, row, 881) - 0.5) * 0.16,
          tiltRadians: Math.min(0.11, frame.slopeRadians * 0.18),
          tiltAxisRadians: frame.downhillAngleRadians + Math.PI * 0.5,
          scale: Object.freeze({
            x: 12 + lengthNoise * 21 + morphology.lavaDrainage * 7,
            y: 0.38 + geologyHash01(seed, col, row, 883) * 0.42,
            z: 2.1 + widthNoise * 3.7,
          }),
          score: lavaScore,
          influence,
          drainage: morphology.lavaDrainage,
          lavaWeight: weights.lava,
          slopeDegrees: frame.slopeDegrees,
        }));
      }
    }
  }

  const features = [...faults, ...lava].sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({
    policyId: F.id,
    valyriaPolicyId: P.id,
    features: Object.freeze(features),
    faultCount: faults.length,
    lavaCount: lava.length,
    checksum: checksumValyriaVolcanicFeatures(features),
    candidateGrid: Object.freeze({ rows, cols, gridMeters }),
    blanketSurfaceRemoved: true,
    canonicalTerrainOwnsContinuousSurface: true,
  });
}
