/**
 * Şafak Kartalı / NE GeoCell G70 hydrology qualification.
 *
 * G70 is source pixels x=1344..1536, y=0..128 of canonical map.png.
 * This authoring-only contract samples the immutable 96x64 canonical water mask
 * and proves whether G70 contains a coastline that merits interpolation. It must
 * not be imported by the shipped runtime.
 */

import { classifyReferenceWaterCell } from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G70_HYDROLOGY_POLICY = Object.freeze({
  id: 'safak-kartali-g70-hydrology-2026-08-12-v3',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G70',
  gx: 7,
  gy: 0,
  pixelBounds: Object.freeze({ xMin: 1344, xMax: 1536, yMin: 0, yMax: 128 }),
  maskCellBounds: Object.freeze({ xMin: 84, xMax: 96, yMin: 0, yMax: 8 }),
  sourcePixelsPerMaskCell: 16,
});

function isWater(surface) {
  return surface === 'sea' || surface === 'lake';
}

export function measureG70Hydrology() {
  const { maskCellBounds } = G70_HYDROLOGY_POLICY;
  let waterCells = 0;
  let landCells = 0;
  let seaCells = 0;
  let lakeCells = 0;
  let boundaryEdges = 0;
  let checksum = 2166136261;

  for (let y = maskCellBounds.yMin; y < maskCellBounds.yMax; y += 1) {
    for (let x = maskCellBounds.xMin; x < maskCellBounds.xMax; x += 1) {
      const body = classifyReferenceWaterCell(x, y);
      const water = isWater(body);
      if (water) waterCells += 1;
      else landCells += 1;
      if (body === 'sea') seaCells += 1;
      if (body === 'lake') lakeCells += 1;

      if (x + 1 < maskCellBounds.xMax && water !== isWater(classifyReferenceWaterCell(x + 1, y))) boundaryEdges += 1;
      if (y + 1 < maskCellBounds.yMax && water !== isWater(classifyReferenceWaterCell(x, y + 1))) boundaryEdges += 1;

      const semanticByte = body === 'sea' ? 2 : body === 'lake' ? 1 : 0;
      checksum ^= semanticByte;
      checksum = Math.imul(checksum, 16777619) >>> 0;
    }
  }

  return Object.freeze({
    policyId: G70_HYDROLOGY_POLICY.id,
    geoCell: G70_HYDROLOGY_POLICY.geoCell,
    baseCells: 96,
    waterCells,
    landCells,
    seaCells,
    lakeCells,
    boundaryEdges,
    semanticChecksum: checksum,
    needsCoastInterpolation: boundaryEdges > 0,
  });
}
