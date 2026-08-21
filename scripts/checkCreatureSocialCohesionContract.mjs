#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const spawner = fs.readFileSync(new URL('../src/3d/gameplay/creatureSpawner.js', import.meta.url), 'utf8');
const brain = fs.readFileSync(new URL('../src/3d/gameplay/creatureBrain.js', import.meta.url), 'utf8');

const factorMatch = brain.match(/CREATURE_SOCIAL_WANDER_RADIUS_FACTOR\s*=\s*([0-9.]+)/);
assert.ok(factorMatch, 'social wander radius factor must be exported by creatureBrain');
const factor = Number(factorMatch[1]);
assert.ok(Number.isFinite(factor) && factor > 0 && factor < 0.5,
  'social wander factor must keep two opposite herd members inside one alert radius');

for (const needle of [
  'socialAnchorX: socialAnchor.x',
  'socialAnchorZ: socialAnchor.z',
  'socialSpawnRadiusMeters: socialRadiusMeters',
]) {
  assert.ok(spawner.includes(needle), `social spawn metadata missing: ${needle}`);
}
assert.ok(
  spawner.indexOf('if (!socialAnchor && socialRadiusMeters) socialAnchor = Object.freeze({ x, z });')
    < spawner.indexOf('spawns.push({'),
  'first accepted social member must establish its anchor before its spawn record is emitted',
);

for (const needle of [
  "profile.locomotion !== 'flight'",
  'profile.packAlertRadiusMeters * CREATURE_SOCIAL_WANDER_RADIUS_FACTOR',
  'const wanderCenter = socialCohesionEnabled',
  'const radius = idleWanderRadiusMeters * Math.sqrt(rng())',
  'object3D.userData.creatureSocial = Object.freeze({',
  'socialAnchorX: spawn.socialAnchorX ?? null',
  'socialAnchorZ: spawn.socialAnchorZ ?? null',
]) {
  assert.ok(brain.includes(needle), `social cohesion runtime contract missing: ${needle}`);
}

assert.equal(/Math\.random\s*\(/.test(`${spawner}\n${brain}`.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), false,
  'social fauna cohesion must remain deterministic and avoid Math.random()');
assert.equal(brain.includes('EditorMaterialStudio'), false, 'creature runtime must not import editor-only material UI');
assert.equal(spawner.includes('EditorMaterialStudio'), false, 'creature spawner must not import editor-only material UI');

console.log('CREATURE_SOCIAL_COHESION_CONTRACT_PASS', JSON.stringify({
  factor,
  pairwiseBoundRatio: Number((factor * 2).toFixed(3)),
  groundHerdOnly: true,
  deterministic: true,
  runtimeEditorSeparated: true,
}));
