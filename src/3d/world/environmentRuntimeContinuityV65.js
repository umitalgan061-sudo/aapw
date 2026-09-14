const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const round = (v, p = 4) => Number((Number.isFinite(v) ? v : 0).toFixed(p));

export const V65_CONTINUITY_POLICY = Object.freeze({
  id: 'environment-runtime-continuity-v65-2026-09-14',
  chunkSize: 512,
  seamBand: 44,
  overlapBand: 18,
  sampleSpacing: 32,
  transferDistance: 64,
  deterministic: true,
});

export const chunkKey = (x, z, size = V65_CONTINUITY_POLICY.chunkSize) => `${Math.floor(x / size)}:${Math.floor(z / size)}`;
export const chunkCoord = (key) => {
  const [x, z] = String(key).split(':').map(Number);
  return { x: Number.isFinite(x) ? x : 0, z: Number.isFinite(z) ? z : 0 };
};
export const chunkBounds = (key, size = V65_CONTINUITY_POLICY.chunkSize) => {
  const c = chunkCoord(key);
  return { minX: c.x * size, maxX: (c.x + 1) * size, minZ: c.z * size, maxZ: (c.z + 1) * size };
};
export const neighborKeys = (key) => {
  const c = chunkCoord(key);
  return [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => `${c.x + dx}:${c.z + dz}`)).filter((item) => item !== key);
};
export const pointDistanceToEdge = (x, z, bounds) => Math.min(Math.abs(x - bounds.minX), Math.abs(x - bounds.maxX), Math.abs(z - bounds.minZ), Math.abs(z - bounds.maxZ));
export const isInSeamBand = (x, z, key, band = V65_CONTINUITY_POLICY.seamBand) => pointDistanceToEdge(x, z, chunkBounds(key)) <= band;
export const isInOverlapBand = (x, z, key, band = V65_CONTINUITY_POLICY.overlapBand) => pointDistanceToEdge(x, z, chunkBounds(key)) <= band;

export const coordinateKey = (x, z, precision = 2) => `${Number(x).toFixed(precision)}:${Number(z).toFixed(precision)}`;
export const stableString = (value) => JSON.stringify(value, Object.keys(value || {}).sort());
export const simpleDigest = (value) => {
  let hash = 2166136261;
  for (const char of stableString(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const normalizeAnchor = (anchor = {}) => ({
  x: Number.isFinite(anchor.x) ? anchor.x : 0,
  z: Number.isFinite(anchor.z) ? anchor.z : 0,
  family: anchor.family || 'grass',
  scale: clamp(anchor.scale ?? 1, 0.2, 2.8),
  rotation: Number.isFinite(anchor.rotation) ? anchor.rotation : 0,
  lod: Number.isFinite(anchor.lod) ? Math.max(0, Math.floor(anchor.lod)) : 0,
});

export const edgeSide = (x, z, key) => {
  const b = chunkBounds(key);
  const distances = { west: Math.abs(x - b.minX), east: Math.abs(x - b.maxX), north: Math.abs(z - b.minZ), south: Math.abs(z - b.maxZ) };
  return Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0];
};

export const oppositeSide = (side) => ({ west: 'east', east: 'west', north: 'south', south: 'north' }[side] || side);
export const adjacentChunkForSide = (key, side) => {
  const c = chunkCoord(key);
  const delta = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] }[side] || [0, 0];
  return `${c.x + delta[0]}:${c.z + delta[1]}`;
};

export const boundaryKey = (anchor, key) => {
  const a = normalizeAnchor(anchor);
  return `${chunkKey(a.x, a.z)}|${edgeSide(a.x, a.z, key)}|${coordinateKey(a.x, a.z)}`;
};

export const pairContinuity = (left, right, tolerance = 28) => {
  const a = normalizeAnchor(left);
  const b = normalizeAnchor(right);
  const distance = Math.hypot(a.x - b.x, a.z - b.z);
  const familyMatch = a.family === b.family;
  const scaleDelta = Math.abs(a.scale - b.scale);
  const lodDelta = Math.abs(a.lod - b.lod);
  return {
    distance: round(distance),
    familyMatch,
    scaleDelta: round(scaleDelta),
    lodDelta,
    withinTolerance: distance <= tolerance,
    compatible: distance <= tolerance && scaleDelta <= 0.72 && lodDelta <= 1,
  };
};

