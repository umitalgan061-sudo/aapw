#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyTerrainMicroSurface,
  createHeightSampler,
  createTerrainChunk,
  disposeTerrainChunk,
  TERRAIN_MICRO_SURFACE_POLICY,
  terrainMicroUvAt,
} from '../src/3d/world/terrain.js';

const EPSILON = 1e-5;
const CHUNK_SIZE = 500;
const close = (actual, expected, label) => assert(
  Math.abs(actual - expected) <= EPSILON,
  `${label}: ${actual} !== ${expected}`,
);

function channelRange(data, channel) {
  let min = 255;
  let max = 0;
  for (let index = channel; index < data.length; index += 4) {
    min = Math.min(min, data[index]);
    max = Math.max(max, data[index]);
  }
  return { min, max };
}

function meanAbsoluteNeighborDelta(data, size, channel) {
  let total = 0;
  let samples = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4 + channel;
      const right = (y * size + ((x + 1) % size)) * 4 + channel;
      const down = (((y + 1) % size) * size + x) * 4 + channel;
      total += Math.abs(data[index] - data[right]) + Math.abs(data[index] - data[down]);
      samples += 2;
    }
  }
  return total / samples;
}

assert.equal(TERRAIN_MICRO_SURFACE_POLICY.id, 'terrain-micro-surface-world-uv-pbr-v3-photoreal');
assert.equal(TERRAIN_MICRO_SURFACE_POLICY.uvChannel, 1, 'micro detail must use uv1, never owner-map albedo uv0');
assert(TERRAIN_MICRO_SURFACE_POLICY.textureSize >= 256, 'photoreal terrain atlas needs enough fracture resolution');
assert(TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters >= 12 && TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters <= 32);
assert(TERRAIN_MICRO_SURFACE_POLICY.normalStrength > 0.4 && TERRAIN_MICRO_SURFACE_POLICY.normalStrength < 1.2);
assert.equal(TERRAIN_MICRO_SURFACE_POLICY.macroColorBreakup, true);
assert.equal(TERRAIN_MICRO_SURFACE_POLICY.photorealDesaturation, true);
assert.equal(TERRAIN_MICRO_SURFACE_POLICY.fractureNormals, true);
assert.deepEqual(TERRAIN_MICRO_SURFACE_POLICY.worldSpaceMacroScaleMeters, [145, 620, 2400]);

const standalone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
applyTerrainMicroSurface(standalone);
assert(standalone.normalMap?.isDataTexture, 'terrain needs a generated normal DataTexture');
assert(standalone.roughnessMap?.isDataTexture, 'terrain needs a generated roughness DataTexture');
for (const texture of [standalone.normalMap, standalone.roughnessMap]) {
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  assert.equal(texture.wrapT, THREE.RepeatWrapping);
  assert.equal(texture.channel, 1, 'micro PBR maps must sample uv1');
  assert.equal(texture.colorSpace, THREE.NoColorSpace);
  close(texture.repeat.x, 1, 'micro texture repeat x');
  close(texture.repeat.y, 1, 'micro texture repeat y');
  assert.equal(texture.image.width, TERRAIN_MICRO_SURFACE_POLICY.textureSize);
  assert.equal(texture.image.height, TERRAIN_MICRO_SURFACE_POLICY.textureSize);
}
close(standalone.normalScale.x, TERRAIN_MICRO_SURFACE_POLICY.normalStrength, 'normal strength x');
close(standalone.normalScale.y, TERRAIN_MICRO_SURFACE_POLICY.normalStrength, 'normal strength y');
assert.equal(standalone.userData.terrainMicroSurface.renderOnly, true);
assert.equal(standalone.userData.terrainMicroSurface.macroWorldSpaceColorBreakup, true);
assert.equal(standalone.userData.terrainMicroSurface.photorealDesaturation, true);
assert.equal(standalone.userData.terrainMicroSurface.fractureNormals, true);
assert.equal(standalone.customProgramCacheKey(), 'terrain-photoreal-world-surface-v3');
const shaderHookSource = standalone.onBeforeCompile.toString();
for (const marker of ['terrainPhotoFbm', 'terrainPhotoVegetation', 'terrainPhotoRock', 'terrainPhotoSnow']) {
  assert(shaderHookSource.includes(marker), `terrain shader lost ${marker} realism signal`);
}

