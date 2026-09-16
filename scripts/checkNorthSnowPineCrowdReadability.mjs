#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  VEGETATION_SPATIAL_PATTERN_POLICY,
  createVegetation,
  disposeVegetation,
} from '../src/3d/world/vegetation.js';
import { northReferenceCryosphereAtWorldXZ } from '../src/3d/world/northReferenceCryosphere.js';

function worldAt(normalizedX, normalizedY) {
  return normalizedReferenceToWorldXZ(normalizedX, normalizedY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
}

function snowPositions(group) {
  const mesh = group.getObjectByName('vegetation-snow-pine-trunks');
  assert(mesh?.isInstancedMesh, 'live vegetation must expose the snow-pine InstancedMesh');
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
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

function densestStand(points, radiusMeters) {
  let best = { anchor: null, members: [] };
  for (const anchor of points) {
    const members = points.filter((point) => Math.hypot(point.x - anchor.x, point.z - anchor.z) <= radiusMeters);
    if (members.length > best.members.length) best = { anchor, members };
  }
  return best;
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
    'snow-pine placement must remain bit-stable for the same world seed');

  const iceCutoff = VEGETATION_SPATIAL_PATTERN_POLICY.permanentIceTreeCutoff;
  let permanentIceCount = 0;
  const ecotoneSnow = [];
  for (const point of firstSnow) {
    const climate = northReferenceCryosphereAtWorldXZ(point.x, point.z);
    if (climate.permanentIce >= iceCutoff) permanentIceCount += 1;
    if (climate.permanentIce < iceCutoff && Math.max(climate.permanentIce, climate.tundra) >= 0.20) ecotoneSnow.push(point);
  }
  assert.equal(permanentIceCount, 0, 'permanent-ice core must remain free of snow-pine trees');
  assert(ecotoneSnow.length >= 8, `map-aligned tundra/ice ecotone must retain multiple snow pines, got ${ecotoneSnow.length}`);

  const crowdRadiusMeters = 900;
  const stand = densestStand(ecotoneSnow, crowdRadiusMeters);
  const crowd = stand.members;
  assert(crowd.length >= 8, `ecotone must contain a readable sparse snow-pine stand, got ${crowd.length}`);

  const distances = nearestNeighbourDistances(crowd);
  const medianNearestMeters = median(distances);
  assert(medianNearestMeters <= 340,
    `snow-pine ecotone stand is too sparse at gameplay/aerial range: median nearest=${medianNearestMeters.toFixed(1)} m`);

  const xs = crowd.map((point) => point.x), zs = crowd.map((point) => point.z);
  const spanX = Math.max(...xs) - Math.min(...xs), spanZ = Math.max(...zs) - Math.min(...zs);
  assert(spanX >= 220 && spanZ >= 220,
    `ecotone stand must occupy a 2D patch rather than a line/point cluster, spans=${spanX.toFixed(1)}x${spanZ.toFixed(1)} m`);

  const coreRadiusMeters = 520;
  const coreTrees = firstSnow.filter((point) => Math.hypot(point.x - winterCore.x, point.z - winterCore.z) <= coreRadiusMeters);
  assert.equal(coreTrees.length, 0, 'canonical always-winter core camera patch must stay visually treeless');

  const telemetry = first.group.userData.northClimateVegetation;
  assert.equal(telemetry?.mapAligned, true, 'runtime crowd telemetry must retain map-aligned ownership');
  assert.equal(telemetry?.climateAuthority, 'northReferenceCryosphereAtWorldXZ',
    'runtime crowd must keep the canonical X+Z cryosphere authority');

  console.log('[checkNorthSnowPineCrowdReadability] PASS', JSON.stringify({
    totalPlaced: first.placedCount,
    winterTreeCount: first.winterTreeCount,
    ecotoneSnowCount: ecotoneSnow.length,
    crowdCount: crowd.length,
    permanentIceCount,
    crowdRadiusMeters,
    medianNearestMeters: Number(medianNearestMeters.toFixed(2)),
    spanMeters: { x: Number(spanX.toFixed(2)), z: Number(spanZ.toFixed(2)) },
    standAnchor: stand.anchor,
    winterCore,
  }));
} finally {
  disposeVegetation(first.group);
  disposeVegetation(second.group);
}
