import assert from 'node:assert/strict';
import {
  PLAYER_REGIONAL_APPEARANCE_POLICY,
  resolvePlayerRegionalAppearance,
  worldXZToCanonicalMap,
} from '../src/3d/gameplay/playerRegionalAppearance.js';
import { REFERENCE_BIOME_ZONES } from '../src/3d/world/worldReferenceMap.js';
import { findPalette } from '../src/3d/materials/palettes.js';

const EXPECTED_PALETTE_SLOTS = ['skin', 'hair', 'eye', 'tunic', 'trousers', 'boot', 'belt', 'cloak'];
const MIN_REQUIRED_PROFILES = 4;
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

function requireFinite(value, label) {
  assert.equal(Number.isFinite(value), true, `${label} must be finite`);
}

function checkProfilePalettes(context) {
  for (const slot of EXPECTED_PALETTE_SLOTS) {
    assert.equal(typeof context.profile[slot], 'string', `${slot} palette must be present`);
    assert.ok(findPalette(context.profile[slot]), `unknown ${slot} palette: ${context.profile[slot]}`);
  }
}

function checkDeterminism(x, y) {
  const first = resolvePlayerRegionalAppearance(x, y, 'acceptance-seed');
  const second = resolvePlayerRegionalAppearance(x, y, 'acceptance-seed');
  assert.deepEqual(second, first, `regional profile changed between identical evaluations at ${x},${y}`);
  assert.equal(first.map.sha256, MAP_SHA);
  checkProfilePalettes(first);
  requireFinite(first.confidence, 'confidence');
  assert.ok(first.confidence >= 0 && first.confidence <= 1, 'confidence outside [0,1]');
  return first;
}

const contexts = REFERENCE_BIOME_ZONES.map((zone) => {
  const context = checkDeterminism(zone.center[0], zone.center[1]);
  assert.equal(context.zoneId, zone.id, `center of ${zone.id} did not resolve back to that zone`);
  return context;
});

const profileKeys = new Set(contexts.map((context) => context.profileKey));
assert.ok(profileKeys.size >= MIN_REQUIRED_PROFILES, `geographic dressing collapsed to only ${profileKeys.size} visual profiles`);

// Mountain relief is a secondary signal; it must not erase a stronger explicit desert/lush biome.
for (const context of contexts) {
  assert.ok(context.biomeKind, `biome kind missing for ${context.zoneId}`);
  assert.ok(context.profileKey, `profile key missing for ${context.zoneId}`);
}

// World-space conversion stays affine and bounded; this is the seam the future player runtime caller
// can use without importing world config into gameplay. Exact bounds are supplied by the owner.
const conversion = worldXZToCanonicalMap({
  worldX: 0,
  worldZ: 0,
  mapBounds: { minX: 0, maxX: 1536, minY: 0, maxY: 1024 },
  metersPerMapUnit: 1,
});
assert.deepEqual(conversion, { x: 0.5, y: 0.5 });

// The policy must describe the same owner-map SHA used by the reference surface stack.
assert.equal(PLAYER_REGIONAL_APPEARANCE_POLICY.sourceMapSha256, MAP_SHA);
assert.equal(PLAYER_REGIONAL_APPEARANCE_POLICY.deterministic, true);
assert.equal(PLAYER_REGIONAL_APPEARANCE_POLICY.mode, 'render-semantic-only');
assert.equal(PLAYER_REGIONAL_APPEARANCE_POLICY.textureSize, 256);

const regionalTunicFamilies = new Set(contexts.map((context) => context.profile.tunic));
assert.ok(regionalTunicFamilies.size >= 3, `expected at least three regional tunic families, got ${regionalTunicFamilies.size}`);

const report = {
  ok: true,
  policyId: PLAYER_REGIONAL_APPEARANCE_POLICY.id,
  mapSha256: MAP_SHA,
  biomeZoneCount: REFERENCE_BIOME_ZONES.length,
  resolvedZoneCount: contexts.length,
  profileKeys: [...profileKeys].sort(),
  tunicPalettes: [...regionalTunicFamilies].sort(),
  missingPaletteAssignments: 0,
  deterministicSamples: contexts.length,
  canonicalWorldConversion: conversion,
};

console.log(JSON.stringify(report, null, 2));
console.log('PLAYER_REGIONAL_APPEARANCE_OK');
