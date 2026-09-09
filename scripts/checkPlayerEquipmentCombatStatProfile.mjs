import assert from 'node:assert/strict';
import { buildPlayerEquipmentCombatStatProfile, serializePlayerEquipmentCombatStatProfile } from '../src/3d/gameplay/playerEquipmentCombatStatProfile.js';

const input = { capacity: 20, items: [
  { id: 'iron-sword', role: 'weapon', damage: 40, reachMeters: 1.8, weight: 4 },
  { id: 'mail', role: 'armor', armor: 30, poise: 12, weight: 10 },
  { id: 'broken-charm', role: 'accessory', damage: NaN, ready: false },
] };
const first = buildPlayerEquipmentCombatStatProfile(input);
const second = buildPlayerEquipmentCombatStatProfile(input);
assert.deepEqual(first, second);
assert.equal(first.totals.damage, 40);
assert.equal(first.weaponId, 'iron-sword');
assert.equal(first.assetMissingCount, 1);
assert.equal(first.readiness, 'partial');
assert.ok(first.encumbrance > 0.6 && first.encumbrance < 0.8);
assert.equal(Object.isFrozen(first), true);
assert.equal(serializePlayerEquipmentCombatStatProfile(first), serializePlayerEquipmentCombatStatProfile(second));
const fallback = buildPlayerEquipmentCombatStatProfile({ items: [{ id: null, role: 'weapon', damage: Infinity }] });
assert.equal(fallback.totals.damage, 0);
assert.equal(fallback.items[0].id, 'unknown-item');
console.log('player equipment combat stat profile: PASS');
