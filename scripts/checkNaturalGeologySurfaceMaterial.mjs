#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  NATURAL_GEOLOGY_RENDER_POLICY,
  createNaturalGeology,
  createNaturalRockPrototypeGeometry,
  disposeNaturalGeology,
  naturalGeologyColorForPlacement,
  naturalGeologyHydratedWeatheringMultiplier,
} from '../src/3d/world/naturalGeology.js';

const WIDTH = 13296.078906418774;
const DEPTH = 10341.394704992379;
const SEA = 6;
const terrain = (x, z) => {
  const nx = x / WIDTH, nz = z / DEPTH;
  const regional = 76 + Math.sin(nx * Math.PI * 3.1 + nz * 1.4) * 46 + Math.sin(nz * Math.PI * 4.1 - nx * 1.2) * 31;
  const ridge = Math.pow(Math.abs(Math.sin((nx * 0.8 + nz * 0.31) * Math.PI * 16)), 1.5) * 92;
  return Math.max(SEA + 3, regional + ridge + Math.max(0, nz + 0.18) * 48);
};

assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.renderOnly, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.geographyAuthorityUnchanged, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.proceduralBaseColorNeutral, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.proceduralVertexWeathering, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.proceduralBaseOriginNormalized, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.hydratedBaseOriginNormalized, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.fallbackHydratedGroundParity, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.instanceClimateColor, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.hydratedSourceMapsPreserved, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.hydratedInstanceWeathering, true);
assert(NATURAL_GEOLOGY_RENDER_POLICY.hydratedRoughnessFloor >= 0.8);
assert(NATURAL_GEOLOGY_RENDER_POLICY.hydratedMetalnessCeiling <= 0.05);

const kinds = ['fractured-scarp', 'bedrock', 'low-outcrop', 'talus', 'boulder', 'asset-proxy'];
const geometryStats = [];
for (const kind of kinds) {
  const geometry = createNaturalRockPrototypeGeometry(kind);
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  assert(positions?.count > 0, `${kind} position attribute missing`);
  assert.equal(colors?.count, positions.count, `${kind} vertex weathering color count mismatch`);
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox?.min?.y;
  assert(Number.isFinite(minY), `${kind} bounding box missing`);
  assert(Math.abs(minY) <= 1e-6, `${kind} procedural base origin drifted from local y=0: ${minY}`);
  assert.equal(geometry.userData.naturalGeologyBaseOrigin?.bottomAtLocalZero, true, `${kind} base-origin metadata missing`);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < colors.count; i += 1) {
    const values = [colors.getX(i), colors.getY(i), colors.getZ(i)];
    assert(values.every(Number.isFinite), `${kind} has non-finite vertex weathering`);
    min = Math.min(min, ...values); max = Math.max(max, ...values);
  }
  assert(max - min >= 0.035, `${kind} vertex weathering is too uniform: ${min}..${max}`);
  assert(min >= 0.72 && max <= 1.08, `${kind} weathering range escaped neutral multiplier bounds: ${min}..${max}`);
  assert.equal(geometry.userData.naturalGeologySurface?.geographyAuthorityChanged, false);
  assert.equal(geometry.userData.naturalGeologySurface?.baseOriginNormalized, true);
  geometryStats.push({ kind, vertices: positions.count, minY: Number(minY.toFixed(8)), min: Number(min.toFixed(4)), max: Number(max.toFixed(4)) });
  geometry.dispose();
}

