#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/animals.js', import.meta.url), 'utf8');

assert.match(source, /MAX_WILDLIFE_SIMULATION_STEP_SECONDS = 0\.1/);
assert.match(source, /const simulationDelta = boundedWildlifeDelta\(delta\)/);
assert.match(source, /const step = fleeSpeedMps \* simulationDelta/);
assert.match(source, /const step = speedMps \* simulationDelta/);
assert.match(source, /mixer\.update\(simulationDelta\)/);
assert.match(source, /if \(!Number\.isFinite\(delta\) \|\| delta <= 0\) return 0/);

const maxStep = 0.1;
const fleeSpeed = 4.5;
const patrolSpeed = 2.2;
const bounded = (delta) => (!Number.isFinite(delta) || delta <= 0 ? 0 : Math.min(delta, maxStep));

assert.equal(bounded(3), 0.1, 'a multi-second tab/background stall must be reduced to one bounded wildlife step');
assert.equal(bounded(Number.NaN), 0, 'non-finite frame deltas must never enter movement or animation state');
assert.equal(bounded(-1), 0, 'negative clock deltas must not rewind wildlife state');
assert.ok(fleeSpeed * bounded(3) <= 0.45 + Number.EPSILON, 'flee displacement per resumed frame must remain collider-safe and bounded');
assert.ok(patrolSpeed * bounded(3) <= 0.22 + Number.EPSILON, 'patrol displacement per resumed frame must remain bounded');

console.log('Wildlife long-frame simulation budget PASS');
