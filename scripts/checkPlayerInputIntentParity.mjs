import assert from 'node:assert/strict';
import { resolvePlayerInputIntentParity, serializePlayerInputIntentParity } from '../src/3d/gameplay/playerInputIntentParity.js';
const input = { moveX: 3, moveY: 4, lookX: NaN, lookY: 0, actions: [
  { action: 'light', source: 'touch', sequence: 2 },
  { action: 'light', source: 'keyboard', sequence: 2 },
  { action: 'roll', source: 'gamepad', sequence: 3 },
  { action: 'guard', source: 'pwa', sequence: 1 },
  { action: 'unknown', source: 'mouse', sequence: 0 }
] };
const a = resolvePlayerInputIntentParity(input); const b = resolvePlayerInputIntentParity(input);
assert.deepEqual(a, b); assert.deepEqual(a.move, { x: 0.6, y: 0.8 }); assert.equal(a.actions.length, 3);
assert.equal(a.actions.find((x) => x.action === 'light').source, 'keyboard'); assert.equal(a.actions.find((x) => x.action === 'dodge').source, 'gamepad');
assert.equal(a.primaryAction, 'block'); assert.equal(a.deviceCount, 3); assert.equal(a.parity.touch, false); assert.equal(a.parity.pwa, true);
assert(Object.isFrozen(a) && Object.isFrozen(a.actions)); assert.equal(serializePlayerInputIntentParity(a), serializePlayerInputIntentParity(b));
assert.equal(resolvePlayerInputIntentParity({ actions: [{ action: 'light', source: 'keyboard', pressed: false }] }).primaryAction, null);
console.log(JSON.stringify({ ok: true, contract: 'player-input-intent-parity', actions: a.actions.length, devices: a.deviceCount }));
