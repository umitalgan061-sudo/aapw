/**
 * Render-only terrain chunk seam reconciliation.
 *
 * Canonical height/collider authority remains world/terrain.js. This module only reconciles the
 * duplicated render vertices that live on already-generated chunk boundaries. Mixed-resolution
 * mobile LOD pairs otherwise form classic T-junctions: the coarse edge is one straight segment while
 * the fine edge contains canonical intermediate samples which do not lie on that chord. The fine
 * boundary is therefore morphed onto the coarse rendered chord, while shared anchors, normals and
 * vertex colours are reconciled in world space. Interior vertices and every geometry index remain
 * untouched.
 *
 * @module world/terrainChunkSeam
 */

export const TERRAIN_CHUNK_SEAM_POLICY = Object.freeze({
  id: 'terrain-chunk-seam-continuity-2026-08-31-v1',
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  terrainHeightAuthority: 'world/terrain.js',
  colliderAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  indexTopologyUnchanged: true,
  drawCallCountUnchanged: true,
  supportedLodRatios: Object.freeze([1, 2, 4]),
  coordinateEpsilonMeters: 1e-5,
  interpolationEpsilon: 1e-8,
});

const SNAPSHOTS = new WeakMap();
const SIDES = Object.freeze(['west', 'east', 'north', 'south']);
const OPPOSITE_SIDE = Object.freeze({ west: 'east', east: 'west', north: 'south', south: 'north' });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function ensureSnapshot(mesh) {
  const geometry = mesh?.geometry;
  if (!geometry) return null;
  let snapshot = SNAPSHOTS.get(geometry);
  if (snapshot) return snapshot;
  const position = geometry.getAttribute?.('position');
  if (!position) return null;
  const segments = inferGridSegments(position);
  if (!segments) return null;
  const boundarySet = new Set();
  for (const side of SIDES) for (const index of boundaryIndices(position, side)) boundarySet.add(index);
  const indices = Int32Array.from([...boundarySet].sort((a, b) => a - b));
  const normal = geometry.getAttribute?.('normal');
  const color = geometry.getAttribute?.('color');
  const positions = new Float32Array(indices.length * 3);
  const normals = normal ? new Float32Array(indices.length * 3) : null;
  const colors = color ? new Float32Array(indices.length * 3) : null;
  for (let offset = 0; offset < indices.length; offset += 1) {
    const index = indices[offset], o = offset * 3;
    positions[o] = position.getX(index); positions[o + 1] = position.getY(index); positions[o + 2] = position.getZ(index);
    if (normal) { normals[o] = normal.getX(index); normals[o + 1] = normal.getY(index); normals[o + 2] = normal.getZ(index); }
    if (color) { colors[o] = color.getX(index); colors[o + 1] = color.getY(index); colors[o + 2] = color.getZ(index); }
  }
  snapshot = Object.freeze({ indices, positions, normals, colors });
  SNAPSHOTS.set(geometry, snapshot);
  return snapshot;
}

/** Restore one chunk boundary to its immutable generated render state before a new adjacency pass. */
export function restoreTerrainChunkSeam(mesh) {
  const snapshot = ensureSnapshot(mesh);
  if (!snapshot) return false;
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), color = geometry.getAttribute('color');
  for (let offset = 0; offset < snapshot.indices.length; offset += 1) {
    const index = snapshot.indices[offset], o = offset * 3;
    position.setXYZ(index, snapshot.positions[o], snapshot.positions[o + 1], snapshot.positions[o + 2]);
    if (normal && snapshot.normals) normal.setXYZ(index, snapshot.normals[o], snapshot.normals[o + 1], snapshot.normals[o + 2]);
    if (color && snapshot.colors) color.setXYZ(index, snapshot.colors[o], snapshot.colors[o + 1], snapshot.colors[o + 2]);
  }
  position.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  if (color) color.needsUpdate = true;
  geometry.computeBoundingBox?.();
  geometry.computeBoundingSphere?.();
  delete mesh.userData.terrainChunkSeam;
  return true;
}

function inferGridSegments(position) {
  const side = Math.round(Math.sqrt(position.count));
  if (side * side !== position.count || side < 2) return null;
  return side - 1;
}

