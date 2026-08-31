#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_SCALE } from '../src/3d/config.js';
import { createTerrainChunk, disposeTerrainChunk } from '../src/3d/world/terrain.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK } from '../src/3d/world/worldReferenceSurfacePindexes.js';
import {
  collectLakeCenters,
  normalizedToWorld,
  summarize,
  round,
  writeJsonArtifact,
} from './lib/lakeBasinQa.mjs';

const centers = collectLakeCenters(WORLD_REFERENCE_BASE_SURFACE_MASK);
const chunkSize = 500;
const segments = 24;
const epsilonHeight = 1e-9;
const epsilonUv = 1e-7;
const epsilonColor = 2e-5;

function vertexIndex(column, row) {
  return row * (segments + 1) + column;
}

function readVertex(mesh, column, row) {
  const index = vertexIndex(column, row);
  const position = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  const color = mesh.geometry.getAttribute('color');
  return Object.freeze({
    index,
    y: position.getY(index),
    u: uv.getX(index),
    v: uv.getY(index),
    r: color.getX(index),
    g: color.getY(index),
    b: color.getZ(index),
  });
}

function compareVertices(a, b, label, metrics) {
  const heightDelta = Math.abs(a.y - b.y);
  const uvDelta = Math.max(Math.abs(a.u - b.u), Math.abs(a.v - b.v));
  const colorDelta = Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b),
  );
  metrics.height.push(heightDelta);
  metrics.uv.push(uvDelta);
  metrics.color.push(colorDelta);
  assert(heightDelta <= epsilonHeight, `${label} height seam delta ${heightDelta}`);
  assert(uvDelta <= epsilonUv, `${label} UV seam delta ${uvDelta}`);
  assert(colorDelta <= epsilonColor, `${label} color seam delta ${colorDelta}`);
}

function compareEastWest(left, right, label, metrics) {
  for (let row = 0; row <= segments; row += 1) {
    compareVertices(
      readVertex(left, segments, row),
      readVertex(right, 0, row),
      `${label} east-west row ${row}`,
      metrics,
    );
  }
}

function compareNorthSouth(north, south, label, metrics) {
  for (let column = 0; column <= segments; column += 1) {
    compareVertices(
      readVertex(north, column, segments),
      readVertex(south, column, 0),
      `${label} north-south column ${column}`,
      metrics,
    );
  }
}

function createChunk(cx, cz) {
  return createTerrainChunk({
    chunkX: cx,
    chunkZ: cz,
    size: chunkSize,
    segments,
  });
}

const globalMetrics = { height: [], uv: [], color: [] };
const lakeReports = [];

for (const [lakeIndex, center] of centers.entries()) {
  const world = normalizedToWorld(center.nx, center.ny, WORLD_SCALE);
  const cx = Math.round(world.x / chunkSize);
  const cz = Math.round(world.z / chunkSize);
  const chunks = new Map();
  const get = (x, z) => {
    const key = `${x}/${z}`;
    if (!chunks.has(key)) chunks.set(key, createChunk(x, z));
    return chunks.get(key);
  };
  const localMetrics = { height: [], uv: [], color: [] };
  try {
    const centerChunk = get(cx, cz);
    const east = get(cx + 1, cz);
    const west = get(cx - 1, cz);
    const south = get(cx, cz + 1);
    const north = get(cx, cz - 1);
    const northEast = get(cx + 1, cz - 1);
    const southWest = get(cx - 1, cz + 1);

    compareEastWest(centerChunk, east, `lake ${lakeIndex} center/east`, localMetrics);
    compareEastWest(west, centerChunk, `lake ${lakeIndex} west/center`, localMetrics);
    compareNorthSouth(centerChunk, south, `lake ${lakeIndex} center/south`, localMetrics);
    compareNorthSouth(north, centerChunk, `lake ${lakeIndex} north/center`, localMetrics);
    compareEastWest(north, northEast, `lake ${lakeIndex} north/northeast`, localMetrics);
    compareNorthSouth(west, southWest, `lake ${lakeIndex} west/southwest`, localMetrics);

    globalMetrics.height.push(...localMetrics.height);
    globalMetrics.uv.push(...localMetrics.uv);
    globalMetrics.color.push(...localMetrics.color);
    lakeReports.push(Object.freeze({
      lakeIndex,
      lakeCell: { x: center.cellX, y: center.cellY },
      normalized: { nx: round(center.nx, 6), ny: round(center.ny, 6) },
      world: { x: round(world.x, 3), z: round(world.z, 3) },
      centerChunk: { x: cx, z: cz },
      comparedVertexPairs: localMetrics.height.length,
      heightDelta: summarize(localMetrics.height, 12),
      uvDelta: summarize(localMetrics.uv, 10),
      colorDelta: summarize(localMetrics.color, 8),
    }));
  } finally {
    for (const chunk of chunks.values()) disposeTerrainChunk(chunk);
  }
}

assert(globalMetrics.height.length >= centers.length * (segments + 1) * 4,
  'chunk seam QA did not compare enough shared vertices');
assert(globalMetrics.height.every((delta) => delta <= epsilonHeight));
assert(globalMetrics.uv.every((delta) => delta <= epsilonUv));
assert(globalMetrics.color.every((delta) => delta <= epsilonColor));

const report = Object.freeze({
  chunkSize,
  segments,
  lakeCount: centers.length,
  comparedVertexPairs: globalMetrics.height.length,
  tolerances: {
    height: epsilonHeight,
    uv: epsilonUv,
    color: epsilonColor,
  },
  aggregate: {
    heightDelta: summarize(globalMetrics.height, 12),
    uvDelta: summarize(globalMetrics.uv, 10),
    colorDelta: summarize(globalMetrics.color, 8),
  },
  lakes: lakeReports,
});

writeJsonArtifact('artifacts/lake-basin-exact-head/chunk-seams.json', report);
console.log('[checkLakeBasinChunkSeams] PASS');
console.log(JSON.stringify(report, null, 2));
