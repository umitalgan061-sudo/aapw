/**
 * Deterministic render-only surface fabric for canonical owner-map Pindex-06.
 *
 * Classification, terrain height, hydrology and collider authority remain untouched. This module
 * only varies the already-owned vertex colour and vertex normal in world space, using unrelated
 * macro/meso/fine scales plus bounded pedogenic lowland weathering so eastern-central terrain does
 * not read as a flat swatch or a single-frequency hash.
 */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

export const PINDEX06_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex06-detail-2026-08-28-v5-micro-normal-weathering',
  pindex: 6,
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  macroMeters: 1320,
  mesoMeters: 360,
  fineMeters: 86,
  grainMeters: 41,
  drainageMeters: 295,
  alluviumMeters: 590,
  seepMeters: 760,
  ironCrustMeters: 245,
  normalWeatherMeters: 156,
  boundaryProbeNormalized: 0.006,
  amplitudeBySurface: Object.freeze({ sea: 0.018, lake: 0.020, soil: 0.176, rock: 0.136, snow: 0.074 }),
  chromaBySurface: Object.freeze({ sea: 0.020, lake: 0.024, soil: 0.148, rock: 0.098, snow: 0.054 }),
  normalStrengthBySurface: Object.freeze({ sea: 0, lake: 0, soil: 0.22, rock: 0.34, snow: 0.11 }),
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
  const grain = valueNoise(worldX + fine * 19, worldZ - meso * 17, P.grainMeters, 23.9);
  const moisture = THREE.MathUtils.clamp(0.5 + macro * 0.34 + meso * 0.22 - fine * 0.04, 0, 1);
  const mineral = THREE.MathUtils.clamp(0.5 - macro * 0.16 + meso * 0.30 + fine * 0.12, 0, 1);

  // Broad luminance carries most of the signal; grain stays restrained so the aerial view reads as
  // weathered terrain rather than television static.
  let luminance = macro * 0.48 + meso * 0.33 + fine * 0.14 + grain * 0.05;
  let warm = mineral - 0.5;
  let cool = moisture - 0.5;

  if (surface === 'soil') {
    const drainageField = valueNoise(
      worldX + meso * 83 + macro * 36,
      worldZ - macro * 109 + fine * 29,
      P.drainageMeters,
      31.7,
    );
    const alluviumField = valueNoise(
      worldX - macro * 146 + fine * 27,
      worldZ + meso * 91 - macro * 42,
      P.alluviumMeters,
      39.4,
    );
    const seepField = valueNoise(
      worldX + macro * 191 - meso * 58,
      worldZ - meso * 163 + fine * 34,
      P.seepMeters,
      48.6,
    );
    const crustField = valueNoise(
      worldX - macro * 61 + fine * 45,
      worldZ + meso * 69 + grain * 17,
      P.ironCrustMeters,
      61.8,
    );
    const drainage = THREE.MathUtils.smoothstep(drainageField, 0.24, 0.80)
      * THREE.MathUtils.smoothstep(moisture, 0.42, 0.80);
    const alluvium = THREE.MathUtils.smoothstep(alluviumField, 0.00, 0.65)
      * THREE.MathUtils.smoothstep(moisture, 0.31, 0.72)
      * (1 - drainage * 0.36);
    const humicSeep = THREE.MathUtils.smoothstep(seepField, 0.10, 0.69)
      * THREE.MathUtils.smoothstep(moisture, 0.46, 0.82)
      * (1 - drainage * 0.28);
    const exposedInterfluve = THREE.MathUtils.smoothstep(mineral, 0.54, 0.87)
      * (1 - THREE.MathUtils.smoothstep(moisture, 0.35, 0.66));
    const ironCrust = THREE.MathUtils.smoothstep(crustField, 0.21, 0.76)
      * exposedInterfluve
      * (1 - alluvium * 0.40);

    luminance += alluvium * 0.15 - drainage * 0.19 - humicSeep * 0.16
      + exposedInterfluve * 0.12 + ironCrust * 0.13 + grain * 0.035;
    cool += drainage * 0.31 + alluvium * 0.07 + humicSeep * 0.34
      - exposedInterfluve * 0.15 - ironCrust * 0.14;
    warm += alluvium * 0.18 + exposedInterfluve * 0.28 + ironCrust * 0.38
      - drainage * 0.10 - humicSeep * 0.21;
  } else if (surface === 'rock') {
    const warp = macro * 0.9 + meso * 0.45;
    const strata = Math.sin((worldX * 0.0068 + worldZ * 0.0039) + warp * 2.4);
    const erosion = Math.abs(valueNoise(worldX - meso * 66, worldZ + macro * 78, 188, 27.2));
    luminance = macro * 0.31 + meso * 0.27 + fine * 0.11 + grain * 0.05 + strata * 0.27 - erosion * 0.11;
    warm += Math.max(0, mineral - 0.48) * 0.45;
    cool *= 0.35;
  } else if (surface === 'snow') {
    const windCrust = THREE.MathUtils.clamp(0.5 + meso * 0.34 - fine * 0.18 - macro * 0.07, 0, 1);
    luminance = macro * 0.18 + meso * 0.29 + fine * 0.19 + grain * 0.04 + (0.5 - windCrust) * 0.34;
    cool = windCrust - 0.5;
    warm *= 0.18;
  } else if (surface === 'sea' || surface === 'lake') {
    luminance = macro * 0.42 + meso * 0.23 + fine * 0.08 + grain * 0.01;
    warm *= 0.12;
    cool += macro * 0.16;
  }

  // Normal breakup follows different finite-difference scales than albedo so lighting does not
  // reveal the colour-noise pattern as a repeated emboss. Only the existing vertex normal tilts;
  // water surfaces are explicitly zero-strength and canonical geometry is never moved.
  const grainStep = P.grainMeters * 0.36;
  const weatherStep = P.normalWeatherMeters * 0.29;
  const grainX = valueNoise(worldX + grainStep, worldZ, P.grainMeters, 73.9)
    - valueNoise(worldX - grainStep, worldZ, P.grainMeters, 73.9);
  const grainZ = valueNoise(worldX, worldZ + grainStep, P.grainMeters, 73.9)
    - valueNoise(worldX, worldZ - grainStep, P.grainMeters, 73.9);
  const weatherX = valueNoise(worldX + weatherStep - meso * 21, worldZ + fine * 15, P.normalWeatherMeters, 81.7)
    - valueNoise(worldX - weatherStep - meso * 21, worldZ + fine * 15, P.normalWeatherMeters, 81.7);
  const weatherZ = valueNoise(worldX - fine * 17, worldZ + weatherStep + macro * 23, P.normalWeatherMeters, 89.3)
    - valueNoise(worldX - fine * 17, worldZ - weatherStep + macro * 23, P.normalWeatherMeters, 89.3);

  return {
    luminance,
    warm,
    cool,
    normalX: grainX * 0.62 + weatherX * 0.38,
    normalZ: grainZ * 0.62 + weatherZ * 0.38,
  };
}

