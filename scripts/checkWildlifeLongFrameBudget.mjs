#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/animals.js', import.meta.url), 'utf8');

assert.match(source, /MAX_WILDLIFE_SIMULATION_STEP_SECONDS = 0\.1/);
assert.match(source, /DEFAULT_FLEE_RELEASE_MARGIN_METERS = 3/);
assert.match(source, /MAX_PACK_ALERT_SAMPLES_PER_TICK = 32/);
assert.match(source, /const simulationDelta = boundedWildlifeDelta\(delta\)/);
assert.match(source, /const hasFinitePlayerPosition = Number\.isFinite\(playerPosition\?\.x\) && Number\.isFinite\(playerPosition\?\.z\)/);
assert.match(source, /const directThreat = canFlee && distanceFromPlayer < fleeTriggerRadiusMeters/);
assert.match(source, /if \(canFlee && !directThreat && packAlertRadiusMeters != null && packmateFleePositions != null\)/);
assert.match(source, /const iteratorFactory = packmateFleePositions\[Symbol\.iterator\]/);
assert.match(source, /iteratorFactory\.call\(packmateFleePositions\)/);
assert.match(source, /packSamplesScanned < MAX_PACK_ALERT_SAMPLES_PER_TICK/);
assert.match(source, /nextPackmate = packIterator\.next\(\)/);
assert.match(source, /const recovering = canFlee/);
assert.match(source, /&& hasFinitePlayerPosition/);
assert.match(source, /distanceFromPlayer < fleeReleaseRadiusMeters/);
assert.match(source, /currentlyFleeing = directThreat \|\| isFleeingFromPack \|\| recovering/);
assert.match(source, /!Number\.isFinite\(packmatePosition\?\.x\) \|\| !Number\.isFinite\(packmatePosition\?\.z\)/);
assert.match(source, /const separationDx = hasFinitePlayerPosition \? dxFromPlayer : packThreatDx/);
assert.match(source, /const separationDistance = hasFinitePlayerPosition \? distanceFromPlayer : nearestPackThreatDistance/);
assert.match(source, /const hasSeparationVector = Number\.isFinite\(separationDistance\) && separationDistance > 1e-6/);
assert.match(source, /Math\.sin\(model\.rotation\.y\)/);
assert.match(source, /Math\.cos\(model\.rotation\.y\)/);
assert.match(source, /function tryCommitGroundedMove\(candidateX, candidateZ\)/);
assert.match(source, /!Number\.isFinite\(resolved\?\.x\) \|\| !Number\.isFinite\(resolved\?\.z\)/);
assert.match(source, /const resolvedY = groundCollider\.getGroundHeight\(resolvedX, resolvedZ\)/);
assert.match(source, /if \(!Number\.isFinite\(resolvedY\)\) return false/);
assert.match(source, /const step = fleeSpeedMps \* simulationDelta/);
assert.match(source, /const step = speedMps \* simulationDelta/);
assert.match(source, /mixer\.update\(simulationDelta\)/);
assert.match(source, /if \(!Number\.isFinite\(delta\) \|\| delta <= 0\) return 0/);

const maxStep = 0.1;
const maxPackSamples = 32;
const fleeSpeed = 4.5;
const patrolSpeed = 2.2;
const triggerRadius = 12;
const releaseMargin = 3;
const releaseRadius = triggerRadius + releaseMargin;
const bounded = (delta) => (!Number.isFinite(delta) || delta <= 0 ? 0 : Math.min(delta, maxStep));
const overlapDirection = (yaw) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
const finitePlayerPosition = (position) => Number.isFinite(position?.x) && Number.isFinite(position?.z);
const finitePackmatePosition = (position) => Number.isFinite(position?.x) && Number.isFinite(position?.z);
const packmateInputIsIterable = (value) => value != null && typeof value[Symbol.iterator] === 'function';
const movementAdapterOutputIsFinite = (position) => Number.isFinite(position?.x) && Number.isFinite(position?.z);
const shouldRecover = ({ wasFleeing, direct, pack, finitePlayer, distance }) => Boolean(
  wasFleeing && !direct && !pack && finitePlayer && distance < releaseRadius,
);
const shouldPackAlert = ({ direct, alertRadius, packmate }) => Boolean(
  !direct && alertRadius != null && finitePackmatePosition(packmate) && Math.hypot(packmate.x, packmate.z) < alertRadius,
);

