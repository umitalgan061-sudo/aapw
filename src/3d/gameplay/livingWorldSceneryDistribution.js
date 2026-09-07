/**
 * Geography-driven post-scatter distribution for already-created vegetation instances.
 *
 * This is deliberately not a new biome/spawn/material system. `vegetation.js` still owns the
 * deterministic instance creation and `livingWorldGeographyAdapter.js` remains the canonical
 * geographic interpretation. This bridge only evaluates the rendered instances against that
 * authority and compacts rejected instances so the visible scene follows the same geography.
 */

import * as THREE from 'three';
import { resolveLivingWorldGeography, resolveLivingWorldSceneryFamilies } from './livingWorldGeographyAdapter.js';

export const LIVING_WORLD_SCENERY_DISTRIBUTION_POLICY = Object.freeze({
  id: 'living-world-scenery-distribution-2026-09-07-v2',
  deterministic: true,
  geographyAuthority: 'livingWorldGeographyAdapter.js',
  placementAuthority: 'WorldAssetPlacementPipeline.js',
  noSecondBiomeFramework: true,
  slopeSampleOffsetMeters: 4,
  minimumWaterDepthMeters: 0.05,
  settlementBufferMeters: 75,
  roadBufferMeters: 3,
  speciesAcceptance: Object.freeze({
    'vegetation-pine-trunks': Object.freeze({ snow: 0.10, north: 0.80, mountain: 0.92, westerlands: 0.56, reach: 0.50, desert: 0.08, steppe: 0.18, arid: 0.06, coast: 0.34, marsh: 0.22, jungle: 0.10, temperate: 0.56, valyria: 0.03 }),
    'vegetation-pine-foliage': Object.freeze({ snow: 0.10, north: 0.80, mountain: 0.92, westerlands: 0.56, reach: 0.50, desert: 0.08, steppe: 0.18, arid: 0.06, coast: 0.34, marsh: 0.22, jungle: 0.10, temperate: 0.56, valyria: 0.03 }),
    'vegetation-round-trunks': Object.freeze({ snow: 0.03, north: 0.52, mountain: 0.20, westerlands: 0.86, reach: 0.94, desert: 0.04, steppe: 0.16, arid: 0.02, coast: 0.58, marsh: 0.48, jungle: 0.22, temperate: 0.90, valyria: 0.02 }),
    'vegetation-round-foliage': Object.freeze({ snow: 0.03, north: 0.52, mountain: 0.20, westerlands: 0.86, reach: 0.94, desert: 0.04, steppe: 0.16, arid: 0.02, coast: 0.58, marsh: 0.48, jungle: 0.22, temperate: 0.90, valyria: 0.02 }),
    'vegetation-snow-pine-trunks': Object.freeze({ snow: 0.96, north: 0.92, mountain: 0.88, westerlands: 0.20, reach: 0.12, desert: 0.00, steppe: 0.10, arid: 0.00, coast: 0.16, marsh: 0.06, jungle: 0.00, temperate: 0.12, valyria: 0.00 }),
    'vegetation-snow-pine-foliage': Object.freeze({ snow: 0.96, north: 0.92, mountain: 0.88, westerlands: 0.20, reach: 0.12, arid: 0.00, coast: 0.16, marsh: 0.06, jungle: 0.00, desert: 0.00, steppe: 0.10, temperate: 0.12, valyria: 0.00 }),
  }),
});

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function hash01(x, z, seed = 0) {
  const mixed = Math.sin(x * 12.9898 + z * 78.233 + seed * 0.01337) * 43758.5453;
  return mixed - Math.floor(mixed);
}

function acceptanceForMesh(meshName, region) {
  return LIVING_WORLD_SCENERY_DISTRIBUTION_POLICY.speciesAcceptance[meshName]?.[region] ?? 0.18;
}

