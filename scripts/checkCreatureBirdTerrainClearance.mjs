#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/creatureBrain.js', import.meta.url), 'utf8');

const helperStart = source.indexOf('function tryCommitFlightMove');
const helperEnd = source.indexOf('\n\t/**', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'atomic flight terrain helper must exist');
const helper = source.slice(helperStart, helperEnd);

const finiteGuardIndex = helper.indexOf('Number.isFinite(candidateX)');
const terrainSampleIndex = helper.indexOf('groundCollider.getGroundHeight(candidateX, candidateZ)');
const finiteTerrainIndex = helper.indexOf('Number.isFinite(terrainY)');
const commitIndex = helper.indexOf('object3D.position.set(candidateX, candidateY, candidateZ)');
assert.ok(finiteGuardIndex >= 0 && finiteGuardIndex < terrainSampleIndex,
  'flight candidate coordinates must be finite before terrain sampling');
assert.ok(terrainSampleIndex >= 0 && terrainSampleIndex < finiteTerrainIndex,
  'flight must sample live terrain before validating its final Y');
assert.ok(finiteTerrainIndex >= 0 && finiteTerrainIndex < commitIndex,
  'terrain-relative Y must be finite before publishing the transform');
assert.equal(helper.includes('playerCollider'), false,
  'airborne terrain clearance must not route through the ground/player collider');
assert.match(helper, /try \{[\s\S]*?groundCollider\.getGroundHeight[\s\S]*?\} catch \{\s*return false;/,
  'terrain-provider exceptions must reject only the current airborne candidate');

assert.match(source,
  /const nextX = object3D\.position\.x \+ nextHeadingX \* profile\.reactiveSpeedMps \* delta;[\s\S]*?if \(tryCommitFlightMove\(nextX, nextZ, nextAltitude\)\)/,
  'takeoff must validate candidate X/Z/altitude before publishing any transform');
assert.match(source,
  /const nextAltitude = Math\.max\(0, flightAltitudeMeters - profile\.takeoffClimbMps \* delta\);[\s\S]*?tryCommitFlightMove\(object3D\.position\.x, object3D\.position\.z, nextAltitude\)/,
  'landing must resample live terrain under the current X/Z before committing descent');
assert.match(source,
  /const nextX = object3D\.position\.x \+ flightHeadingX \* profile\.reactiveSpeedMps \* delta;[\s\S]*?const nextZ = object3D\.position\.z \+ flightHeadingZ \* profile\.reactiveSpeedMps \* delta;[\s\S]*?if \(tryCommitFlightMove\(nextX, nextZ, nextAltitude\)\)/,
  'horizontal airborne travel must sample terrain at the candidate X/Z before publishing it');
assert.match(source,
  /if \(tryCommitFlightMove\(nextX, nextZ, nextAltitude\)\) \{\s*flightElapsedSeconds = nextElapsedSeconds;\s*flightAltitudeMeters = nextAltitude;\s*flightPhase = nextPhase;/,
  'airborne timer, altitude and phase must commit only with the matching terrain-valid transform');

console.log('CREATURE_BIRD_TERRAIN_CLEARANCE_PASS', JSON.stringify({
  terrainRelative: true,
  atomicTransformCommit: true,
  exceptionIsolation: true,
  failedTickStateFreeze: true,
}));
