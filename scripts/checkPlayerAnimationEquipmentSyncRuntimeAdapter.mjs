import assert from 'node:assert/strict';
import {
  buildPlayerAnimationEquipmentSyncSnapshot,
} from '../src/3d/gameplay/playerAnimationEquipmentSyncDirector.js';
import {
  applyPlayerAnimationEquipmentSyncSnapshot,
  buildAndApplyPlayerAnimationEquipmentSync,
} from '../src/3d/gameplay/playerAnimationEquipmentSyncRuntimeAdapter.js';

const snapshot = buildPlayerAnimationEquipmentSyncSnapshot({
  locomotion: 'walk',
  combatPhase: 'guard',
  layers: [
    { id: 'locomotion', family: 'locomotion', clip: 'walk', weight: 0.8, priority: 20 },
    { id: 'guard', family: 'defense', clip: 'guard', weight: 1, priority: 60 },
  ],
  equipment: [
    { id: 'sword', slot: 'mainHand', weaponClass: 'sword', ready: true },
    { id: 'shield', slot: 'offHand', weaponClass: 'shield', ready: true },
  ],
});

const calls = [];
const owners = {
  animationOwner: {
    setLayerWeight: (...args) => calls.push(['layer', ...args]),
    setCrossFadeSeconds: (...args) => calls.push(['fade', ...args]),
    setUpperBodyLock: (...args) => calls.push(['lock', ...args]),
  },
  equipmentOwner: {
    applySocketPose: (...args) => calls.push(['socket', ...args]),
  },
};

const receipt = applyPlayerAnimationEquipmentSyncSnapshot(snapshot, owners);
assert.equal(receipt.applied, true);
assert.equal(receipt.animationCalls, 4);
assert.equal(receipt.equipmentCalls, 2);
assert.equal(calls.filter(([kind]) => kind === 'socket').length, 2);
assert.equal(calls.find(([kind]) => kind === 'lock')[1], true);
assert.equal(calls.find(([kind]) => kind === 'fade')[1], 0.35);

const composed = buildAndApplyPlayerAnimationEquipmentSync({ layers: [] }, {});
assert.equal(composed.receipt.applied, false);
assert.equal(composed.receipt.reason, 'owner-methods-unavailable');

const malformed = applyPlayerAnimationEquipmentSyncSnapshot({ version: 'bad' }, owners);
assert.equal(malformed.applied, false);
assert.equal(malformed.reason, 'invalid-version');

console.log(JSON.stringify({ checks: 10, applied: receipt.applied, animationCalls: receipt.animationCalls, equipmentCalls: receipt.equipmentCalls }));
