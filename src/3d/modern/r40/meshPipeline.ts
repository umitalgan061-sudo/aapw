import { hashJson, clamp, stableSort } from './deterministic';
import { estimateTextureBytes } from './render';

export interface MeshPrimitive { readonly id: string; readonly vertices: number; readonly triangles: number; readonly materialId: string; readonly textureIds: readonly string[]; }
export interface MeshAsset { readonly id: string; readonly primitives: readonly MeshPrimitive[]; readonly lods: readonly number[]; readonly bytes: number; readonly digest: string; }
export interface MeshBudget { readonly triangles: number; readonly vertices: number; readonly textures: number; readonly bytes: number; }
export interface MeshOptimizationReport { readonly originalTriangles: number; readonly optimizedTriangles: number; readonly reduction: number; readonly budgetAccepted: boolean; readonly digest: string; }

export function optimizeMesh(asset: MeshAsset, targetReduction = 0.35): MeshOptimizationReport {
  const originalTriangles = asset.primitives.reduce((sum, p) => sum + p.triangles, 0);
  const factor = 1 - clamp(targetReduction, 0, 0.8);
  const optimizedTriangles = asset.primitives.reduce((sum, p) => sum + Math.max(12, Math.floor(p.triangles * factor)), 0);
  return Object.freeze({ originalTriangles, optimizedTriangles, reduction: originalTriangles > 0 ? 1 - optimizedTriangles / originalTriangles : 0, budgetAccepted: optimizedTriangles <= originalTriangles, digest: hashJson({ asset: asset.id, optimizedTriangles }) });
}
export function chooseLod(distance: number, lodDistances: readonly number[]): number {
  let selected = lodDistances.length - 1;
  for (let i = 0; i < lodDistances.length; i += 1) if (distance <= lodDistances[i]!) { selected = i; break; }
  return Math.max(0, selected);
}
export function textureBudget(width: number, height: number, bpp = 4): number { return estimateTextureBytes(width, height, bpp, true); }
export function meshDigest(asset: MeshAsset): string { return hashJson({ id: asset.id, primitives: stableSort(asset.primitives, (a, b) => a.id.localeCompare(b.id)), lods: [...asset.lods].sort((a, b) => a - b) }); }
