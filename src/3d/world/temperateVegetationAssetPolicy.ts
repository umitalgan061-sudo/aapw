import * as THREE from 'three';
import {
  analyzeMaterialSurfaces,
  buildAutoMaterialRecipe,
  buildRecommendedLayerRecipe,
} from '../materials/MaterialAssignmentCore.ts';
import { northReferenceCryosphereAtWorldXZ } from './northReferenceCryosphere.js';

export const TEMPERATE_VEGETATION_ASSET_POLICY = Object.freeze({
  id: 'temperate-vegetation-asset-first-2026-10-13-v1',
  maxInstances: 12000,
  maxSourceMeshes: 12,
  maxSourceVertices: 250000,
  minSourceHeightMeters: 0.05,
  hostedPreflightMinBytes: 512,
  maxAttemptsPerAsset: 3,
  surfaceSampleOffsetMeters: 3,
  roadExclusionRadiusMeters: 10,
  settlementExclusionRadiusMeters: 90,
  candidates: Object.freeze({
    pine: Object.freeze([
      Object.freeze({ url: 'assets/models/vegetation/pine_Zt62gceKXZ.glb', targetHeightMeters: 8.6, maxHorizontalToHeightRatio: 1.2 }),
      Object.freeze({ url: 'assets/models/vegetation/pine_trees_oYtDty0fR6.glb', targetHeightMeters: 8.6, maxHorizontalToHeightRatio: 1.35 }),
    ]),
    round: Object.freeze([
      Object.freeze({ url: 'assets/models/vegetation/tree_aVOxaHRPWe.glb', targetHeightMeters: 7.2, maxHorizontalToHeightRatio: 1.85 }),
      Object.freeze({ url: 'assets/models/vegetation/tree_QVOop92WmG.glb', targetHeightMeters: 7.2, maxHorizontalToHeightRatio: 1.85 }),
      Object.freeze({ url: 'assets/models/vegetation/tree_qZtx0AHhcy.glb', targetHeightMeters: 7.2, maxHorizontalToHeightRatio: 1.85 }),
    ]),
  }),
});

const TEXTURE_KEYS = Object.freeze(['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap', 'bumpMap', 'displacementMap']);

export function hasAuthoredVegetationSurfaceData(model) {
  const analysis = analyzeMaterialSurfaces(model);
  if (analysis.placeholder || analysis.meshCount === 0 || analysis.surfaceCount === 0) return false;
  return analysis.surfaces.every((surface) => {
    const material = surface.material;
    if (!material || material.userData?.isPlaceholder) return false;
    if (TEXTURE_KEYS.some((key) => material[key]?.isTexture)) return true;
    return Boolean(surface.mesh?.geometry?.attributes?.color && material.vertexColors);
  });
}

export function buildVegetationAssetMaterialRecipe(model, species, metadata = {}) {
  const analysis = analyzeMaterialSurfaces(model);
  if (!analysis.meshCount || !analysis.surfaceCount || hasAuthoredVegetationSurfaceData(model)) return null;
  const foliagePalette = species === 'pine' ? 'pine' : 'leaf';
  if (analysis.surfaces.length > 1) {
    const surfaceOverrides = {};
    for (const surface of analysis.surfaces) {
      const label = `${surface.slot || ''} ${surface.meshName || ''} ${surface.materialName || ''}`.toLowerCase();
      let palette;
      if (/(bark|trunk|stem|wood|bole)/.test(label)) palette = 'bark';
      else if (/(leaf|leaves|foliage|needle|canopy|crown|branch)/.test(label)) palette = foliagePalette;
      else if (surface.meshIndex === 0 && Number(surface.materialIndex) === 0) palette = 'bark';
      else palette = foliagePalette;
      surfaceOverrides[surface.key] = palette;
    }
    const values = new Set(Object.values(surfaceOverrides));
    if (values.size < 2) {
      surfaceOverrides[analysis.surfaces[0].key] = 'bark';
      surfaceOverrides[analysis.surfaces[analysis.surfaces.length - 1].key] = foliagePalette;
    }
    return { version: 1, mode: 'surface', textureSize: 256, surfaceOverrides };
  }
  const basePaletteId = species === 'pine' ? 'pine' : 'tree';
  return buildRecommendedLayerRecipe(model, { metadata, paletteId: basePaletteId, textureSize: 256 })
    || buildAutoMaterialRecipe(model, { metadata, paletteId: basePaletteId, textureSize: 256 });
}

export async function probeHostedVegetationAsset(assetUrl, {
  fetchImpl = globalThis.fetch,
  signal,
  minBytes = TEMPERATE_VEGETATION_ASSET_POLICY.hostedPreflightMinBytes,
  cache = 'no-store',
} = {}) {
  if (typeof fetchImpl !== 'function') return Object.freeze({ status: 'unknown', shouldLoad: true, reason: 'fetch-unavailable' });
  let response;
  try {
    response = await fetchImpl(assetUrl, { method: 'HEAD', cache, signal });
  } catch {
    return signal?.aborted
      ? Object.freeze({ status: 'cancelled', shouldLoad: false, reason: 'abort-signal' })
      : Object.freeze({ status: 'unknown', shouldLoad: true, reason: 'head-failed' });
  }
  if (signal?.aborted) return Object.freeze({ status: 'cancelled', shouldLoad: false, reason: 'abort-signal' });
  const statusCode = Number(response?.status);
  if (!response?.ok) {
    if (statusCode === 405 || statusCode === 501) return Object.freeze({ status: 'unknown', shouldLoad: true, reason: 'head-unsupported', statusCode });
    return Object.freeze({ status: 'rejected', shouldLoad: false, reason: 'http-error', statusCode });
  }
  const rawLength = response.headers?.get?.('content-length');
  const contentLength = rawLength == null ? null : Number.parseInt(rawLength, 10);
  if (Number.isFinite(contentLength) && contentLength > 0 && contentLength < minBytes) {
    return Object.freeze({ status: 'rejected', shouldLoad: false, reason: 'pointer-sized-response', contentLength, minBytes });
  }
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType.startsWith('text/')) return Object.freeze({ status: 'rejected', shouldLoad: false, reason: 'text-response', contentLength, contentType });
  return Object.freeze({ status: 'accepted', shouldLoad: true, reason: 'hosted-binary-candidate', contentLength, contentType });
}

