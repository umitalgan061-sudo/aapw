#!/usr/bin/env node
import assert from 'node:assert/strict';
import { G60_TERRAIN3D_ROAD_PATH_POLICY as P, sampleG60RoadPath } from '../godot/terrain-authoring/geocells/ne/g60_road_path.mjs';
import { sampleG70RoadPath } from '../godot/terrain-authoring/geocells/ne/g70_road_path.mjs';
import { measureG61Hydrology } from '../godot/terrain-authoring/geocells/ne/g61_hydrology.mjs';

let pairs = 0, maxHeight = 0, maxControl = 0, maxRoad = 0, maxPath = 0, maxMaterial = 0;
const edgeX = P.normalizedBounds.xMax;
for (let i = 0; i <= 256; i += 1) {
  const y = P.normalizedBounds.yMin + (P.normalizedBounds.yMax - P.normalizedBounds.yMin) * i / 256;
  const a = sampleG60RoadPath(edgeX, y), b = sampleG70RoadPath(edgeX, y);
  maxHeight = Math.max(maxHeight, Math.abs(a.authoredHeight - b.authoredHeight));
  maxControl = Math.max(maxControl, Math.abs(a.roadPathControlBlend - b.roadPathControlBlend));
  maxRoad = Math.max(maxRoad, Math.abs(a.roadCoverage - b.roadCoverage));
  maxPath = Math.max(maxPath, Math.abs(a.pathCoverage - b.pathCoverage));
  maxMaterial = Math.max(maxMaterial,
    Math.abs(a.rockWeight - b.rockWeight), Math.abs(a.snowWeight - b.snowWeight),
    ...a.color.map((v, c) => Math.abs(v - b.color[c])), Math.abs(a.roughness - b.roughness));
  pairs += 1;
}
assert.equal(pairs, 257); assert.equal(maxHeight, 0); assert.equal(maxControl, 0);
assert.equal(maxRoad, 0); assert.equal(maxPath, 0); assert.equal(maxMaterial, 0);

const south = measureG61Hydrology();
assert.equal(south.baseCells, 96); assert.equal(south.waterCells, 96); assert.equal(south.seaCells, 96);
assert.equal(south.landCells, 0); assert.equal(south.lakeCells, 0); assert.equal(south.boundaryEdges, 0);
let southPairs = 0, maxSouthGuardHeight = 0, maxSouthGuardControl = 0;
for (let i = 0; i <= 256; i += 1) {
  const x = P.normalizedBounds.xMin + (P.normalizedBounds.xMax - P.normalizedBounds.xMin) * i / 256;
  const a = sampleG60RoadPath(x, P.normalizedBounds.yMax);
  const b = sampleG60RoadPath(x, P.normalizedBounds.yMax + P.guardNormalized);
  maxSouthGuardHeight = Math.max(maxSouthGuardHeight, Math.abs(a.authoredHeight - b.authoredHeight));
  maxSouthGuardControl = Math.max(maxSouthGuardControl, Math.abs(a.roadPathControlBlend - b.roadPathControlBlend));
  assert.equal(a.coverage, 0); assert.equal(b.coverage, 0); southPairs += 1;
}
assert.equal(southPairs, 257); assert.equal(maxSouthGuardHeight, 0); assert.equal(maxSouthGuardControl, 0);
const metrics = { eastNeighbor:'G70', eastPairs:pairs, southNeighbor:'G61', southPairs,
  maxHeight, maxControl, maxRoad, maxPath, maxMaterial, maxSouthGuardHeight, maxSouthGuardControl };
console.log(`NE_G60_ROAD_PATH_NEIGHBOR_SEAMS=${JSON.stringify(metrics)}`);
console.log('NE_G60_ROAD_PATH_NEIGHBOR_SEAMS_OK');
