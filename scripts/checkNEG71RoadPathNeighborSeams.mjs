#!/usr/bin/env node
import assert from 'node:assert/strict';
import { G71_TERRAIN3D_ROAD_PATH_POLICY as P, sampleG71RoadPath } from '../godot/terrain-authoring/geocells/ne/g71_road_path.mjs';
import { sampleG70RoadPath } from '../godot/terrain-authoring/geocells/ne/g70_road_path.mjs';
import { measureG61Hydrology } from '../godot/terrain-authoring/geocells/ne/g61_hydrology.mjs';

const normalDelta = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
let northPairs = 0, maxNorthHeight = 0, maxNorthNormal = 0, maxNorthControl = 0, maxNorthRoad = 0, maxNorthPath = 0, maxNorthSurface = 0;
for (let i = 0; i <= 256; i += 1) {
  const x = P.normalizedBounds.xMin + (P.normalizedBounds.xMax - P.normalizedBounds.xMin) * i / 256;
  const a = sampleG71RoadPath(x, P.normalizedBounds.yMin), b = sampleG70RoadPath(x, P.normalizedBounds.yMin);
  maxNorthHeight = Math.max(maxNorthHeight, Math.abs(a.authoredHeight - b.authoredHeight));
  maxNorthNormal = Math.max(maxNorthNormal, normalDelta(a.normal, b.normal));
  maxNorthControl = Math.max(maxNorthControl, Math.abs(a.roadPathControlBlend - b.roadPathControlBlend));
  maxNorthRoad = Math.max(maxNorthRoad, Math.abs(a.roadCoverage - b.roadCoverage));
  maxNorthPath = Math.max(maxNorthPath, Math.abs(a.pathCoverage - b.pathCoverage));
  maxNorthSurface = Math.max(maxNorthSurface,
    Math.abs(a.rockWeight - b.rockWeight), Math.abs(a.snowWeight - b.snowWeight),
    Math.abs(a.terrestrialSurfaceMass - b.terrestrialSurfaceMass));
  northPairs += 1;
}
assert.equal(northPairs, 257); assert.equal(maxNorthHeight, 0); assert.equal(maxNorthNormal, 0);
assert.equal(maxNorthControl, 0); assert.equal(maxNorthRoad, 0); assert.equal(maxNorthPath, 0); assert.equal(maxNorthSurface, 0);

const west = measureG61Hydrology();
assert.equal(west.baseCells, 96); assert.equal(west.waterCells, 96); assert.equal(west.seaCells, 96);
assert.equal(west.landCells, 0); assert.equal(west.lakeCells, 0); assert.equal(west.boundaryEdges, 0);

let westPairs = 0, southPairs = 0, eastBoundarySamples = 0;
let maxGuardHeight = 0, maxGuardNormal = 0, maxGuardControl = 0, maxGuardCoverage = 0;
const g = P.guardNormalized;
for (let i = 0; i <= 256; i += 1) {
  const y = P.normalizedBounds.yMin + (P.normalizedBounds.yMax - P.normalizedBounds.yMin) * i / 256;
  const westCore = sampleG71RoadPath(P.normalizedBounds.xMin, y);
  const westGuard = sampleG71RoadPath(P.normalizedBounds.xMin - g, y);
  maxGuardHeight = Math.max(maxGuardHeight, Math.abs(westCore.authoredHeight - westGuard.authoredHeight));
  maxGuardNormal = Math.max(maxGuardNormal, normalDelta(westCore.normal, westGuard.normal));
  maxGuardControl = Math.max(maxGuardControl, Math.abs(westCore.roadPathControlBlend - westGuard.roadPathControlBlend));
  maxGuardCoverage = Math.max(maxGuardCoverage, Math.abs(westCore.coverage), Math.abs(westGuard.coverage)); westPairs += 1;

  const x = P.normalizedBounds.xMin + (P.normalizedBounds.xMax - P.normalizedBounds.xMin) * i / 256;
  const southCore = sampleG71RoadPath(x, P.normalizedBounds.yMax);
  const southGuard = sampleG71RoadPath(x, P.normalizedBounds.yMax + g);
  maxGuardHeight = Math.max(maxGuardHeight, Math.abs(southCore.authoredHeight - southGuard.authoredHeight));
  maxGuardNormal = Math.max(maxGuardNormal, normalDelta(southCore.normal, southGuard.normal));
  maxGuardControl = Math.max(maxGuardControl, Math.abs(southCore.roadPathControlBlend - southGuard.roadPathControlBlend));
  maxGuardCoverage = Math.max(maxGuardCoverage, Math.abs(southCore.coverage), Math.abs(southGuard.coverage)); southPairs += 1;

  const east = sampleG71RoadPath(1, y); assert.equal(east.coverage, 0); eastBoundarySamples += 1;
}
assert.equal(westPairs, 257); assert.equal(southPairs, 257); assert.equal(eastBoundarySamples, 257);
assert.equal(maxGuardHeight, 0); assert.equal(maxGuardNormal, 0); assert.equal(maxGuardControl, 0); assert.equal(maxGuardCoverage, 0);
assert.throws(() => sampleG71RoadPath(1 + 1e-6, .1875), /east of owner world/);

console.log(`NE_G71_ROAD_PATH_NEIGHBOR_SEAMS=${JSON.stringify({
  northNeighbor: 'G70', northPairs, westNeighbor: 'G61-hydrology', westPairs,
  southNeighbor: 'not-yet-authored-self-guard', southPairs, eastBoundarySamples,
  maxNorthHeight, maxNorthNormal, maxNorthControl, maxNorthRoad, maxNorthPath, maxNorthSurface,
  maxGuardHeight, maxGuardNormal, maxGuardControl, maxGuardCoverage,
})}`);
console.log('NE_G71_ROAD_PATH_NEIGHBOR_SEAMS_OK');
