/** Deterministic material-detail layer for canonical owner-map Pindex-03 only. */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';
import { applyWesternMarineShelfToneToColorAttribute } from './westernMarineShelfTone.js';
import {
  applyWesternReferenceSurfaceFabricToColorAttribute,
  sampleWesternReferenceSurfaceFabric,
} from './westernReferenceSurfaceFabric.js';

export const PINDEX03_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex03-detail-2026-08-30-v13-multiscale-erosion-normal',
  pindex: 3,
  westernMarineShelfTone: true,
  westernReferenceSurfaceFabric: true,
  worldSpaceMicroNormalWeathering: true,
  sharedFabricNormalSource: true,
  regionalAlbedoWeathering: true,
  directionalErosionNormal: true,
  normalMicroProbeMeters: 3.5,
  normalProbeMeters: 9.0,
  normalMacroProbeMeters: 31.0,
  normalBroadProbeMeters: 96.0,
  normalUltraBroadProbeMeters: 220.0,
  normalSnowWindProbeMeters: 18.0,
  normalErosionProbeMeters: 54.0,
  normalMicroBlend: 0.20,
  normalMacroBlend: 0.23,
  normalBroadBlend: 0.18,
  normalUltraBroadBlend: 0.13,
  normalErosionBlend: 0.18,
  normalStrengthBySurface: Object.freeze({ sea: 0, lake: 0, soil: 0.38, rock: 0.56, snow: 0.19 }),
  normalSeamFeatherNormalized: 0.012,
  mapAuthorityUnchanged: true,
  geographyAuthorityUnchanged: true,
  terrainHeightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  renderOnly: true,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function smoothstep01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function pindex03NormalWeight(normalizedX) {
  const P = PINDEX03_DETAIL_POLICY;
  const west = smoothstep01((normalizedX - 0.2) / P.normalSeamFeatherNormalized);
  const east = smoothstep01((0.3 - normalizedX) / P.normalSeamFeatherNormalized);
  return west * east;
}

function weatheringHeight(fabric, surface) {
  if (surface === 'rock') {
    return fabric.weathering * 0.24 + fabric.fracture * 0.28 + fabric.frostWash * 0.16
      + fabric.stonyPatch * 0.18 + fabric.subMicro * 0.14;
  }
  if (surface === 'snow') {
    return fabric.crust * 0.38 + fabric.fine * 0.20 + fabric.micro * 0.14
      + fabric.weathering * 0.12 + fabric.stonyPatch * 0.10 + fabric.frostWash * 0.06;
  }
  return fabric.moisture * 0.22 + fabric.mineral * 0.20 + fabric.weathering * 0.16
    + fabric.exposedInterfluve * 0.15 + fabric.stonyPatch * 0.15 + fabric.subMicro * 0.12;
}

function weatheringGradient(worldX, worldZ, step, surface) {
  const east = weatheringHeight(sampleWesternReferenceSurfaceFabric(worldX + step, worldZ), surface);
  const west = weatheringHeight(sampleWesternReferenceSurfaceFabric(worldX - step, worldZ), surface);
  const north = weatheringHeight(sampleWesternReferenceSurfaceFabric(worldX, worldZ + step), surface);
  const south = weatheringHeight(sampleWesternReferenceSurfaceFabric(worldX, worldZ - step), surface);
  return Object.freeze({ x: east - west, z: north - south });
}

function erosionSignal(fabric, surface) {
  if (surface === 'rock') {
    return fabric.erosionScour * 0.40 + fabric.fracture * 0.27
      + fabric.exposedInterfluve * 0.20 + fabric.frostWash * 0.13;
  }
  if (surface === 'snow') {
    return fabric.erosionScour * 0.22 + fabric.crust * 0.34
      + fabric.frostWash * 0.26 + fabric.weathering * 0.18;
  }
  return fabric.erosionScour * 0.38 + fabric.drainageThread * 0.27
    + fabric.exposedInterfluve * 0.21 + fabric.heathMosaic * 0.14;
}

function directionalErosionGradient(worldX, worldZ, step, surface) {
  const axisX = 0.86;
  const axisZ = 0.51;
  const crossX = -axisZ;
  const crossZ = axisX;
  const alongA = erosionSignal(sampleWesternReferenceSurfaceFabric(
    worldX + axisX * step,
    worldZ + axisZ * step,
  ), surface);
  const alongB = erosionSignal(sampleWesternReferenceSurfaceFabric(
    worldX - axisX * step,
    worldZ - axisZ * step,
  ), surface);
  const crossA = erosionSignal(sampleWesternReferenceSurfaceFabric(
    worldX + crossX * step * 0.72,
    worldZ + crossZ * step * 0.72,
  ), surface);
  const crossB = erosionSignal(sampleWesternReferenceSurfaceFabric(
    worldX - crossX * step * 0.72,
    worldZ - crossZ * step * 0.72,
  ), surface);
  const along = alongA - alongB;
  const cross = (crossA - crossB) * 0.68;
  return Object.freeze({
    x: along * axisX + cross * crossX,
    z: along * axisZ + cross * crossZ,
  });
}

