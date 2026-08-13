/**
 * Şafak Kartalı / NE GeoCell G70 — Coast/Hydrology through pinned Terrain3D.
 *
 * G70 is the literal NE origin cell and is canonical open sea. GeoCell/mask coordinates are
 * addressing and QA only. The authored field is evaluated in owner-map normalized coordinates and
 * includes a small west/south guard band into the already-qualified G60/G71 sea neighbours.
 * No coastline, island or land relief may be invented in this layer.
 */

import {
  classifyReferenceWaterBody,
  sampleReferenceCoastBlend,
} from '../../../../src/3d/world/worldReferenceWaterMask.js';
import { CANONICAL_TERRAIN_SHADOW_POLICY } from '../../../../src/3d/world/worldReferenceTerrainAdapter.js';

export const G70_TERRAIN3D_HYDROLOGY_POLICY = Object.freeze({
  id: 'safak-kartali-g70-terrain3d-hydrology-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G70',
  gx: 7,
  gy: 0,
  layer: 'Coast/Hydrology',
  pixelBounds: Object.freeze({ xMin: 1344, xMax: 1536, yMin: 0, yMax: 128 }),
  maskCellBounds: Object.freeze({ xMin: 84, xMax: 96, yMin: 0, yMax: 8 }),
  normalizedBounds: Object.freeze({ xMin: 7 / 8, xMax: 1, yMin: 0, yMax: 1 / 8 }),
  guardBandNormalized: 1 / 1536,
  sourceGridSize: 65,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  seaLevelMeters: 0,
  minimumWaterDepthMeters: CANONICAL_TERRAIN_SHADOW_POLICY.minimumWaterDepthMeters,
  openWaterDepthMeters: CANONICAL_TERRAIN_SHADOW_POLICY.openWaterDepthMeters,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function g70GuardBounds() {
  const b = G70_TERRAIN3D_HYDROLOGY_POLICY.normalizedBounds;
  const g = G70_TERRAIN3D_HYDROLOGY_POLICY.guardBandNormalized;
  return Object.freeze({
    xMin: b.xMin - g,
    xMax: b.xMax,
    yMin: b.yMin,
    yMax: b.yMax + g,
  });
}

export function sampleG70Hydrology(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const body = classifyReferenceWaterBody(normalizedX, normalizedY);
  const coastBlend = sampleReferenceCoastBlend(normalizedX, normalizedY);
  const depthMeters = G70_TERRAIN3D_HYDROLOGY_POLICY.minimumWaterDepthMeters
    + (G70_TERRAIN3D_HYDROLOGY_POLICY.openWaterDepthMeters
      - G70_TERRAIN3D_HYDROLOGY_POLICY.minimumWaterDepthMeters) * clamp01(coastBlend);
  return Object.freeze({
    body,
    water: body === 'sea' || body === 'lake',
    coastBlend,
    depthMeters,
    heightMeters: G70_TERRAIN3D_HYDROLOGY_POLICY.seaLevelMeters - depthMeters,
  });
}

function hashByte(checksum, byte) {
  return Math.imul((checksum ^ (byte & 0xff)) >>> 0, 16777619) >>> 0;
}

function hashQuantized(checksum, value, scale = 1000000) {
  const quantized = Math.round(value * scale) | 0;
  let result = checksum;
  for (const shift of [0, 8, 16, 24]) result = hashByte(result, quantized >>> shift);
  return result >>> 0;
}

function bodyByte(body) {
  return body === 'sea' ? 2 : body === 'lake' ? 1 : 0;
}

export function measureG70Terrain3DHydrology() {
  const policy = G70_TERRAIN3D_HYDROLOGY_POLICY;
  const mask = policy.maskCellBounds;
  let waterCells = 0;
  let landCells = 0;
  let seaCells = 0;
  let lakeCells = 0;
  let boundaryEdges = 0;
  let semanticChecksum = 2166136261;

  for (let y = mask.yMin; y < mask.yMax; y += 1) {
    for (let x = mask.xMin; x < mask.xMax; x += 1) {
      const sample = sampleG70Hydrology((x + 0.5) / 96, (y + 0.5) / 64);
      if (sample.water) waterCells += 1;
      else landCells += 1;
      if (sample.body === 'sea') seaCells += 1;
      else if (sample.body === 'lake') lakeCells += 1;
      semanticChecksum = hashByte(semanticChecksum, bodyByte(sample.body));
      if (x + 1 < mask.xMax) {
        const east = sampleG70Hydrology((x + 1.5) / 96, (y + 0.5) / 64);
        if (east.water !== sample.water) boundaryEdges += 1;
      }
      if (y + 1 < mask.yMax) {
        const south = sampleG70Hydrology((x + 0.5) / 96, (y + 1.5) / 64);
        if (south.water !== sample.water) boundaryEdges += 1;
      }
    }
  }

  const guardSamples = [];
  for (let y = mask.yMin; y < mask.yMax; y += 1) guardSamples.push(sampleG70Hydrology((mask.xMin - 0.5) / 96, (y + 0.5) / 64));
  for (let x = mask.xMin; x < mask.xMax; x += 1) guardSamples.push(sampleG70Hydrology((x + 0.5) / 96, (mask.yMax + 0.5) / 64));
  guardSamples.push(sampleG70Hydrology((mask.xMin - 0.5) / 96, (mask.yMax + 0.5) / 64));
  const guardSeaSamples = guardSamples.filter((sample) => sample.body === 'sea').length;

  const bounds = g70GuardBounds();
  const size = policy.sourceGridSize;
  let minHeightMeters = Infinity;
  let maxHeightMeters = -Infinity;
  let maxAdjacentHeightDeltaMeters = 0;
  let maxGuardHeightDeltaMeters = 0;
  let denseNonSeaSamples = 0;
  let sourceChecksum = 2166136261;
  let previousRow = null;

  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG70Hydrology(nx, ny);
      if (sample.body !== 'sea') denseNonSeaSamples += 1;
      minHeightMeters = Math.min(minHeightMeters, sample.heightMeters);
      maxHeightMeters = Math.max(maxHeightMeters, sample.heightMeters);
      if (x > 0) maxAdjacentHeightDeltaMeters = Math.max(maxAdjacentHeightDeltaMeters, Math.abs(sample.heightMeters - row[x - 1].heightMeters));
      if (previousRow) maxAdjacentHeightDeltaMeters = Math.max(maxAdjacentHeightDeltaMeters, Math.abs(sample.heightMeters - previousRow[x].heightMeters));
      sourceChecksum = hashQuantized(sourceChecksum, sample.heightMeters);
      sourceChecksum = hashQuantized(sourceChecksum, sample.coastBlend);
      row.push(sample);
    }
    previousRow = row;
  }

  const core = policy.normalizedBounds;
  const g = policy.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const ny = core.yMin + (core.yMax - core.yMin) * t;
    const nx = core.xMin + (core.xMax - core.xMin) * t;
    const westCore = sampleG70Hydrology(core.xMin, ny);
    const westGuard = sampleG70Hydrology(core.xMin - g, ny);
    const southCore = sampleG70Hydrology(nx, core.yMax);
    const southGuard = sampleG70Hydrology(nx, core.yMax + g);
    maxGuardHeightDeltaMeters = Math.max(
      maxGuardHeightDeltaMeters,
      Math.abs(westCore.heightMeters - westGuard.heightMeters),
      Math.abs(southCore.heightMeters - southGuard.heightMeters),
    );
  }

  return Object.freeze({
    policyId: policy.id,
    geoCell: policy.geoCell,
    layer: policy.layer,
    baseCells: 96,
    waterCells,
    landCells,
    seaCells,
    lakeCells,
    boundaryEdges,
    semanticChecksum,
    guardSamples: guardSamples.length,
    guardSeaSamples,
    guardNonSeaSamples: guardSamples.length - guardSeaSamples,
    denseSamples: size * size,
    denseNonSeaSamples,
    minHeightMeters,
    maxHeightMeters,
    maxAdjacentHeightDeltaMeters,
    maxGuardHeightDeltaMeters,
    sourceChecksum,
  });
}

