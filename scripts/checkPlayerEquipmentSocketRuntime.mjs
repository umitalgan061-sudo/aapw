import assert from 'node:assert/strict';
import {
  resolvePlayerEquipmentSocketRuntime,
  validatePlayerEquipmentSocketRuntime,
} from '../src/3d/gameplay/playerEquipmentSocketRuntime.js';

const input = {
  equipment: [
    { id: 'iron-sword', kind: 'weapon', socket: 'mainHand', asset: 'assets/models/props/iron-sword.glb', materialManifestId: 'weapon.iron', stats: { attack: 12, weight: 4 } },
    { id: 'round-shield', kind: 'shield', socket: 'offHand', materialManifestId: 'shield.round', stats: { armor: 8, poise: 4, weight: 6 } },
    { id: 'traveler-cloak', kind: 'armor', socket: 'chest', materialManifestId: 'armor.cloak', stats: { armor: 5, weight: 2 } },
    { id: 'second-sword', kind: 'weapon', socket: 'mainHand', materialManifestId: 'weapon.iron', stats: { attack: 9 } },
    { id: 'broken-belt', kind: 'accessory', socket: 'hands', stats: { armor: 2 } },
  ],
  requireMaterialManifest: true,
};

const first = resolvePlayerEquipmentSocketRuntime(input);
const second = resolvePlayerEquipmentSocketRuntime(input);
assert.deepEqual(first, second, 'socket resolution must be deterministic');
assert.equal(first.slots.mainHand.itemId, 'iron-sword');
assert.equal(first.slots.offHand.itemId, 'round-shield');
assert.equal(first.slots.chest.itemId, 'traveler-cloak');
assert.equal(first.rejected.find((entry) => entry.id === 'second-sword')?.reason, 'socket-occupied');
assert.equal(first.rejected.find((entry) => entry.id === 'broken-belt')?.reason, 'missing-material-manifest');
assert.equal(first.totals.attack, 12);
assert.equal(first.totals.armor, 13);
assert.equal(first.totals.poise, 4);
assert.equal(first.totals.weight, 12);
assert.equal(validatePlayerEquipmentSocketRuntime(first), true);

const fallback = resolvePlayerEquipmentSocketRuntime({
  equipment: [{ id: 'axe', kind: 'weapon', materialManifestId: 'weapon.axe', stats: { attack: 7 } }],
});
assert.equal(fallback.slots.mainHand.itemId, 'axe');

console.log('[checkPlayerEquipmentSocketRuntime] PASS');
