import assert from 'node:assert/strict';
import { PLAYER_DIRECTIONAL_DIRECTIONS } from '../src/3d/gameplay/playerDirectionalLocomotionPolicy.js';
import {
  PLAYER_LOCOMOTION_ANTICIPATION_MODES,
  resolvePlayerLocomotionAnticipationProfile,
  resolvePlayerLocomotionAnticipatedBlend,
  resolvePlayerLocomotionCadenceBias,
  resolvePlayerLocomotionLookAheadSeconds,
  resolvePlayerLocomotionContactResponse,
} from '../src/3d/gameplay/playerLocomotionAnticipationPolicy.js';
import {
  auditPlayerLocomotionProfiles,
  listPlayerLocomotionAnticipationProfiles,
  resolvePlayerLocomotionAnticipationProfileConfig,
  resolvePlayerLocomotionProfileBlend,
  resolvePlayerLocomotionBlendedConfig,
  resolvePlayerLocomotionContextProfile,
  applyPlayerLocomotionAnticipationProfile,
} from '../src/3d/gameplay/playerLocomotionAnticipationProfiles.js';

const finiteTree = (value) => {
  if (typeof value === 'number') assert.equal(Number.isFinite(value), true);
  if (value && typeof value === 'object') for (const child of Object.values(value)) finiteTree(child);
};
const sample = (index, overrides = {}) => {
  const angle = (index % 32) * Math.PI / 16;
  return {
    velocity: { x: Math.sin(angle), y: Math.cos(angle) },
    facing: { x: 0, y: 1 },
    planarSpeedMps: (index % 20) * 0.63,
    slopeDegrees: (index * 5) % 56,
    turnRateDegreesPerSecond: (index * 47) % 541,
    deltaSeconds: 0.008 + (index % 7) * 0.013,
    surfaceConfidence: (index * 0.17) % 1,
    surfaceSlip: (index * 0.11) % 1,
    ...overrides,
  };
};

assert.equal(PLAYER_DIRECTIONAL_DIRECTIONS.length, 8);
assert.equal(PLAYER_LOCOMOTION_ANTICIPATION_MODES.length, 16);
assert.equal(auditPlayerLocomotionProfiles().valid, true);
assert.equal(auditPlayerLocomotionProfiles().immutable, true);
assert.equal(listPlayerLocomotionAnticipationProfiles().length, 8);

for (const profileName of listPlayerLocomotionAnticipationProfiles()) {
  const config = resolvePlayerLocomotionAnticipationProfileConfig(profileName);
  assert.equal(Object.isFrozen(config), true);
  assert.ok(config.key.length > 0);
  assert.ok(config.accelerationBias >= 0.6 && config.accelerationBias <= 1.4);
  assert.ok(config.brakeBias >= 0.6 && config.brakeBias <= 1.5);
}

for (let index = 0; index < 512; index += 1) {
  const input = sample(index);
  const profile = resolvePlayerLocomotionAnticipationProfile(input);
  assert.ok(PLAYER_LOCOMOTION_ANTICIPATION_MODES.includes(profile.mode));
  assert.ok(PLAYER_DIRECTIONAL_DIRECTIONS.includes(profile.anticipatedDirection));
  const blend = profile.anticipatedBlendWeights;
  assert.equal(Object.keys(blend).length, 8);
  const values = Object.values(blend);
  assert.ok(values.every((value) => value >= 0 && value <= 1));
  assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 0.001);
  assert.ok(resolvePlayerLocomotionLookAheadSeconds(input) >= 0.05);
  assert.ok(resolvePlayerLocomotionLookAheadSeconds(input) <= 0.35);
  assert.ok(resolvePlayerLocomotionCadenceBias(input) >= 0.7);
  assert.ok(resolvePlayerLocomotionCadenceBias(input) <= 1.18);
  finiteTree(profile);
}

for (let angle = -Math.PI; angle <= Math.PI; angle += Math.PI / 64) {
  const input = sample(40, { velocity: { x: Math.sin(angle), y: Math.cos(angle) }, planarSpeedMps: 6 });
  const blend = resolvePlayerLocomotionAnticipatedBlend(input);
  const positive = Object.values(blend).filter((value) => value > 0.001);
  assert.ok(positive.length <= 4);
  assert.ok(Math.abs(Object.values(blend).reduce((a, b) => a + b, 0) - 1) < 0.001);
}

for (let confidence = 0; confidence <= 1; confidence += 0.1) {
  for (let slip = 0; slip <= 1; slip += 0.2) {
    const response = resolvePlayerLocomotionContactResponse(sample(3, { surfaceConfidence: confidence, surfaceSlip: slip }));
    for (const value of Object.values(response)) assert.ok(value >= 0 && value <= 1);
  }
}

for (let index = 0; index < 80; index += 1) {
  const blended = resolvePlayerLocomotionProfileBlend({ agile: index + 1, heavy: 80 - index, cautious: index % 3 });
  const sum = Object.values(blended).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.001);
  assert.ok(Object.values(blended).every((value) => value >= 0 && value <= 1));
  const config = resolvePlayerLocomotionBlendedConfig(blended);
  assert.ok(config.accelerationBias >= 0.6 && config.accelerationBias <= 1.4);
  assert.ok(config.brakeBias >= 0.6 && config.brakeBias <= 1.5);
  assert.ok(config.pivotBias >= 0.6 && config.pivotBias <= 1.5);
}

const contexts = [
  { archetype: 'agile', surfaceRisk: 0, combatPressure: 0, staminaPressure: 0 },
  { archetype: 'heavy', surfaceRisk: 1, combatPressure: 0.2, staminaPressure: 0.8 },
  { archetype: 'invalid', surfaceRisk: 100, combatPressure: -2, staminaPressure: Infinity },
];
for (const context of contexts) {
  const resolved = resolvePlayerLocomotionContextProfile(context);
  assert.ok(resolved.surfaceRisk >= 0 && resolved.surfaceRisk <= 1);
  assert.ok(resolved.combatPressure >= 0 && resolved.combatPressure <= 1);
  assert.ok(resolved.staminaPressure >= 0 && resolved.staminaPressure <= 1);
  assert.ok(Math.abs(Object.values(resolved.blend).reduce((a, b) => a + b, 0) - 1) < 0.001);
  finiteTree(resolved);
}

for (const profileName of listPlayerLocomotionAnticipationProfiles()) {
  const resolved = applyPlayerLocomotionAnticipationProfile(sample(21), profileName);
  assert.equal(resolved.profileKey, profileName);
  assert.ok(resolved.startWeight >= 0 && resolved.startWeight <= 1);
  assert.ok(resolved.brakeWeight >= 0 && resolved.brakeWeight <= 1);
  assert.ok(resolved.pivotWeight >= 0 && resolved.pivotWeight <= 1);
  assert.ok(resolved.contact.plant >= 0 && resolved.contact.plant <= 1);
}

const deterministicA = Array.from({ length: 160 }, (_, index) => resolvePlayerLocomotionAnticipationProfile(sample(index)));
const deterministicB = Array.from({ length: 160 }, (_, index) => resolvePlayerLocomotionAnticipationProfile(sample(index)));
assert.deepEqual(deterministicA, deterministicB);
assert.equal(JSON.stringify(deterministicA), JSON.stringify(deterministicB));

console.log('PLAYER_LOCOMOTION_ANTICIPATION_INVARIANT_PASS');
