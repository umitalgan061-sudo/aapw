/** Deterministic material-detail layer for canonical owner-map Pindex-01 only. */
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';
import { applyWesternMarineShelfToneToColorAttribute } from './westernMarineShelfTone.js';
import { applyWesternReferenceSurfaceFabricToColorAttribute } from './westernReferenceSurfaceFabric.js';

export const PINDEX01_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex01-detail-2026-08-26-v3-world-space-surface-fabric',
  pindex: 1,
  westernMarineShelfTone: true,
  westernReferenceSurfaceFabric: true,
  geographyAuthorityUnchanged: true,
});

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

export function applyPindex01DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');
  let touchedVertices = 0;
  let fabricVertices = 0;
  let marineVertices = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX01_DETAIL_POLICY.pindex) continue;
    if (applyWesternReferenceSurfaceFabricToColorAttribute(color, index, c)) fabricVertices += 1;
    if (applyWesternMarineShelfToneToColorAttribute(color, index, c) > 0) marineVertices += 1;
    touchedVertices += 1;
  }
  color.needsUpdate = true;
  const summary = Object.freeze({
    policyId: PINDEX01_DETAIL_POLICY.id,
    pindex: 1,
    touchedVertices,
    fabricVertices,
    marineVertices,
  });
  mesh.userData.run277Pindex01Detail = summary;
  return summary;
}

export function applyPindex01DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  let fabricVertices = 0;
  let marineVertices = 0;
  for (const mesh of terrainGroup.children) {
    const summary = applyPindex01DetailToTerrainMesh(mesh);
    touchedVertices += summary.touchedVertices;
    fabricVertices += summary.fabricVertices;
    marineVertices += summary.marineVertices;
  }
  const summary = Object.freeze({
    policyId: PINDEX01_DETAIL_POLICY.id,
    pindex: 1,
    touchedVertices,
    fabricVertices,
    marineVertices,
    meshCount: terrainGroup.children.length,
  });
  terrainGroup.userData.run277Pindex01Detail = summary;
  return summary;
}
