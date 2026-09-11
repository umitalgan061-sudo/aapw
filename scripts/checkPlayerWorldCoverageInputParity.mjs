import assert from 'node:assert/strict';

import {
  getPlayerWorldCoverageInputContract,
  normalizePlayerWorldCoverageInput,
  validatePlayerWorldCoverageInput,
} from '../src/3d/gameplay/playerWorldCoverageInputParity.js';

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (left, right, message) => { assert.deepEqual(left, right, message); checks += 1; };

const contract = getPlayerWorldCoverageInputContract();
eq(contract.sources, ['keyboard', 'gamepad', 'touch'], 'input sources');
eq(contract.axisRange, [-1, 1], 'axis range');
eq(contract.deadZone, 0.02, 'dead zone');

const neutral = normalizePlayerWorldCoverageInput();
eq(neutral.move, { x: 0, z: 0 }, 'neutral movement');
eq(neutral.look, { x: 0, y: 0 }, 'neutral look');
eq(neutral.activeSources, [], 'neutral sources');
ok(validatePlayerWorldCoverageInput(neutral).ok, 'neutral validation');

const parity = normalizePlayerWorldCoverageInput({
  keyboard: { moveX: 1, moveZ: 0 },
  gamepad: { moveX: 0.9, moveZ: 0.1 },
  touch: { moveX: 1, moveZ: 0 },
  mouse: { lookX: 0.5, lookY: -0.25 },
});

eq(parity.activeSources, ['keyboard', 'gamepad', 'touch'], 'all devices represented');
ok(parity.move.x <= 1 && parity.move.x >= -1, 'averaged movement bounded');
ok(parity.move.z <= 1 && parity.move.z >= -1, 'averaged movement z bounded');
eq(parity.look, { x: 0.5, y: -0.25 }, 'mouse look normalized');
ok(validatePlayerWorldCoverageInput(parity).ok, 'parity validation');

const deadZone = normalizePlayerWorldCoverageInput({ keyboard: { moveX: 0.01, moveZ: -0.01 } });
eq(deadZone.activeSources, [], 'dead zone suppresses jitter');

const overflow = normalizePlayerWorldCoverageInput({ keyboard: { moveX: 9, moveZ: -9 }, mouse: { lookX: 9, lookY: -9 } });
eq(overflow.move, { x: 1, z: -1 }, 'axis overflow clamped');
eq(overflow.look, { x: 1, y: -1 }, 'look overflow clamped');
ok(validatePlayerWorldCoverageInput(overflow).ok, 'bounded overflow still valid');

const disagreement = normalizePlayerWorldCoverageInput({ keyboard: { moveX: 1 }, gamepad: { moveX: -1 } });
ok(disagreement.disagreement > 0, 'input disagreement is visible');
ok(!disagreement.parityReady, 'large disagreement is not silently accepted');

console.log(JSON.stringify({ checks, activeSources: parity.activeSources, disagreement: disagreement.disagreement }));