function regionScaleBias(region, meshName) {
  if (meshName.includes('snow-pine')) return ['snow', 'north', 'mountain'].includes(region) ? 1.04 : 0.96;
  if (meshName.includes('pine')) return ['mountain', 'north'].includes(region) ? 1.08 : 0.96;
  if (meshName.includes('round')) return ['reach', 'westerlands', 'temperate'].includes(region) ? 1.05 : 0.94;
  return 1;
}

function compactInstancedMesh(mesh, keepIndices, matrixCache = new THREE.Matrix4()) {
  let next = 0;
  for (const sourceIndex of keepIndices) {
    mesh.getMatrixAt(sourceIndex, matrixCache);
    mesh.setMatrixAt(next, matrixCache);
    next += 1;
  }
  mesh.count = next;
  mesh.instanceMatrix.needsUpdate = true;
  return next;
}

function sampleInstancePosition(mesh, index) {
  mesh.getMatrixAt(index, _matrix);
  _matrix.decompose(_position, _quaternion, _scale);
  return { x: finite(_position.x), y: finite(_position.y), z: finite(_position.z), scale: Math.max(0.001, finite(_scale.x, 1)) };
}

function deriveTerrainContext(point, { sampleHeightMeters, seaLevelMeters, slopeSampleOffsetMeters }) {
  if (typeof sampleHeightMeters !== 'function') {
    return { groundHeight: point.y, slopeDegrees: 0, waterDepth: 0 };
  }
  const groundHeight = finite(sampleHeightMeters(point.x, point.z), point.y);
  const offset = Math.max(1, finite(slopeSampleOffsetMeters, 4));
  const dx = finite(sampleHeightMeters(point.x + offset, point.z), groundHeight) - groundHeight;
  const dz = finite(sampleHeightMeters(point.x, point.z + offset), groundHeight) - groundHeight;
  const slopeDegrees = (Math.atan2(Math.max(Math.abs(dx), Math.abs(dz)), offset) * 180) / Math.PI;
  const waterDepth = Math.max(0, finite(seaLevelMeters, 0) - groundHeight);
  return { groundHeight, slopeDegrees, waterDepth };
}

export function auditLivingWorldSceneryInstance(mesh, index, {
  seed = 0,
  sampleHeightMeters = null,
  seaLevelMeters = 0,
  settlementSeats = [],
  roadEdges = [],
  waterDepthMeters = null,
  slopeDegrees = null,
} = {}) {
  const point = sampleInstancePosition(mesh, index);
  const terrain = deriveTerrainContext(point, {
    sampleHeightMeters,
    seaLevelMeters,
    slopeSampleOffsetMeters: LIVING_WORLD_SCENERY_DISTRIBUTION_POLICY.slopeSampleOffsetMeters,
  });
  const resolvedSlopeDegrees = Number.isFinite(slopeDegrees) ? slopeDegrees : terrain.slopeDegrees;
  const resolvedWaterDepth = Number.isFinite(waterDepthMeters) ? waterDepthMeters : terrain.waterDepth;
  const geography = resolveLivingWorldGeography({
    worldX: point.x,
    worldZ: point.z,
    role: 'guard',
    groundHeight: terrain.groundHeight,
    slopeDegrees: resolvedSlopeDegrees,
    waterDepth: resolvedWaterDepth,
    settlementDistance: nearestSettlementDistance(point, settlementSeats),
    roadDistance: nearestRoadDistance(point, roadEdges),
    seed,
  });
  const families = resolveLivingWorldSceneryFamilies(point.x, point.z);
  const acceptance = acceptanceForMesh(mesh.name, geography.region);
  const roll = hash01(point.x, point.z, seed ^ mesh.name.length);
  const acceptedByHabitat = geography.ok;
  const acceptedByRegion = roll <= acceptance;
  return Object.freeze({
    ok: acceptedByHabitat && acceptedByRegion,
    reason: !acceptedByHabitat ? `geography:${geography.reason}` : acceptedByRegion ? 'distribution-valid' : 'region-density',
    region: geography.region,
    families: families.families,
    geography,
    roll,
    acceptance,
    groundHeight: terrain.groundHeight,
    slopeDegrees: resolvedSlopeDegrees,
    waterDepth: resolvedWaterDepth,
    scale: point.scale * regionScaleBias(geography.region, mesh.name),
    position: Object.freeze({ x: point.x, y: point.y, z: point.z }),
  });
}

