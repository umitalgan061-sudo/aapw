/** Deterministic micro-detail layer for canonical owner-map Pindex-10 only. */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

export const PINDEX10_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex10-detail-2026-08-12-v1',
  pindex: 10,
  amplitudeBySurface: Object.freeze({ sea: 0.0055, lake: 0.0055, soil: 0.032, rock: 0.036, snow: 0.016 }),
});

function hash01(x, y) {
  const value = Math.sin(x * 6.211 + y * 97.881 + 41.113) * 43758.5453;
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

export function applyPindex10DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');
  let touchedVertices = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX10_DETAIL_POLICY.pindex) continue;
    const amplitude = PINDEX10_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0;
    const noise = (hash01(c.normalizedX * 1024, c.normalizedY * 1024) - 0.5) * 2 * amplitude;
    const shade = THREE.MathUtils.clamp(1 + noise, 0.85, 1.15);
    color.setXYZ(index,
      THREE.MathUtils.clamp(color.getX(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getY(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getZ(index) * shade, 0, 1));
    touchedVertices += 1;
  }
  color.needsUpdate = true;
  const summary = Object.freeze({ policyId: PINDEX10_DETAIL_POLICY.id, pindex: 10, touchedVertices });
  mesh.userData.run317Pindex10Detail = summary;
  return summary;
}

export function applyPindex10DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  for (const mesh of terrainGroup.children) touchedVertices += applyPindex10DetailToTerrainMesh(mesh).touchedVertices;
  const summary = Object.freeze({ policyId: PINDEX10_DETAIL_POLICY.id, pindex: 10, touchedVertices, meshCount: terrainGroup.children.length });
  terrainGroup.userData.run317Pindex10Detail = summary;
  return summary;
}
