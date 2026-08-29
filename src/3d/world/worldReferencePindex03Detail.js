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
  id: 'owner-map-pindex03-detail-2026-08-30-v10-wind-crust-weathered-normal',
  pindex: 3,
  westernMarineShelfTone: true,
  westernReferenceSurfaceFabric: true,
  worldSpaceMicroNormalWeathering: true,
  sharedFabricNormalSource: true,
  normalMicroProbeMeters: 3.5,
  normalProbeMeters: 9.0,
  normalMacroProbeMeters: 31.0,
  normalBroadProbeMeters: 96.0,
  normalSnowWindProbeMeters: 18.0,
  normalMicroBlend: 0.22,
  normalMacroBlend: 0.25,
  normalBroadBlend: 0.21,
  normalStrengthBySurface: Object.freeze({ sea: 0, lake: 0, soil: 0.34, rock: 0.53, snow: 0.18 }),
  normalSeamFeatherNormalized: 0.012,
  mapAuthorityUnchanged: true,
  geographyAuthorityUnchanged: true,
  terrainHeightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  renderOnly: true,
});

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
  return 0.88 + fabric.mineral * 0.08 + fabric.exposedInterfluve * 0.08
    + fabric.stonyPatch * 0.10 - fabric.moisture * 0.07;
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
  const microBlend = P.normalMicroBlend;
  const macroBlend = P.normalMacroBlend;
  const broadBlend = P.normalBroadBlend;
  const fineBlend = 1 - microBlend - macroBlend - broadBlend;
  let gradientX = micro.x * microBlend + fine.x * fineBlend + macro.x * macroBlend + broad.x * broadBlend;
  let gradientZ = micro.z * microBlend + fine.z * fineBlend + macro.z * macroBlend + broad.z * broadBlend;
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
  let normalVertices = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX03_DETAIL_POLICY.pindex) continue;
    if (applyWesternReferenceSurfaceFabricToColorAttribute(color, index, c)) fabricVertices += 1;
    if (applyWesternMarineShelfToneToColorAttribute(color, index, c) > 0) marineVertices += 1;
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
  let normalVertices = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex03DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    fabricVertices += summary.fabricVertices;
    marineVertices += summary.marineVertices;
    normalVertices += summary.normalVertices;
  }
  const summary = Object.freeze({
    policyId: PINDEX03_DETAIL_POLICY.id,
    pindex: 3,
    touchedVertices,
    fabricVertices,
    marineVertices,
    normalVertices,
    meshCount: terrainGroup.children.length,
  });
  terrainGroup.userData.run281Pindex03Detail = summary;
  return summary;
}