export function validateTemperateTreeAsset(model, {
  maxSourceMeshes = TEMPERATE_VEGETATION_ASSET_POLICY.maxSourceMeshes,
  maxSourceVertices = TEMPERATE_VEGETATION_ASSET_POLICY.maxSourceVertices,
  minSourceHeightMeters = TEMPERATE_VEGETATION_ASSET_POLICY.minSourceHeightMeters,
  maxHorizontalToHeightRatio = 2,
} = {}) {
  if (!model || model.userData?.isPlaceholder) return { valid: false, reason: 'placeholder-model' };
  let placeholder = false;
  model.traverse?.((node) => { if (node.userData?.isPlaceholder) placeholder = true; });
  if (placeholder) return { valid: false, reason: 'placeholder-model' };
  const meshes = [];
  model.updateMatrixWorld?.(true);
  model.traverse?.((node) => {
    if (!node?.isMesh || !node.geometry?.getAttribute?.('position') || !node.material || node.isSkinnedMesh || node.morphTargetInfluences?.length) return;
    const slots = Array.isArray(node.material) ? node.material : [node.material];
    if (slots.length && slots.every((material) => material && !material.userData?.isPlaceholder)) meshes.push(node);
  });
  if (!meshes.length) return { valid: false, reason: 'no-renderable-static-mesh' };
  if (meshes.length > maxSourceMeshes) return { valid: false, reason: 'source-mesh-budget-exceeded' };
  const vertexCount = meshes.reduce((sum, mesh) => sum + (mesh.geometry.getAttribute('position')?.count || 0), 0);
  if (vertexCount > maxSourceVertices) return { valid: false, reason: 'source-vertex-budget-exceeded', vertexCount };
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return { valid: false, reason: 'empty-bounds' };
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const horizontalToHeightRatio = size.y > 0 ? Math.max(size.x, size.z) / size.y : Infinity;
  if (![size.x, size.y, size.z, center.x, center.y, center.z, horizontalToHeightRatio].every(Number.isFinite)) {
    return { valid: false, reason: 'non-finite-bounds' };
  }
  if (size.y < minSourceHeightMeters) return { valid: false, reason: 'degenerate-height' };
  if (horizontalToHeightRatio > maxHorizontalToHeightRatio) return { valid: false, reason: 'implausibly-wide-tree' };
  return { valid: true, meshes, bounds, size, center, horizontalToHeightRatio, vertexCount };
}

export function createTemperateVegetationSurfaceQuery({ sampleHeightMeters, seaLevelMeters, seats = [], roadEdges = [] } = {}) {
  if (typeof sampleHeightMeters !== 'function' || !Number.isFinite(Number(seaLevelMeters))) return null;
  const offset = TEMPERATE_VEGETATION_ASSET_POLICY.surfaceSampleOffsetMeters;
  const distanceToSegment = (px, pz, ax, az, bx, bz) => {
    const abx = bx - ax, abz = bz - az, lengthSquared = abx * abx + abz * abz;
    if (lengthSquared <= 1e-12) return Math.hypot(px - ax, pz - az);
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lengthSquared));
    return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
  };
  return (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    let height, east, north;
    try {
      height = Number(sampleHeightMeters(x, z));
      east = Number(sampleHeightMeters(x + offset, z));
      north = Number(sampleHeightMeters(x, z + offset));
    } catch { return null; }
    if (![height, east, north].every(Number.isFinite)) return null;
    const slopeDegrees = Math.max(
      Math.atan2(Math.abs(east - height), offset) * 180 / Math.PI,
      Math.atan2(Math.abs(north - height), offset) * 180 / Math.PI,
    );
    let roadDistance = Number.MAX_SAFE_INTEGER;
    for (const edge of roadEdges || []) {
      const points = Array.isArray(edge?.points) ? edge.points : [];
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1], b = points[i];
        if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) continue;
        roadDistance = Math.min(roadDistance, distanceToSegment(x, z, a.x, a.z, b.x, b.z));
      }
    }
    let settlementDistance = Number.MAX_SAFE_INTEGER;
    for (const seat of seats || []) {
      if (Number.isFinite(seat?.x) && Number.isFinite(seat?.z)) settlementDistance = Math.min(settlementDistance, Math.hypot(x - seat.x, z - seat.z));
    }
    const climate = northReferenceCryosphereAtWorldXZ(x, z) || {};
    const biome = Number(climate.permanentIce) >= 0.55 ? 'alpine-bare' : Number(climate.tundra) >= 0.20 ? 'tundra' : 'forest';
    const waterDepth = Math.max(0, Number(seaLevelMeters) - height);
    return { height, slopeDegrees, waterDepth, roadDistance, settlementDistance, biome, waterType: waterDepth > 0.05 ? 'sea' : null };
  };
}
