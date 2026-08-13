/**
 * Kızıl Ufuk / G65 compact Terrain3D-qualified runtime grid.
 *
 * The grid is reconstructed once from the merged Near Detail source using the exact storage
 * transforms observed in the real pinned Terrain3D v1.0.2 bake from run 31698396821. Dedicated
 * CI re-bakes Terrain3D and proves every 129x129 node plus 257x257 interpolated probes.
 */
import {
  G65_NEAR_DETAIL_POLICY,
  sampleG65NearDetail,
} from '../../godot/terrain-authoring/geocells/se/g65_near_detail.mjs';

export const G65_TERRAIN3D_RUNTIME_GRID = Object.freeze({
  id: 'kizil-ufuk-g65-terrain3d-runtime-grid-2026-08-13-v1',
  parityPolicyId: 'kizil-ufuk-g65-terrain3d-threejs-runtime-parity-2026-08-13-v1',
  artifactRunId: 31698396821,
  artifactId: 9180429652,
  artifactDigestSha256: '620251ad4a8dfcae708346e4445cf7e9d3386787f722a48045a76551b7631a02',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  terrain3dVersion: '1.0.2',
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  terrain3dRegionCount: 4,
  terrain3dBakedVertices: 263169,
  terrain3dSavedRegionFiles: 4,
  gridSize: 129,
  normalizedBounds: Object.freeze({ xMin: 6 / 8, xMax: 7 / 8, yMin: 5 / 8, yMax: 6 / 8 }),
  maxNodeHeightErrorMeters: 0.00000101,
  maxNodeUnitError: 0.00000002,
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const round = (value, digits) => Number(value.toFixed(digits));
const rgba8 = (value) => Math.floor(clamp01(value) * 255 + 1e-12) / 255;
const control8 = (value) => Math.round(clamp01(value) * 255) / 255;

function buildGrid() {
  if (G65_NEAR_DETAIL_POLICY.sourceMapSha256 !== G65_TERRAIN3D_RUNTIME_GRID.sourceMapSha256) {
    throw new Error('G65 runtime grid map.png provenance mismatch');
  }
  const size = G65_TERRAIN3D_RUNTIME_GRID.gridSize;
  const bounds = G65_TERRAIN3D_RUNTIME_GRID.normalizedBounds;
  const count = size * size;
  const heights = new Float64Array(count);
  const rockBlend = new Float64Array(count);
  const tintR = new Float64Array(count);
  const tintG = new Float64Array(count);
  const tintB = new Float64Array(count);
  const roughness = new Float64Array(count);
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG65NearDetail(nx, ny);
      if (sample.waterConfidence >= 0.5 || sample.roadCoverage !== 0 || sample.pathCoverage !== 0 || sample.snowWeight !== 0) {
        throw new Error(`G65 runtime grid semantic drift at ${x},${y}`);
      }
      const index = y * size + x;
      const sourceHeight = round(sample.authoredHeight, 6);
      heights[index] = round(Math.fround(sourceHeight), 6);
      rockBlend[index] = control8(round(sample.rockBlend, 8));
      tintR[index] = rgba8(round(sample.tintR, 8));
      tintG[index] = rgba8(round(sample.tintG, 8));
      tintB[index] = rgba8(round(sample.tintB, 8));
      roughness[index] = rgba8(round(sample.roughness, 8));
    }
  }
  return Object.freeze({ heights, rockBlend, tintR, tintG, tintB, roughness });
}

const GRID = buildGrid();

function query(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const bounds = G65_TERRAIN3D_RUNTIME_GRID.normalizedBounds;
  if (normalizedX < bounds.xMin || normalizedX > bounds.xMax || normalizedY < bounds.yMin || normalizedY > bounds.yMax) return null;
  const size = G65_TERRAIN3D_RUNTIME_GRID.gridSize;
  const gx = ((normalizedX - bounds.xMin) / (bounds.xMax - bounds.xMin)) * (size - 1);
  const gy = ((normalizedY - bounds.yMin) / (bounds.yMax - bounds.yMin)) * (size - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  return { x0, y0, x1: Math.min(x0 + 1, size - 1), y1: Math.min(y0 + 1, size - 1), tx: gx - x0, ty: gy - y0, size };
}

function bilerp(values, q) {
  const i00 = q.y0 * q.size + q.x0, i10 = q.y0 * q.size + q.x1;
  const i01 = q.y1 * q.size + q.x0, i11 = q.y1 * q.size + q.x1;
  const top = values[i00] + (values[i10] - values[i00]) * q.tx;
  const bottom = values[i01] + (values[i11] - values[i01]) * q.tx;
  return top + (bottom - top) * q.ty;
}

export function sampleG65Terrain3dRuntimeGridNormalized(normalizedX, normalizedY) {
  const q = query(normalizedX, normalizedY);
  if (!q) return null;
  return Object.freeze({
    height: bilerp(GRID.heights, q),
    rockBlend: bilerp(GRID.rockBlend, q),
    color: Object.freeze([bilerp(GRID.tintR, q), bilerp(GRID.tintG, q), bilerp(GRID.tintB, q)]),
    roughness: bilerp(GRID.roughness, q),
    snowBlend: 0,
    roadBlend: 0,
    pathBlend: 0,
  });
}

export function getG65Terrain3dRuntimeGridForVerification() {
  return GRID;
}