export function buildG70Terrain3DHydrologySource() {
  const policy = G70_TERRAIN3D_HYDROLOGY_POLICY;
  const bounds = g70GuardBounds();
  const size = policy.sourceGridSize;
  const payload = {
    schema: 'westeros-g70-terrain3d-hydrology-source-v1',
    policyId: policy.id,
    sourceMapSha256: policy.sourceMapSha256,
    geoCell: policy.geoCell,
    layer: policy.layer,
    width: size,
    height: size,
    coreBounds: policy.normalizedBounds,
    guardBounds: bounds,
    seaLevelMeters: policy.seaLevelMeters,
    minimumWaterDepthMeters: policy.minimumWaterDepthMeters,
    openWaterDepthMeters: policy.openWaterDepthMeters,
    heights: [],
    waterConfidence: [],
  };
  let checksum = 2166136261;
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG70Hydrology(nx, ny);
      if (sample.body !== 'sea') throw new Error(`G70 guard-backed source invented non-sea semantics at ${x},${y}: ${sample.body}`);
      const heightMeters = Number(sample.heightMeters.toFixed(6));
      const confidence = Number(sample.coastBlend.toFixed(8));
      payload.heights.push(heightMeters);
      payload.waterConfidence.push(confidence);
      checksum = hashQuantized(checksum, heightMeters);
      checksum = hashQuantized(checksum, confidence);
    }
  }
  payload.sourceChecksum = checksum >>> 0;
  return Object.freeze(payload);
}
