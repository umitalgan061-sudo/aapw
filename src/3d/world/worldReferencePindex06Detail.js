/** Deterministic micro-detail layer for canonical owner-map Pindex-06 only. */
import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import { classifyReferenceBaseSurface, referencePindexFromNormalizedX } from './worldReferenceSurfacePindexes.js';

// Canonical Pindex-06 composition is sea 380 / soil 260 / rock 0 / snow 0 — the largest soil share
// of any strip polished so far (260/640 cells, versus 187/640 for Pindex-05 and 149/576 for
// Pindex-04). Continuing the established inverse relationship, per-vertex soil/sea amplitudes drop
// again so this broad inland body does not read noisier than its already-tuned neighbours.
// Rock/snow entries are inert here and exist only to keep the policy schema identical across
// Run277..Run307.
export const PINDEX06_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex06-detail-2026-08-12-v1',
  pindex: 6,
  amplitudeBySurface: Object.freeze({ sea: 0.007, lake: 0.007, soil: 0.04, rock: 0.04, snow: 0.02 }),
});

// Distinct multipliers per pindex keep neighbouring strips from sharing a visible noise pattern.
function hash01(x, y) {
  const value = Math.sin(x * 53.719 + y * 29.443 + 41.237) * 43758.5453;
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

export function applyPindex06DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color) throw new TypeError('semantic terrain position+color attributes are required');
  let touchedVertices = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const c = classificationForWorld(worldX, worldZ);
    if (c.pindex !== PINDEX06_DETAIL_POLICY.pindex) continue;
    const amplitude = PINDEX06_DETAIL_POLICY.amplitudeBySurface[c.surface] ?? 0;
    const noise = (hash01(c.normalizedX * 1024, c.normalizedY * 1024) - 0.5) * 2 * amplitude;
    const shade = THREE.MathUtils.clamp(1 + noise, 0.85, 1.15);
    color.setXYZ(index,
      THREE.MathUtils.clamp(color.getX(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getY(index) * shade, 0, 1),
      THREE.MathUtils.clamp(color.getZ(index) * shade, 0, 1));
    touchedVertices += 1;
  }
  color.needsUpdate = true;
  const summary = Object.freeze({ policyId: PINDEX06_DETAIL_POLICY.id, pindex: 6, touchedVertices });
  mesh.userData.run307Pindex06Detail = summary;
  return summary;
}

export function applyPindex06DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) throw new TypeError('canonical terrain group is required');
  let touchedVertices = 0;
  for (const mesh of terrainGroup.children) touchedVertices += applyPindex06DetailToTerrainMesh(mesh).touchedVertices;
  const summary = Object.freeze({ policyId: PINDEX06_DETAIL_POLICY.id, pindex: 6, touchedVertices, meshCount: terrainGroup.children.length });
  terrainGroup.userData.run307Pindex06Detail = summary;
  return summary;
}
