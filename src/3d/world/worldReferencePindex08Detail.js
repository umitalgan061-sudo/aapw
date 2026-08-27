/**
 * Deterministic render-only surface fabric for canonical owner-map Pindex-08.
 *
 * Classification, terrain height, hydrology and collider authority remain untouched. The module
 * only varies already-owned vertex colour in world space, replacing the old single-frequency
 * normalized-map hash with unrelated macro/meso/fine signals and surface-aware weathering.
 */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

export const PINDEX08_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex08-detail-2026-08-28-v6-readable-pedogenic-lowland-weathering',
  pindex: 8,
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  macroMeters: 1710,
  mesoMeters: 455,
  fineMeters: 108,
  grainMeters: 46,
  drainageMeters: 330,
  alluviumMeters: 620,
  seepMeters: 790,
  ironCrustMeters: 270,
  boundaryProbeNormalized: 0.006,
  amplitudeBySurface: Object.freeze({ sea: 0.018, lake: 0.020, soil: 0.188, rock: 0.160, snow: 0.086 }),
  chromaBySurface: Object.freeze({ sea: 0.020, lake: 0.022, soil: 0.162, rock: 0.114, snow: 0.064 }),
});

function hash01(ix, iz, seed = 0) {
  const value = Math.sin(ix * 193.17 + iz * 241.61 + seed * 73.43) * 43758.5453123;
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
  const probe = PINDEX08_DETAIL_POLICY.boundaryProbeNormalized;
  let same = 1;
  for (const offset of [-probe, -probe * 0.5, probe * 0.5, probe]) {
    const x = THREE.MathUtils.clamp(normalizedX + offset, 0, 1);
    if (referencePindexFromNormalizedX(x) === PINDEX08_DETAIL_POLICY.pindex) same += 1;
  }
  return same / 5;
}

function surfaceFabric(surface, worldX, worldZ) {
  const P = PINDEX08_DETAIL_POLICY;
  const macro = valueNoise(worldX, worldZ, P.macroMeters, 5.1);
  const meso = valueNoise(worldX - macro * 225, worldZ + macro * 164, P.mesoMeters, 12.3);
  const fine = valueNoise(worldX + meso * 54, worldZ - meso * 63, P.fineMeters, 19.7);
  const grain = valueNoise(worldX - fine * 21, worldZ + meso * 18, P.grainMeters, 31.4);
  const moisture = THREE.MathUtils.clamp(0.5 + macro * 0.34 + meso * 0.20 - fine * 0.05, 0, 1);
  const mineral = THREE.MathUtils.clamp(0.5 - macro * 0.12 + meso * 0.30 + fine * 0.12, 0, 1);

  let luminance = macro * 0.50 + meso * 0.34 + fine * 0.12 + grain * 0.04;
  let warm = mineral - 0.5;
  let cool = moisture - 0.5;

  if (surface === 'soil') {
    const drainageField = valueNoise(
      worldX + meso * 96 + macro * 42,
      worldZ - macro * 118 + fine * 24,
      P.drainageMeters,
      34.8,
    );
    const floodplainField = valueNoise(
      worldX - macro * 155 + fine * 31,
      worldZ + meso * 104 - macro * 38,
      P.alluviumMeters,
      42.6,
    );
    const seepField = valueNoise(
      worldX + macro * 203 - meso * 61,
      worldZ - meso * 177 + fine * 37,
      P.seepMeters,
      53.7,
    );
    const crustField = valueNoise(
      worldX - macro * 67 + fine * 49,
      worldZ + meso * 73 + grain * 19,
      P.ironCrustMeters,
      67.2,
    );
    const drainage = THREE.MathUtils.smoothstep(drainageField, 0.22, 0.78)
      * THREE.MathUtils.smoothstep(moisture, 0.43, 0.82);
    const alluvium = THREE.MathUtils.smoothstep(floodplainField, -0.02, 0.66)
      * THREE.MathUtils.smoothstep(moisture, 0.30, 0.72)
      * (1 - drainage * 0.38);
    const peatSeep = THREE.MathUtils.smoothstep(seepField, 0.08, 0.68)
      * THREE.MathUtils.smoothstep(moisture, 0.47, 0.82)
      * (1 - drainage * 0.30);
    const exposedInterfluve = THREE.MathUtils.smoothstep(mineral, 0.55, 0.88)
      * (1 - THREE.MathUtils.smoothstep(moisture, 0.34, 0.64));
    const ironCrust = THREE.MathUtils.smoothstep(crustField, 0.22, 0.76)
      * exposedInterfluve
      * (1 - alluvium * 0.42);
    luminance += alluvium * 0.17 - drainage * 0.21 - peatSeep * 0.18
      + exposedInterfluve * 0.14 + ironCrust * 0.14 + grain * 0.038;
    cool += drainage * 0.34 + alluvium * 0.08 + peatSeep * 0.38
      - exposedInterfluve * 0.17 - ironCrust * 0.16;
    warm += alluvium * 0.20 + exposedInterfluve * 0.31 + ironCrust * 0.42
      - drainage * 0.11 - peatSeep * 0.24;
  } else if (surface === 'rock') {
    const warp = macro * 0.73 - meso * 0.47;
    const strata = Math.sin(worldX * 0.0048 + worldZ * 0.0062 + warp * 3.1);
    const erosion = Math.abs(valueNoise(worldX - meso * 72, worldZ + macro * 85, 205, 27.6));
    luminance = macro * 0.32 + meso * 0.29 + fine * 0.10 + grain * 0.05 + strata * 0.27 - erosion * 0.13;
    warm += Math.max(0, mineral - 0.44) * 0.48;
    cool *= 0.32;
  } else if (surface === 'snow') {
    const scour = THREE.MathUtils.clamp(0.5 + meso * 0.31 - fine * 0.24 - macro * 0.11, 0, 1);
    luminance = macro * 0.20 + meso * 0.31 + fine * 0.17 + grain * 0.04 + (0.5 - scour) * 0.40;
    cool = scour - 0.5;
    warm *= 0.14;
  } else if (surface === 'sea' || surface === 'lake') {
    luminance = macro * 0.38 + meso * 0.23 + fine * 0.05 + grain * 0.01;
    warm *= 0.08;
    cool += macro * 0.13;
  }

  return { luminance, warm, cool };
}

