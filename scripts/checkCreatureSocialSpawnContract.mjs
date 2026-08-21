#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const spawner = fs.readFileSync(new URL('../src/3d/gameplay/creatureSpawner.js', import.meta.url), 'utf8');
const brain = fs.readFileSync(new URL('../src/3d/gameplay/creatureBrain.js', import.meta.url), 'utf8');

function objectBody(source, exportName) {
  const marker = `export const ${exportName} = Object.freeze({`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${exportName} export missing`);
  let depth = 0;
  let bodyStart = source.indexOf('{', start);
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, i);
  }
  throw new Error(`${exportName} object did not close`);
}

const socialBody = objectBody(spawner, 'CREATURE_SOCIAL_SPAWN_RADIUS_METERS');
const socialEntries = [...socialBody.matchAll(/^\s*([a-zA-Z0-9_]+):\s*([0-9.]+),?\s*$/gm)]
  .map((match) => [match[1], Number(match[2])]);
assert.ok(socialEntries.length >= 6, 'social spawn contract must cover established herd/flock species');

for (const [speciesId, clusterRadius] of socialEntries) {
  assert.ok(clusterRadius > 0 && clusterRadius <= 20, `${speciesId} cluster radius must stay bounded`);
  const profilePattern = new RegExp(`${speciesId}: Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\s*\\}\\),`);
  const profile = brain.match(profilePattern)?.[1];
  assert.ok(profile, `${speciesId} behavior profile missing`);
  const alertRadius = Number(profile.match(/packAlertRadiusMeters:\s*([0-9.]+)/)?.[1]);
  assert.ok(Number.isFinite(alertRadius) && alertRadius > 0, `${speciesId} must retain herd/flock alert behavior`);
  assert.ok(clusterRadius * 2 < alertRadius,
    `${speciesId} worst-case pair distance ${clusterRadius * 2} must stay inside alert radius ${alertRadius}`);
}

assert.match(spawner, /isPlaceablePosition\(x, z,/,
  'social placement must keep canonical water/slope/seat/road gate');
assert.match(spawner, /isCreatureHabitatCompatible\(speciesId, x, z,/,
  'social placement must keep species habitat gate');
assert.doesNotMatch(spawner, /Math\.random\s*\(/,
  'social fauna placement must remain deterministic');
assert.doesNotMatch(spawner, /EditorMaterialStudio/,
  'runtime fauna placement must not import editor-only material UI');

console.log('CREATURE_SOCIAL_SPAWN_CONTRACT_PASS', JSON.stringify({
  species: socialEntries.map(([speciesId]) => speciesId),
  pairwiseAlertReachableAtSpawn: true,
  canonicalPlacementGate: true,
  deterministic: true,
}));
