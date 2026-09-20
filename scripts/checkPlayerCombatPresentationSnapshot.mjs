import assert from 'node:assert/strict';
import {
  createPlayerCombatPresentationSnapshot,
  serializePlayerCombatPresentationSnapshot,
} from '../src/3d/gameplay/playerCombatPresentationSnapshot.js';

const input = {
  frame: 7.8,
  intent: { action: 'heavyAttack', accepted: true },
  comboIndex: 2.9,
  resources: { stamina: 80, maxStamina: 120, poise: 35, maxPoise: 60 },
  target: { id: 'wolf-1', distance: -4, locked: true },
  animation: { locomotion: 'attack', locomotionWeight: 2, attackWeight: 0.8, guardWeight: -1, reactionWeight: 0.25, clip: 'heavy-02' },
  equipment: { weaponId: 'longsword', armorId: 'leather', sockets: { mainHand: 'RightHand', offHand: '', back: 'Back' } },
  outcome: { outcome: 'hit', damage: 42 },
};

const first = createPlayerCombatPresentationSnapshot(input);
const second = createPlayerCombatPresentationSnapshot(input);
assert.deepEqual(first, second);
assert.equal(first.frame, 7);
assert.equal(first.comboIndex, 2);
assert.equal(first.target.distance, 0);
assert.equal(first.animation.locomotionWeight, 1);
assert.equal(first.animation.guardWeight, 0);
assert.equal(first.equipment.weaponId, 'longsword');
assert.equal(first.feedback.kind, 'impact');
assert.equal(first.hitConfirmed, true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.equipment.sockets), true);
assert.equal(serializePlayerCombatPresentationSnapshot(first), serializePlayerCombatPresentationSnapshot(second));

const malformed = createPlayerCombatPresentationSnapshot({ frame: 'bad', resources: null, animation: null, equipment: null, target: null });
assert.equal(malformed.frame, 0);
assert.equal(malformed.action, 'none');
assert.equal(malformed.target.id, null);
assert.equal(malformed.feedback.kind, 'none');
console.log('PLAYER_COMBAT_PRESENTATION_SNAPSHOT_OK');