function quantize(value, epsilon = TERRAIN_CHUNK_SEAM_POLICY.coordinateEpsilonMeters) {
  return Math.round(value / epsilon);
}

function worldAnchorKey(mesh, position, index) {
  return `${quantize(position.getX(index) + finite(mesh.position?.x))}:${quantize(position.getZ(index) + finite(mesh.position?.z))}`;
}

function normalizedVector(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function angleDegreesBetween(a, b) {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  return Math.acos(dot) * 180 / Math.PI;
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function boundaryIndices(position, side) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index), z = position.getZ(index);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const tolerance = Math.max(1e-7, Math.max(maxX - minX, maxZ - minZ) * 1e-8);
  const target = side === 'west' ? minX : side === 'east' ? maxX : side === 'north' ? minZ : maxZ;
  const useX = side === 'west' || side === 'east';
  const indices = [];
  for (let index = 0; index < position.count; index += 1) {
    const axis = useX ? position.getX(index) : position.getZ(index);
    if (Math.abs(axis - target) <= tolerance) indices.push(index);
  }
  indices.sort((a, b) => {
    const ta = useX ? position.getZ(a) : position.getX(a);
    const tb = useX ? position.getZ(b) : position.getX(b);
    return ta - tb;
  });
  return indices;
}

/** Build a stable descriptor without assuming Three.js PlaneGeometry's row-major index order. */
export function describeTerrainChunkGrid(mesh) {
  const geometry = mesh?.geometry;
  const position = geometry?.getAttribute?.('position');
  if (!position) return null;
  ensureSnapshot(mesh);
  const segments = inferGridSegments(position);
  if (!segments) return null;
  const sides = {};
  for (const side of SIDES) {
    const indices = boundaryIndices(position, side);
    if (indices.length !== segments + 1) return null;
    sides[side] = indices;
  }
  return {
    mesh,
    geometry,
    position,
    normal: geometry.getAttribute('normal'),
    color: geometry.getAttribute('color'),
    segments,
    chunkX: finite(mesh.userData?.chunkCoord?.x, NaN),
    chunkZ: finite(mesh.userData?.chunkCoord?.z, NaN),
    sides: Object.freeze(sides),
  };
}

function pairKey(a, b) {
  return `${a.chunkX},${a.chunkZ}|${b.chunkX},${b.chunkZ}`;
}

function sidePairFor(a, b) {
  if (b.chunkX === a.chunkX + 1 && b.chunkZ === a.chunkZ) return ['east', 'west'];
  if (b.chunkX === a.chunkX - 1 && b.chunkZ === a.chunkZ) return ['west', 'east'];
  if (b.chunkZ === a.chunkZ + 1 && b.chunkX === a.chunkX) return ['south', 'north'];
  if (b.chunkZ === a.chunkZ - 1 && b.chunkX === a.chunkX) return ['north', 'south'];
  return null;
}

function readNormal(descriptor, index) {
  const attr = descriptor.normal;
  return attr ? normalizedVector(attr.getX(index), attr.getY(index), attr.getZ(index)) : [0, 1, 0];
}

function writeNormal(descriptor, index, value) {
  descriptor.normal?.setXYZ(index, value[0], value[1], value[2]);
}

function readColor(descriptor, index) {
  const attr = descriptor.color;
  return attr ? [attr.getX(index), attr.getY(index), attr.getZ(index)] : null;
}

function writeColor(descriptor, index, value) {
  if (descriptor.color && value) descriptor.color.setXYZ(index, value[0], value[1], value[2]);
}

