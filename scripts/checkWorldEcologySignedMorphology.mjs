#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  WORLD_ECOLOGY_SURFACE_FIELD_POLICY,
  sampleWorldEcologySurfaceField,
  ecologySurfaceMaterialContext,
} from '../src/3d/world/worldEcologySurfaceField.js';

const base = {
  x: 840,
  z: -460,
  height: 34,
  slopeDegrees: 5,
  aspectRadians: 0.2,
  moisture: 0.58,
  snow: 0,
  waterDepth: 0,
  riverDistance: 180,
  lakeDistance: 220,
  coastDistance: 300,
  roadDistance: 80,
  settlementDistance: 140,
  biome: 'meadow',
  shelter: 0.54,
  erosion: 0.32,
  deposition: 0.52,
};

const convex = sampleWorldEcologySurfaceField({ ...base, concavity: -1, seed: 1337 });
const flat = sampleWorldEcologySurfaceField({ ...base, concavity: 0, seed: 1337 });
const basin = sampleWorldEcologySurfaceField({ ...base, concavity: 1, seed: 1337 });

assert.equal(WORLD_ECOLOGY_SURFACE_FIELD_POLICY.signedConcavityPreserved, true);
assert.equal(convex.physical.concavity, -1);
assert.equal(flat.physical.concavity, 0);
assert.equal(basin.physical.concavity, 1);
assert(convex.response.moisture < basin.response.moisture, 'convex landform must not read as wetter than an equally conditioned basin');
assert(convex.response.deposition < basin.response.deposition, 'convex landform must not receive basin-like deposition');
assert.notEqual(convex.response.moisture, basin.response.moisture);
assert.notEqual(convex.response.deposition, basin.response.deposition);

const context = ecologySurfaceMaterialContext(convex);
assert.equal(context.concavity, -1);
assert(Number.isFinite(context.moisture));
assert(Number.isFinite(context.deposition));
assert(Number.isFinite(context.weathering));

console.log('[checkWorldEcologySignedMorphology] PASS: convex, flat and basin terrain retain distinct signed morphology through ecology/material context.');