const normalData = standalone.normalMap.image.data;
const roughnessData = standalone.roughnessMap.image.data;
const normalXRange = channelRange(normalData, 0);
const normalYRange = channelRange(normalData, 1);
const normalZRange = channelRange(normalData, 2);
const roughnessRange = channelRange(roughnessData, 1);
assert(normalXRange.max - normalXRange.min > 50, 'normal atlas must vary strongly along tangent X');
assert(normalYRange.max - normalYRange.min > 50, 'normal atlas must vary strongly along tangent Y');
assert(normalZRange.min > 80, 'photoreal micro normals must remain upward-facing');
assert(roughnessRange.max - roughnessRange.min > 35, 'roughness atlas must contain dry/polished variation');
const normalLocalEnergy = meanAbsoluteNeighborDelta(normalData, TERRAIN_MICRO_SURFACE_POLICY.textureSize, 0)
  + meanAbsoluteNeighborDelta(normalData, TERRAIN_MICRO_SURFACE_POLICY.textureSize, 1);
const roughnessLocalEnergy = meanAbsoluteNeighborDelta(roughnessData, TERRAIN_MICRO_SURFACE_POLICY.textureSize, 1);
assert(normalLocalEnergy > 5, `normal atlas is too smooth (${normalLocalEnergy.toFixed(2)})`);
assert(roughnessLocalEnergy > 1.5, `roughness atlas is too smooth (${roughnessLocalEnergy.toFixed(2)})`);

const sampler = createHeightSampler(12345);
const west = createTerrainChunk({ chunkX: 0, chunkZ: 0, size: CHUNK_SIZE, segments: 2, seed: 12345 });
const east = createTerrainChunk({ chunkX: 1, chunkZ: 0, size: CHUNK_SIZE, segments: 2, seed: 12345 });
assert.equal(west.material.normalMap, east.material.normalMap, 'all chunks must share one micro normal atlas');
assert.equal(west.material.roughnessMap, east.material.roughnessMap, 'all chunks must share one micro roughness atlas');
assert.equal(west.material.normalMap.channel, 1);
assert.equal(west.material.roughnessMap.channel, 1);
assert.equal(west.userData.currentTerrainMicroSurface.policyId, TERRAIN_MICRO_SURFACE_POLICY.id);
assert.equal(west.userData.currentTerrainMicroSurface.macroWorldSpaceColorBreakup, true);

for (const chunk of [west, east]) {
  const positions = chunk.geometry.getAttribute('position');
  const microUv = chunk.geometry.getAttribute('uv1');
  assert(microUv, 'production terrain chunk must expose uv1 for metre-space PBR detail');
  for (let index = 0; index < positions.count; index += 2) {
    const worldX = chunk.position.x + positions.getX(index);
    const worldZ = chunk.position.z + positions.getZ(index);
    const expected = terrainMicroUvAt(worldX, worldZ);
    close(microUv.getX(index), expected.u, `uv1.u chunk ${chunk.position.x} vertex ${index}`);
    close(microUv.getY(index), expected.v, `uv1.v chunk ${chunk.position.x} vertex ${index}`);
    close(positions.getY(index), sampler(worldX, worldZ), `canonical height chunk ${chunk.position.x} vertex ${index}`);
  }
  assert.equal(chunk.userData.currentTerrainSingleSource, true);
}

function boundary(mesh, localX) {
  const position = mesh.geometry.getAttribute('position');
  const microUv = mesh.geometry.getAttribute('uv1');
  const rows = [];
  for (let index = 0; index < position.count; index += 1) {
    if (Math.abs(position.getX(index) - localX) > EPSILON) continue;
    rows.push({
      z: position.getZ(index),
      y: position.getY(index),
      u: microUv.getX(index),
      v: microUv.getY(index),
    });
  }
  return rows.sort((a, b) => a.z - b.z);
}

const westEdge = boundary(west, CHUNK_SIZE / 2);
const eastEdge = boundary(east, -CHUNK_SIZE / 2);
assert.equal(westEdge.length, eastEdge.length);
for (let index = 0; index < westEdge.length; index += 1) {
  close(westEdge[index].y, eastEdge[index].y, `seam height ${index}`);
  close(westEdge[index].u, eastEdge[index].u, `seam uv1.u ${index}`);
  close(westEdge[index].v, eastEdge[index].v, `seam uv1.v ${index}`);
}

const period = TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters;
const origin = terrainMicroUvAt(17.5, -33.25);
const oneTileEast = terrainMicroUvAt(17.5 + period, -33.25);
const oneTileNorth = terrainMicroUvAt(17.5, -33.25 + period);
close(oneTileEast.u - origin.u, 1, 'one detail period east must advance exactly one micro tile');
close(oneTileNorth.v - origin.v, 1, 'one detail period north must advance exactly one micro tile');

standalone.dispose();
disposeTerrainChunk(west);
disposeTerrainChunk(east);
console.log('[checkTerrainMicroSurface] PASS: photoreal world-space colour breakup + fractured normal/roughness detail stay seam-continuous and never change canonical height.');
