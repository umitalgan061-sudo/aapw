import assert from 'node:assert/strict';
import { classifyReferenceBaseSurface } from '../src/3d/world/worldReferenceSurfacePindexes.js';
import { measureG16Hydrology } from '../godot/terrain-authoring/geocells/sw/g16_hydrology.mjs';

function isWater(surface) {
  return surface === 'sea' || surface === 'lake';
}

function inspectGeoCell(gx, gy) {
  const maskXMin = gx * 12;
  const maskYMin = gy * 8;
  let water = 0;
  let land = 0;
  let boundaries = 0;
  const cells = [];

  for (let ly = 0; ly < 8; ly += 1) {
    const row = [];
    for (let lx = 0; lx < 12; lx += 1) {
      const mx = maskXMin + lx;
      const my = maskYMin + ly;
      const surface = classifyReferenceBaseSurface((mx + 0.5) / 96, (my + 0.5) / 64);
      const waterFlag = isWater(surface);
      if (waterFlag) water += 1;
      else land += 1;
      row.push(waterFlag);
    }
    cells.push(row);
  }

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 12; x += 1) {
      if (x + 1 < 12 && cells[y][x] !== cells[y][x + 1]) boundaries += 1;
      if (y + 1 < 8 && cells[y][x] !== cells[y + 1][x]) boundaries += 1;
    }
  }

  return { geoCell: `G${gx}${gy}`, gx, gy, water, land, boundaries, distance: Math.max(gx, 7 - gy) };
}

const g16 = measureG16Hydrology();
assert.equal(g16.baseCells, 96);
assert.equal(g16.waterCells, 96, 'Actions classifier establishes G16 as uniform water');
assert.equal(g16.landCells, 0);
assert.equal(g16.boundaryEdges, 0);

const inventory = [];
for (let gy = 0; gy < 8; gy += 1) {
  for (let gx = 0; gx < 8; gx += 1) inventory.push(inspectGeoCell(gx, gy));
}

inventory.sort((a, b) => a.distance - b.distance || b.gy - a.gy || a.gx - b.gx);
const transitions = inventory.filter((cell) => cell.water > 0 && cell.land > 0 && cell.boundaries > 0);
assert.ok(transitions.length > 0, 'canonical map must contain at least one mixed land/water GeoCell');

console.log(JSON.stringify({
  g16: { water: g16.waterCells, land: g16.landCells, boundaries: g16.boundaryEdges },
  nearestTransitions: transitions.slice(0, 12),
}, null, 2));

assert.fail(`G16 has no coastline; nearest canonical transition is ${transitions[0].geoCell}`);
