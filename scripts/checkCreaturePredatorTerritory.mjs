#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const spawner = fs.readFileSync(new URL('../src/3d/gameplay/creatureSpawner.js', import.meta.url), 'utf8');

assert.match(spawner, /export const CREATURE_PREDATOR_TERRITORY_RADIUS_METERS = Object\.freeze\(/,
  'territorial predator spawn matrix must be exported');
assert.match(spawner, /ayi:\s*Object\.freeze\(\{[^}]*ayi:\s*42[^}]*aslan:\s*36/s,
  'bear territory must separate bears and lions');
assert.match(spawner, /aslan:\s*Object\.freeze\(\{[^}]*ayi:\s*36[^}]*aslan:\s*48/s,
  'lion territory must symmetrically separate bears and lions');
assert.match(spawner, /export function isCreaturePredatorTerritorySeparated\(/,
  'territorial separation helper must stay directly testable');
assert.match(spawner, /isCreaturePredatorTerritorySeparated\(speciesId, x, z, spawns\)/,
  'scatterCreatures must gate predator acceptance through territory separation');
assert.match(spawner, /Math\.hypot\(x - spawn\.x, z - spawn\.z\) < minimumDistanceMeters/,
  'territorial separation must use physical world-space metres');
assert.match(spawner, /isCreaturePredatorSpawnSeparated\(speciesId, x, z, spawns\)[\s\S]*isCreaturePredatorTerritorySeparated\(speciesId, x, z, spawns\)/,
  'predator territory must extend, not replace, prey-buffer ecology');
assert.match(spawner, /isPlaceablePosition\(x, z,/,
  'canonical water/slope/seat/road placement gate must remain active');
assert.match(spawner, /isCreatureHabitatCompatible\(speciesId, x, z,/,
  'species habitat gate must remain active');
assert.doesNotMatch(spawner, /Math\.random\s*\(/,
  'spawn remains deterministic');
assert.doesNotMatch(spawner, /EditorMaterialStudio/,
  'runtime fauna placement must not import editor-only material UI');

const territoryStart = spawner.indexOf('export const CREATURE_PREDATOR_TERRITORY_RADIUS_METERS');
const territoryEnd = spawner.indexOf('\n});', territoryStart);
const territoryBody = spawner.slice(territoryStart, territoryEnd);
const distances = [...territoryBody.matchAll(/:\s*([0-9]+(?:\.[0-9]+)?)/g)].map((match) => Number(match[1]));
assert.equal(distances.length, 4, 'territory matrix must contain exactly four bear/lion relationships');
for (const distance of distances) assert.ok(distance >= 24 && distance <= 64, `territory ${distance}m must stay bounded`);

console.log('CREATURE_PREDATOR_TERRITORY_PASS', JSON.stringify({
  deterministic: true,
  canonicalPlacementGate: true,
  preyBufferPreserved: true,
  symmetricCrossPredatorBuffer: true,
  checkedRelationships: distances.length,
}));