export function applyPindex06DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  const normal = mesh?.geometry?.getAttribute?.('normal');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');

  let touchedVertices = 0;
  let detailEnergy = 0;
  let normalVariationEnergy = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX06_DETAIL_POLICY.pindex) continue;

    const edge = pindexBoundaryWeight(c.normalizedX);
    const amplitude = (PINDEX06_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0) * edge;
    const chroma = (PINDEX06_DETAIL_POLICY.chromaBySurface[c.surface] ?? 0) * edge;
    const fabric = surfaceFabric(c.surface, worldX, worldZ);
    const shade = THREE.MathUtils.clamp(1 + fabric.luminance * amplitude, 0.81, 1.19);

    let r = color.getX(index) * shade;
    let g = color.getY(index) * shade;
    let b = color.getZ(index) * shade;
    // Moist zones drift slightly cooler/greener while mineral-weathered zones drift warmer. The
    // shift is bounded and surface-aware; it does not overwrite the canonical semantic palette.
    r += (fabric.warm * 0.90 - fabric.cool * 0.25) * chroma;
    g += (fabric.cool * 0.61 + fabric.warm * 0.10) * chroma;
    b += (fabric.cool * 0.55 - fabric.warm * 0.23) * chroma;
    color.setXYZ(index,
      THREE.MathUtils.clamp(r, 0, 1),
      THREE.MathUtils.clamp(g, 0, 1),
      THREE.MathUtils.clamp(b, 0, 1));

    if (normal) {
      const normalStrength = (PINDEX06_DETAIL_POLICY.normalStrengthBySurface[c.surface] ?? 0) * edge;
      if (normalStrength > 0) {
        const nx = normal.getX(index) + fabric.normalX * normalStrength;
        const ny = Math.max(0.08, normal.getY(index));
        const nz = normal.getZ(index) + fabric.normalZ * normalStrength;
        const length = Math.hypot(nx, ny, nz) || 1;
        normal.setXYZ(index, nx / length, ny / length, nz / length);
        normalVariationEnergy += (Math.abs(fabric.normalX) + Math.abs(fabric.normalZ)) * normalStrength;
      }
    }

    detailEnergy += Math.abs(fabric.luminance) * amplitude + (Math.abs(fabric.warm) + Math.abs(fabric.cool)) * chroma;
    touchedVertices += 1;
  }

  color.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  const summary = Object.freeze({
    policyId: PINDEX06_DETAIL_POLICY.id,
    pindex: 6,
    touchedVertices,
    meanDetailEnergy: touchedVertices > 0 ? detailEnergy / touchedVertices : 0,
    meanNormalVariationEnergy: touchedVertices > 0 ? normalVariationEnergy / touchedVertices : 0,
  });
  mesh.userData.run293Pindex06Detail = summary;
  return summary;
}

export function applyPindex06DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  let weightedEnergy = 0;
  let weightedNormalVariationEnergy = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex06DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    weightedEnergy += summary.meanDetailEnergy * summary.touchedVertices;
    weightedNormalVariationEnergy += summary.meanNormalVariationEnergy * summary.touchedVertices;
  }
  const summary = Object.freeze({
    policyId: PINDEX06_DETAIL_POLICY.id,
    pindex: 6,
    touchedVertices,
    meshCount: terrainGroup.children.length,
    meanDetailEnergy: touchedVertices > 0 ? weightedEnergy / touchedVertices : 0,
    meanNormalVariationEnergy: touchedVertices > 0 ? weightedNormalVariationEnergy / touchedVertices : 0,
  });
  terrainGroup.userData.run293Pindex06Detail = summary;
  return summary;
}