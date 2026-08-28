/**
 * Deterministic render-only surface weathering for canonical owner-map Pindex-10.
 *
 * Pindex ownership, map classification, terrain height, hydrology and colliders remain canonical.
 * This module only modifies existing terrain vertex colours. The original v1 layer used one
 * normalized-map sine hash at 1024x frequency, which read as nearly uniform procedural grain at
 * full-world scale. v4 keeps the world-space multi-scale fabric and adds readable bounded pedogenic
 * differentiation: humic seep pockets, depositional lowland patches and oxidized mineral crusts.
 * No new coastline, river, ridge or other geography is made.
 */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

export const PINDEX10_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex10-detail-2026-08-28-v4-readable-pedogenic-lowland-weathering',
  pindex: 10,
  macroMeters: 1860,
  mesoMeters: 520,
  fineMeters: 138,
  microMeters: 46,
  warpMeters: 840,
  seepMeters: 880,
  depositionMeters: 670,
  ironCrustMeters: 275,
  boundaryFeatherNormalized: 0.018,
  mapAuthorityUnchanged: true,
  geographyAuthorityUnchanged: true,
  terrainHeightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  renderOnly: true,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
  const t = clamp01((value - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
};

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
  let amplitude = 0.55;
  let scale = scaleMeters;
  for (let octave = 0; octave < 4; octave += 1) {
    total += valueNoise(worldX, worldZ, scale, seed + octave * 191) * amplitude;
    weight += amplitude;
    scale /= 2.11;
    amplitude *= 0.46;
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

function pindex10BoundaryWeight(normalizedX) {
  // Pindex-10 owns the final 0.9..1.0 canonical strip. Fade only the additive material response at
  // its western seam; the world edge itself needs no artificial fade because there is no neighbour.
  const local = normalizedX * 10 - 9;
  const westDistance = Math.max(0, local) / 10;
  return smoothstep(0, PINDEX10_DETAIL_POLICY.boundaryFeatherNormalized, westDistance);
}

export function samplePindex10SurfaceFabric(worldX, worldZ, normalizedX) {
  const P = PINDEX10_DETAIL_POLICY;
  const warpA = fbm(worldX + 2100, worldZ - 1200, P.warpMeters, 0x1a10);
  const warpB = fbm(worldX - 1600, worldZ + 1900, P.warpMeters * 0.79, 0x2b21);
  const warpedX = worldX + (warpA - 0.5) * 510;
  const warpedZ = worldZ + (warpB - 0.5) * 510;

  const macro = fbm(warpedX, warpedZ, P.macroMeters, 0x3c32);
  const meso = fbm(warpedX + 430, warpedZ - 760, P.mesoMeters, 0x4d43);
  const fine = fbm(worldX - 280, worldZ + 510, P.fineMeters, 0x5e54);
  const micro = valueNoise(worldX + 117, worldZ - 193, P.microMeters, 0x6f65);

  // Broad lowland drainage language without inventing actual rivers: this only changes colour.
  const drainageField = ridge(fbm(warpedX - 980, warpedZ + 860, 360, 0x7a76));
  const drainageThread = smoothstep(0.78, 0.965, drainageField) * (0.40 + meso * 0.60);
  const swale = smoothstep(0.58, 0.90, drainageField) * smoothstep(0.30, 0.74, 1 - macro);
  const alluvium = smoothstep(0.66, 0.92, meso) * swale * smoothstep(0.40, 0.82, fine);

  const strata = ridge(fbm(warpedX + worldZ * 0.09, warpedZ - worldX * 0.06, 235, 0x8b87));
  const exposure = clamp01(0.20 + macro * 0.46 + meso * 0.30 + strata * 0.12 - swale * 0.25);
  const moisture = clamp01(0.42 + (0.5 - macro) * 0.48 + (0.5 - meso) * 0.31 + swale * 0.28 + drainageThread * 0.18);
  const mineral = clamp01(0.22 + meso * 0.39 + fine * 0.29 + strata * 0.20 - swale * 0.11);
  const interfluve = smoothstep(0.57, 0.88, exposure) * smoothstep(0.52, 0.84, mineral) * smoothstep(0.32, 0.70, 1 - swale);

  const seepField = fbm(warpedX + macro * 260, warpedZ - meso * 210, P.seepMeters, 0x9c98);
  const depositionField = fbm(warpedX - meso * 180, warpedZ + macro * 240, P.depositionMeters, 0xada9);
  const crustField = fbm(worldX + fine * 95, worldZ - micro * 70, P.ironCrustMeters, 0xbeba);
  const humicSeep = smoothstep(0.50, 0.77, seepField)
    * smoothstep(0.48, 0.80, moisture)
    * (1 - interfluve * 0.38);
  const depositionalPatch = smoothstep(0.49, 0.78, depositionField)
    * smoothstep(0.43, 0.76, moisture)
    * (0.44 + swale * 0.56)
    * (1 - drainageThread * 0.26);
  const ironCrust = smoothstep(0.54, 0.82, crustField)
    * smoothstep(0.51, 0.83, mineral)
    * smoothstep(0.45, 0.80, exposure)
    * (1 - humicSeep * 0.50);
  const boundary = pindex10BoundaryWeight(normalizedX);

  return Object.freeze({
    macro, meso, fine, micro, drainageField, drainageThread, swale, alluvium,
    strata, exposure, moisture, mineral, interfluve, humicSeep, depositionalPatch, ironCrust, boundary,
  });
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
    const damp = fabric.swale * fabric.moisture;
    const gravel = fabric.interfluve * smoothstep(0.56, 0.86, fabric.fine);
    shade = 0.960
      + (fabric.macro - 0.5) * 0.120
      + (fabric.meso - 0.5) * 0.080
      + (fabric.fine - 0.5) * 0.034
      - fabric.drainageThread * 0.040
      + fabric.alluvium * 0.025
      - fabric.humicSeep * 0.082
      + fabric.depositionalPatch * 0.055
      + fabric.ironCrust * 0.070;
    tintR = dry * 0.035 + gravel * 0.032 + fabric.alluvium * 0.019
      + fabric.depositionalPatch * 0.043 + fabric.ironCrust * 0.080
      - damp * 0.025 - fabric.humicSeep * 0.052;
    tintG = dry * 0.017 + fabric.alluvium * 0.013 + fabric.depositionalPatch * 0.026
      - gravel * 0.007 + damp * 0.011 + fabric.humicSeep * 0.028
      + fabric.ironCrust * 0.016;
    tintB = dry * 0.003 - gravel * 0.012 - fabric.alluvium * 0.006
      - damp * 0.019 - fabric.humicSeep * 0.040 - fabric.ironCrust * 0.033;
  } else if (surface === 'rock') {
    const wetFracture = fabric.drainageThread * fabric.moisture + fabric.humicSeep * 0.18;
    const oxidized = smoothstep(0.57, 0.86, fabric.mineral) * smoothstep(0.48, 0.82, fabric.exposure);
    shade = 0.952 + (fabric.macro - 0.5) * 0.090 + (fabric.strata - 0.5) * 0.115
      + (fabric.fine - 0.5) * 0.030 + fabric.ironCrust * 0.040;
    tintR = oxidized * 0.040 + fabric.ironCrust * 0.040 - wetFracture * 0.032;
    tintG = oxidized * 0.014 + fabric.ironCrust * 0.009 - wetFracture * 0.025;
    tintB = -oxidized * 0.011 - fabric.ironCrust * 0.018 - wetFracture * 0.018 + (1 - fabric.exposure) * 0.010;
  } else if (surface === 'snow') {
    const scour = fabric.interfluve * smoothstep(0.54, 0.84, fabric.fine);
    const grit = smoothstep(0.66, 0.91, fabric.mineral) * smoothstep(0.56, 0.88, fabric.micro);
    const sheltered = fabric.swale * fabric.moisture + fabric.humicSeep * 0.14;
    shade = 0.984 + (fabric.macro - 0.5) * 0.052 + (fabric.meso - 0.5) * 0.030 + sheltered * 0.019 - grit * 0.038;
    tintR = -scour * 0.011 - grit * 0.021;
    tintG = -scour * 0.004 - grit * 0.019;
    tintB = scour * 0.015 + sheltered * 0.011 - grit * 0.014;
  } else if (surface === 'lake' || surface === 'sea') {
    // Water geometry/depth/hydrology remain canonical. Keep only restrained optical colour breakup.
    shade = 0.997 + (fabric.macro - 0.5) * 0.010 + (fabric.meso - 0.5) * 0.005;
    tintB = (fabric.macro - 0.5) * 0.005;
  } else {
    return false;
  }

  r = THREE.MathUtils.clamp(r * lerp(1, shade, weight) + tintR * weight, 0, 1);
  g = THREE.MathUtils.clamp(g * lerp(1, shade, weight) + tintG * weight, 0, 1);
  b = THREE.MathUtils.clamp(b * lerp(1, shade, weight) + tintB * weight, 0, 1);
  color.setXYZ(index, r, g, b);
  return true;
}

export function applyPindex10DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');

  let touchedVertices = 0;
  let boundaryWeightedVertices = 0;
  const surfaceCounts = { sea: 0, lake: 0, soil: 0, rock: 0, snow: 0 };
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX10_DETAIL_POLICY.pindex) continue;

    const fabric = samplePindex10SurfaceFabric(worldX, worldZ, c.normalizedX);
    if (!applyFabricToColor(color, index, c.surface, fabric)) continue;
    touchedVertices += 1;
    if (surfaceCounts[c.surface] !== undefined) surfaceCounts[c.surface] += 1;
    if (fabric.boundary < 0.999) boundaryWeightedVertices += 1;
  }

  color.needsUpdate = true;
  const summary = Object.freeze({
    policyId: PINDEX10_DETAIL_POLICY.id,
    pindex: 10,
    touchedVertices,
    boundaryWeightedVertices,
    surfaceCounts: Object.freeze({ ...surfaceCounts }),
    geographyAuthorityUnchanged: true,
  });
  mesh.userData.run317Pindex10Detail = summary;
  return summary;
}

export function applyPindex10DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  for (const mesh of terrainGroup.children) touchedVertices += applyPindex10DetailToTerrainMesh(mesh).touchedVertices;
  const summary = Object.freeze({
    policyId: PINDEX10_DETAIL_POLICY.id,
    pindex: 10,
    touchedVertices,
    meshCount: terrainGroup.children.length,
    geographyAuthorityUnchanged: true,
  });
  terrainGroup.userData.run317Pindex10Detail = summary;
  return summary;
}
