/** Deterministic material-detail layer for canonical owner-map Pindex-03 only. */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';
import { applyWesternMarineShelfToneToColorAttribute } from './westernMarineShelfTone.js';
import { applyWesternReferenceSurfaceFabricToColorAttribute } from './westernReferenceSurfaceFabric.js';

export const PINDEX03_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex03-detail-2026-08-29-v4-weathered-micro-normal',
  pindex: 3,
  westernMarineShelfTone: true,
  westernReferenceSurfaceFabric: true,
  worldSpaceMicroNormalWeathering: true,
  normalMesoMeters: 236,
  normalFineMeters: 68,
  normalStrengthBySurface: Object.freeze({ sea: 0, lake: 0, soil: 0.18, rock: 0.30, snow: 0.09 }),
  normalSeamFeatherNormalized: 0.012,
  mapAuthorityUnchanged: true,
  geographyAuthorityUnchanged: true,
  terrainHeightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  renderOnly: true,
});

function hash01(ix, iz, seed) {
  let h = Math.imul((ix | 0) ^ seed, 0x45d9f3b) ^ Math.imul((iz | 0) + seed, 0x119de1f3);
  h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 15;
  return (h >>> 0) / 0x100000000;
}

function valueNoise(worldX, worldZ, scaleMeters, seed) {
  const gx = worldX / scaleMeters;
  const gz = worldZ / scaleMeters;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx0 = gx - x0;
  const fz0 = gz - z0;
  const fx = fx0 * fx0 * (3 - 2 * fx0);
  const fz = fz0 * fz0 * (3 - 2 * fz0);
  const a = hash01(x0, z0, seed);
  const b = hash01(x0 + 1, z0, seed);
  const c = hash01(x0, z0 + 1, seed);
  const d = hash01(x0 + 1, z0 + 1, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, fx), THREE.MathUtils.lerp(c, d, fx), fz) * 2 - 1;
}

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

function applyPindex03WeatheredNormal(normal, index, classification) {
  if (!normal || classification.surface === 'sea' || classification.surface === 'lake') return false;
  const P = PINDEX03_DETAIL_POLICY;
  const strength = P.normalStrengthBySurface[classification.surface] ?? 0;
  const seam = pindex03NormalWeight(classification.normalizedX);
  if (strength <= 0 || seam <= 0) return false;

  const step = 4.0;
  const wx = classification.worldX;
  const wz = classification.worldZ;
  const mesoX = valueNoise(wx + step, wz, P.normalMesoMeters, 0x3031)
    - valueNoise(wx - step, wz, P.normalMesoMeters, 0x3031);
  const mesoZ = valueNoise(wx, wz + step, P.normalMesoMeters, 0x4041)
    - valueNoise(wx, wz - step, P.normalMesoMeters, 0x4041);
  const fineX = valueNoise(wx + step, wz, P.normalFineMeters, 0x5051)
    - valueNoise(wx - step, wz, P.normalFineMeters, 0x5051);
  const fineZ = valueNoise(wx, wz + step, P.normalFineMeters, 0x6061)
    - valueNoise(wx, wz - step, P.normalFineMeters, 0x6061);

  const weatherGain = classification.surface === 'rock' ? 1.12 : classification.surface === 'snow' ? 0.72 : 0.92;
  const perturbX = (mesoX * 0.42 + fineX * 0.58) * strength * seam * weatherGain;
  const perturbZ = (mesoZ * 0.42 + fineZ * 0.58) * strength * seam * weatherGain;
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
