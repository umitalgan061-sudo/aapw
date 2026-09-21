import assert from 'node:assert/strict';
import { createPlayerThirdPersonCameraDirector, validatePlayerThirdPersonCameraReceipt } from '../src/3d/gameplay/playerThirdPersonCameraDirector.js';

const fixture = () => ({
  action: 'lock-on',
  deltaTime: 1 / 60,
  lookDelta: { x: 0.5, y: -0.25 },
  grounded: true,
  speed: 4.5,
  targets: [
    { id: 'far-visible', distance: 12, angle: 0.2, priority: 0.1 },
    { id: 'near-visible', distance: 6, angle: 0.4, priority: 0.1 },
    { id: 'hidden', distance: 1, angle: 0, priority: 1, visible: false },
  ],
});

const run = () => {
  const director = createPlayerThirdPersonCameraDirector({ historyLimit: 2 });
  const first = director.derive(fixture());
  assert.equal(first.mode, 'lock-on');
  assert.equal(first.target.id, 'near-visible');
  assert.equal(validatePlayerThirdPersonCameraReceipt(first), true);
  assert.equal(first.framing.distance, 3.4);
  const second = director.derive({ ...fixture(), action: 'aim', aiming: true, lookDelta: { x: -0.25, y: 0.1 } });
  assert.equal(second.mode, 'aim');
  assert.equal(second.framing.distance, 2.25);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.orbit), true);
  assert.equal(director.getHistory().length, 2);
  const before = JSON.stringify(second);
  second.orbit.yaw = 999;
  assert.equal(JSON.stringify(second), before);
  director.dispose();
  assert.equal(director.derive(fixture()), null);
  assert.equal(director.reset(), false);
  return { first, second };
};

const left = run();
const right = run();
assert.deepEqual(left, right);
console.log('Kızıl Ufuk third-person camera director proof: PASS');
