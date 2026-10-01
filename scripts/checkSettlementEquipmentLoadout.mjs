import { strict as assert } from 'node:assert';
import { buildSettlementEquipmentLoadout } from '../src/3d/gameplay/settlementEquipmentLoadout.js';

const input = {
  settlementId: 'north-settlement',
  equipment: { weapon: 'iron_sword', armor: 'leather_coat', charm: 'market_eye' },
  inventory: { iron_sword: 1, leather_coat: 0, market_eye: 1 },
  catalog: {
    iron_sword: { label: 'Iron Sword', slot: 'weapon', weight: 3.5, value: 120 },
    leather_coat: { label: 'Leather Coat', slot: 'armor', weight: 5, value: 90 },
    market_eye: { label: 'Market Eye', slot: 'charm', weight: 0.2, value: 60 },
  },
  carryWeight: 23.5,
  maxCarryWeight: 24,
};
const first = buildSettlementEquipmentLoadout(input);
const second = buildSettlementEquipmentLoadout(input);
assert.deepEqual(first, second, 'deterministic projection');
assert.equal(first.summary.equippedCount, 3);
assert.equal(first.summary.missingCount, 1);
assert.equal(first.summary.encumbered, false);
assert.equal(first.nextAction, 'restock:armor');
assert(Object.isFrozen(first) && Object.isFrozen(first.slots[0]), 'deep freeze');
assert.equal(typeof first.fingerprint, 'string');
assert(first.stable.includes('north-settlement'));
const malformed = buildSettlementEquipmentLoadout({ equipment: { weapon: 'x' }, inventory: { x: 'bad' }, carryWeight: 'bad', maxCarryWeight: 0 });
assert.equal(malformed.slots[0].available, false);
assert.equal(malformed.summary.maxCarryWeight, 1);
assert.equal(malformed.summary.carryRatio, 0);
console.log('settlement equipment loadout checks passed');
