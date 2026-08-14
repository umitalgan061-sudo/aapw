/** Deterministic micro-detail layer for canonical owner-map Pindex-04 only. */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

export const PINDEX04_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex04-detail-2026-08-11-v1',
  pindex: 4,
  amplitudeBySurface: Object.freeze({ sea: 0.009, lake: 0.009, soil: 0.045, rock: 0.045, snow: 0.02 }),
});

function hash01(x, y) {
  const value = Math.sin(x * 39.137 + y * 31.771 + 53.911) * 43758.5453;
  return value - Math.floor(value);
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

export function applyPindex04DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');
  let touchedVertices = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX04_DETAIL_POLICY.pindex) continue;
    const amplitude = PINDEX04_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0;
    const noise = (hash01(c.normalizedX * 1024, c.normalizedY * 1024) - 0.5) * 2 * amplitude;
    const shade = THREE.MathUtils.clamp(1 + noise, 0.85, 1.15);
    color.setXYZ(index,
      THREE.MathUtils.clamp(color.getX(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getY(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getZ(index) * shade, 0, 1));
    touchedVertices += 1;
  }
  color.needsUpdate = true;
  const summary = Object.freeze({ policyId: PINDEX04_DETAIL_POLICY.id, pindex: 4, touchedVertices });
  mesh.userData.run282Pindex04Detail = summary;
  return summary;
}

export function applyPindex04DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  for (const mesh of terrainGroup.children) touchedVertices += applyPindex04DetailToTerrainMesh(mesh).touchedVertices;
  const summary = Object.freeze({ policyId: PINDEX04_DETAIL_POLICY.id, pindex: 4, touchedVertices, meshCount: terrainGroup.children.length });
  terrainGroup.userData.run282Pindex04Detail = summary;
  return summary;
}