export function applyLivingWorldVegetationDistribution(group, {
  seed = 0,
  sampleHeightMeters = null,
  seaLevelMeters = 0,
  settlementSeats = [],
  roadEdges = [],
} = {}) {
  const stats = {
    policyId: LIVING_WORLD_SCENERY_DISTRIBUTION_POLICY.id,
    deterministic: true,
    scannedInstances: 0,
    keptInstances: 0,
    rejectedByGeography: 0,
    rejectedByRegionDensity: 0,
    regions: Object.create(null),
    maxObservedSlopeDegrees: 0,
    maxObservedWaterDepth: 0,
  };

  if (!group) return Object.freeze(stats);

  for (const mesh of group.children) {
    if (!mesh?.isInstancedMesh || !/^vegetation-(?:pine|round|snow-pine)-(?:trunks|foliage)$/.test(mesh.name)) continue;
    const keep = [];
    const count = mesh.count;
    stats.scannedInstances += count;
    for (let index = 0; index < count; index += 1) {
      const audit = auditLivingWorldSceneryInstance(mesh, index, {
        seed,
        sampleHeightMeters,
        seaLevelMeters,
        settlementSeats,
        roadEdges,
      });
      stats.maxObservedSlopeDegrees = Math.max(stats.maxObservedSlopeDegrees, finite(audit.slopeDegrees));
      stats.maxObservedWaterDepth = Math.max(stats.maxObservedWaterDepth, finite(audit.waterDepth));
      stats.regions[audit.region] = (stats.regions[audit.region] || 0) + (audit.ok ? 1 : 0);
      if (!audit.ok) {
        if (audit.reason.startsWith('geography:')) stats.rejectedByGeography += 1;
        else stats.rejectedByRegionDensity += 1;
        continue;
      }
      mesh.getMatrixAt(index, _matrix);
      _matrix.decompose(_position, _quaternion, _scale);
      const scaled = audit.scale;
      _scale.set(scaled, scaled, scaled);
      _matrix.compose(_position, _quaternion, _scale);
      mesh.setMatrixAt(index, _matrix);
      keep.push(index);
    }
    stats.keptInstances += compactInstancedMesh(mesh, keep, _matrix);
  }

  group.userData.livingWorldSceneryDistribution = Object.freeze({
    ...stats,
    regions: Object.freeze({ ...stats.regions }),
    settlementAware: true,
    roadAware: true,
    terrainAware: typeof sampleHeightMeters === 'function',
    slopeDerivedFromTerrain: typeof sampleHeightMeters === 'function',
    waterDepthDerivedFromTerrain: typeof sampleHeightMeters === 'function',
    familyAuthority: 'livingWorldGeographyAdapter.js',
  });
  return Object.freeze({
    ...stats,
    regions: Object.freeze({ ...stats.regions }),
  });
}

function nearestSettlementDistance(point, seats) {
  let nearest = Infinity;
  for (const seat of seats || []) {
    if (!Number.isFinite(seat?.x) || !Number.isFinite(seat?.z)) continue;
    nearest = Math.min(nearest, Math.hypot(point.x - seat.x, point.z - seat.z));
  }
  return nearest;
}

function nearestRoadDistance(point, roadEdges) {
  let nearest = Infinity;
  for (const edge of roadEdges || []) {
    const points = Array.isArray(edge?.points) ? edge.points : [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) continue;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.z - a.z) * abz) / len2));
      nearest = Math.min(nearest, Math.hypot(point.x - (a.x + abx * t), point.z - (a.z + abz * t)));
    }
  }
  return nearest;
}