export const dedupeAnchors = (anchors = [], precision = 1) => {
  const seen = new Set();
  const result = [];
  for (const raw of anchors) {
    const anchor = normalizeAnchor(raw);
    const key = `${anchor.family}|${anchor.x.toFixed(precision)}|${anchor.z.toFixed(precision)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(anchor);
    }
  }
  return result;
};

export const buildBoundaryTransfers = (anchors = [], key) => {
  const result = [];
  for (const anchor of dedupeAnchors(anchors)) {
    if (!isInSeamBand(anchor.x, anchor.z, key)) continue;
    const side = edgeSide(anchor.x, anchor.z, key);
    result.push({
      id: boundaryKey(anchor, key),
      sourceChunk: key,
      targetChunk: adjacentChunkForSide(key, side),
      side,
      oppositeSide: oppositeSide(side),
      anchor,
      transferDistance: V65_CONTINUITY_POLICY.transferDistance,
    });
  }
  return result;
};

export const mergeTransfers = (leftTransfers = [], rightTransfers = []) => {
  const map = new Map();
  for (const item of [...leftTransfers, ...rightTransfers]) map.set(item.id, item);
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
};

export const buildChunkContinuity = ({ key, anchors = [], neighbors = {} } = {}) => {
  const own = dedupeAnchors(anchors);
  const transfers = buildBoundaryTransfers(own, key);
  const comparisons = [];
  for (const [neighborKey, neighborAnchors] of Object.entries(neighbors)) {
    for (const left of transfers.filter((item) => item.targetChunk === neighborKey)) {
      const candidates = dedupeAnchors(neighborAnchors).filter((item) => Math.hypot(item.x - left.anchor.x, item.z - left.anchor.z) <= V65_CONTINUITY_POLICY.transferDistance);
      if (!candidates.length) comparisons.push({ transfer: left.id, neighborKey, matched: false });
      for (const candidate of candidates.slice(0, 3)) comparisons.push({ transfer: left.id, neighborKey, matched: true, continuity: pairContinuity(left.anchor, candidate) });
    }
  }
  const matched = comparisons.filter((item) => item.matched).length;
  return {
    key,
    anchors: own,
    transfers,
    comparisons,
    summary: {
      anchorCount: own.length,
      transferCount: transfers.length,
      comparedCount: comparisons.length,
      matchedCount: matched,
      continuityRate: round(matched / (comparisons.length || 1)),
    },
    digest: simpleDigest({ key, transfers, comparisons }),
  };
};

export const healSeam = (left, right) => {
  const a = normalizeAnchor(left);
  const b = normalizeAnchor(right);
  if (a.family !== b.family) return { changed: false, reason: 'family-mismatch', left: a, right: b };
  const midpoint = { x: round((a.x + b.x) / 2, 3), z: round((a.z + b.z) / 2, 3) };
  const scale = round((a.scale + b.scale) / 2);
  const rotation = round((a.rotation + b.rotation) / 2);
  return {
    changed: true,
    bridge: { ...midpoint, family: a.family, scale, rotation, lod: Math.min(a.lod, b.lod) },
    before: { left: a, right: b },
  };
};

export const continuityMatrix = (chunks = {}) => {
  const keys = Object.keys(chunks).sort();
  const rows = [];
  for (const key of keys) {
    for (const neighbor of neighborKeys(key).filter((candidate) => keys.includes(candidate))) {
      if (key >= neighbor) continue;
      const left = buildChunkContinuity({ key, anchors: chunks[key], neighbors: { [neighbor]: chunks[neighbor] } });
      rows.push({ left: key, right: neighbor, ...left.summary, digest: left.digest });
    }
  }
  const rate = rows.reduce((sum, row) => sum + row.continuityRate, 0) / (rows.length || 1);
  return { rows, meanContinuityRate: round(rate), pairCount: rows.length };
};

export const validateContinuity = (result) => {
  const errors = [];
  if (!result || !result.summary) errors.push('summary-missing');
  if (result?.summary?.continuityRate < 0 || result?.summary?.continuityRate > 1) errors.push('continuity-range');
  for (const transfer of result?.transfers || []) if (!transfer.targetChunk) errors.push('transfer-target');
  return { ok: errors.length === 0, errors };
};

export const buildContinuityEnvelope = ({ chunks = {}, camera = {} } = {}) => {
  const matrix = continuityMatrix(chunks);
  const cx = Number.isFinite(camera.x) ? camera.x : 0;
  const cz = Number.isFinite(camera.z) ? camera.z : 0;
  const active = chunkKey(cx, cz);
  return {
    activeChunk: active,
    residentNeighbors: neighborKeys(active).filter((key) => Object.prototype.hasOwnProperty.call(chunks, key)),
    matrix,
    seamSafe: matrix.meanContinuityRate >= 0.72,
    digest: simpleDigest({ active, matrix }),
  };
};

export const continuityTelemetry = (envelope) => ({
  policy: V65_CONTINUITY_POLICY.id,
  activeChunk: envelope?.activeChunk,
  residentNeighbors: envelope?.residentNeighbors?.length || 0,
  pairCount: envelope?.matrix?.pairCount || 0,
  continuityRate: envelope?.matrix?.meanContinuityRate || 0,
  seamSafe: envelope?.seamSafe === true,
  digest: envelope?.digest || null,
});
