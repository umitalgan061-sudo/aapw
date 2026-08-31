#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import { createVegetation, disposeVegetation } from '../src/3d/world/vegetation.js';
import { northReferenceCryosphereAtWorldXZ } from '../src/3d/world/northReferenceCryosphere.js';

function worldAt(normalizedX, normalizedY) {
  return normalizedReferenceToWorldXZ(
    normalizedX,
    normalizedY,
    WORLD_SCALE.MAP_BOUNDS,
    WORLD_SCALE.METERS_PER_MAP_UNIT,
  );
}

function snowPositions(group) {
  const mesh = group.getObjectByName('vegetation-snow-pine-trunks');
  assert(mesh?.isInstancedMesh, 'live vegetation must expose the snow-pine InstancedMesh');
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const positions = [];
  for (let index = 0; index < mesh.count; index += 1) {
    mesh.getMatrixAt(index, matrix);
    matrix.decompose(position, quaternion, scale);
    positions.push(Object.freeze({ x: position.x, z: position.z }));
  }
  return positions;
}

function nearestNeighbourDistances(points) {
  return points.map((point, index) => {
    let nearest = Infinity;
    for (let otherIndex = 0; otherIndex < points.length; otherIndex += 1) {
      if (otherIndex === index) continue;
      const other = points[otherIndex];
      nearest = Math.min(nearest, Math.hypot(point.x - other.x, point.z - other.z));
    }
    return nearest;
  }).filter(Number.isFinite).sort((a, b) => a - b);
}

function median(values) {
  if (values.length === 0) return Infinity;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
}

function roundedSignature(points) {
  return points.map(({ x, z }) => `${x.toFixed(5)},${z.toFixed(5)}`);
}

const winterCore = worldAt(0.145, 0.115);
const radiusMeters = Math.hypot(winterCore.x, winterCore.z) + 1100;
const fixture = Object.freeze({
  sampleHeightMeters: () => 120,
  seaLevelMeters: 0,
  seed: 0x43524f57,
  seats: [],
  roadEdges: [],
  radiusMeters,
  densityPerKm2: 30,
});

const first = createVegetation(fixture);
const second = createVegetation(fixture);

try {
  const firstSnow = snowPositions(first.group);
  const secondSnow = snowPositions(second.group);
  assert(firstSnow.length > 0, 'production-density live scatter must contain map-aligned snow pines');
  assert.equal(first.winterTreeCount, firstSnow.length, 'winter telemetry must match rendered snow-pine instances');
  assert.deepEqual(roundedSignature(firstSnow), roundedSignature(secondSnow),
    'snow-pine crowd placement must remain bit-stable for the same world seed');

  const crowdRadiusMeters = 900;
  const crowd = firstSnow.filter((point) => Math.hypot(point.x - winterCore.x, point.z - winterCore.z) <= crowdRadiusMeters);
  assert(crowd.length >= 12,
    `canonical always-winter camera neighbourhood must contain a readable snow-pine crowd, got ${crowd.length}`);

  const distances = nearestNeighbourDistances(crowd);
  const medianNearestMeters = median(distances);
  assert(medianNearestMeters <= 260,
    `snow-pine crowd is too sparse to read as a stand at gameplay/aerial range: median nearest=${medianNearestMeters.toFixed(1)} m`);

  const xs = crowd.map((point) => point.x);
  const zs = crowd.map((point) => point.z);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanZ = Math.max(...zs) - Math.min(...zs);
  assert(spanX >= 350 && spanZ >= 350,
    `winter crowd must occupy a 2D stand rather than a line/point cluster, spans=${spanX.toFixed(1)}x${spanZ.toFixed(1)} m`);

  let permanentIceCount = 0;
  let escapedClimateCount = 0;
  for (const point of crowd) {
    const climate = northReferenceCryosphereAtWorldXZ(point.x, point.z);
    if (climate.permanentIce >= 0.55) permanentIceCount += 1;
    if (Math.max(climate.permanentIce, climate.tundra) < 0.20) escapedClimateCount += 1;
  }
  assert.equal(escapedClimateCount, 0, 'crowd-readability fixture must not count snow pines outside northern climate ownership');
  assert(permanentIceCount >= 6,
    `canonical crowd must visibly anchor permanent ice with multiple snow pines, got ${permanentIceCount}`);

  const telemetry = first.group.userData.northClimateVegetation;
  assert.equal(telemetry?.mapAligned, true, 'runtime crowd telemetry must retain map-aligned ownership');
  assert.equal(telemetry?.climateAuthority, 'northReferenceCryosphereAtWorldXZ',
    'runtime crowd must keep the canonical X+Z cryosphere authority');

  console.log('[checkNorthSnowPineCrowdReadability] PASS', JSON.stringify({
    totalPlaced: first.placedCount,
    winterTreeCount: first.winterTreeCount,
    crowdCount: crowd.length,
    permanentIceCount,
    crowdRadiusMeters,
    medianNearestMeters: Number(medianNearestMeters.toFixed(2)),
    spanMeters: { x: Number(spanX.toFixed(2)), z: Number(spanZ.toFixed(2)) },
    winterCore,
  }));
} finally {
  disposeVegetation(first.group);
  disposeVegetation(second.group);
}
