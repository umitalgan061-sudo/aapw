import assert from 'node:assert/strict';
import {
  PRESENTATION_STATES,
  resolvePlayerPresentation,
  buildEquipmentSocketBindings,
  buildArmorStatEnvelope,
} from '../src/3d/gameplay/playerAnimationEquipmentDirector.js';

const attack = resolvePlayerPresentation({
  combatState: { action: 'light', comboIndex: 2 },
  movement: { x: 1, z: 0 },
  equipment: { weaponSocket: 'hand_r', armorProfile: 'leather' },
});
assert.equal(attack.state, PRESENTATION_STATES.LIGHT_ATTACK);
assert.equal(attack.comboIndex, 2);
assert.equal(attack.armorProfile, 'leather');

const stagger = resolvePlayerPresentation({ combatState: { lastResolvedHit: { kind: 'hit', staggered: true } } });
assert.equal(stagger.state, PRESENTATION_STATES.STAGGER);

const sockets = buildEquipmentSocketBindings({ weaponId: 'sword_01', offhandId: 'shield_01', chestId: 'mail_01' });
assert.deepEqual(sockets.map(({ slot, socket }) => ({ slot, socket })), [
  { slot: 'weapon', socket: 'hand_r' },
  { slot: 'offhand', socket: 'hand_l' },
  { slot: 'chest', socket: 'spine' },
]);

const armor = buildArmorStatEnvelope({ mitigation: 1.4, poise: 40, staminaPenalty: 0.2, tags: ['metal', 'heavy'] });
assert.equal(armor.mitigation, 0.95);
assert.equal(armor.movementMultiplier, 0.93);
assert.deepEqual(armor.tags, ['metal', 'heavy']);

console.log('player animation/equipment director contract: PASS');
