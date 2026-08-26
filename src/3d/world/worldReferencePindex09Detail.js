/**
 * Deterministic render-only surface fabric for canonical owner-map Pindex-09.
 *
 * Pindex ownership, surface classification, terrain height, hydrology and colliders remain owned by
 * the canonical map/terrain systems. This module only changes the existing vertex-color attribute.
 * The previous v1 implementation sampled one high-frequency sine hash in normalized map space;
 * at aerial scale that could read as uniform television-noise and reset abruptly at a Pindex seam.
 * v2 uses deterministic world-space value noise at deliberately incommensurate scales, domain warp,
 * boundary feathering and surface-specific weathering so the far-east band reads as landform-scale
 * material rather than a repeated procedural overlay.
 */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

export const PINDEX09_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex09-detail-2026-08-27-v2-world-space-weathering',
  pindex: 9,
  macroMeters: 1680,
  mesoMeters: 470,
  fineMeters: 126,
  microMeters: 44,
  warpMeters: 760,
  boundaryFeatherNormalized: 0.018,
  mapAuthorityUnchanged: true,
  geographyAuthorityUnchanged: true,
  terrainHeightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  renderOnly: true,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (a, b, value) => {
  const t = clamp01((value - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function hash2D(ix, iz, seed) {
  let h = Math.imul((ix | 0) ^ seed, 0x45d9f3b) ^ Math.imul((iz | 0) + seed, 0x119de1f3);
  h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 15;
  return (h >>> 0) / 0x100000000;
}

function valueNoise(worldX, worldZ, scaleMeters, seed) {
  const x = worldX / scaleMeters;
  const z = worldZ / scaleMeters;
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx0 = x - x0;
  const tz0 = z - z0;
  const tx = tx0 * tx0 * (3 - 2 * tx0);
  const tz = tz0 * tz0 * (3 - 2 * tz0);
  const a = hash2D(x0, z0, seed);
  const b = hash2D(x0 + 1, z0, seed);
  const c = hash2D(x0, z0 + 1, seed);
  const d = hash2D(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

function fbm(worldX, worldZ, scaleMeters, seed) {
  let total = 0;
  let weight = 0;
  let amplitude = 0.54;
  let scale = scaleMeters;
  for (let octave = 0; octave < 4; octave += 1) {
    total += valueNoise(worldX, worldZ, scale, seed + octave * 173) * amplitude;
    weight += amplitude;
    scale /= 2.07;
    amplitude *= 0.47;
  }
  return total / weight;
}

function ridge(value) {
  return 1 - Math.abs(value * 2 - 1);
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

function pindex09BoundaryWeight(normalizedX) {
  // Pindexes are ten owner-map columns. Fade this additive color response at the 0.8/0.9 strip
  // boundaries so neighbouring Pindex detail layers meet through the unchanged canonical base color.
  const local = normalizedX * 10 - 8;
  const edgeDistance = Math.min(local, 1 - local) / 10;
  return smoothstep(0, PINDEX09_DETAIL_POLICY.boundaryFeatherNormalized, edgeDistance);
}

export function samplePindex09SurfaceFabric(worldX, worldZ, normalizedX) {
  const P = PINDEX09_DETAIL_POLICY;
  const warpA = fbm(worldX + 1700, worldZ - 900, P.warpMeters, 0x1909);
  const warpB = fbm(worldX - 2300, worldZ + 1400, P.warpMeters * 0.83, 0x29a1);
  const warpedX = worldX + (warpA - 0.5) * 430;
  const warpedZ = worldZ + (warpB - 0.5) * 430;

  const macro = fbm(warpedX, warpedZ, P.macroMeters, 0x3901);
  const meso = fbm(warpedX + 380, warpedZ - 620, P.mesoMeters, 0x49b7);
  const fine = fbm(worldX - 210, worldZ + 430, P.fineMeters, 0x59d3);
  const micro = valueNoise(worldX + 91, worldZ - 157, P.microMeters, 0x69f5);
  const drainage = ridge(fbm(warpedX - 1100, warpedZ + 700, 330, 0x79b1));
  const strata = ridge(fbm(warpedX + worldZ * 0.11, warpedZ - worldX * 0.07, 215, 0x89c3));
  const exposure = clamp01(0.18 + macro * 0.50 + meso * 0.32 - drainage * 0.20);
  const moisture = clamp01(0.52 + (0.5 - macro) * 0.46 + (0.5 - meso) * 0.34 + drainage * 0.16);
  const mineral = clamp01(0.20 + meso * 0.45 + fine * 0.30 + strata * 0.18);
  const boundary = pindex09BoundaryWeight(normalizedX);

  return Object.freeze({ macro, meso, fine, micro, drainage, strata, exposure, moisture, mineral, boundary });
}

function applyFabricToColor(color, index, surface, fabric) {
  const weight = fabric.boundary;
  if (weight <= 0) return false;

  let r = color.getX(index);
  let g = color.getY(index);
  let b = color.getZ(index);
  let shade = 1;
  let tintR = 0;
  let tintG = 0;
  let tintB = 0;

  if (surface === 'soil') {
    const dry = clamp01(1 - fabric.moisture);
    const heath = smoothstep(0.58, 0.84, fabric.exposure) * smoothstep(0.50, 0.82, fabric.mineral);
    shade = 0.965 + (fabric.macro - 0.5) * 0.11 + (fabric.meso - 0.5) * 0.075 + (fabric.fine - 0.5) * 0.030;
    tintR = dry * 0.038 + heath * 0.022 - fabric.moisture * 0.018;
    tintG = dry * 0.020 - heath * 0.010 + fabric.moisture * 0.008;
    tintB = dry * 0.006 - heath * 0.009 - fabric.moisture * 0.013;
  } else if (surface === 'rock') {
    const wetFracture = fabric.drainage * fabric.moisture;
    const iron = smoothstep(0.58, 0.86, fabric.mineral) * smoothstep(0.48, 0.80, fabric.exposure);
    shade = 0.955 + (fabric.macro - 0.5) * 0.095 + (fabric.strata - 0.5) * 0.105 + (fabric.fine - 0.5) * 0.028;
    tintR = iron * 0.038 - wetFracture * 0.030;
    tintG = iron * 0.012 - wetFracture * 0.025;
    tintB = -iron * 0.010 - wetFracture * 0.018 + (1 - fabric.exposure) * 0.012;
  } else if (surface === 'snow') {
    const scour = smoothstep(0.56, 0.84, fabric.exposure) * smoothstep(0.52, 0.84, fabric.fine);
    const grit = smoothstep(0.65, 0.90, fabric.mineral) * smoothstep(0.55, 0.86, fabric.micro);
    shade = 0.985 + (fabric.macro - 0.5) * 0.050 + (fabric.meso - 0.5) * 0.030 - grit * 0.035;
    tintR = -scour * 0.010 - grit * 0.020;
    tintG = -scour * 0.004 - grit * 0.019;
    tintB = scour * 0.014 - grit * 0.014;
  } else if (surface === 'lake' || surface === 'sea') {
    // Water ownership is canonical. Keep only very low-amplitude optical tone breakup here; geometry,
    // depth, shoreline and hydrology are never changed by this module.
    shade = 0.997 + (fabric.macro - 0.5) * 0.012 + (fabric.meso - 0.5) * 0.006;
    tintB = (fabric.macro - 0.5) * 0.006;
  } else {
    return false;
  }

  const applied = weight;
  r = THREE.MathUtils.clamp(r * lerp(1, shade, applied) + tintR * applied, 0, 1);
  g = THREE.MathUtils.clamp(g * lerp(1, shade, applied) + tintG * applied, 0, 1);
  b = THREE.MathUtils.clamp(b * lerp(1, shade, applied) + tintB * applied, 0, 1);
  color.setXYZ(index, r, g, b);
  return true;
}

export function applyPindex09DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');

  let touchedVertices = 0;
  const surfaceCounts = { sea: 0, lake: 0, soil: 0, rock: 0, snow: 0 };
  let boundaryWeightedVertices = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX09_DETAIL_POLICY.pindex) continue;

    const fabric = samplePindex09SurfaceFabric(worldX, worldZ, c.normalizedX);
    if (!applyFabricToColor(color, index, c.surface, fabric)) continue;
    touchedVertices += 1;
    if (surfaceCounts[c.surface] !== undefined) surfaceCounts[c.surface] += 1;
    if (fabric.boundary < 0.999) boundaryWeightedVertices += 1;
  }

  color.needsUpdate = true;
  const summary = Object.freeze({
    policyId: PINDEX09_DETAIL_POLICY.id,
    pindex: 9,
    touchedVertices,
    boundaryWeightedVertices,
    surfaceCounts: Object.freeze({ ...surfaceCounts }),
    geographyAuthorityUnchanged: true,
  });
  mesh.userData.run296Pindex09Detail = summary;
  return summary;
}

export function applyPindex09DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  for (const mesh of terrainGroup.children) touchedVertices += applyPindex09DetailToTerrainMesh(mesh).touchedVertices;
  const summary = Object.freeze({
    policyId: PINDEX09_DETAIL_POLICY.id,
    pindex: 9,
    touchedVertices,
    meshCount: terrainGroup.children.length,
    geographyAuthorityUnchanged: true,
  });
  terrainGroup.userData.run296Pindex09Detail = summary;
  return summary;
}
