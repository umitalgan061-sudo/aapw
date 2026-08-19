#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const brain = fs.readFileSync(new URL('../src/3d/gameplay/creatureBrain.js', import.meta.url), 'utf8');
const living = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldSpawner.js', import.meta.url), 'utf8');

for (const [speciesId, radius] of [['kuzgun', 12], ['kartal', 20], ['tavuk', 8]]) {
  const block = brain.match(new RegExp(`${speciesId}: Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\t\\}\\),`));
  assert.ok(block, `${speciesId} profile must exist`);
  assert.match(block[1], /locomotion: 'flight'/, `${speciesId} must keep shipped flight locomotion`);
  assert.match(block[1], new RegExp(`packAlertRadiusMeters: ${radius}(?:,|\\n)`), `${speciesId} flock radius must remain ${radius}m`);
}

assert.match(living, /const creatureHerdRegistry = new Map\(\)/, 'shipped population must share one bounded same-species registry');
assert.match(living, /herdMembers = herdRegistry\.get\(speciesId\)/, 'registry must partition alerts by canonical species id');
assert.match(living, /if \(other === member \|\| !other\.isDirectAlarmSource\) continue/, 'receiver-only flock reactions must never relay');
assert.match(living, /get isDirectAlarmSource\(\) \{ return directThreatActive \|\| memoryRemainingSeconds > 0; \}/,
  'only direct player threat plus bounded direct-memory may publish flock alerts');
assert.match(living, /if \(Math\.hypot\(dx, dz\) <= packAlertRadiusMeters\)/, 'flock propagation must stay radius-bounded');
assert.match(living, /else if \(herd\) \{\s*effectivePlayerPosition = herdReactivePositions\[0\]/,
  'flock receiver direction must derive from the actual direct alarm source');
assert.match(living, /phase: fleeing \? \(predator \? 'predator-flee' : herd && !usingMemory \? 'herd-flee'/,
  'flock reaction must remain observable as group-threat telemetry');
assert.equal(living.includes('EditorMaterialStudio'), false, 'living-world runtime must not import editor material UI');

console.log('CREATURE_BIRD_FLOCK_PASS', JSON.stringify({
  ravenRadiusMeters: 12,
  eagleRadiusMeters: 20,
  chickenRadiusMeters: 8,
  sameSpeciesOnly: true,
  noRelayStorm: true,
  flightControllerReused: true,
}));
