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

// State-machine structure: takeoff is attempted only from grounded, each candidate is terrain-validated
// before phase/altitude/timer commit, landing is monotonic after a successful terrain sample, and a
// completed landing recenters the ordinary grounded wander envelope.
assert.match(source, /if \(flightPhase === 'grounded'\) \{\s*if \(currentlyReacting\) \{/,
  'startle may attempt takeoff only from grounded state');
assert.match(source, /if \(tryCommitFlightMove\(nextX, nextZ, nextAltitude\)\) \{\s*flightHeadingX = nextHeadingX;/,
  'takeoff state may commit only after its terrain-relative transform is valid');
assert.match(source, /flightElapsedSeconds = delta;/, 'successful takeoff must start its bounded flight timer from simulation delta');
assert.match(source, /const nextAltitude = Math\.max\(0, flightAltitudeMeters - profile\.takeoffClimbMps \* delta\)/,
  'landing altitude candidate must decrease monotonically toward zero');
assert.match(source, /if \(tryCommitFlightMove\(object3D\.position\.x, object3D\.position\.z, nextAltitude\)\) \{\s*flightAltitudeMeters = nextAltitude;/,
  'landing altitude may advance only after a valid terrain-relative transform commits');
assert.match(source, /if \(flightAltitudeMeters <= 0\) \{\s*flightPhase = 'grounded'/,
  'landing must return to grounded rather than leave an airborne latch');
assert.match(source, /return currentlyReacting \|\| \(isFlightSpecies && flightPhase !== 'grounded'\)/,
  'airborne birds must remain urgent until grounded so flight cannot be demoted to distant LOD mid-air');
assert.match(source, /wanderCenter\.x = object3D\.position\.x;\s*wanderCenter\.z = object3D\.position\.z/,
  'post-flight wander center must move to the actual landing site');
assert.match(source, /pickNewWanderTarget\(\);\s*pauseTimer = profile\.wanderPauseSeconds/,
  'landing must re-enter ordinary bounded ground wander');
assert.match(source, /const nextAltitude = Math\.min\(profile\.flightAltitudeMeters, profile\.takeoffClimbMps \* delta\)/,
  'first climb candidate must be clamped to the authored altitude ceiling');
assert.match(source, /nextAltitude = Math\.min\(profile\.flightAltitudeMeters, flightAltitudeMeters \+ profile\.takeoffClimbMps \* delta\)/,
  'continued climb must stay clamped to the authored altitude ceiling');
assert.match(source, /else if \(nextElapsedSeconds >= profile\.flightDurationSeconds\) \{\s*nextPhase = 'landing'/,
  'cruise must terminate on the authored timer');
assert.match(source, /gaitName: flightPhase === 'grounded' \? plan\.restGait : plan\.alertGait/,
  'ground and airborne gait families must stay distinct');

// Airborne birds intentionally bypass ground/player collision resolution so a raven can clear a wall
// or roof. Ground movement keeps the canonical player collider, but both paths must validate terrain
// before one atomic position.set publishes the candidate.
const flightHelperStart = source.indexOf('function tryCommitFlightMove');
const flightHelperEnd = source.indexOf('\n\t/**', flightHelperStart);
assert.ok(flightHelperStart >= 0 && flightHelperEnd > flightHelperStart, 'flight movement helper must remain discoverable');
const flightHelper = source.slice(flightHelperStart, flightHelperEnd);
assert.equal(flightHelper.includes('playerCollider'), false,
  'airborne flight must not be blocked by ground-player X/Z collision resolution');
assert.match(flightHelper, /groundCollider\.getGroundHeight\(candidateX, candidateZ\)/,
  'airborne flight must remain terrain-relative');
assert.match(flightHelper, /object3D\.position\.set\(candidateX, candidateY, candidateZ\)/,
  'airborne transform must publish atomically after terrain validation');

const groundedHelperStart = source.indexOf('function tryCommitGroundedMove');
const groundedHelperEnd = source.indexOf('\n\n\t// Airborne birds', groundedHelperStart);
assert.ok(groundedHelperStart >= 0 && groundedHelperEnd > groundedHelperStart, 'ground movement helper must remain discoverable');
const groundedHelper = source.slice(groundedHelperStart, groundedHelperEnd);
assert.match(groundedHelper, /playerCollider\.resolveXZ/, 'ground hopping must keep canonical collision resolution');
assert.match(groundedHelper, /groundCollider\.getGroundHeight/, 'ground hopping must remain terrain-aligned');
assert.match(groundedHelper, /object3D\.position\.set\(resolvedX, resolvedY, resolvedZ\)/,
  'grounded movement must publish one complete finite transform');

// Determinism policy for bird movement: no executable wall-clock or random source may appear in the
// brain. Flight is advanced solely by supplied simulation delta, and failed terrain candidates cannot
// consume hidden timer progress because timer assignment is inside the successful commit branch.
const executableSource = source.split('\n').filter((line) => !/^\s*(?:\/\/|\*)/.test(line)).join('\n');
assert.equal(/Math\.random\s*\(/.test(executableSource), false, 'bird brain must not use Math.random');
assert.equal(/Date\.now\s*\(|performance\.now\s*\(/.test(executableSource), false, 'bird flight must not use wall-clock time');
assert.match(source, /const nextElapsedSeconds = flightElapsedSeconds \+ delta/,
  'airborne flight lifetime must derive its next timer solely from simulation delta');
assert.match(source, /if \(tryCommitFlightMove\(nextX, nextZ, nextAltitude\)\) \{\s*flightElapsedSeconds = nextElapsedSeconds;/,
  'airborne timer must commit only when the matching transform commits');

console.log('CREATURE_BIRD_FLIGHT_LIFECYCLE_PASS', JSON.stringify({
  ...lifecycle,
  boundedAltitude: true,
  boundedDuration: true,
  airborneUrgency: true,
  collisionAwareGround: true,
  airborneObstacleClearance: true,
  atomicTerrainCommit: true,
  deterministicDeltaClock: true,
}));