function snowWindCrustGradient(worldX, worldZ, step) {
  const alongX = step * 0.82;
  const alongZ = step * 0.57;
  const lee = sampleWesternReferenceSurfaceFabric(worldX + alongX, worldZ + alongZ);
  const windward = sampleWesternReferenceSurfaceFabric(worldX - alongX, worldZ - alongZ);
  const crossA = sampleWesternReferenceSurfaceFabric(worldX - alongZ * 0.55, worldZ + alongX * 0.55);
  const crossB = sampleWesternReferenceSurfaceFabric(worldX + alongZ * 0.55, worldZ - alongX * 0.55);
  const along = (lee.crust - windward.crust) * 0.72 + (lee.frostWash - windward.frostWash) * 0.28;
  const cross = (crossA.crust - crossB.crust) * 0.64 + (crossA.micro - crossB.micro) * 0.36;
  return Object.freeze({ x: along * 0.82 - cross * 0.57, z: along * 0.57 + cross * 0.82 });
}

function localWeatheringGain(worldX, worldZ, surface) {
  const fabric = sampleWesternReferenceSurfaceFabric(worldX, worldZ);
  if (surface === 'rock') {
    return 0.98 + fabric.fracture * 0.17 + fabric.frostWash * 0.10
      + fabric.stonyPatch * 0.14 - fabric.moisture * 0.06;
  }
  if (surface === 'snow') {
    return 0.68 + fabric.crust * 0.12 + fabric.weathering * 0.05 + fabric.stonyPatch * 0.05
      + fabric.frostWash * 0.04;
  }
  return 0.90 + fabric.mineral * 0.09 + fabric.exposedInterfluve * 0.09
    + fabric.stonyPatch * 0.11 + fabric.erosionScour * 0.06 - fabric.moisture * 0.07;
}

function applyPindex03WeatheredNormal(normal, index, classification) {
  if (!normal || classification.surface === 'sea' || classification.surface === 'lake') return false;
  const P = PINDEX03_DETAIL_POLICY;
  const strength = P.normalStrengthBySurface[classification.surface] ?? 0;
  const seam = pindex03NormalWeight(classification.normalizedX);
  if (strength <= 0 || seam <= 0) return false;

  const wx = classification.worldX;
  const wz = classification.worldZ;
  const micro = weatheringGradient(wx, wz, P.normalMicroProbeMeters, classification.surface);
  const fine = weatheringGradient(wx, wz, P.normalProbeMeters, classification.surface);
  const macro = weatheringGradient(wx, wz, P.normalMacroProbeMeters, classification.surface);
  const broad = weatheringGradient(wx, wz, P.normalBroadProbeMeters, classification.surface);
  const ultraBroad = weatheringGradient(wx, wz, P.normalUltraBroadProbeMeters, classification.surface);
  const erosion = directionalErosionGradient(wx, wz, P.normalErosionProbeMeters, classification.surface);
  const microBlend = P.normalMicroBlend;
  const macroBlend = P.normalMacroBlend;
  const broadBlend = P.normalBroadBlend;
  const ultraBroadBlend = P.normalUltraBroadBlend;
  const fineBlend = 1 - microBlend - macroBlend - broadBlend - ultraBroadBlend;
  let gradientX = micro.x * microBlend + fine.x * fineBlend + macro.x * macroBlend
    + broad.x * broadBlend + ultraBroad.x * ultraBroadBlend;
  let gradientZ = micro.z * microBlend + fine.z * fineBlend + macro.z * macroBlend
    + broad.z * broadBlend + ultraBroad.z * ultraBroadBlend;
  gradientX = gradientX * (1 - P.normalErosionBlend) + erosion.x * P.normalErosionBlend;
  gradientZ = gradientZ * (1 - P.normalErosionBlend) + erosion.z * P.normalErosionBlend;
  if (classification.surface === 'snow') {
    const wind = snowWindCrustGradient(wx, wz, P.normalSnowWindProbeMeters);
    gradientX = gradientX * 0.76 + wind.x * 0.24;
    gradientZ = gradientZ * 0.76 + wind.z * 0.24;
  }
  const weatherGain = localWeatheringGain(wx, wz, classification.surface);
  const perturbX = gradientX * strength * seam * weatherGain;
  const perturbZ = gradientZ * strength * seam * weatherGain;

  const nx = normal.getX(index) + perturbX;
  const ny = Math.max(0.08, normal.getY(index));
  const nz = normal.getZ(index) + perturbZ;
  const length = Math.hypot(nx, ny, nz) || 1;
  normal.setXYZ(index, nx / length, ny / length, nz / length);
  return true;
}

