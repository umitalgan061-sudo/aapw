import assert from 'node:assert/strict';
import { buildPlayerPresentationFrame, createPlayerPresentationRuntimeBridge } from '../src/3d/gameplay/playerPresentationRuntimeBridge.js';

const frame = buildPlayerPresentationFrame({
  movement: { x: 2, z: -2, speedMps: 99, grounded: false },
  combatState: { action: 'light', comboIndex: 9 },
  equipment: { weaponSocket: 'hand_r', weaponId: 'sword_01', armorProfile: 'leather' },
  feedback: { outcome: 'hit', appliedAmount: 24, serial: 7, position: { x: 1, y: 2, z: 3 } },
});
assert.equal(frame.animation.state, 'attack_light');
assert.equal(frame.animation.comboIndex, 3);
assert.equal(frame.locomotion.grounded, false);
assert.equal(frame.locomotion.speedMps, 20);
assert.equal(frame.locomotion.blendWeight, 1);
assert.equal(frame.feedback.cue, 'impact');
assert.equal(frame.feedback.position.z, 3);

const bridge = createPlayerPresentationRuntimeBridge({
  movement: { x: 0, z: 0 },
  equipment: { armorProfile: 'unarmored' },
});
let emissions = 0;
const unsubscribe = bridge.subscribe((next) => {
  emissions += 1;
  assert(Number.isFinite(next.locomotion.blendWeight));
});
const updated = bridge.update({
  movement: { x: 0.4, z: 0.2, speedMps: 4 },
  combatState: { action: 'block' },
  equipment: { shieldSocket: 'forearm_l' },
});
assert.equal(updated.animation.state, 'block');
assert.equal(emissions, 1);
unsubscribe();
bridge.update({ feedback: { outcome: 'unknown', appliedAmount: Number.NaN } });
assert.equal(bridge.snapshot().feedback.cue, 'none');
bridge.dispose();

console.log('PLAYER_PRESENTATION_RUNTIME_BRIDGE_PASS');
