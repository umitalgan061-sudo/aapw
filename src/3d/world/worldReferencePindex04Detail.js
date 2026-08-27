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
  id: 'owner-map-pindex04-detail-2026-08-27-v5-soil-horizon-weathering',
  pindex: 4,
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  macroMeters: 1540,
  mesoMeters: 430,
  fineMeters: 104,
  drainageMeters: 286,
  alluviumMeters: 760,
  interfluveMeters: 980,
  peatMeters: 360,
  oxideMeters: 610,
  boundaryProbeNormalized: 0.006,
  amplitudeBySurface: Object.freeze({ sea: 0.014, lake: 0.016, soil: 0.174, rock: 0.148, snow: 0.074 }),
  chromaBySurface: Object.freeze({ sea: 0.016, lake: 0.020, soil: 0.154, rock: 0.108, snow: 0.056 }),
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

function ridgedNoise(worldX, worldZ, cellMeters, seed) {
  return 1 - Math.abs(valueNoise(worldX, worldZ, cellMeters, seed));
}

function surfaceFabric(surface, worldX, worldZ) {
  const P = PINDEX04_DETAIL_POLICY;
  // Low-frequency warp prevents the detail bands and drainage motifs from sharing axis-aligned
  // repetition. This is visual-domain deformation only; no terrain coordinate is ever moved.
  const warpA = valueNoise(worldX, worldZ, 2180, 1.9);
  const warpB = valueNoise(worldX + 511, worldZ - 337, 1870, 2.7);
  const warpedX = worldX + warpA * 230 + warpB * 105;
  const warpedZ = worldZ - warpA * 170 + warpB * 132;
  const macro = valueNoise(warpedX, warpedZ, P.macroMeters, 4.3);
  const meso = valueNoise(warpedX - macro * 126, warpedZ + macro * 92, P.mesoMeters, 9.7);
  const fine = valueNoise(worldX + meso * 47, worldZ - meso * 39, P.fineMeters, 16.1);
  const moisture = THREE.MathUtils.clamp(0.5 + macro * 0.36 + meso * 0.19 - fine * 0.035, 0, 1);
  const mineral = THREE.MathUtils.clamp(0.5 - macro * 0.19 + meso * 0.29 + fine * 0.11, 0, 1);

  // Lowland material language: narrow dark drainage threads sit inside broader damp swales, while
  // depositional fan patches and dry interfluves occupy different spatial frequencies. These are
  // deliberately non-authoritative visual fields; actual rivers/hydrology remain owned elsewhere.
  const drainageWarp = valueNoise(warpedX + 83, warpedZ - 59, 610, 31.4);
  const drainageRidge = ridgedNoise(
    warpedX + drainageWarp * 95,
    warpedZ - drainageWarp * 71,
    P.drainageMeters,
    34.1,
  );
  const drainageThread = THREE.MathUtils.smoothstep(drainageRidge, 0.72, 0.94);
  const swaleField = valueNoise(warpedX - 210, warpedZ + 146, 540, 36.8);
  const dampSwale = THREE.MathUtils.clamp(
    drainageThread * 0.72 + Math.max(0, -swaleField) * 0.38 + Math.max(0, moisture - 0.54) * 0.42,
    0,
    1,
  );
  const fanNoise = valueNoise(warpedX + macro * 180, warpedZ - macro * 124, P.alluviumMeters, 41.2);
  const fanMeso = valueNoise(worldX - 151, worldZ + 203, 238, 43.7);
  const alluvium = THREE.MathUtils.clamp(
    Math.max(0, -fanNoise) * (0.58 + Math.max(0, -fanMeso) * 0.42)
      * (0.35 + dampSwale * 0.65),
    0,
    1,
  );
  const interfluveField = valueNoise(warpedX - 377, warpedZ - 219, P.interfluveMeters, 47.9);
  const exposedInterfluve = THREE.MathUtils.clamp(
    Math.max(0, interfluveField) * Math.max(0, 0.58 - moisture) * 2.25
      * (0.72 + Math.max(0, meso) * 0.28),
    0,
    1,
  );

  // Soil-horizon breakup adds irregular organic accumulation in persistently damp pockets and
  // oxidised mineral crust on the driest interfluves. The two masks use unrelated world-space
  // scales so they do not collapse into a repeated checker/ridge motif.
  const peatField = valueNoise(warpedX + 241, warpedZ - 173, P.peatMeters, 52.3);
  const peat = THREE.MathUtils.clamp(
    Math.max(0, -peatField) * dampSwale * (0.58 + Math.max(0, moisture - 0.55) * 1.15),
    0,
    1,
  );
  const oxideField = valueNoise(warpedX - 463, warpedZ + 307, P.oxideMeters, 58.7);
  const ironCrust = THREE.MathUtils.clamp(
    Math.max(0, oxideField) * exposedInterfluve * (0.68 + mineral * 0.32),
    0,
    1,
  );

  // Most visual energy stays at kilometre/hundreds-of-metres scale; fine grain only prevents flat
  // patches at gameplay distance and is intentionally too weak to become television-static noise.
  let luminance = macro * 0.49 + meso * 0.31 + fine * 0.12 - dampSwale * 0.15 + alluvium * 0.09
    + exposedInterfluve * 0.11 - peat * 0.08 + ironCrust * 0.055;
  let warm = mineral - 0.5;
  let cool = moisture - 0.5;

  if (surface === 'soil') {
    const meadowPatch = valueNoise(worldX - 91, worldZ + 137, 690, 21.4);
    cool += Math.max(0, meadowPatch) * 0.21 + dampSwale * 0.37 + peat * 0.18;
    warm += Math.max(0, -meadowPatch) * 0.15 + alluvium * 0.28 + exposedInterfluve * 0.34 + ironCrust * 0.22;
    luminance -= dampSwale * 0.11 + peat * 0.07;
    luminance += alluvium * 0.06 + exposedInterfluve * 0.08 + ironCrust * 0.045;
  } else if (surface === 'rock') {
    // Warped bedding reads as geological weathering without touching the mountain geometry.
    const strataWarp = macro * 0.82 + meso * 0.48;
    const strata = Math.sin(worldX * 0.0061 - worldZ * 0.0046 + strataWarp * 2.35);
    const erosion = valueNoise(worldX + strata * 34, worldZ - strata * 27, 238, 27.8);
    luminance = macro * 0.27 + meso * 0.25 + fine * 0.09 + strata * 0.24 + erosion * 0.10
      - dampSwale * 0.06 + exposedInterfluve * 0.05;
    warm += Math.max(0, mineral - 0.46) * 0.46 + exposedInterfluve * 0.10;
    cool = cool * 0.34 + dampSwale * 0.08;
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

  return { luminance, warm, cool, dampSwale, alluvium, exposedInterfluve, peat, ironCrust };
}

export function applyPindex04DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');

  let touchedVertices = 0;
  let detailEnergy = 0;
  let drainageEnergy = 0;
  let soilHorizonEnergy = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX04_DETAIL_POLICY.pindex) continue;

    const edge = pindexBoundaryWeight(c.normalizedX);
    const amplitude = (PINDEX04_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0) * edge;
    const chroma = (PINDEX04_DETAIL_POLICY.chromaBySurface[c.surface] ?? 0) * edge;
    const fabric = surfaceFabric(c.surface, worldX, worldZ);
    const shade = THREE.MathUtils.clamp(1 + fabric.luminance * amplitude, 0.80, 1.20);

    let r = color.getX(index) * shade;
    let g = color.getY(index) * shade;
    let b = color.getZ(index) * shade;
    r += (fabric.warm * 0.92 - fabric.cool * 0.25) * chroma;
    g += (fabric.cool * 0.64 + fabric.warm * 0.09) * chroma;
    b += (fabric.cool * 0.54 - fabric.warm * 0.23) * chroma;

    // Soil-specific hydrologic material breakup: damp swales are cooler/darker, recent alluvium is
    // slightly warmer/greyer, exposed interfluves are mineral-rich, and soil horizons add bounded
    // organic/oxide colour separation without changing any canonical surface classification.
    if (c.surface === 'soil') {
      r += (-fabric.dampSwale * 0.016 + fabric.alluvium * 0.018 + fabric.exposedInterfluve * 0.025
        - fabric.peat * 0.012 + fabric.ironCrust * 0.020) * edge;
      g += (fabric.dampSwale * 0.010 + fabric.alluvium * 0.006 - fabric.exposedInterfluve * 0.006
        - fabric.peat * 0.007 + fabric.ironCrust * 0.002) * edge;
      b += (fabric.dampSwale * 0.012 + fabric.alluvium * 0.004 - fabric.exposedInterfluve * 0.011
        - fabric.peat * 0.009 - fabric.ironCrust * 0.012) * edge;
      soilHorizonEnergy += (fabric.peat + fabric.ironCrust) * edge;
    }

    color.setXYZ(index,
      THREE.MathUtils.clamp(r, 0, 1),
      THREE.MathUtils.clamp(g, 0, 1),
      THREE.MathUtils.clamp(b, 0, 1));

    detailEnergy += Math.abs(fabric.luminance) * amplitude
      + (Math.abs(fabric.warm) + Math.abs(fabric.cool)) * chroma;
    drainageEnergy += (fabric.dampSwale + fabric.alluvium + fabric.exposedInterfluve) * edge;
    touchedVertices += 1;
  }

  color.needsUpdate = true;
  const summary = Object.freeze({
    policyId: PINDEX04_DETAIL_POLICY.id,
    pindex: 4,
    touchedVertices,
    meanDetailEnergy: touchedVertices > 0 ? detailEnergy / touchedVertices : 0,
    meanHydrologicMaterialEnergy: touchedVertices > 0 ? drainageEnergy / touchedVertices : 0,
    meanSoilHorizonEnergy: touchedVertices > 0 ? soilHorizonEnergy / touchedVertices : 0,
  });
  mesh.userData.run282Pindex04Detail = summary;
  return summary;
}

export function applyPindex04DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  let weightedEnergy = 0;
  let weightedHydrologicMaterialEnergy = 0;
  let weightedSoilHorizonEnergy = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex04DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    weightedEnergy += summary.meanDetailEnergy * summary.touchedVertices;
    weightedHydrologicMaterialEnergy += summary.meanHydrologicMaterialEnergy * summary.touchedVertices;
    weightedSoilHorizonEnergy += summary.meanSoilHorizonEnergy * summary.touchedVertices;
  }
  const summary = Object.freeze({
    policyId: PINDEX04_DETAIL_POLICY.id,
    pindex: 4,
    touchedVertices,
    meshCount: terrainGroup.children.length,
    meanDetailEnergy: touchedVertices > 0 ? weightedEnergy / touchedVertices : 0,
    meanHydrologicMaterialEnergy: touchedVertices > 0 ? weightedHydrologicMaterialEnergy / touchedVertices : 0,
    meanSoilHorizonEnergy: touchedVertices > 0 ? weightedSoilHorizonEnergy / touchedVertices : 0,
  });
  terrainGroup.userData.run282Pindex04Detail = summary;
  return summary;
}
