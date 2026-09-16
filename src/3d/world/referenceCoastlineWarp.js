/**
 * Source-anchored coastline-domain reconstruction for the canonical 96x64 owner-map mask.
 *
 * The source-derived semantic mask remains the only land/sea authority. This module decodes only the
 * sea/non-sea topology, builds one allocation-free signed distance field at module load, and exposes a
 * bounded sub-cell domain warp used by terrainReliefDetail.js. It does not create new islands, fill
 * lakes, modify the owner map, or own height/collision. The intent is purely geometric reconstruction:
 * break long cardinal stair steps left by the low-resolution semantic mask while keeping every change
 * inside a narrow band around an existing canonical sea/dry boundary.
 *
 * @module world/referenceCoastlineWarp
 */

import { WORLD_REFERENCE_BASE_SURFACE_MASK } from './worldReferenceSurfacePindexes.js';

const TAU = Math.PI * 2;
const clamp01 = (value) => value <= 0 ? 0 : value >= 1 ? 1 : value;
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export const REFERENCE_COASTLINE_WARP_POLICY = Object.freeze({
  id: 'owner-map-coastline-subcell-naturalization-2026-08-31-v1',
  sourceMaskSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256,
  sourceMapSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256,
  sourceMaskWidth: WORLD_REFERENCE_BASE_SURFACE_MASK.width,
  sourceMaskHeight: WORLD_REFERENCE_BASE_SURFACE_MASK.height,
  canonicalMaskUnchanged: true,
  canonicalLakeOwnershipUnchanged: true,
  heightAuthorityUnchanged: true,
  topologyPreserving: true,
  deterministic: true,
  transitionStartCells: 0.35,
  transitionEndCells: 2.65,
  normalMeanderCells: 0.34,
  tangentialMeanderCells: 0.10,
  maximumAdditionalWarpCells: 0.40,
  legacyWarpInteriorFraction: 0.20,
  legacyWarpCoastFraction: 0.62,
  boundaryNeighbourhood: 8,
});

const WIDTH = WORLD_REFERENCE_BASE_SURFACE_MASK.width;
const HEIGHT = WORLD_REFERENCE_BASE_SURFACE_MASK.height;
const SEA_CODE = WORLD_REFERENCE_BASE_SURFACE_MASK.codes.sea;

function decodeMask() {
  const { width, height, bitsPerCell, rowsHex } = WORLD_REFERENCE_BASE_SURFACE_MASK;
  const decoded = new Uint8Array(width * height);
  const totalBits = BigInt(width * bitsPerCell);
  const codeMask = (1n << BigInt(bitsPerCell)) - 1n;
  for (let y = 0; y < height; y += 1) {
    const row = BigInt(`0x${rowsHex[y]}`);
    for (let x = 0; x < width; x += 1) {
      const shift = totalBits - BigInt((x + 1) * bitsPerCell);
      decoded[y * width + x] = Number((row >> shift) & codeMask);
    }
  }
  return decoded;
}

const MASK_CODES = decodeMask();
const isSeaCell = (x, y) => MASK_CODES[y * WIDTH + x] === SEA_CODE;

function collectBoundaryCells() {
  const sea = [];
  const dry = [];
  const offsets = REFERENCE_COASTLINE_WARP_POLICY.boundaryNeighbourhood === 8
    ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
    : [[0, -1], [-1, 0], [1, 0], [0, 1]];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const seaHere = isSeaCell(x, y);
      let boundary = false;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) continue;
        if (isSeaCell(nx, ny) !== seaHere) {
          boundary = true;
          break;
        }
      }
      if (!boundary) continue;
      (seaHere ? sea : dry).push(Object.freeze({ x, y }));
    }
  }
  return Object.freeze({ sea: Object.freeze(sea), dry: Object.freeze(dry) });
}

const BOUNDARY_CELLS = collectBoundaryCells();

function nearestBoundaryDistanceCells(x, y, candidates) {
  let bestSquared = Infinity;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const dx = x - candidate.x;
    const dy = y - candidate.y;
    const squared = dx * dx + dy * dy;
    if (squared < bestSquared) bestSquared = squared;
  }
  return Math.sqrt(bestSquared);
}

function buildSignedDistanceField() {
  const field = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const sea = isSeaCell(x, y);
      const oppositeBoundary = sea ? BOUNDARY_CELLS.dry : BOUNDARY_CELLS.sea;
      const distance = Math.max(0.5, nearestBoundaryDistanceCells(x, y, oppositeBoundary) - 0.5);
      field[y * WIDTH + x] = sea ? -distance : distance;
    }
  }
  return field;
}

const SIGNED_DISTANCE_CELLS = buildSignedDistanceField();