const placement = (overrides) => ({
  x: 1200, z: -900, y: 90, kind: 'bedrock', volcanic: false,
  valyriaInfluence: 0, curvatureMeters: 0.2, northness: 0.45,
  southernDryness: 0.25, heightAboveSeaMeters: 120, localReliefMeters: 55,
  ...overrides,
});
const temperate = placement({});
const north = placement({ x: -1300, z: -3100, northness: 0.92, southernDryness: 0.02, heightAboveSeaMeters: 410, localReliefMeters: 145 });
const south = placement({ x: 850, z: 3100, northness: 0.05, southernDryness: 0.96, heightAboveSeaMeters: 180, localReliefMeters: 80 });
const volcanic = placement({ x: 3600, z: 2500, volcanic: true, valyriaInfluence: 0.92, curvatureMeters: 1.2, kind: 'fractured-scarp' });
const color = (sample) => naturalGeologyColorForPlacement(sample).toArray();
const multiplier = (sample) => naturalGeologyHydratedWeatheringMultiplier(sample).toArray();
assert.deepEqual(color(north), color({ ...north }), 'north placement color must be deterministic');
assert.deepEqual(multiplier(south), multiplier({ ...south }), 'hydrated multiplier must be deterministic');
assert.notDeepEqual(color(north), color(south), 'north/south procedural geology lost geographic color separation');
assert.notDeepEqual(multiplier(north), multiplier(south), 'north/south hydrated geology lost geographic weathering separation');
assert(color(south)[0] > color(south)[2] * 1.45, 'southern geology is not warm/ferric enough');
assert(color(north)[2] > color(north)[0], 'northern/high geology is not cool enough');
assert(multiplier(south)[0] > multiplier(south)[2], 'hydrated southern multiplier must preserve warm weathering');
assert(multiplier(north)[2] > multiplier(north)[0], 'hydrated northern multiplier must preserve cool exposure');
assert(multiplier(volcanic)[0] > multiplier(volcanic)[2], 'hydrated volcanic multiplier must preserve oxidized basalt bias');
for (const sample of [temperate, north, south, volcanic]) {
  for (const value of multiplier(sample)) assert(value >= 0.68 && value <= 1.01, `hydrated weathering multiplier ${value} is too destructive`);
}

const created = createNaturalGeology({
  sampleHeightMeters: terrain,
  seaLevelMeters: SEA,
  seed: 1337,
  seats: [],
  roadEdges: [],
  worldWidthMeters: WIDTH,
  worldDepthMeters: DEPTH,
});
const instanced = created.group.children.filter((child) => child?.isInstancedMesh);
assert(instanced.length >= 4, `expected geology instanced families, got ${instanced.length}`);
let renderedInstances = 0;
for (const mesh of instanced) {
  assert(mesh.material?.isMeshStandardMaterial, `${mesh.name} material is not MeshStandardMaterial`);
  assert(mesh.material.vertexColors === true, `${mesh.name} lost procedural vertex weathering`);
  assert(mesh.material.color.equals(new THREE.Color(0xffffff)), `${mesh.name} reintroduced base×instance double tint`);
  assert(mesh.geometry.getAttribute('color')?.count === mesh.geometry.getAttribute('position')?.count, `${mesh.name} vertex weathering missing`);
  assert(mesh.instanceColor?.count === mesh.count, `${mesh.name} geographic instance colors missing`);
  assert.equal(mesh.userData.naturalGeologySurface?.doubleTintRemoved, true, `${mesh.name} double-tint contract missing`);
  assert.equal(mesh.userData.naturalGeologySurface?.baseOriginNormalized, true, `${mesh.name} base-origin parity contract missing`);
  mesh.geometry.computeBoundingBox();
  assert(Math.abs(mesh.geometry.boundingBox.min.y) <= 1e-6, `${mesh.name} fallback geometry is not ground-origin aligned`);
  renderedInstances += mesh.count;
}
assert.equal(renderedInstances, created.placements.length, 'each geology placement must remain represented exactly once in procedural fallback');
disposeNaturalGeology(created.group);

console.log('[checkNaturalGeologySurfaceMaterial] PASS');
console.log(JSON.stringify({
  policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
  placementCount: created.placements.length,
  instancedFamilyCount: instanced.length,
  geometryStats,
  colors: { temperate: color(temperate), north: color(north), south: color(south), volcanic: color(volcanic) },
  hydratedMultipliers: { temperate: multiplier(temperate), north: multiplier(north), south: multiplier(south), volcanic: multiplier(volcanic) },
  baseOriginParity: true,
}, null, 2));