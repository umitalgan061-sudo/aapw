/**
 * Deterministic render-only surface fabric for canonical owner-map Pindex-06.
 *
 * Classification, terrain height, hydrology and collider authority remain untouched. This module
 * only varies the already-owned vertex colour in world space, using unrelated macro/meso/fine
 * scales so the eastern-central terrain does not read as a flat swatch or a single-frequency hash.
 */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

export const PINDEX06_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex06-detail-2026-08-26-v3-visible-multiscale-fabric',
  pindex: 6,
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  macroMeters: 1320,
  mesoMeters: 360,
  fineMeters: 86,
  boundaryProbeNormalized: 0.006,
  amplitudeBySurface: Object.freeze({ sea: 0.018, lake: 0.020, soil: 0.150, rock: 0.120, snow: 0.065 }),
  chromaBySurface: Object.freeze({ sea: 0.020, lake: 0.024, soil: 0.130, rock: 0.090, snow: 0.050 }),
});

function hash01(ix, iz, seed = 0) {
  const value = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453123;
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
  const probe = PINDEX06_DETAIL_POLICY.boundaryProbeNormalized;
  let same = 1;
  for (const offset of [-probe, -probe * 0.5, probe * 0.5, probe]) {
    const x = THREE.MathUtils.clamp(normalizedX + offset, 0, 1);
    if (referencePindexFromNormalizedX(x) === PINDEX06_DETAIL_POLICY.pindex) same += 1;
  }
  return same / 5;
}

function surfaceFabric(surface, worldX, worldZ) {
  const P = PINDEX06_DETAIL_POLICY;
  const macro = valueNoise(worldX, worldZ, P.macroMeters, 2.7);
  const meso = valueNoise(worldX + macro * 170, worldZ - macro * 110, P.mesoMeters, 8.1);
  const fine = valueNoise(worldX - meso * 41, worldZ + meso * 53, P.fineMeters, 14.3);
  const moisture = THREE.MathUtils.clamp(0.5 + macro * 0.34 + meso * 0.22, 0, 1);
  const mineral = THREE.MathUtils.clamp(0.5 - macro * 0.16 + meso * 0.30 + fine * 0.12, 0, 1);

  // Broad luminance carries most of the signal; fine noise is deliberately restrained so the
  // aerial view reads as weathered terrain rather than television static.
  let luminance = macro * 0.50 + meso * 0.34 + fine * 0.16;
  let warm = mineral - 0.5;
  let cool = moisture - 0.5;

  if (surface === 'rock') {
    const warp = macro * 0.9 + meso * 0.45;
    const strata = Math.sin((worldX * 0.0068 + worldZ * 0.0039) + warp * 2.4);
    luminance = macro * 0.32 + meso * 0.28 + fine * 0.12 + strata * 0.28;
    warm += Math.max(0, mineral - 0.48) * 0.45;
    cool *= 0.35;
  } else if (surface === 'snow') {
    const windCrust = THREE.MathUtils.clamp(0.5 + meso * 0.34 - fine * 0.18, 0, 1);
    luminance = macro * 0.18 + meso * 0.30 + fine * 0.20 + (0.5 - windCrust) * 0.32;
    cool = windCrust - 0.5;
    warm *= 0.18;
  } else if (surface === 'sea' || surface === 'lake') {
    luminance = macro * 0.42 + meso * 0.23 + fine * 0.08;
    warm *= 0.12;
    cool += macro * 0.16;
  }

  return { luminance, warm, cool };
}

export function applyPindex06DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');

  let touchedVertices = 0;
  let detailEnergy = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX06_DETAIL_POLICY.pindex) continue;

    const edge = pindexBoundaryWeight(c.normalizedX);
    const amplitude = (PINDEX06_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0) * edge;
    const chroma = (PINDEX06_DETAIL_POLICY.chromaBySurface[c.surface] ?? 0) * edge;
    const fabric = surfaceFabric(c.surface, worldX, worldZ);
    const shade = THREE.MathUtils.clamp(1 + fabric.luminance * amplitude, 0.82, 1.18);

    let r = color.getX(index) * shade;
    let g = color.getY(index) * shade;
    let b = color.getZ(index) * shade;
    // Moist zones drift slightly cooler/greener while mineral-weathered zones drift warmer. The
    // shift is bounded and surface-aware; it does not overwrite the canonical semantic palette.
    r += (fabric.warm * 0.90 - fabric.cool * 0.26) * chroma;
    g += (fabric.cool * 0.62 + fabric.warm * 0.10) * chroma;
    b += (fabric.cool * 0.56 - fabric.warm * 0.24) * chroma;
    color.setXYZ(index,
      THREE.MathUtils.clamp(r, 0, 1),
      THREE.MathUtils.clamp(g, 0, 1),
      THREE.MathUtils.clamp(b, 0, 1));

    detailEnergy += Math.abs(fabric.luminance) * amplitude + (Math.abs(fabric.warm) + Math.abs(fabric.cool)) * chroma;
    touchedVertices += 1;
  }

  color.needsUpdate = true;
  const summary = Object.freeze({
    policyId: PINDEX06_DETAIL_POLICY.id,
    pindex: 6,
    touchedVertices,
    meanDetailEnergy: touchedVertices > 0 ? detailEnergy / touchedVertices : 0,
  });
  mesh.userData.run293Pindex06Detail = summary;
  return summary;
}

export function applyPindex06DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  let weightedEnergy = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex06DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    weightedEnergy += summary.meanDetailEnergy * summary.touchedVertices;
  }
  const summary = Object.freeze({
    policyId: PINDEX06_DETAIL_POLICY.id,
    pindex: 6,
    touchedVertices,
    meshCount: terrainGroup.children.length,
    meanDetailEnergy: touchedVertices > 0 ? weightedEnergy / touchedVertices : 0,
  });
  terrainGroup.userData.run293Pindex06Detail = summary;
  return summary;
}
