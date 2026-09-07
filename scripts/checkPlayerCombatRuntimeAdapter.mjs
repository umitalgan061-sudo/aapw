import assert from 'node:assert/strict';
import {
  attachPlayerCombatRuntimeAdapter,
  PLAYER_ATTACK_WINDOW_EVENT,
  PLAYER_COMBAT_FEEDBACK_EVENT,
} from '../src/3d/gameplay/playerCombatRuntimeAdapter.js';

const target = new EventTarget();
let frames = 0;
const adapter = attachPlayerCombatRuntimeAdapter({
  target,
  getMovement: () => ({ x: 0.5, z: -0.25, speedMps: 4, grounded: true }),
  getEquipment: () => ({ weaponId: 'sword_01', armorProfile: 'leather' }),
  onFrame: (frame) => { frames += 1; assert.equal(frame.locomotion.speedMps, 4); },
});

target.dispatchEvent(new CustomEvent(PLAYER_ATTACK_WINDOW_EVENT, {
  detail: { kind: 'light', comboStep: 2, phase: 'start' },
}));
assert.equal(adapter.snapshot().animation.state, 'attack_light');
assert.equal(adapter.snapshot().animation.comboIndex, 2);

target.dispatchEvent(new CustomEvent(PLAYER_COMBAT_FEEDBACK_EVENT, {
  detail: { outcome: 'hit-stagger', appliedAmount: 12, serial: 8, position: { x: 1, y: 2, z: 3 } },
}));
const feedback = adapter.snapshot().feedback;
assert.equal(feedback.cue, 'stagger');
assert.equal(feedback.serial, 8);
assert.equal(feedback.position.z, 3);
assert.equal(frames, 2);

adapter.dispose();
target.dispatchEvent(new CustomEvent(PLAYER_COMBAT_FEEDBACK_EVENT, { detail: { outcome: 'hit' } }));
assert.equal(frames, 2);
console.log('PLAYER_COMBAT_RUNTIME_ADAPTER_PASS');
