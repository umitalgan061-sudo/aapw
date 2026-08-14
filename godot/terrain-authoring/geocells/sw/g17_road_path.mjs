/**
 * Günbatımı Ustası / SW G17 Road/Path authoring and measurement contract.
 *
 * G17 is canonical open sea. The physically correct Road/Path layer is a
 * deterministic negative proof: live roads and footpaths must stay outside
 * the owned parcel and its source-pixel guard band, and Terrain3D must not
 * invent road/path control IDs while preserving qualified substrate data.
 */
export const G17_ROAD_PATH_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g17-terrain3d-road-path-2026-08-14-v2',
  schema: 'westeros-g17-road-path-v2',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G17',
  gx: 1,
  gy: 7,
  layer: 'Road/Path',
  normalizedBounds: Object.freeze({ xMin: 1 / 8, xMax: 2 / 8, yMin: 7 / 8, yMax: 1 }),
  sourceGridSize: 257,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  // One canonical source pixel in each axis. This is a QA guard, not a visible tile border.
  guardBandNormalizedX: 1 / 1536,
  guardBandNormalizedY: 1 / 1024,
  groundTextureId: 0,
  rockTextureId: 1,
  roadTextureId: 2,
  pathTextureId: 3,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const finitePoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y);

export function expandG17Bounds(bounds = G17_ROAD_PATH_POLICY.normalizedBounds) {
  return Object.freeze({
    xMin: bounds.xMin - G17_ROAD_PATH_POLICY.guardBandNormalizedX,
    xMax: bounds.xMax + G17_ROAD_PATH_POLICY.guardBandNormalizedX,
    yMin: bounds.yMin - G17_ROAD_PATH_POLICY.guardBandNormalizedY,
    yMax: bounds.yMax + G17_ROAD_PATH_POLICY.guardBandNormalizedY,
  });
}

export function pointInsideBounds(point, bounds) {
  if (!finitePoint(point)) return false;
  return point.x >= bounds.xMin && point.x <= bounds.xMax &&
    point.y >= bounds.yMin && point.y <= bounds.yMax;
}

// Liang-Barsky line clipping. Touching the rectangle counts as an intersection.
export function segmentIntersectsBounds(a, b, bounds) {
  if (!finitePoint(a) || !finitePoint(b)) throw new TypeError('segment points must be finite');
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - bounds.xMin, bounds.xMax - a.x, a.y - bounds.yMin, bounds.yMax - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i += 1) {
    if (Math.abs(p[i]) <= Number.EPSILON) {
      if (q[i] < 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denom = dx * dx + dy * dy;
  if (denom <= Number.EPSILON) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denom));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function pointBoundsDistance(point, bounds) {
  const dx = Math.max(bounds.xMin - point.x, 0, point.x - bounds.xMax);
  const dy = Math.max(bounds.yMin - point.y, 0, point.y - bounds.yMax);
  return Math.hypot(dx, dy);
}

export function segmentBoundsClearance(a, b, bounds) {
  if (segmentIntersectsBounds(a, b, bounds)) return 0;
  const corners = [
    { x: bounds.xMin, y: bounds.yMin },
    { x: bounds.xMax, y: bounds.yMin },
    { x: bounds.xMax, y: bounds.yMax },
    { x: bounds.xMin, y: bounds.yMax },
  ];
  return Math.min(
    pointBoundsDistance(a, bounds),
    pointBoundsDistance(b, bounds),
    ...corners.map((corner) => pointSegmentDistance(corner, a, b)),
  );
}

export function measurePolylineAgainstG17(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return Object.freeze({
      segmentCount: 0,
      ownedCrossings: 0,
      guardCrossings: 0,
      minOwnedClearance: Infinity,
      minGuardClearance: Infinity,
      normalizedLength: 0,
    });
  }
  const owned = G17_ROAD_PATH_POLICY.normalizedBounds;
  const guard = expandG17Bounds(owned);
  let ownedCrossings = 0;
  let guardCrossings = 0;
  let minOwnedClearance = Infinity;
  let minGuardClearance = Infinity;
  let normalizedLength = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!finitePoint(a) || !finitePoint(b)) throw new TypeError('polyline contains a non-finite point');
    if (segmentIntersectsBounds(a, b, owned)) ownedCrossings += 1;
    if (segmentIntersectsBounds(a, b, guard)) guardCrossings += 1;
    minOwnedClearance = Math.min(minOwnedClearance, segmentBoundsClearance(a, b, owned));
    minGuardClearance = Math.min(minGuardClearance, segmentBoundsClearance(a, b, guard));
    normalizedLength += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return Object.freeze({
    segmentCount: points.length - 1,
    ownedCrossings,
    guardCrossings,
    minOwnedClearance,
    minGuardClearance,
    normalizedLength,
  });
}

export function sampleG17RoadPath(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const b = G17_ROAD_PATH_POLICY.normalizedBounds;
  const inside = normalizedX >= b.xMin && normalizedX <= b.xMax &&
    normalizedY >= b.yMin && normalizedY <= b.yMax;
  return Object.freeze({ inside, roadCoverage: 0, pathCoverage: 0, coverage: 0, kind: 0 });
}

function fnv1a(checksum, value) {
  return Math.imul((checksum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;
}

export function measureG17ZeroCoverage(size = G17_ROAD_PATH_POLICY.sourceGridSize) {
  if (!Number.isInteger(size) || size < 2) throw new RangeError('size must be integer >= 2');
  let checksum = 2166136261;
  let maxCoverage = 0;
  let activeSamples = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sample = sampleG17RoadPath(x / (size - 1), y / (size - 1));
      maxCoverage = Math.max(maxCoverage, sample.coverage);
      if (sample.coverage > 0) activeSamples += 1;
      checksum = fnv1a(checksum, Math.round(clamp01(sample.roadCoverage) * 255));
      checksum = fnv1a(checksum, Math.round(clamp01(sample.pathCoverage) * 255));
    }
  }
  return Object.freeze({
    sourceGridSize: size,
    samples: size * size,
    activeSamples,
    maxCoverage,
    maxAdjacentCoverageStep: 0,
    maxGuardBandCoverageDelta: 0,
    coverageChecksum: checksum,
  });
}
