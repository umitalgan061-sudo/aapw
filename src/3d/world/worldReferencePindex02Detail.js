/** Deterministic material-detail layer for canonical owner-map Pindex-02 only. */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';
import { applyWesternMarineShelfToneToColorAttribute } from './westernMarineShelfTone.js';
import {
  applyWesternReferenceSurfaceFabricToColorAttribute,
  sampleWesternReferenceSurfaceFabric,
} from './westernReferenceSurfaceFabric.js';

export const PINDEX02_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex02-detail-2026-08-30-v6-erosion-ecotone-normal',
  pindex: 2,
  westernMarineShelfTone: true,
  westernReferenceSurfaceFabric: true,
  worldSpaceMicroNormalWeathering: true,
  sharedFabricNormalSource: true,
  erosionScourNormalSource: true,
  heathEcotoneNormalSource: true,
  normalSubMicroProbeMeters: 4.5,
  normalProbeMeters: 11.0,
  normalMesoProbeMeters: 36.0,
  normalMacroProbeMeters: 112.0,
  normalScaleWeights: Object.freeze({ subMicro: 0.17, micro: 0.43, meso: 0.27, macro: 0.13 }),
  normalStrengthBySurface: Object.freeze({ sea: 0, lake: 0, soil: 0.39, rock: 0.58, snow: 0.16 }),
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

function pindex02NormalWeight(normalizedX) {
  const P = PINDEX02_DETAIL_POLICY;
  const west = smoothstep01((normalizedX - 0.1) / P.normalSeamFeatherNormalized);
  const east = smoothstep01((0.2 - normalizedX) / P.normalSeamFeatherNormalized);
  return west * east;
}

function weatheringHeight(fabric, surface) {
  if (surface === 'rock') {
    return fabric.weathering * 0.22 + fabric.fracture * 0.24 + fabric.frostWash * 0.15
      + fabric.stonyPatch * 0.15 + fabric.erosionScour * 0.11 + fabric.exposedInterfluve * 0.06
      + fabric.subMicro * 0.04 + fabric.fine * 0.03;
  }
  if (surface === 'snow') {
    return fabric.crust * 0.33 + fabric.fine * 0.21 + fabric.micro * 0.16
      + fabric.weathering * 0.12 + fabric.subMicro * 0.07 + fabric.stonyPatch * 0.05
      + fabric.erosionScour * 0.035 + fabric.frostWash * 0.025;
  }
  return fabric.moisture * 0.20 + fabric.mineral * 0.16 + fabric.weathering * 0.14
    + fabric.exposedInterfluve * 0.12 + fabric.stonyPatch * 0.11 + fabric.erosionScour * 0.10
    + fabric.heathMosaic * 0.075 + fabric.drainageThread * 0.045 + fabric.subMicro * 0.025
    + fabric.fine * 0.025;
}

function weatheringGradient(worldX, worldZ, step, surface) {
  const east = weatheringHeight(sampleWesternReferenceSurfaceFabric(worldX + step, worldZ), surface);
  const west = weatheringHeight(sampleWesternReferenceSurfaceFabric(worldX - step, worldZ), surface);
  const north = weatheringHeight(sampleWesternReferenceSurfaceFabric(worldX, worldZ + step), surface);
  const south = weatheringHeight(sampleWesternReferenceSurfaceFabric(worldX, worldZ - step), surface);
  return { x: east - west, z: north - south };
}

function applyPindex02WeatheredNormal(normal, index, classification) {
  if (!normal || classification.surface === 'sea' || classification.surface === 'lake') return false;
  const P = PINDEX02_DETAIL_POLICY;
  const strength = P.normalStrengthBySurface[classification.surface] ?? 0;
  const seam = pindex02NormalWeight(classification.normalizedX);
  if (strength <= 0 || seam <= 0) return false;

  const wx = classification.worldX;
  const wz = classification.worldZ;
  const subMicro = weatheringGradient(wx, wz, P.normalSubMicroProbeMeters, classification.surface);
  const micro = weatheringGradient(wx, wz, P.normalProbeMeters, classification.surface);
  const meso = weatheringGradient(wx, wz, P.normalMesoProbeMeters, classification.surface);
  const macro = weatheringGradient(wx, wz, P.normalMacroProbeMeters, classification.surface);
  const weights = P.normalScaleWeights;
  const weatherGain = classification.surface === 'rock' ? 1.22 : classification.surface === 'snow' ? 0.79 : 1.08;
  const perturbX = (subMicro.x * weights.subMicro + micro.x * weights.micro
    + meso.x * weights.meso + macro.x * weights.macro) * strength * seam * weatherGain;
  const perturbZ = (subMicro.z * weights.subMicro + micro.z * weights.micro
    + meso.z * weights.meso + macro.z * weights.macro) * strength * seam * weatherGain;

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

export function applyPindex02DetailToTerrainMesh(mesh) {
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
    if (c.pindex !== PINDEX02_DETAIL_POLICY.pindex) continue;
    if (applyWesternReferenceSurfaceFabricToColorAttribute(color, index, c)) fabricVertices += 1;
    if (applyWesternMarineShelfToneToColorAttribute(color, index, c) > 0) marineVertices += 1;
    if (applyPindex02WeatheredNormal(normal, index, c)) normalVertices += 1;
    touchedVertices += 1;
  }
  color.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  const summary = Object.freeze({
    policyId: PINDEX02_DETAIL_POLICY.id,
    pindex: 2,
    touchedVertices,
    fabricVertices,
    marineVertices,
    normalVertices,
  });
  mesh.userData.run278Pindex02Detail = summary;
  return summary;
}

export function applyPindex02DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  let fabricVertices = 0;
  let marineVertices = 0;
  let normalVertices = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex02DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    fabricVertices += summary.fabricVertices;
    marineVertices += summary.marineVertices;
    normalVertices += summary.normalVertices;
  }
  const summary = Object.freeze({
    policyId: PINDEX02_DETAIL_POLICY.id,
    pindex: 2,
    touchedVertices,
    fabricVertices,
    marineVertices,
    normalVertices,
    meshCount: terrainGroup.children.length,
  });
  terrainGroup.userData.run278Pindex02Detail = summary;
  return summary;
}