export function applyPindex08DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');

  let touchedVertices = 0;
  let detailEnergy = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX08_DETAIL_POLICY.pindex) continue;

    const edge = pindexBoundaryWeight(c.normalizedX);
    const amplitude = (PINDEX08_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0) * edge;
    const chroma = (PINDEX08_DETAIL_POLICY.chromaBySurface[c.surface] ?? 0) * edge;
    const fabric = surfaceFabric(c.surface, worldX, worldZ);
    const shade = THREE.MathUtils.clamp(1 + fabric.luminance * amplitude, 0.80, 1.20);

    let r = color.getX(index) * shade;
    let g = color.getY(index) * shade;
    let b = color.getZ(index) * shade;
    r += (fabric.warm * 0.86 - fabric.cool * 0.22) * chroma;
    g += (fabric.cool * 0.58 + fabric.warm * 0.11) * chroma;
    b += (fabric.cool * 0.52 - fabric.warm * 0.21) * chroma;
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
    policyId: PINDEX08_DETAIL_POLICY.id,
    pindex: 8,
    touchedVertices,
    meanDetailEnergy: touchedVertices > 0 ? detailEnergy / touchedVertices : 0,
  });
  mesh.userData.run295Pindex08Detail = summary;
  return summary;
}

export function applyPindex08DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  let weightedEnergy = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex08DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    weightedEnergy += summary.meanDetailEnergy * summary.touchedVertices;
  }
  const summary = Object.freeze({
    policyId: PINDEX08_DETAIL_POLICY.id,
    pindex: 8,
    touchedVertices,
    meshCount: terrainGroup.children.length,
    meanDetailEnergy: touchedVertices > 0 ? weightedEnergy / touchedVertices : 0,
  });
  terrainGroup.userData.run295Pindex08Detail = summary;
  return summary;
}
