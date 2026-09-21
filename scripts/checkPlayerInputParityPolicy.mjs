import assert from 'node:assert/strict';
import { createPlayerInputParityPolicy, PLAYER_INPUT_PARITY_SCHEMA } from '../src/3d/gameplay/playerInputParityPolicy.js';

const run = () => {
  const policy = createPlayerInputParityPolicy({ deadzone: 0.2, maxHistory: 2 });
  const first = policy.ingest({ device: 'keyboard', action: 'attack', sequence: 1, pressed: true });
  assert.equal(first.accepted, true);
  assert.equal(first.action, 'light');
  assert.equal(first.schema, PLAYER_INPUT_PARITY_SCHEMA);

  const analogue = policy.ingest({ device: 'gamepad', action: 'target-lock', sequence: 2, axis: { x: 0.6, y: -0.1 }, pressed: true });
  assert.equal(analogue.action, 'lock-on');
  assert.equal(analogue.normalized.x, 0.5);
  assert.equal(analogue.normalized.y, 0);
  assert.equal(policy.validate(analogue), true);

  const duplicate = policy.ingest({ device: 'touch', action: 'dodge', sequence: 2, pressed: true });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'non-monotonic-sequence');

  const invalid = policy.ingest({ device: 'joystick', action: 'light', sequence: 3 });
  assert.equal(invalid.reason, 'invalid-device');

  const snapshot = policy.snapshot();
  assert.equal(snapshot.history.length, 2);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.history[0]), true);

  const replayA = createPlayerInputParityPolicy({ deadzone: 0.2 }).ingest({ device: 'mouse', action: 'attack-heavy', sequence: 9, axis: { x: -0.8, y: 0.4 }, pressed: true });
  const replayB = createPlayerInputParityPolicy({ deadzone: 0.2 }).ingest({ device: 'mouse', action: 'attack-heavy', sequence: 9, axis: { x: -0.8, y: 0.4 }, pressed: true });
  assert.deepEqual(replayA, replayB);

  policy.dispose();
  assert.equal(policy.ingest({ device: 'system', action: 'guard', sequence: 10 }).reason, 'disposed');
  console.log('PLAYER_INPUT_PARITY_POLICY_OK');
};

run();
