#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/creatureBrain.js', import.meta.url), 'utf8');
const terrainRelativeY = /object3D\.position\.y = groundCollider\.getGroundHeight\(object3D\.position\.x, object3D\.position\.z\) \+ flightAltitudeMeters;/g;
const samples = source.match(terrainRelativeY) ?? [];

assert.ok(samples.length >= 2,
  'climb/cruise and landing must both recompute altitude above the live terrain under the bird');
assert.match(source,
  /flightAltitudeMeters = Math\.max\(0,[\s\S]*?groundCollider\.getGroundHeight\(object3D\.position\.x, object3D\.position\.z\) \+ flightAltitudeMeters;[\s\S]*?if \(flightAltitudeMeters <= 0\)/,
  'landing must follow current terrain height all the way to grounded state');
assert.match(source,
  /object3D\.position\.x \+= flightHeadingX[\s\S]*?object3D\.position\.z \+= flightHeadingZ[\s\S]*?groundCollider\.getGroundHeight\(object3D\.position\.x, object3D\.position\.z\) \+ flightAltitudeMeters/,
  'horizontal airborne travel must resample terrain at the new X/Z before publishing Y');

console.log('CREATURE_BIRD_TERRAIN_CLEARANCE_PASS', JSON.stringify({ terrainRelativeSamples: samples.length }));
