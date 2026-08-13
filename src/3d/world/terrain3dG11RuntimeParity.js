/**
 * Runtime adapter for a deterministic G11 Terrain3D bake artifact.
 * GeoCell coordinates are artifact addressing only; bilinear interpolation is continuous.
 */
export const G11_PARITY_SCHEMA = 'westeros-g11-terrain3d-bake-v1';
function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}
function assertBake(bake) {
  if (!bake || bake.schema !== G11_PARITY_SCHEMA) throw new TypeError('invalid G11 Terrain3D bake schema');
  if (!Number.isInteger(bake.width) || !Number.isInteger(bake.height) || bake.width < 2 || bake.height < 2) throw new RangeError('G11 bake dimensions must be >= 2');
  if (!Array.isArray(bake.heights) || bake.heights.length !== bake.width * bake.height) throw new RangeError('G11 bake height payload size mismatch');
  for (let i = 0; i < bake.heights.length; i++) assertFinite(Number(bake.heights[i]), `G11 bake height[${i}]`);
}
export function createG11Terrain3DBakeSampler(bake) {
  assertBake(bake);
  const { minX, maxX, minY, maxY } = bake.normalizedBounds;
  assertFinite(minX, 'minX'); assertFinite(maxX, 'maxX'); assertFinite(minY, 'minY'); assertFinite(maxY, 'maxY');
  if (!(maxX > minX) || !(maxY > minY)) throw new RangeError('G11 normalized bounds are invalid');
  const sx = (bake.width - 1) / (maxX - minX), sy = (bake.height - 1) / (maxY - minY);
  return function sampleNormalized(nx, ny) {
    if (nx < minX || nx > maxX || ny < minY || ny > maxY) return null;
    const x = Math.min(bake.width - 1, Math.max(0, (nx - minX) * sx));
    const y = Math.min(bake.height - 1, Math.max(0, (ny - minY) * sy));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(bake.width - 1, x0 + 1), y1 = Math.min(bake.height - 1, y0 + 1);
    const tx = x - x0, ty = y - y0, at = (ix, iy) => Number(bake.heights[iy * bake.width + ix]);
    const a = at(x0, y0) * (1 - tx) + at(x1, y0) * tx, b = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
    return a * (1 - ty) + b * ty;
  };
}
export function applyG11Terrain3DBakeToPositionAttribute(position, normalizedForVertex, bake) {
  const sample = createG11Terrain3DBakeSampler(bake); let touched = 0;
  for (let i = 0; i < position.count; i++) { const uv = normalizedForVertex(i); const height = sample(uv.x, uv.y); if (height === null) continue; position.setY(i, height); touched++; }
  position.needsUpdate = touched > 0; return touched;
}