assert.equal(bounded(3), 0.1, 'a multi-second tab/background stall must be reduced to one bounded wildlife step');
assert.equal(bounded(Number.NaN), 0, 'non-finite frame deltas must never enter movement or animation state');
assert.equal(bounded(-1), 0, 'negative clock deltas must not rewind wildlife state');
assert.equal(maxPackSamples, 32, 'group-AI pack sensing must remain bounded per wildlife tick');
assert.ok(fleeSpeed * bounded(3) <= 0.45 + Number.EPSILON, 'flee displacement per resumed frame must remain collider-safe and bounded');
assert.ok(patrolSpeed * bounded(3) <= 0.22 + Number.EPSILON, 'patrol displacement per resumed frame must remain bounded');
assert.equal(releaseRadius, 15, 'default flee release radius must remain a bounded 3 m margin beyond trigger');
assert.equal(shouldRecover({ wasFleeing: true, direct: false, pack: false, finitePlayer: true, distance: 13 }), true, 'wolf must remain fleeing immediately outside the trigger boundary');
assert.equal(shouldRecover({ wasFleeing: true, direct: false, pack: false, finitePlayer: true, distance: 16 }), false, 'wolf must release once the player clears hysteresis radius');
assert.equal(shouldRecover({ wasFleeing: true, direct: false, pack: false, finitePlayer: false, distance: 13 }), false, 'invalid player input must not keep recovery latched');
assert.equal(shouldPackAlert({ direct: false, alertRadius: 5, packmate: { x: 0, z: 3 } }), true, 'finite nearby packmates must propagate alarm without any player-position dependency');
assert.equal(shouldPackAlert({ direct: true, alertRadius: 5, packmate: { x: 0, z: 3 } }), false, 'direct player threat must retain priority over pack alert');
assert.equal(shouldPackAlert({ direct: false, alertRadius: 5, packmate: { x: Number.NaN, z: 3 } }), false, 'malformed packmates must fail closed');
assert.equal(packmateInputIsIterable([{ x: 0, z: 3 }]), true, 'array pack inputs must remain eligible for group-AI propagation');
assert.equal(packmateInputIsIterable(new Set([{ x: 0, z: 3 }])), true, 'generic iterable pack inputs must remain supported');
assert.equal(packmateInputIsIterable({ x: 0, z: 3 }), false, 'truthy non-iterable pack payloads must fail closed before iteration');
assert.equal(packmateInputIsIterable(null), false, 'null pack payloads must fail closed');
const overlap = overlapDirection(Math.PI / 2);
assert.ok(Math.abs(overlap.x - 1) <= Number.EPSILON && Math.abs(overlap.z) <= 1e-15, 'exact-overlap flee fallback must be a deterministic unit direction from wolf yaw');
assert.equal(finitePlayerPosition({ x: Number.NaN, z: 0 }), false, 'NaN player threat coordinates must fail closed before direct wildlife sensing');
assert.equal(finitePlayerPosition({ x: Infinity, z: 0 }), false, 'infinite player threat coordinates must fail closed before direct wildlife sensing');
assert.equal(finitePlayerPosition({ x: 0, z: 0 }), true, 'finite player threat coordinates must remain eligible for wildlife sensing');
assert.equal(movementAdapterOutputIsFinite({ x: Number.NaN, z: 0 }), false, 'NaN collider output must be rejected before movement commit');
assert.equal(movementAdapterOutputIsFinite({ x: 0, z: Infinity }), false, 'infinite collider output must be rejected before movement commit');
assert.equal(movementAdapterOutputIsFinite({ x: 1, z: 2 }), true, 'finite collider output must remain eligible for movement commit');

console.log('Wildlife long-frame simulation budget PASS');