function lerp3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function reconcileMixedLodGeometry(fine, coarse, fineSide, coarseSide, stats, pendingInterpolations) {
  if (fine.segments <= coarse.segments || fine.segments % coarse.segments !== 0) return false;
  const ratio = fine.segments / coarse.segments;
  if (!TERRAIN_CHUNK_SEAM_POLICY.supportedLodRatios.includes(ratio)) return false;
  const fineIndices = fine.sides[fineSide], coarseIndices = coarse.sides[coarseSide];
  const eps = TERRAIN_CHUNK_SEAM_POLICY.interpolationEpsilon;
  for (let fineStep = 0; fineStep <= fine.segments; fineStep += 1) {
    const coarsePosition = fineStep / ratio;
    const rounded = Math.round(coarsePosition);
    if (Math.abs(coarsePosition - rounded) <= eps) {
      const fineIndex = fineIndices[fineStep], coarseIndex = coarseIndices[rounded];
      stats.maxSharedAnchorHeightMismatchMeters = Math.max(
        stats.maxSharedAnchorHeightMismatchMeters,
        Math.abs(fine.position.getY(fineIndex) - coarse.position.getY(coarseIndex)),
      );
      continue;
    }
    const lower = Math.floor(coarsePosition), upper = Math.ceil(coarsePosition), t = coarsePosition - lower;
    const fineIndex = fineIndices[fineStep], lowerIndex = coarseIndices[lower], upperIndex = coarseIndices[upper];
    const originalY = fine.position.getY(fineIndex);
    const targetY = coarse.position.getY(lowerIndex) + (coarse.position.getY(upperIndex) - coarse.position.getY(lowerIndex)) * t;
    stats.maxPreTjunctionHeightDeviationMeters = Math.max(stats.maxPreTjunctionHeightDeviationMeters, Math.abs(originalY - targetY));
    fine.position.setY(fineIndex, targetY);
    stats.morphedBoundaryVertexCount += 1;
    stats.maxBoundaryMorphMeters = Math.max(stats.maxBoundaryMorphMeters, Math.abs(originalY - targetY));
    pendingInterpolations.push({ fine, fineIndex, coarse, lowerIndex, upperIndex, t });
  }
  fine.position.needsUpdate = true;
  stats.mixedLodPairCount += 1;
  return true;
}

function collectSharedAnchors(descriptors) {
  const anchors = new Map();
  for (const descriptor of descriptors) {
    const visited = new Set();
    for (const side of SIDES) {
      for (const index of descriptor.sides[side]) {
        if (visited.has(index)) continue;
        visited.add(index);
        const key = worldAnchorKey(descriptor.mesh, descriptor.position, index);
        if (!anchors.has(key)) anchors.set(key, []);
        anchors.get(key).push({ descriptor, index });
      }
    }
  }
  return anchors;
}

function reconcileSharedAnchorAttributes(anchors, stats) {
  for (const entries of anchors.values()) {
    if (entries.length < 2) continue;
    let nx = 0, ny = 0, nz = 0;
    let cr = 0, cg = 0, cb = 0, colorCount = 0;
    const normals = [];
    const colors = [];
    for (const entry of entries) {
      const normal = readNormal(entry.descriptor, entry.index);
      normals.push(normal); nx += normal[0]; ny += normal[1]; nz += normal[2];
      const color = readColor(entry.descriptor, entry.index);
      colors.push(color);
      if (color) { cr += color[0]; cg += color[1]; cb += color[2]; colorCount += 1; }
    }
    for (let i = 0; i < normals.length; i += 1) for (let j = i + 1; j < normals.length; j += 1) {
      stats.maxPreSharedNormalAngleDegrees = Math.max(stats.maxPreSharedNormalAngleDegrees, angleDegreesBetween(normals[i], normals[j]));
      if (colors[i] && colors[j]) stats.maxPreSharedColorDelta = Math.max(stats.maxPreSharedColorDelta, colorDistance(colors[i], colors[j]));
    }
    const sharedNormal = normalizedVector(nx, ny, nz);
    const sharedColor = colorCount ? [cr / colorCount, cg / colorCount, cb / colorCount] : null;
    for (const entry of entries) {
      writeNormal(entry.descriptor, entry.index, sharedNormal);
      writeColor(entry.descriptor, entry.index, sharedColor);
      stats.reconciledSharedAnchorCount += 1;
    }
  }
}

function interpolateFineBoundaryAttributes(pendingInterpolations) {
  for (const link of pendingInterpolations) {
    const n0 = readNormal(link.coarse, link.lowerIndex), n1 = readNormal(link.coarse, link.upperIndex);
    writeNormal(link.fine, link.fineIndex, normalizedVector(...lerp3(n0, n1, link.t)));
    const c0 = readColor(link.coarse, link.lowerIndex), c1 = readColor(link.coarse, link.upperIndex);
    if (c0 && c1) writeColor(link.fine, link.fineIndex, lerp3(c0, c1, link.t));
  }
}

