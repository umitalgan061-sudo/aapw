#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/creatureBrain.js', import.meta.url), 'utf8');

function profileBlock(speciesId) {
  const match = source.match(new RegExp(`${speciesId}: Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\t\\}\\),`));
  assert.ok(match, `${speciesId} flight profile must exist`);
  return match[1];
}

function readNumber(block, key) {
  const match = block.match(new RegExp(`${key}:\\s*([0-9]+(?:\\.[0-9]+)?)`));
  assert.ok(match, `${key} must be authored`);
  return Number(match[1]);
}

const expected = Object.freeze({
  kuzgun: Object.freeze({ altitude: 12, climb: 6, duration: 6, trigger: 9, speed: 7, flockRadius: 12 }),
  kartal: Object.freeze({ altitude: 22, climb: 5, duration: 9, trigger: 16, speed: 8, flockRadius: 20 }),
  tavuk: Object.freeze({ altitude: 4, climb: 4, duration: 2.5, trigger: 5, speed: 4, flockRadius: 8 }),
});

const lifecycle = {};
for (const [speciesId, budget] of Object.entries(expected)) {
  const block = profileBlock(speciesId);
  assert.match(block, /locomotion: 'flight'/, `${speciesId} must stay on the shipped flight controller`);
  const altitude = readNumber(block, 'flightAltitudeMeters');
  const climb = readNumber(block, 'takeoffClimbMps');
  const duration = readNumber(block, 'flightDurationSeconds');
  const trigger = readNumber(block, 'reactiveTriggerRadiusMeters');
  const speed = readNumber(block, 'reactiveSpeedMps');
  const flockRadius = readNumber(block, 'packAlertRadiusMeters');
  assert.equal(altitude, budget.altitude, `${speciesId} altitude must stay authored`);
  assert.equal(climb, budget.climb, `${speciesId} climb/landing speed must stay authored`);
  assert.equal(duration, budget.duration, `${speciesId} airborne timer must stay authored`);
  assert.equal(trigger, budget.trigger, `${speciesId} player trigger radius must stay authored`);
  assert.equal(speed, budget.speed, `${speciesId} cruise speed must stay authored`);
  assert.equal(flockRadius, budget.flockRadius, `${speciesId} flock radius must stay authored`);

  const climbSeconds = altitude / climb;
  const landingSeconds = altitude / climb;
  const conservativeTotalSeconds = duration + landingSeconds + 1 / 60;
  assert.ok(climbSeconds >= 1 && climbSeconds <= 5, `${speciesId} climb must stay visually readable and bounded`);
  assert.ok(landingSeconds >= 1 && landingSeconds <= 5, `${speciesId} landing must stay visually readable and bounded`);
  assert.ok(conservativeTotalSeconds < 14, `${speciesId} must not remain airborne indefinitely`);
  assert.ok(flockRadius >= trigger, `${speciesId} flockmates should be able to react just outside direct player trigger range`);
  assert.ok(flockRadius <= trigger * 1.7, `${speciesId} flock radius must remain local rather than settlement-wide`);
  assert.ok(speed * duration <= 80, `${speciesId} one startled flight must stay spatially bounded`);

  lifecycle[speciesId] = {
    altitudeMeters: altitude,
    climbSeconds: Number(climbSeconds.toFixed(3)),
    landingSeconds: Number(landingSeconds.toFixed(3)),
    flightDurationSeconds: duration,
    maxHorizontalTravelMeters: Number((speed * duration).toFixed(3)),
  };
}

