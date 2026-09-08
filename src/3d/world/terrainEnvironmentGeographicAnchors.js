/**
 * Macro geographic anchor system for environment distribution.
 * Anchors describe where environmental families prefer to live; they do not instantiate assets.
 */

import { terrainEnvironmentSurfaceProfile } from './terrainSurfaceFabric.js';
import { environmentSpatialNoise, deterministicSpatialOrdinal } from './terrainEnvironmentSpatialPolicy.js';
import { geologyResponseAtWorld } from './terrainEnvironmentGeologyResponse.js';
import { seasonalGeometryEnvelope } from './terrainEnvironmentSeasonalGeography.js';

const freeze = (v) => Object.freeze(v);
const norm = (v) => String(v ?? '').trim().toLowerCase();
const finite = (v, f = 0) => Number.isFinite(v) ? v : f;
const clamp01 = (v) => Math.max(0, Math.min(1, finite(v)));

export const TERRAIN_ENVIRONMENT_GEOGRAPHIC_ANCHOR_POLICY = freeze({
  id: 'terrain-environment-geographic-anchors-2026-09-08-v1',
  deterministic: true,
  worldSpace: true,
  authoredOnly: true,
  noGeometryCreation: true,
  noTerrainMutation: true,
  noHydrologyMutation: true,
  noColliderMutation: true,
  anchorFamilies: freeze(['forest-core', 'forest-edge', 'meadow-basin', 'heath-ridge', 'tundra-shelf', 'alpine-scarp', 'dry-rock', 'wetland-margin', 'settlement-buffer', 'water-margin']),
  minimumAnchorSpacingMeters: 180,
  maximumInfluenceMeters: 920,
});

const ANCHOR_PROFILES = freeze({
  'forest-core': freeze({ tree: 1.0, deadTree: 0.18, shrub: 0.46, grass: 0.62, rock: 0.20, slopeMin: 2, slopeMax: 29, moistureMin: 0.42, moistureMax: 0.92 }),
  'forest-edge': freeze({ tree: 0.66, deadTree: 0.24, shrub: 0.60, grass: 0.76, rock: 0.42, slopeMin: 3, slopeMax: 38, moistureMin: 0.28, moistureMax: 0.84 }),
  'meadow-basin': freeze({ tree: 0.22, deadTree: 0.08, shrub: 0.36, grass: 1.0, rock: 0.08, slopeMin: 0, slopeMax: 18, moistureMin: 0.32, moistureMax: 0.88 }),
  'heath-ridge': freeze({ tree: 0.30, deadTree: 0.28, shrub: 0.70, grass: 0.62, rock: 0.64, slopeMin: 6, slopeMax: 41, moistureMin: 0.12, moistureMax: 0.66 }),
  'tundra-shelf': freeze({ tree: 0.06, deadTree: 0.56, shrub: 0.22, grass: 0.40, rock: 0.72, slopeMin: 0, slopeMax: 42, moistureMin: 0.12, moistureMax: 0.76 }),
  'alpine-scarp': freeze({ tree: 0.02, deadTree: 0.42, shrub: 0.08, grass: 0.14, rock: 1.0, slopeMin: 18, slopeMax: 64, moistureMin: 0.04, moistureMax: 0.72 }),
  'dry-rock': freeze({ tree: 0.04, deadTree: 0.20, shrub: 0.24, grass: 0.22, rock: 0.94, slopeMin: 4, slopeMax: 58, moistureMin: 0.01, moistureMax: 0.48 }),
  'wetland-margin': freeze({ tree: 0.18, deadTree: 0.22, shrub: 0.66, grass: 0.86, rock: 0.10, slopeMin: 0, slopeMax: 12, moistureMin: 0.68, moistureMax: 1.0 }),
  'settlement-buffer': freeze({ tree: 0.28, deadTree: 0.10, shrub: 0.34, grass: 0.58, rock: 0.16, slopeMin: 0, slopeMax: 20, moistureMin: 0.12, moistureMax: 0.82 }),
  'water-margin': freeze({ tree: 0.12, deadTree: 0.16, shrub: 0.46, grass: 0.72, rock: 0.28, slopeMin: 0, slopeMax: 26, moistureMin: 0.54, moistureMax: 1.0 }),
});

function anchorCenters(worldWidthMeters, worldDepthMeters, seed, count = 24) {
  const centers = [];
  const columns = Math.max(3, Math.ceil(Math.sqrt(count * worldWidthMeters / Math.max(1, worldDepthMeters))));
  const rows = Math.max(3, Math.ceil(count / columns));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (centers.length >= count) break;
      const jitterX = (environmentSpatialNoise(column * 0.41 + seed * 0.001, row * 0.37 + seed * 0.002) - 0.5) * 0.72;
      const jitterZ = (environmentSpatialNoise(column * 0.27 + seed * 0.003, row * 0.59 + seed * 0.004) - 0.5) * 0.72;
      const nx = clamp01((column + 0.5 + jitterX) / columns);
      const nz = clamp01((row + 0.5 + jitterZ) / rows);
      centers.push(freeze({ index: centers.length, nx, nz }));
    }
  }
  return freeze(centers);
}