function fieldAt(x, y) {
  const ix = Math.max(0, Math.min(WIDTH - 1, x));
  const iy = Math.max(0, Math.min(HEIGHT - 1, y));
  return SIGNED_DISTANCE_CELLS[iy * WIDTH + ix];
}

/** Bilinear signed-distance sample plus analytic gradient in mask-cell coordinates. */
export function sampleReferenceCoastlineField(normalizedX, normalizedY) {
  const nx = clamp01(Number.isFinite(normalizedX) ? normalizedX : 0);
  const ny = clamp01(Number.isFinite(normalizedY) ? normalizedY : 0);
  const fx = nx * WIDTH - 0.5;
  const fy = ny * HEIGHT - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = clamp01(fx - x0);
  const ty = clamp01(fy - y0);
  const a = fieldAt(x0, y0);
  const b = fieldAt(x0 + 1, y0);
  const c = fieldAt(x0, y0 + 1);
  const d = fieldAt(x0 + 1, y0 + 1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  const signedDistanceCells = top + (bottom - top) * ty;
  const gradientX = (b - a) * (1 - ty) + (d - c) * ty;
  const gradientY = (c - a) * (1 - tx) + (d - b) * tx;
  const gradientLength = Math.hypot(gradientX, gradientY);
  const normalX = gradientLength > 1e-8 ? gradientX / gradientLength : 0;
  const normalY = gradientLength > 1e-8 ? gradientY / gradientLength : 0;
  const absoluteDistanceCells = Math.abs(signedDistanceCells);
  const P = REFERENCE_COASTLINE_WARP_POLICY;
  const proximity = 1 - smooth01(
    (absoluteDistanceCells - P.transitionStartCells)
      / (P.transitionEndCells - P.transitionStartCells),
  );
  return {
    signedDistanceCells,
    absoluteDistanceCells,
    proximity,
    normalX,
    normalY,
    tangentX: -normalY,
    tangentY: normalX,
  };
}

function meanderSignals(nx, ny) {
  const broad = Math.sin(TAU * (nx * 5.17 + ny * 3.41) + 0.73) * 0.52
    + Math.sin(TAU * (nx * -2.83 + ny * 6.29) + 2.17) * 0.31
    + Math.sin(TAU * (nx * 8.11 + ny * -1.93) + 4.07) * 0.17;
  const tangent = Math.sin(TAU * (nx * 7.31 + ny * 4.87) + 1.31) * 0.61
    + Math.sin(TAU * (nx * -4.13 + ny * 9.07) + 3.63) * 0.39;
  return { broad, tangent };
}

/** Additional source-anchored warp in normalized owner-map coordinates. */
export function referenceCoastlineNaturalizationOffsets(normalizedX, normalizedY) {
  const nx = clamp01(Number.isFinite(normalizedX) ? normalizedX : 0);
  const ny = clamp01(Number.isFinite(normalizedY) ? normalizedY : 0);
  const field = sampleReferenceCoastlineField(nx, ny);
  if (field.proximity <= 0 || (field.normalX === 0 && field.normalY === 0)) {
    return { du: 0, dv: 0, proximity: 0, signedDistanceCells: field.signedDistanceCells };
  }
  const P = REFERENCE_COASTLINE_WARP_POLICY;
  const waves = meanderSignals(nx, ny);
  const cellX = nx * WIDTH - 0.5;
  const cellY = ny * HEIGHT - 0.5;
  const centerDx = Math.abs(cellX - Math.round(cellX));
  const centerDy = Math.abs(cellY - Math.round(cellY));
  const centerDistance = Math.hypot(centerDx, centerDy);
  const centerGuard = smooth01((centerDistance - 0.035) / 0.25);
  const coastGain = field.proximity * centerGuard;
  const normalCells = waves.broad * P.normalMeanderCells * coastGain;
  const tangentCells = waves.tangent * P.tangentialMeanderCells * coastGain;
  let duCells = field.normalX * normalCells + field.tangentX * tangentCells;
  let dvCells = field.normalY * normalCells + field.tangentY * tangentCells;
  const magnitude = Math.hypot(duCells, dvCells);
  if (magnitude > P.maximumAdditionalWarpCells) {
    const scale = P.maximumAdditionalWarpCells / magnitude;
    duCells *= scale;
    dvCells *= scale;
  }
  return {
    du: duCells / WIDTH,
    dv: dvCells / HEIGHT,
    proximity: field.proximity,
    signedDistanceCells: field.signedDistanceCells,
  };
}

export function referenceCoastlineWarpStats() {
  return Object.freeze({
    policyId: REFERENCE_COASTLINE_WARP_POLICY.id,
    width: WIDTH,
    height: HEIGHT,
    seaBoundaryCellCount: BOUNDARY_CELLS.sea.length,
    dryBoundaryCellCount: BOUNDARY_CELLS.dry.length,
  });
}
