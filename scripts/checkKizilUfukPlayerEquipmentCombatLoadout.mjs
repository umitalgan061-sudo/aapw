import assert from 'node:assert/strict';
import { buildPlayerEquipmentCombatLoadout, validatePlayerEquipmentCombatLoadout, loadoutDigest } from '../src/3d/gameplay/playerEquipmentCombatLoadout.js';

const makeRoot = () => ({ traverse(fn) { for (const name of ['mixamorigRightHand', 'mixamorigLeftHand', 'mixamorigSpine']) fn({ name }); } });
const input = {
  equipment: {
    mainHand: { id: 'greatsword' },
    offHand: { id: 'shield' },
    chest: { id: 'plate' },
  },
  baseAttack: { staminaCost: 20, reach: 2, duration: 0.7 },
  attackKind: 'heavy',
  animation: { movementState: 'idle', attackKind: 'heavy', comboStep: 2, grounded: true },
  actorRoot: makeRoot(),
};
const a = buildPlayerEquipmentCombatLoadout(input);
const b = buildPlayerEquipmentCombatLoadout(input);
assert.deepEqual(a, b);
assert.equal(validatePlayerEquipmentCombatLoadout(a).valid, true);
assert.equal(a.profile.mainHand.id, 'greatsword');
assert.equal(a.profile.armor.id, 'plate');
assert.equal(a.profile.shieldEquipped, true);
assert.ok(a.attack.cost > 20);
assert.ok(a.attack.reach > 2);
assert.equal(a.animation.locomotionLayer, 'attack');
assert.equal(a.sockets.bindings.mainHand.socket, 'mixamorigRightHand');
assert.equal(a.sockets.bindings.offHand.socket, 'mixamorigLeftHand');
assert.ok(a.material);
assert.equal(loadoutDigest(a), loadoutDigest(b));
const malformed = buildPlayerEquipmentCombatLoadout({ equipment: {}, baseAttack: { staminaCost: NaN } });
assert.equal(validatePlayerEquipmentCombatLoadout(malformed).valid, true);
assert.equal(Object.isFrozen(a), true);
console.log('Kızıl Ufuk equipment combat loadout contract: PASS');
