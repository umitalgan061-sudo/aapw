/** Deterministic render-only detail layer for canonical owner-map Pindex-05. */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

export const PINDEX05_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex05-detail-2026-08-27-v7-readable-lowland-drainage-mosaic',
  pindex: 5,
  amplitudeBySurface: Object.freeze({ sea: 0.004, lake: 0.004, soil: 0.058, rock: 0.046, snow: 0.020 }),
  naturalSoilFabric: true,
  worldSpaceWeathering: true,
  lowlandDrainageMosaic: true,
  legacyNormalized1024GrainRemoved: true,
  pindexStartX: 0.4,
  pindexEndX: 0.5,
  edgeFeatherFraction: 0.14,
  macroScaleMeters: 1640,
  mesoScaleMeters: 470,
  fineScaleMeters: 118,
  grainScaleMeters: 43,
  drainageScaleMeters: 310,
  alluviumScaleMeters: 520,
  floodplainScaleMeters: 760,
  seepScaleMeters: 185,
  erosionScaleMeters: 265,
  moistureStrength: 0.44,
  mineralDryStrength: 0.34,
  alluviumStrength: 0.34,
  interfluveStrength: 0.30,
  stonyStrength: 0.18,
  humicStrength: 0.26,
  clayStrength: 0.20,
  erosionApronStrength: 0.18,
  luminanceStrength: 0.17,
  wetSoilColor: 0x405735,
  dryHeathColor: 0xa48b52,
  alluviumColor: 0x617157,
  exposedMineralColor: 0xa68a61,
  stonyColor: 0x747169,
  humicColor: 0x374630,
  clayColor: 0x8e755b,
  erosionApronColor: 0x7c6b51,
  geographyAuthorityUnchanged: true,
});

