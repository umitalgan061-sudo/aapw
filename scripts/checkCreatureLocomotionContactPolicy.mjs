import assert from 'node:assert/strict';
import { normalizeCreatureContactProbe, resolveCreatureContactFlags, resolveCreatureSurfaceResponse, resolveCreatureTraversalCue, buildCreatureContactLocomotionInput, evaluateCreatureContactRisk, projectCreatureContactPolicy, compareCreatureContactProbes } from '../src/3d/gameplay/creatureLocomotionContactPolicy.js';

const clean = normalizeCreatureContactProbe({ grounded: true, normalConfidence: 1, surfaceConfidence: 1, slip: 0, slopeDegrees: 5, forwardDistance: 5, forwardHeight: 0, impactMps: 0 });
assert.equal(clean.grounded, true);
assert.equal(clean.slip, 0);
assert.equal(resolveCreatureContactFlags(clean).stable, true);
assert.equal(resolveCreatureSurfaceResponse(clean).risk, undefined);
assert.equal(evaluateCreatureContactRisk(clean).severity, 'low');

const slippery = { grounded: true, normalConfidence: 0.9, surfaceConfidence: 0.9, slip: 0.9, slopeDegrees: 20, forwardDistance: 3, forwardHeight: 0, impactMps: 0 };
assert.equal(resolveCreatureContactFlags(slippery).slippery, true);
assert.ok(resolveCreatureSurfaceResponse(slippery).instability > 0);
assert.equal(projectCreatureContactPolicy(slippery).grounded, true);

const blocked = { grounded: true, forwardBlocked: true, forwardDistance: 5, forwardHeight: 0 };
assert.equal(resolveCreatureTraversalCue(blocked).blocked, true);
const input = buildCreatureContactLocomotionInput({ behaviour: 'wander', moving: true, speedMps: 1, targetSpeedMps: 2 }, blocked);
assert.equal(input.traversalBlocked, true);
assert.equal(input.contactFlags.blocked, true);

const climb = { grounded: true, forwardDistance: 2, forwardHeight: 1.2 };
assert.equal(resolveCreatureTraversalCue(climb).climbable, true);
const drop = { grounded: true, forwardDistance: 2, forwardHeight: -1.5 };
assert.equal(resolveCreatureTraversalCue(drop).drop, true);

const diff = compareCreatureContactProbes(clean, slippery);
assert.ok(diff.tractionDelta < 0);
assert.ok(diff.riskDelta > 0);

const malformed = normalizeCreatureContactProbe({ grounded: 'yes', slip: 'bad', normalConfidence: 99, slopeDegrees: Infinity });
assert.equal(malformed.grounded, true);
assert.equal(malformed.slip, 0);
assert.equal(malformed.normalConfidence, 1);
assert.equal(malformed.slopeDegrees, 0);
console.log('Creature locomotion contact policy checks passed');
