/**
 * Deterministic render-only surface fabric for canonical owner-map Pindex-07.
 *
 * Classification, terrain height, hydrology and collider authority remain untouched. The module
 * only varies already-owned vertex colour in world space, replacing the old single-frequency
 * normalized-map hash with unrelated macro/meso/fine signals and surface-aware weathering.
 */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

export const PINDEX07_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex07-detail-2026-08-26-v3-readable-worldspace-weathering',
  pindex: 7,
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  macroMeters: 1480,
  mesoMeters: 410,
  fineMeters: 94,
  boundaryProbeNormalized: 0.006,
  amplitudeBySurface: Object.freeze({ sea: 0.018, lake: 0.020, soil: 0.170, rock: 0.150, snow: 0.082 }),
  chromaBySurface: Object.freeze({ sea: 0.020, lake: 0.022, soil: 0.142, rock: 0.108, snow: 0.062 }),
});

function hash01(ix, iz, seed = 0) {
  const value = Math.sin(ix * 157.31 + iz * 269.57 + seed * 91.17) * 43758.5453123;
  return value - Math.floor(value);
}

function smooth01(value) {
  return value * value * (3 - 2 * value);
}

function valueNoise(worldX, worldZ, cellMeters, seed) {
  const gx = worldX / cellMeters;
  const gz = worldZ / cellMeters;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const tx = smooth01(gx - x0);
  const tz = smooth01(gz - z0);
  const h00 = hash01(x0, z0, seed);
  const h10 = hash01(x0 + 1, z0, seed);
  const h01 = hash01(x0, z0 + 1, seed);
  const h11 = hash01(x0 + 1, z0 + 1, seed);
  const a = THREE.MathUtils.lerp(h00, h10, tx);
  const b = THREE.MathUtils.lerp(h01, h11, tx);
  return THREE.MathUtils.lerp(a, b, tz) * 2 - 1;
}

function classificationForWorld(worldX, worldZ) {
  const mapPoint = plannedWorldXZToMapCanvas(worldX, worldZ);
  const normalized = mapCanvasToNormalizedReference(mapPoint.x, mapPoint.y);
  return {
    surface: classifyReferenceBaseSurface(normalized.x, normalized.y),
    pindex: referencePindexFromNormalizedX(normalized.x),
    normalizedX: normalized.x,
  };
}

function pindexBoundaryWeight(normalizedX) {
  const probe = PINDEX07_DETAIL_POLICY.boundaryProbeNormalized;
  let same = 1;
  for (const offset of [-probe, -probe * 0.5, probe * 0.5, probe]) {
    const x = THREE.MathUtils.clamp(normalizedX + offset, 0, 1);
    if (referencePindexFromNormalizedX(x) === PINDEX07_DETAIL_POLICY.pindex) same += 1;
  }
  return same / 5;
}

function surfaceFabric(surface, worldX, worldZ) {
  const P = PINDEX07_DETAIL_POLICY;
  const macro = valueNoise(worldX, worldZ, P.macroMeters, 3.9);
  const meso = valueNoise(worldX + macro * 190, worldZ - macro * 135, P.mesoMeters, 9.7);
  const fine = valueNoise(worldX - meso * 47, worldZ + meso * 59, P.fineMeters, 16.1);
  const moisture = THREE.MathUtils.clamp(0.5 + macro * 0.31 + meso * 0.24 - fine * 0.04, 0, 1);
  const mineral = THREE.MathUtils.clamp(0.5 - macro * 0.14 + meso * 0.28 + fine * 0.14, 0, 1);

  let luminance = macro * 0.48 + meso * 0.36 + fine * 0.16;
  let warm = mineral - 0.5;
  let cool = moisture - 0.5;

  if (surface === 'rock') {
    const warp = macro * 0.82 + meso * 0.51;
    const strata = Math.sin(worldX * 0.0059 - worldZ * 0.0046 + warp * 2.8);
    const erosion = Math.abs(valueNoise(worldX + meso * 66, worldZ - macro * 78, 185, 21.4));
    luminance = macro * 0.34 + meso * 0.28 + fine * 0.10 + strata * 0.28 - erosion * 0.12;
    warm += Math.max(0, mineral - 0.46) * 0.52;
    cool *= 0.34;
  } else if (surface === 'snow') {
    const windCrust = THREE.MathUtils.clamp(0.5 + meso * 0.34 - fine * 0.23 + macro * 0.10, 0, 1);
    luminance = macro * 0.18 + meso * 0.34 + fine * 0.20 + (0.5 - windCrust) * 0.38;
    cool = windCrust - 0.5;
    warm *= 0.16;
  } else if (surface === 'sea' || surface === 'lake') {
    luminance = macro * 0.40 + meso * 0.22 + fine * 0.07;
    warm *= 0.10;
    cool += macro * 0.15;
  }

  return { luminance, warm, cool };
}

export function applyPindex07DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');

  let touchedVertices = 0;
  let detailEnergy = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX07_DETAIL_POLICY.pindex) continue;

    const edge = pindexBoundaryWeight(c.normalizedX);
    const amplitude = (PINDEX07_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0) * edge;
    const chroma = (PINDEX07_DETAIL_POLICY.chromaBySurface[c.surface] ?? 0) * edge;
    const fabric = surfaceFabric(c.surface, worldX, worldZ);
    const shade = THREE.MathUtils.clamp(1 + fabric.luminance * amplitude, 0.80, 1.20);

    let r = color.getX(index) * shade;
    let g = color.getY(index) * shade;
    let b = color.getZ(index) * shade;
    r += (fabric.warm * 0.88 - fabric.cool * 0.24) * chroma;
    g += (fabric.cool * 0.60 + fabric.warm * 0.10) * chroma;
    b += (fabric.cool * 0.54 - fabric.warm * 0.23) * chroma;
    color.setXYZ(index,
      THREE.MathUtils.clamp(r, 0, 1),
      THREE.MathUtils.clamp(g, 0, 1),
      THREE.MathUtils.clamp(b, 0, 1));

    detailEnergy += Math.abs(fabric.luminance) * amplitude
      + (Math.abs(fabric.warm) + Math.abs(fabric.cool)) * chroma;
    touchedVertices += 1;
  }

  color.needsUpdate = true;
  const summary = Object.freeze({
    policyId: PINDEX07_DETAIL_POLICY.id,
    pindex: 7,
    touchedVertices,
    meanDetailEnergy: touchedVertices > 0 ? detailEnergy / touchedVertices : 0,
  });
  mesh.userData.run294Pindex07Detail = summary;
  return summary;
}

export function applyPindex07DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  let weightedEnergy = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex07DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    weightedEnergy += summary.meanDetailEnergy * summary.touchedVertices;
  }
  const summary = Object.freeze({
    policyId: PINDEX07_DETAIL_POLICY.id,
    pindex: 7,
    touchedVertices,
    meshCount: terrainGroup.children.length,
    meanDetailEnergy: touchedVertices > 0 ? weightedEnergy / touchedVertices : 0,
  });
  terrainGroup.userData.run294Pindex07Detail = summary;
  return summary;
}