// State-machine structure: direct/flock reaction may only launch from grounded; landing is monotonic,
// returns exactly to ground, recenters the wander envelope at the landing position, and applies the
// alert gait only while airborne.
assert.match(source, /if \(currentlyReacting && flightPhase === 'grounded'\) \{\s*flightPhase = 'climbing'/,
  'startle may launch only from grounded state');
assert.match(source, /flightElapsedSeconds = 0/, 'each takeoff must reset its bounded flight timer');
assert.match(source, /flightAltitudeMeters = Math\.max\(0, flightAltitudeMeters - profile\.takeoffClimbMps \* delta\)/,
  'landing altitude must decrease monotonically toward zero');
assert.match(source, /if \(flightAltitudeMeters <= 0\) \{\s*flightPhase = 'grounded'/,
  'landing must return to grounded rather than leave an airborne latch');
assert.match(source, /return currentlyReacting \|\| \(isFlightSpecies && flightPhase !== 'grounded'\)/,
  'airborne birds must remain urgent until grounded so flight cannot be demoted to distant LOD mid-air');
assert.match(source, /wanderCenter\.x = object3D\.position\.x;\s*wanderCenter\.z = object3D\.position\.z/,
  'post-flight wander center must move to the actual landing site');
assert.match(source, /pickNewWanderTarget\(\);\s*pauseTimer = profile\.wanderPauseSeconds/,
  'landing must re-enter ordinary bounded ground wander');
assert.match(source, /flightAltitudeMeters = Math\.min\(profile\.flightAltitudeMeters, flightAltitudeMeters \+ profile\.takeoffClimbMps \* delta\)/,
  'climb must be clamped to the authored altitude ceiling');
assert.match(source, /else if \(flightElapsedSeconds >= profile\.flightDurationSeconds\) \{\s*flightPhase = 'landing'/,
  'cruise must terminate on the authored timer');
assert.match(source, /gaitName: flightPhase === 'grounded' \? plan\.restGait : plan\.alertGait/,
  'ground and airborne gait families must stay distinct');

// Airborne birds intentionally bypass ground/player collision resolution so a raven can clear a wall
// or roof. Ground wander still resolves X/Z through the canonical player collider. Lock both halves of
// that contract: removing the ground collider is a regression; adding collider resolution inside the
// flight branch is also a regression.
const flightStart = source.indexOf("if (isFlightSpecies) {");
const groundBranch = source.indexOf("if (currentlyReacting) {", flightStart);
assert.ok(flightStart >= 0 && groundBranch > flightStart, 'flight branch boundaries must remain discoverable');
const flightBranch = source.slice(flightStart, groundBranch);
assert.equal(flightBranch.includes('playerCollider.resolveXZ'), false,
  'airborne flight must not be blocked by ground-player X/Z collision resolution');
const wanderFunctionStart = source.indexOf('function stepGroundWander');
const wanderFunctionEnd = source.indexOf('\n\treturn {', wanderFunctionStart);
const wanderBlock = source.slice(wanderFunctionStart, wanderFunctionEnd);
assert.match(wanderBlock, /playerCollider\.resolveXZ/, 'ground hopping must keep canonical collision resolution');
assert.match(wanderBlock, /groundCollider\.getGroundHeight/, 'ground hopping must remain terrain-aligned');

// Determinism policy for bird movement: no executable wall-clock or random source may appear in the
// brain. Flight is advanced solely by supplied simulation delta and the seeded wander stream.
const executableSource = source.split('\n').filter((line) => !/^\s*(?:\/\/|\*)/.test(line)).join('\n');
assert.equal(/Math\.random\s*\(/.test(executableSource), false, 'bird brain must not use Math.random');
assert.equal(/Date\.now\s*\(|performance\.now\s*\(/.test(executableSource), false, 'bird flight must not use wall-clock time');
assert.match(source, /flightElapsedSeconds \+= delta/, 'flight lifetime must advance through simulation delta');

console.log('CREATURE_BIRD_FLIGHT_LIFECYCLE_PASS', JSON.stringify({
  ...lifecycle,
  boundedAltitude: true,
  boundedDuration: true,
  airborneUrgency: true,
  collisionAwareGround: true,
  airborneObstacleClearance: true,
  deterministicDeltaClock: true,
}));
