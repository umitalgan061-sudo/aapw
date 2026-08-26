/**
 * Deterministic render-only surface fabric for canonical owner-map Pindex-04.
 *
 * The owner map remains the sole surface/geography authority. This module only breaks up the
 * western-central runtime colour field with broad moisture/mineral weathering and subordinate
 * meso/fine variation. Terrain height, hydrology, shoreline and collider output are read-only.
 */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

export const PINDEX04_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex04-detail-2026-08-26-v2-west-central-multiscale-weathering',
  pindex: 4,
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  macroMeters: 1540,
  mesoMeters: 430,
  fineMeters: 104,
  boundaryProbeNormalized: 0.006,
  amplitudeBySurface: Object.freeze({ sea: 0.014, lake: 0.016, soil: 0.125, rock: 0.112, snow: 0.055 }),
  chromaBySurface: Object.freeze({ sea: 0.016, lake: 0.020, soil: 0.112, rock: 0.082, snow: 0.042 }),
});

function hash01(ix, iz, seed = 0) {
  const value = Math.sin(ix * 127.1 + iz * 311.7 + seed * 91.337) * 43758.5453123;
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
    normalizedY: normalized.y,
  };
}

function pindexBoundaryWeight(normalizedX) {
  const probe = PINDEX04_DETAIL_POLICY.boundaryProbeNormalized;
  let same = 1;
  for (const offset of [-probe, -probe * 0.5, probe * 0.5, probe]) {
    const x = THREE.MathUtils.clamp(normalizedX + offset, 0, 1);
    if (referencePindexFromNormalizedX(x) === PINDEX04_DETAIL_POLICY.pindex) same += 1;
  }
  return same / 5;
}

function surfaceFabric(surface, worldX, worldZ) {
  const P = PINDEX04_DETAIL_POLICY;
  // Low-frequency warp prevents the three detail bands from sharing axis-aligned repetition.
  const warp = valueNoise(worldX, worldZ, 2180, 1.9);
  const macro = valueNoise(worldX + warp * 230, worldZ - warp * 170, P.macroMeters, 4.3);
  const meso = valueNoise(worldX - macro * 126, worldZ + macro * 92, P.mesoMeters, 9.7);
  const fine = valueNoise(worldX + meso * 47, worldZ - meso * 39, P.fineMeters, 16.1);
  const moisture = THREE.MathUtils.clamp(0.5 + macro * 0.36 + meso * 0.19 - fine * 0.035, 0, 1);
  const mineral = THREE.MathUtils.clamp(0.5 - macro * 0.19 + meso * 0.29 + fine * 0.11, 0, 1);

  // Most visual energy stays at kilometre/hundreds-of-metres scale; fine grain only prevents flat
  // patches at gameplay distance and is intentionally too weak to become television-static noise.
  let luminance = macro * 0.53 + meso * 0.33 + fine * 0.14;
  let warm = mineral - 0.5;
  let cool = moisture - 0.5;

  if (surface === 'soil') {
    // Moist hollows retain greener/darker character; weathered mineral/heath patches become subtly
    // warmer. Both follow independent fields, avoiding a single tint/noise knob across the region.
    const meadowPatch = valueNoise(worldX - 91, worldZ + 137, 690, 21.4);
    cool += Math.max(0, meadowPatch) * 0.18;
    warm += Math.max(0, -meadowPatch) * 0.12;
  } else if (surface === 'rock') {
    // Warped bedding reads as geological weathering without touching the mountain geometry.
    const strataWarp = macro * 0.82 + meso * 0.48;
    const strata = Math.sin(worldX * 0.0061 - worldZ * 0.0046 + strataWarp * 2.35);
    const erosion = valueNoise(worldX + strata * 34, worldZ - strata * 27, 238, 27.8);
    luminance = macro * 0.29 + meso * 0.27 + fine * 0.10 + strata * 0.24 + erosion * 0.10;
    warm += Math.max(0, mineral - 0.46) * 0.46;
    cool *= 0.34;
  } else if (surface === 'snow') {
    const crust = THREE.MathUtils.clamp(0.5 + meso * 0.31 - fine * 0.20 + macro * 0.08, 0, 1);
    luminance = macro * 0.17 + meso * 0.30 + fine * 0.18 + (0.5 - crust) * 0.35;
    cool = crust - 0.5;
    warm *= 0.15;
  } else if (surface === 'sea' || surface === 'lake') {
    // Under-water terrain remains low-energy because actual water optics own the visible surface.
    luminance = macro * 0.39 + meso * 0.20 + fine * 0.06;
    warm *= 0.10;
    cool += macro * 0.14;
  }

  return { luminance, warm, cool };
}

export function applyPindex04DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');

  let touchedVertices = 0;
  let detailEnergy = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX04_DETAIL_POLICY.pindex) continue;

    const edge = pindexBoundaryWeight(c.normalizedX);
    const amplitude = (PINDEX04_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0) * edge;
    const chroma = (PINDEX04_DETAIL_POLICY.chromaBySurface[c.surface] ?? 0) * edge;
    const fabric = surfaceFabric(c.surface, worldX, worldZ);
    const shade = THREE.MathUtils.clamp(1 + fabric.luminance * amplitude, 0.82, 1.18);

    let r = color.getX(index) * shade;
    let g = color.getY(index) * shade;
    let b = color.getZ(index) * shade;
    r += (fabric.warm * 0.92 - fabric.cool * 0.25) * chroma;
    g += (fabric.cool * 0.64 + fabric.warm * 0.09) * chroma;
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
    policyId: PINDEX04_DETAIL_POLICY.id,
    pindex: 4,
    touchedVertices,
    meanDetailEnergy: touchedVertices > 0 ? detailEnergy / touchedVertices : 0,
  });
  mesh.userData.run282Pindex04Detail = summary;
  return summary;
}

export function applyPindex04DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  let weightedEnergy = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex04DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    weightedEnergy += summary.meanDetailEnergy * summary.touchedVertices;
  }
  const summary = Object.freeze({
    policyId: PINDEX04_DETAIL_POLICY.id,
    pindex: 4,
    touchedVertices,
    meshCount: terrainGroup.children.length,
    meanDetailEnergy: touchedVertices > 0 ? weightedEnergy / touchedVertices : 0,
  });
  terrainGroup.userData.run282Pindex04Detail = summary;
  return summary;
}
