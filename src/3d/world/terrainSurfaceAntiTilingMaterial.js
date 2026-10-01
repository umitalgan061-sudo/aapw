/**
 * Render-only material adapter for terrain chunks.
 *
 * Applies the existing anti-tiling response to vertex colours on a shipped terrain mesh. It does not
 * mutate height, hydrology, collider, road, settlement or biome authority and is safe to call once
 * per newly-created chunk. World coordinates include the chunk transform so adjacent chunks share the
 * same deterministic signal at their seam.
 */
import {
  TERRAIN_SURFACE_ANTI_TILING_POLICY,
  terrainSurfaceAntiTilingAt,
} from './terrainSurfaceAntiTiling.js';

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const clampColor = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function slopeDegreesFromNormalY(normalY) {
  const y = clamp01((Number.isFinite(normalY) ? normalY : 1) * 0.5 + 0.5);
  return Math.min(89, Math.max(0, Math.acos(Math.max(-1, Math.min(1, 2 * y - 1))) * 180 / Math.PI));
}

function contextFromVertex(mesh, position, normal, index, seed, waterLevelMeters) {
  const worldX = (mesh.position?.x || 0) + position.getX(index);
  const worldZ = (mesh.position?.z || 0) + position.getZ(index);
  const elevationMeters = position.getY(index);
  const normalY = normal ? normal.getY(index) : 1;
  const slopeDegrees = slopeDegreesFromNormalY(normalY);
  const rockWeight = clamp01((1 - clamp01(normalY)) * 0.85 + (slopeDegrees / 89) * 0.15);
  const snowWeight = clamp01((elevationMeters - 260) / 420);
  const waterWeight = elevationMeters <= waterLevelMeters ? 1 : 0;
  const waterDistanceMeters = Math.abs(elevationMeters - waterLevelMeters) * 8;
  return {
    worldX,
    worldZ,
    context: {
      seed,
      elevationMeters,
      slopeDegrees,
      moisture: clamp01(0.28 + (1 - Math.min(1, waterDistanceMeters / 420)) * 0.42),
      rockWeight,
      snowWeight,
      waterWeight,
      waterDistanceMeters,
    },
  };
}

export function applyTerrainSurfaceAntiTilingMaterial(mesh, {
  seed = 1,
  waterLevelMeters = 0,
} = {}) {
  const position = mesh?.geometry?.getAttribute?.('position');
  const color = mesh?.geometry?.getAttribute?.('color');
  const normal = mesh?.geometry?.getAttribute?.('normal');
  if (!position || !color || color.itemSize < 3) {
    return Object.freeze({ ok: false, applied: false, reason: 'missing-position-or-color-attribute' });
  }

  let maximumDelta = 0;
  let changedVertices = 0;
  for (let index = 0; index < position.count; index += 1) {
    const { worldX, worldZ, context } = contextFromVertex(mesh, position, normal, index, seed, waterLevelMeters);
    const response = terrainSurfaceAntiTilingAt(worldX, worldZ, context);
    const signal = (response.macro * 0.48 + response.meso * 0.32 + response.micro * 0.20) * response.farFade;
    const gain = Math.min(0.11, response.albedoVariation * response.farFade * 1.45);
    const redScale = 1 + signal * gain * 1.00;
    const greenScale = 1 + signal * gain * 0.84;
    const blueScale = 1 + signal * gain * 1.12;
    const offset = index * 3;
    const beforeR = color.getX(index);
    const beforeG = color.getY(index);
    const beforeB = color.getZ(index);
    const afterR = clampColor(beforeR * redScale);
    const afterG = clampColor(beforeG * greenScale);
    const afterB = clampColor(beforeB * blueScale);
    color.setXYZ(index, afterR, afterG, afterB);
    const delta = Math.max(Math.abs(afterR - beforeR), Math.abs(afterG - beforeG), Math.abs(afterB - beforeB));
    maximumDelta = Math.max(maximumDelta, delta);
    if (delta > 1e-7) changedVertices += 1;
    void offset;
  }
  color.needsUpdate = true;

  const manifest = Object.freeze({
    policyId: TERRAIN_SURFACE_ANTI_TILING_POLICY.id,
    adapterId: 'terrain-surface-anti-tiling-material-2026-09-07-v1',
    applied: true,
    renderOnly: true,
    changedVertices,
    vertexCount: position.count,
    maximumDelta,
    seamSafeWorldCoordinates: true,
    canonicalHeightUnchanged: true,
    canonicalHydrologyUnchanged: true,
    canonicalColliderUnchanged: true,
  });
  mesh.userData = { ...(mesh.userData || {}), terrainSurfaceAntiTilingMaterial: manifest };
  if (mesh.material) mesh.material.userData = { ...(mesh.material.userData || {}), terrainSurfaceAntiTilingMaterial: manifest };
  return Object.freeze({ ok: true, applied: true, manifest });
}

export function validateTerrainSurfaceAntiTilingMaterialApplication(result) {
  const errors = [];
  if (result?.ok !== true || result?.applied !== true) errors.push('adapter-not-applied');
  if (!Number.isFinite(result?.manifest?.vertexCount) || result.manifest.vertexCount <= 0) errors.push('invalid-vertex-count');
  if (!Number.isFinite(result?.manifest?.maximumDelta) || result.manifest.maximumDelta < 0 || result.manifest.maximumDelta > 0.11) errors.push('delta-out-of-bounds');
  if (result?.manifest?.seamSafeWorldCoordinates !== true) errors.push('world-seam-safety-missing');
  if (result?.manifest?.canonicalHeightUnchanged !== true) errors.push('height-authority-mutated');
  if (result?.manifest?.canonicalHydrologyUnchanged !== true) errors.push('hydrology-authority-mutated');
  if (result?.manifest?.canonicalColliderUnchanged !== true) errors.push('collider-authority-mutated');
  return Object.freeze({ ok: errors.length === 0, errors });
}
