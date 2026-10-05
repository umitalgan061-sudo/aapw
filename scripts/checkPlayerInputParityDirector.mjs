import assert from 'node:assert/strict';
import { projectPlayerInputParity, serializePlayerInputParity } from '../src/3d/gameplay/playerInputParityDirector.js';

const sample = {
  move: { x: 2, y: 0 },
  look: { x: 0.1, y: 0.2 },
  'keyboard-mouse': { connected: true, confidence: 1, actions: { light: { pressed: true, justPressed: true, value: 1 } } },
  gamepad: { connected: true, confidence: 0.8, actions: { dodge: { pressed: true, value: 0.9 } } },
  mobile: { connected: false, confidence: 0, actions: { heavy: { pressed: true, value: 1 } } },
};

const first = projectPlayerInputParity(sample);
const second = projectPlayerInputParity(sample);
assert.deepEqual(first, second);
assert.equal(first.move.magnitude, 1);
assert.equal(first.actions.find((entry) => entry.action === 'light').source, 'keyboard-mouse');
assert.equal(first.actions.find((entry) => entry.action === 'dodge').source, 'gamepad');
assert.equal(first.actions.find((entry) => entry.action === 'heavy').source, 'none');
assert.equal(first.parityReady, true);
assert.throws(() => { first.actions.push({}); }, TypeError);
assert.equal(serializePlayerInputParity(first), serializePlayerInputParity(second));

const malformed = projectPlayerInputParity({ move: { x: 'bad', y: Infinity }, look: null }, { deadzone: 'bad' });
assert.equal(malformed.move.magnitude, 0);
assert.equal(malformed.look.magnitude, 0);
assert.equal(malformed.deadzone, 0.18);
assert.equal(malformed.primarySource, 'keyboard-mouse');

console.log('player input parity director: ok');
