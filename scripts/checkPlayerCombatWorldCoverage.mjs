import assert from 'node:assert/strict';
import { createPlayerCombatWorldCoverage, PLAYER_WORLD_COVERAGE_PORTS } from '../src/3d/gameplay/playerCombatWorldCoverage.js';
const calls = [];
const coverage = createPlayerCombatWorldCoverage({
	groundResolver: ({ position }) => { calls.push('ground'); return { groundY: position.y - 0.04, grounded: true }; },
	colliderResolver: () => { calls.push('collider'); return { blocked: false, clearanceMeters: 0.9 }; },
	waterResolver: () => { calls.push('water'); return { waterY: -10, submerged: false }; },
	slopeResolver: () => { calls.push('slope'); return { angleRadians: 0.35, blocked: false }; },
});
const input = { position: { x: 12, y: 3, z: -5 }, heightMeters: 1.8, radius: 0.4, deltaSeconds: 1 / 60, nowSeconds: 4 };
const first = coverage.sample(input); const second = coverage.sample(input);
assert.deepEqual(PLAYER_WORLD_COVERAGE_PORTS, ['ground', 'collider', 'water', 'slope']);
assert.deepEqual(calls.slice(0, 4), PLAYER_WORLD_COVERAGE_PORTS);
assert.equal(first.allPortsAvailable, true); assert.equal(first.readiness.grounded, true); assert.equal(first.combatSafe, true);
assert.ok(first.visualColliderDelta <= 0.08); assert.equal(first.digest, second.digest);
const transform = { position: { ...input.position } };
assert.equal(coverage.applyGrounding(transform, first), true); assert.equal(transform.position.y, 2.96);
const failed = createPlayerCombatWorldCoverage({ groundResolver: () => ({ groundY: 0, grounded: true }) }).sample(input);
assert.equal(failed.allPortsAvailable, false); assert.equal(failed.combatSafe, false); assert.equal(failed.readiness.worldPortsReady, false);
console.log('PLAYER_COMBAT_WORLD_COVERAGE_OK checks=18');
