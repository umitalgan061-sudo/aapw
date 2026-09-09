import assert from 'node:assert/strict';
import {
  buildPlayerAnimationEventSchedule,
  serializePlayerAnimationEventSchedule,
} from '../src/3d/gameplay/playerAnimationEventSchedule.js';

const sample = { action: 'heavy', duration: 1.2, progress: 0.42, speed: 1.1 };
const first = buildPlayerAnimationEventSchedule(sample);
const second = buildPlayerAnimationEventSchedule(sample);
assert.deepEqual(first, second);
assert.equal(first.action, 'heavy');
assert.equal(first.events.length, 3);
assert.equal(first.activeEvent, 'active');
assert.equal(first.complete, false);
assert.equal(serializePlayerAnimationEventSchedule(sample), serializePlayerAnimationEventSchedule(sample));
assert.equal(buildPlayerAnimationEventSchedule({ action: 'invalid', progress: 5 }).reason, 'unsupported-action');
assert.equal(buildPlayerAnimationEventSchedule({ action: 'light', progress: Number.NaN }).progress, 0);
assert.equal(buildPlayerAnimationEventSchedule({ action: 'dodge', speed: 0 }).speed, 0.1);
assert.throws(() => { first.events.push({ name: 'x', time: 0 }); }, TypeError);
console.log('player animation event schedule contract: ok');