const WET_SOIL = new THREE.Color(PINDEX05_DETAIL_POLICY.wetSoilColor);
const DRY_HEATH = new THREE.Color(PINDEX05_DETAIL_POLICY.dryHeathColor);
const ALLUVIUM = new THREE.Color(PINDEX05_DETAIL_POLICY.alluviumColor);
const EXPOSED_MINERAL = new THREE.Color(PINDEX05_DETAIL_POLICY.exposedMineralColor);
const STONY = new THREE.Color(PINDEX05_DETAIL_POLICY.stonyColor);
const HUMIC = new THREE.Color(PINDEX05_DETAIL_POLICY.humicColor);
const CLAY = new THREE.Color(PINDEX05_DETAIL_POLICY.clayColor);
const EROSION_APRON = new THREE.Color(PINDEX05_DETAIL_POLICY.erosionApronColor);
const scratch = new THREE.Color();

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);
function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash01(ix, iy, seed = 0) {
  let value = Math.imul((ix | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((iy | 0) + seed, 0x165667b1);
  value ^= value >>> 15;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  return (value >>> 0) / 0x100000000;
}

function valueNoise(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash01(x0, y0, seed);
  const n10 = hash01(x0 + 1, y0, seed);
  const n01 = hash01(x0, y0 + 1, seed);
  const n11 = hash01(x0 + 1, y0 + 1, seed);
  const nx0 = THREE.MathUtils.lerp(n00, n10, sx);
  const nx1 = THREE.MathUtils.lerp(n01, n11, sx);
  return THREE.MathUtils.lerp(nx0, nx1, sy) * 2 - 1;
}

function fbm(x, y, seed) {
  let amplitude = 0.56;
  let frequency = 1;
  let sum = 0;
  let weight = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    sum += valueNoise(x * frequency, y * frequency, seed + octave * 137) * amplitude;
    weight += amplitude;
    frequency *= 2.07;
    amplitude *= 0.47;
  }
  return sum / weight;
}

function ridge(value) {
  return 1 - Math.abs(value);
}

function pindexEdgeMask(normalizedX) {
  const P = PINDEX05_DETAIL_POLICY;
  const localX = clamp01((normalizedX - P.pindexStartX) / (P.pindexEndX - P.pindexStartX));
  return smoothstep(0, P.edgeFeatherFraction, localX) * smoothstep(0, P.edgeFeatherFraction, 1 - localX);
}

/** Compatibility helper retained for existing QA. The richer production path below uses world metres. */
export function resolvePindex05NaturalSoilSignals(normalizedX, normalizedY) {
  const P = PINDEX05_DETAIL_POLICY;
  const edgeMask = pindexEdgeMask(normalizedX);
  const warpX = valueNoise(normalizedX * 11.3 + 17.2, normalizedY * 9.7 - 8.4, 0x51a7) * 0.035;
  const warpY = valueNoise(normalizedX * 8.9 - 3.1, normalizedY * 12.1 + 6.7, 0x91e3) * 0.035;
  const x = normalizedX + warpX;
  const y = normalizedY + warpY;
  const macro = valueNoise(x * 7.5, y * 5.25, 0x31b5);
  const meso = valueNoise(x * 28 + 13.7, y * 23 - 5.9, 0x71c9);
  const fine = valueNoise(x * 92 - 21.4, y * 78 + 18.8, 0xb42d);
  const moisture = clamp01(0.5 + macro * 0.39 + meso * 0.17 - fine * 0.04);
  const mineralDry = clamp01(0.5 - macro * 0.30 + meso * 0.24 + fine * 0.10);
  const luminance = THREE.MathUtils.clamp(macro * 0.50 + meso * 0.34 + fine * 0.16, -1, 1);
  return { edgeMask, moisture, mineralDry, luminance };
}

export function resolvePindex05WorldWeathering(worldX, worldZ, normalizedX) {
  const P = PINDEX05_DETAIL_POLICY;
  const edgeMask = pindexEdgeMask(normalizedX);
  const warpA = fbm(worldX / 2100 + 8.7, worldZ / 1740 - 4.2, 0x6a21);
  const warpB = fbm(worldX / 1870 - 11.3, worldZ / 2250 + 7.6, 0x9d47);
  const warpedX = worldX + warpA * 330;
  const warpedZ = worldZ + warpB * 290;
  const macro = fbm(warpedX / P.macroScaleMeters, warpedZ / P.macroScaleMeters, 0x1357);
  const meso = fbm(warpedX / P.mesoScaleMeters + 13.1, warpedZ / P.mesoScaleMeters - 8.4, 0x2468);
  const fine = fbm(worldX / P.fineScaleMeters - 17.7, worldZ / P.fineScaleMeters + 21.2, 0x3579);
  const grain = valueNoise(worldX / P.grainScaleMeters + 4.8, worldZ / P.grainScaleMeters - 12.6, 0x468a);
  const drainageField = fbm(warpedX / P.drainageScaleMeters - 6.3, warpedZ / (P.drainageScaleMeters * 1.55) + 14.1, 0x579b);
  const drainage = clamp01((ridge(drainageField) - 0.55) / 0.45);
  const alluvialField = fbm(warpedX / P.alluviumScaleMeters + 19.4, warpedZ / P.alluviumScaleMeters - 3.8, 0x68ac);
  const floodplainField = fbm(
    (warpedX * 0.83 + warpedZ * 0.56) / P.floodplainScaleMeters - 2.7,
    (warpedZ * 0.83 - warpedX * 0.56) / (P.floodplainScaleMeters * 0.72) + 9.8,
    0x79bd,
  );
  const seepField = fbm(worldX / P.seepScaleMeters + 22.1, worldZ / (P.seepScaleMeters * 1.38) - 15.6, 0x8ace);
  const erosionField = fbm(
    (worldX * 0.66 - worldZ * 0.75) / P.erosionScaleMeters + 3.4,
    (worldZ * 0.66 + worldX * 0.75) / (P.erosionScaleMeters * 1.24) - 7.9,
    0x9bdf,
  );
  const moisture = clamp01(0.50 - macro * 0.32 - meso * 0.13 + drainage * 0.34 - fine * 0.035 + seepField * 0.045);
  const mineralDry = clamp01(0.50 + macro * 0.26 + meso * 0.20 + fine * 0.08 - drainage * 0.24 - seepField * 0.03);
  const alluvium = edgeMask * drainage * smoothstep(-0.20, 0.48, alluvialField) * smoothstep(0.48, 0.78, moisture);
  const floodplain = edgeMask * smoothstep(0.36, 0.76, moisture) * smoothstep(-0.34, 0.46, floodplainField) * (0.30 + drainage * 0.70);
  const humic = edgeMask * smoothstep(0.62, 0.88, moisture) * smoothstep(0.02, 0.72, seepField) * (0.32 + floodplain * 0.68);
  const interfluve = edgeMask * (1 - drainage) * smoothstep(0.52, 0.80, mineralDry) * smoothstep(0.18, 0.74, macro);
  const stony = edgeMask * smoothstep(0.58, 0.86, fine * 0.62 + grain * 0.38) * (0.28 + interfluve * 0.72);
  const clay = edgeMask * smoothstep(0.46, 0.78, alluvium + floodplain * 0.52) * smoothstep(-0.12, 0.62, -fine);
  const erosionApron = edgeMask * (1 - drainage) * smoothstep(0.48, 0.84, Math.abs(erosionField)) * smoothstep(0.44, 0.80, mineralDry);
  const luminance = THREE.MathUtils.clamp(
    macro * 0.40 + meso * 0.29 + fine * 0.16 + grain * 0.06 + floodplainField * 0.06 + erosionField * 0.03,
    -1,
    1,
  );
  return {
    edgeMask,
    moisture,
    mineralDry,
    alluvium,
    floodplain,
    humic,
    interfluve,
    stony,
    clay,
    erosionApron,
    luminance,
  };
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

export function applyPindex05DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');
  let touchedVertices = 0;
  let naturalSoilVertices = 0;
  let naturalSoilEnergy = 0;
  let drainageVertices = 0;
  let alluvialVertices = 0;
  let interfluveVertices = 0;
  let humicVertices = 0;
  let erosionApronVertices = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX05_DETAIL_POLICY.pindex) continue;
    const signal = resolvePindex05WorldWeathering(worldX, worldZ, c.normalizedX);
    const amplitude = PINDEX05_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0;
    const shade = THREE.MathUtils.clamp(1 + signal.edgeMask * signal.luminance * amplitude, 0.86, 1.14);
    scratch.setRGB(
      THREE.MathUtils.clamp(color.getX(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getY(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getZ(index) * shade, 0, 1),
    );
    if (c.surface === 'soil') {
      const wetWeight = signal.edgeMask * signal.moisture * PINDEX05_DETAIL_POLICY.moistureStrength;
      const dryWeight = signal.edgeMask * signal.mineralDry * PINDEX05_DETAIL_POLICY.mineralDryStrength;
      const alluviumWeight = signal.alluvium * PINDEX05_DETAIL_POLICY.alluviumStrength;
      const interfluveWeight = signal.interfluve * PINDEX05_DETAIL_POLICY.interfluveStrength;
      const stonyWeight = signal.stony * PINDEX05_DETAIL_POLICY.stonyStrength;
      const humicWeight = signal.humic * PINDEX05_DETAIL_POLICY.humicStrength;
      const clayWeight = signal.clay * PINDEX05_DETAIL_POLICY.clayStrength;
      const erosionApronWeight = signal.erosionApron * PINDEX05_DETAIL_POLICY.erosionApronStrength;
      scratch.lerp(WET_SOIL, wetWeight);
      scratch.lerp(HUMIC, humicWeight);
      scratch.lerp(ALLUVIUM, alluviumWeight);
      scratch.lerp(CLAY, clayWeight);
      scratch.lerp(DRY_HEATH, dryWeight);
      scratch.lerp(EXPOSED_MINERAL, interfluveWeight);
      scratch.lerp(EROSION_APRON, erosionApronWeight);
      scratch.lerp(STONY, stonyWeight);
      const tonal = 1 + signal.edgeMask * signal.luminance * PINDEX05_DETAIL_POLICY.luminanceStrength;
      scratch.multiplyScalar(tonal);
      naturalSoilVertices += signal.edgeMask > 0.01 ? 1 : 0;
      drainageVertices += signal.moisture > 0.62 && signal.edgeMask > 0.05 ? 1 : 0;
      alluvialVertices += signal.alluvium > 0.08 ? 1 : 0;
      interfluveVertices += signal.interfluve > 0.08 ? 1 : 0;
      humicVertices += signal.humic > 0.06 ? 1 : 0;
      erosionApronVertices += signal.erosionApron > 0.08 ? 1 : 0;
      naturalSoilEnergy += signal.edgeMask * (
        Math.abs(signal.luminance)
        + wetWeight
        + dryWeight
        + alluviumWeight
        + interfluveWeight
        + stonyWeight
        + humicWeight
        + clayWeight
        + erosionApronWeight
      );
    } else if (c.surface === 'rock') {
      const rockWeather = signal.edgeMask * (signal.interfluve * 0.14 + signal.stony * 0.12 + signal.erosionApron * 0.08);
      scratch.lerp(STONY, rockWeather);
    } else if (c.surface === 'snow') {
      scratch.lerp(STONY, signal.edgeMask * signal.stony * 0.04);
    }
    color.setXYZ(index, clamp01(scratch.r), clamp01(scratch.g), clamp01(scratch.b));
    touchedVertices += 1;
  }
  color.needsUpdate = true;
  const summary = Object.freeze({
    policyId: PINDEX05_DETAIL_POLICY.id,
    pindex: 5,
    touchedVertices,
    naturalSoilVertices,
    naturalSoilEnergy,
    drainageVertices,
    alluvialVertices,
    interfluveVertices,
    humicVertices,
    erosionApronVertices,
  });
  mesh.userData.run292Pindex05Detail = summary;
  return summary;
}

export function applyPindex05DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  let naturalSoilVertices = 0;
  let naturalSoilEnergy = 0;
  let drainageVertices = 0;
  let alluvialVertices = 0;
  let interfluveVertices = 0;
  let humicVertices = 0;
  let erosionApronVertices = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex05DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    naturalSoilVertices += summary.naturalSoilVertices;
    naturalSoilEnergy += summary.naturalSoilEnergy;
    drainageVertices += summary.drainageVertices;
    alluvialVertices += summary.alluvialVertices;
    interfluveVertices += summary.interfluveVertices;
    humicVertices += summary.humicVertices;
    erosionApronVertices += summary.erosionApronVertices;
  }
  const summary = Object.freeze({
    policyId: PINDEX05_DETAIL_POLICY.id,
    pindex: 5,
    touchedVertices,
    naturalSoilVertices,
    naturalSoilEnergy,
    drainageVertices,
    alluvialVertices,
    interfluveVertices,
    humicVertices,
    erosionApronVertices,
    meshCount: terrainGroup.children.length,
  });
  terrainGroup.userData.run292Pindex05Detail = summary;
  return summary;
}
