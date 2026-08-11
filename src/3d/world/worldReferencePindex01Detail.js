/**
 * Run277: deterministic, allocation-light micro-detail for owner-map pindex 01.
 *
 * This layer preserves Run276's immutable sea/lake/soil/rock/snow classification and geometry.
 * It only modulates the existing vertex-color attribute for dry pindex-01 vertices, using a
 * coordinate hash instead of Math.random(). Water is intentionally untouched.
 * @module world/worldReferencePindex01Detail
 */

import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import {
  classifyReferenceBaseSurface,
  referencePindexFromNormalizedX,
} from './worldReferenceSurfacePindexes.js';

export const WORLD_REFERENCE_PINDEX01_DETAIL_POLICY = Object.freeze({
  id: 'owner-map-pindex01-detail-2026-08-11-v1',
  pindex: 1,
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  cellMeters: 22,
  amplitudes: Object.freeze({ soil: 0.055, rock: 0.04, snow: 0.02 }),
});

function classificationAt(worldX, worldZ) {
  const map = plannedWorldXZToMapCanvas(worldX, worldZ);
  const normalized = mapCanvasToNormalizedReference(map.x, map.y);
  return {
    surface: classifyReferenceBaseSurface(normalized.x, normalized.y),
    pindex: referencePindexFromNormalizedX(normalized.x),
  };
}

function hash01(ix, iz) {
  let value = Math.imul(ix | 0, 0x1f123bb5) ^ Math.imul(iz | 0, 0x5f356495) ^ 0x6d2b79f5;
  value ^= value >>> 15;
  value = Math.imul(value, 0x2c1b3c6d);
  value ^= value >>> 12;
  value = Math.imul(value, 0x297a2d39);
  value ^= value >>> 15;
  return (value >>> 0) / 4294967295;
}

export function pindex01DetailFactor(worldX, worldZ, surface) {
  const amplitude = WORLD_REFERENCE_PINDEX01_DETAIL_POLICY.amplitudes[surface] || 0;
  if (amplitude === 0) return 1;
  const scale = WORLD_REFERENCE_PINDEX01_DETAIL_POLICY.cellMeters;
  const ix = Math.floor(worldX / scale);
  const iz = Math.floor(worldZ / scale);
  const signed = hash01(ix, iz) * 2 - 1;
  return 1 + signed * amplitude;
}

export function applyReferencePindex01DetailToTerrainMesh(mesh) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  if (!position || !color || position.count !== color.count) {
    throw new TypeError('Run276 position/color attributes are required before Run277 detail');
  }
  if (mesh.userData?.run277Pindex01Detail) return mesh.userData.run277Pindex01Detail;

  let detailedVertexCount = 0;
  const detailedBySurface = { soil: 0, rock: 0, snow: 0 };
  let factorMin = 1;
  let factorMax = 1;

  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const classification = classificationAt(worldX, worldZ);
    if (classification.pindex !== WORLD_REFERENCE_PINDEX01_DETAIL_POLICY.pindex) continue;
    if (!(classification.surface in detailedBySurface)) continue;

    const factor = pindex01DetailFactor(worldX, worldZ, classification.surface);
    color.setXYZ(
      index,
      Math.min(1, Math.max(0, color.getX(index) * factor)),
      Math.min(1, Math.max(0, color.getY(index) * factor)),
      Math.min(1, Math.max(0, color.getZ(index) * factor)),
    );
    detailedVertexCount += 1;
    detailedBySurface[classification.surface] += 1;
    factorMin = Math.min(factorMin, factor);
    factorMax = Math.max(factorMax, factor);
  }

  color.needsUpdate = detailedVertexCount > 0;
  const summary = Object.freeze({
    policyId: WORLD_REFERENCE_PINDEX01_DETAIL_POLICY.id,
    pindex: 1,
    detailedVertexCount,
    detailedBySurface: Object.freeze({ ...detailedBySurface }),
    factorMin,
    factorMax,
  });
  mesh.userData.run277Pindex01Detail = summary;
  return summary;
}

export function applyReferencePindex01DetailToTerrainGroup(terrainGroup) {
  if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) {
    throw new TypeError('canonical terrain group is required');
  }
  const detailedBySurface = { soil: 0, rock: 0, snow: 0 };
  let detailedVertexCount = 0;
  let factorMin = 1;
  let factorMax = 1;
  for (const mesh of terrainGroup.children) {
    const summary = applyReferencePindex01DetailToTerrainMesh(mesh);
    detailedVertexCount += summary.detailedVertexCount;
    for (const key of Object.keys(detailedBySurface)) detailedBySurface[key] += summary.detailedBySurface[key];
    factorMin = Math.min(factorMin, summary.factorMin);
    factorMax = Math.max(factorMax, summary.factorMax);
  }
  const summary = Object.freeze({
    policyId: WORLD_REFERENCE_PINDEX01_DETAIL_POLICY.id,
    pindex: 1,
    meshCount: terrainGroup.children.length,
    detailedVertexCount,
    detailedBySurface: Object.freeze({ ...detailedBySurface }),
    factorMin,
    factorMax,
  });
  terrainGroup.userData.run277Pindex01Detail = summary;
  return summary;
}
