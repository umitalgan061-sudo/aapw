#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const spawner = fs.readFileSync(new URL('../src/3d/gameplay/creatureSpawner.js', import.meta.url), 'utf8');

assert.match(spawner, /export const CREATURE_PREDATOR_PREY_SPAWN_BUFFER_METERS = Object\.freeze\(/,
  'predator/prey spawn buffer table must be exported');
assert.match(spawner, /ayi:\s*Object\.freeze\(\{[^}]*geyik:/s,
  'bear spawn buffer must protect established prey');
assert.match(spawner, /aslan:\s*Object\.freeze\(\{[^}]*geyik:/s,
  'lion spawn buffer must protect established prey');
assert.match(spawner, /export function isCreaturePredatorSpawnSeparated\(/,
  'spawn separation helper must stay directly testable');
assert.match(spawner, /isCreaturePredatorSpawnSeparated\(speciesId, x, z, spawns\)/,
  'scatterCreatures must apply predator/prey separation before accepting a spawn');
assert.match(spawner, /Math\.hypot\(x - spawn\.x, z - spawn\.z\) < minimumDistanceMeters/,
  'separation must use physical world-space metres');
assert.match(spawner, /isPlaceablePosition\(x, z,/,
  'canonical water/slope/seat/road placement gate must remain active');
assert.match(spawner, /isCreatureHabitatCompatible\(speciesId, x, z,/,
  'species habitat gate must remain active');
assert.doesNotMatch(spawner, /Math\.random\s*\(/,
  'spawn remains deterministic');
assert.doesNotMatch(spawner, /EditorMaterialStudio/,
  'runtime fauna placement must not import editor-only material UI');

const objectStart = spawner.indexOf('export const CREATURE_PREDATOR_PREY_SPAWN_BUFFER_METERS');
const objectEnd = spawner.indexOf('\n});', objectStart);
const bufferBody = spawner.slice(objectStart, objectEnd);
const distances = [...bufferBody.matchAll(/:\s*([0-9]+(?:\.[0-9]+)?)/g)].map((match) => Number(match[1]));
assert.ok(distances.length >= 6, 'buffer table should cover multiple predator/prey pairs');
for (const distance of distances) assert.ok(distance >= 12 && distance <= 48, `buffer ${distance}m must stay ecologically bounded`);

console.log('CREATURE_PREDATOR_SPAWN_BUFFER_PASS', JSON.stringify({
  deterministic: true,
  canonicalPlacementGate: true,
  predatorPreySeparation: true,
  checkedBuffers: distances.length,
}));
