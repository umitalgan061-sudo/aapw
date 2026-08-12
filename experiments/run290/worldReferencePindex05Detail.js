/** Dormant deterministic Pindex-05 candidate. Intentionally outside src/3d until activation is proven. */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from '../../src/3d/world/worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from '../../src/3d/world/worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from '../../src/3d/world/worldReferenceSurfacePindexes.js';

export const PINDEX05_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex05-detail-candidate-2026-08-11-v4',
  pindex: 5,
  amplitudeBySurface: Object.freeze({ sea: 0.008, lake: 0.008, soil: 0.043, rock: 0.043, snow: 0.02 }),
});

function hash01(x, y) {
  const value = Math.sin(x * 47.311 + y * 23.917 + 67.113) * 43758.5453;
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

export function applyPindex05DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');
  let touchedVertices = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX05_DETAIL_POLICY.pindex) continue;
    const amplitude = PINDEX05_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0;
    const noise = (hash01(c.normalizedX * 1024, c.normalizedY * 1024) - 0.5) * 2 * amplitude;
    const shade = THREE.MathUtils.clamp(1 + noise, 0.85, 1.15);
    color.setXYZ(index,
      THREE.MathUtils.clamp(color.getX(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getY(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getZ(index) * shade, 0, 1));
    touchedVertices += 1;
  }
  color.needsUpdate = true;
  const summary = Object.freeze({ policyId: PINDEX05_DETAIL_POLICY.id, pindex: 5, touchedVertices });
  mesh.userData.run290Pindex05Candidate = summary;
  return summary;
}

export function applyPindex05DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  for (const mesh of terrainGroup.children) touchedVertices += applyPindex05DetailToTerrainMesh(mesh).touchedVertices;
  const summary = Object.freeze({ policyId: PINDEX05_DETAIL_POLICY.id, pindex: 5, touchedVertices, meshCount: terrainGroup.children.length });
  terrainGroup.userData.run290Pindex05Candidate = summary;
  return summary;
}