function applyPindex03RegionalAlbedo(color, index, classification) {
  if (classification.surface === 'sea' || classification.surface === 'lake') return false;
  const fabric = sampleWesternReferenceSurfaceFabric(classification.worldX, classification.worldZ);
  const seam = pindex03NormalWeight(classification.normalizedX);
  if (seam <= 0) return false;

  let red = 1;
  let green = 1;
  let blue = 1;
  if (classification.surface === 'soil') {
    red += (fabric.mineral - 0.5) * 0.076 + fabric.exposedInterfluve * 0.046
      + fabric.stonyPatch * 0.028 - fabric.moisture * 0.020 - fabric.erosionScour * 0.052;
    green += (fabric.moisture - 0.5) * 0.064 + fabric.heathMosaic * 0.024
      + fabric.exposedInterfluve * 0.014 - fabric.erosionScour * 0.046 - fabric.stonyPatch * 0.016;
    blue += (fabric.moisture - 0.5) * 0.042 - fabric.mineral * 0.038
      - fabric.heathMosaic * 0.034 - fabric.erosionScour * 0.036 + fabric.frostWash * 0.018;
  } else if (classification.surface === 'rock') {
    red += fabric.exposedInterfluve * 0.054 + fabric.frostWash * 0.030
      - fabric.fracture * 0.054 - fabric.erosionScour * 0.030;
    green += fabric.frostWash * 0.038 - fabric.fracture * 0.048
      - fabric.stonyPatch * 0.028 - fabric.erosionScour * 0.032;
    blue += fabric.frostWash * 0.052 - fabric.weathering * 0.032
      - fabric.fracture * 0.039 - fabric.stonyPatch * 0.020;
  } else if (classification.surface === 'snow') {
    red += (fabric.crust - 0.5) * 0.020 - fabric.weathering * 0.014 - fabric.stonyPatch * 0.010;
    green += (fabric.crust - 0.5) * 0.024 + fabric.frostWash * 0.008 - fabric.weathering * 0.010;
    blue += (fabric.crust - 0.5) * 0.034 + fabric.frostWash * 0.016 - fabric.stonyPatch * 0.006;
  } else {
    return false;
  }

  red = THREE.MathUtils.lerp(1, THREE.MathUtils.clamp(red, 0.89, 1.10), seam);
  green = THREE.MathUtils.lerp(1, THREE.MathUtils.clamp(green, 0.89, 1.10), seam);
  blue = THREE.MathUtils.lerp(1, THREE.MathUtils.clamp(blue, 0.89, 1.10), seam);
  color.setXYZ(
    index,
    clamp01(color.getX(index) * red),
    clamp01(color.getY(index) * green),
    clamp01(color.getZ(index) * blue),
  );
  return true;
}

function classificationForWorld(worldX, worldZ) {
  const mapPoint = plannedWorldXZToMapCanvas(worldX, worldZ);
  const normalized = mapCanvasToNormalizedReference(mapPoint.x, mapPoint.y);
  return {
    surface: classifyReferenceBaseSurface(normalized.x, normalized.y),
    pindex: referencePindexFromNormalizedX(normalized.x),
    normalizedX: normalized.x,
    normalizedY: normalized.y,
    worldX,
    worldZ,
  };
}

export function applyPindex03DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  const normal = mesh?.geometry?.getAttribute?.('normal');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');
  let touchedVertices = 0;
  let fabricVertices = 0;
  let marineVertices = 0;
  let albedoVertices = 0;
  let normalVertices = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX03_DETAIL_POLICY.pindex) continue;
    if (applyWesternReferenceSurfaceFabricToColorAttribute(color, index, c)) fabricVertices += 1;
    if (applyWesternMarineShelfToneToColorAttribute(color, index, c) > 0) marineVertices += 1;
    if (applyPindex03RegionalAlbedo(color, index, c)) albedoVertices += 1;
    if (applyPindex03WeatheredNormal(normal, index, c)) normalVertices += 1;
    touchedVertices += 1;
  }
  color.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  const summary = Object.freeze({
    policyId: PINDEX03_DETAIL_POLICY.id,
    pindex: 3,
    touchedVertices,
    fabricVertices,
    marineVertices,
    albedoVertices,
    normalVertices,
  });
  mesh.userData.run281Pindex03Detail = summary;
  return summary;
}

export function applyPindex03DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  let fabricVertices = 0;
  let marineVertices = 0;
  let albedoVertices = 0;
  let normalVertices = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex03DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    fabricVertices += summary.fabricVertices;
    marineVertices += summary.marineVertices;
    albedoVertices += summary.albedoVertices;
    normalVertices += summary.normalVertices;
  }
  const summary = Object.freeze({
    policyId: PINDEX03_DETAIL_POLICY.id,
    pindex: 3,
    touchedVertices,
    fabricVertices,
    marineVertices,
    albedoVertices,
    normalVertices,
    meshCount: terrainGroup.children.length,
  });
  terrainGroup.userData.run281Pindex03Detail = summary;
  return summary;
}