function finalizeDescriptorAttributes(descriptors, positionTouched) {
  for (const descriptor of descriptors) {
    if (positionTouched.has(descriptor.geometry)) {
      descriptor.position.needsUpdate = true;
      descriptor.geometry.computeBoundingBox?.();
      descriptor.geometry.computeBoundingSphere?.();
    }
    if (descriptor.normal) descriptor.normal.needsUpdate = true;
    if (descriptor.color) descriptor.color.needsUpdate = true;
  }
}

function freshStats() {
  return {
    policyId: TERRAIN_CHUNK_SEAM_POLICY.id,
    chunkCount: 0,
    adjacentPairCount: 0,
    sameLodPairCount: 0,
    mixedLodPairCount: 0,
    unsupportedPairCount: 0,
    morphedBoundaryVertexCount: 0,
    reconciledSharedAnchorCount: 0,
    maxBoundaryMorphMeters: 0,
    maxPreTjunctionHeightDeviationMeters: 0,
    maxSharedAnchorHeightMismatchMeters: 0,
    maxPreSharedNormalAngleDegrees: 0,
    maxPreSharedColorDelta: 0,
  };
}

/**
 * Restore and reconcile every currently loaded terrain chunk.
 *
 * @param {Map<string, any>|Iterable<any>} loadedMeshes
 * @returns {Readonly<object>}
 */
export function reconcileLoadedTerrainChunkSeams(loadedMeshes) {
  const meshes = loadedMeshes instanceof Map ? [...loadedMeshes.values()] : [...(loadedMeshes ?? [])];
  const stats = freshStats();
  for (const mesh of meshes) restoreTerrainChunkSeam(mesh);
  const descriptors = meshes.map(describeTerrainChunkGrid).filter(Boolean);
  stats.chunkCount = descriptors.length;
  const byCoord = new Map(descriptors.map((descriptor) => [`${descriptor.chunkX},${descriptor.chunkZ}`, descriptor]));
  const pendingInterpolations = [];
  const positionTouched = new Set();
  const visitedPairs = new Set();

  for (const descriptor of descriptors) {
    for (const neighborCoord of [[descriptor.chunkX + 1, descriptor.chunkZ], [descriptor.chunkX, descriptor.chunkZ + 1]]) {
      const neighbor = byCoord.get(`${neighborCoord[0]},${neighborCoord[1]}`);
      if (!neighbor) continue;
      const key = pairKey(descriptor, neighbor);
      if (visitedPairs.has(key)) continue;
      visitedPairs.add(key);
      const sidePair = sidePairFor(descriptor, neighbor);
      if (!sidePair) continue;
      stats.adjacentPairCount += 1;
      if (descriptor.segments === neighbor.segments) {
        stats.sameLodPairCount += 1;
        continue;
      }
      const fine = descriptor.segments > neighbor.segments ? descriptor : neighbor;
      const coarse = fine === descriptor ? neighbor : descriptor;
      const fineSide = fine === descriptor ? sidePair[0] : OPPOSITE_SIDE[sidePair[0]];
      const coarseSide = fine === descriptor ? sidePair[1] : OPPOSITE_SIDE[sidePair[1]];
      if (reconcileMixedLodGeometry(fine, coarse, fineSide, coarseSide, stats, pendingInterpolations)) {
        positionTouched.add(fine.geometry);
      } else {
        stats.unsupportedPairCount += 1;
      }
    }
  }

  // Do not call computeVertexNormals() here: it would mutate the first interior vertex row and force
  // full-geometry snapshots on hundreds of desktop chunks. Boundary shading is instead made continuous
  // below from the immutable generated normals; fine intermediate edge normals interpolate the coarse
  // anchors exactly, while interior normals remain the canonical terrain chunk's original values.

  const anchors = collectSharedAnchors(descriptors);
  reconcileSharedAnchorAttributes(anchors, stats);
  interpolateFineBoundaryAttributes(pendingInterpolations);
  finalizeDescriptorAttributes(descriptors, positionTouched);

  for (const descriptor of descriptors) {
    descriptor.mesh.userData.terrainChunkSeam = Object.freeze({
      policyId: TERRAIN_CHUNK_SEAM_POLICY.id,
      renderOnly: true,
      segments: descriptor.segments,
      reconciled: true,
    });
  }

  return Object.freeze({ ...stats });
}