export function buildGeographicAnchors({ worldWidthMeters = 9000, worldDepthMeters = 7000, seed = 20260908, count = 30 } = {}) {
  const centers = anchorCenters(worldWidthMeters, worldDepthMeters, seed, count);
  const anchors = centers.map((center) => {
    const x = (center.nx - 0.5) * worldWidthMeters;
    const z = (center.nz - 0.5) * worldDepthMeters;
    const n = environmentSpatialNoise(x * 0.0017 + seed, z * 0.0017 - seed);
    const selector = environmentSpatialNoise(x * 0.00073 - seed, z * 0.00113 + seed);
    const family = selector < 0.18 ? 'forest-core' : selector < 0.32 ? 'forest-edge' : selector < 0.48 ? 'meadow-basin' : selector < 0.60 ? 'heath-ridge' : selector < 0.72 ? 'tundra-shelf' : selector < 0.83 ? 'alpine-scarp' : selector < 0.91 ? 'dry-rock' : selector < 0.96 ? 'wetland-margin' : selector < 0.985 ? 'settlement-buffer' : 'water-margin';
    const profile = ANCHOR_PROFILES[family];
    return freeze({ index: center.index, family, x, z, radiusMeters: 260 + n * 520, strength: 0.52 + n * 0.48, profile });
  });
  return freeze(anchors);
}

function radialInfluence(anchor, x, z) {
  const distance = Math.hypot(x - anchor.x, z - anchor.z);
  return clamp01(1 - distance / anchor.radiusMeters) ** 1.7 * anchor.strength;
}

export function sampleGeographicAnchorField({ x = 0, z = 0, anchors = [] } = {}) {
  const contributions = anchors.map((anchor) => ({ anchor, influence: radialInfluence(anchor, x, z) })).filter((entry) => entry.influence > 0.025).sort((a, b) => b.influence - a.influence);
  const top = contributions.slice(0, 5);
  const totals = { tree: 0, deadTree: 0, shrub: 0, grass: 0, rock: 0 };
  let totalInfluence = 0;
  for (const entry of top) {
    totalInfluence += entry.influence;
    for (const [key, value] of Object.entries(entry.anchor.profile)) if (key in totals) totals[key] += value * entry.influence;
  }
  const scale = totalInfluence > 0 ? 1 / totalInfluence : 0;
  return freeze({
    x: finite(x),
    z: finite(z),
    dominantFamily: top[0]?.anchor?.family ?? null,
    dominantInfluence: top[0]?.influence ?? 0,
    totalInfluence: clamp01(totalInfluence),
    density: freeze(Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, clamp01(value * scale)]))),
    contributors: freeze(top.map((entry) => freeze({ family: entry.anchor.family, influence: entry.influence, radiusMeters: entry.anchor.radiusMeters }))),
  });
}

export function buildAnchorAwareEnvironmentSample({ x = 0, z = 0, sample = {}, anchors = [] } = {}) {
  const anchorField = sampleGeographicAnchorField({ x, z, anchors });
  const surface = terrainEnvironmentSurfaceProfile({ x, z, terrainSample: sample });
  const geology = geologyResponseAtWorld({ worldX: x, worldZ: z, sample });
  const season = seasonalGeometryEnvelope({ season: sample.season ?? 'spring', biome: sample.biome ?? anchorField.dominantFamily, category: sample.category ?? 'tree', sample });
  const category = norm(sample.category || 'tree');
  const anchorDensity = category === 'rock' || category === 'cliff' || category === 'scree' ? anchorField.density.rock : category === 'dead-tree' ? anchorField.density.deadTree : category === 'shrub' ? anchorField.density.shrub : category === 'grass' ? anchorField.density.grass : anchorField.density.tree;
  const density = clamp01(anchorDensity * 0.56 + geology.density * 0.26 + season.densityFactor * 0.18);
  return freeze({
    anchorField,
    surface,
    geology,
    season,
    category,
    density,
    deterministicOrdinal: deterministicSpatialOrdinal(category, x, z),
  });
}

export function rankAnchorFamiliesAtWorld({ x = 0, z = 0, sample = {}, anchors = [] } = {}) {
  return freeze(anchors
    .map((anchor) => ({ anchor, influence: radialInfluence(anchor, x, z) }))
    .filter((entry) => entry.influence > 0)
    .sort((a, b) => b.influence - a.influence || a.anchor.family.localeCompare(b.anchor.family))
    .map((entry) => freeze({ family: entry.anchor.family, influence: entry.influence, compatibility: clamp01(entry.influence * (entry.anchor.profile.moistureMin <= finite(sample.moisture, 0.5) && entry.anchor.profile.moistureMax >= finite(sample.moisture, 0.5) ? 1 : 0.34)) })));
}

export function geographicAnchorManifest(options = {}) {
  const anchors = buildGeographicAnchors(options);
  return freeze({ policyId: TERRAIN_ENVIRONMENT_GEOGRAPHIC_ANCHOR_POLICY.id, count: anchors.length, anchors });
}

export function validateGeographicAnchors(options = {}) {
  const anchors = buildGeographicAnchors(options);
  const errors = [];
  if (anchors.length === 0) errors.push('no-anchors');
  for (const anchor of anchors) {
    if (!ANCHOR_PROFILES[anchor.family]) errors.push(`unknown-family:${anchor.family}`);
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.z)) errors.push(`non-finite-anchor:${anchor.index}`);
    if (anchor.radiusMeters < TERRAIN_ENVIRONMENT_GEOGRAPHIC_ANCHOR_POLICY.minimumAnchorSpacingMeters * 0.75) errors.push(`anchor-radius-too-small:${anchor.index}`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), count: anchors.length, policyId: TERRAIN_ENVIRONMENT_GEOGRAPHIC_ANCHOR_POLICY.id });
}
