import assert from 'node:assert/strict';
import { createPlayerEquipmentConditionDirector, resolvePlayerEquipmentCondition, validatePlayerEquipmentCondition } from '../src/3d/gameplay/playerEquipmentConditionDirector.js';

const fixture = {
  maxCarryWeight: 100,
  activeAttackKind: 'heavy',
  items: [
    { id: 'longsword', slot: 'mainHand', condition: 100, weight: 8 },
    { id: 'plate', slot: 'chest', condition: 35, weight: 26 },
    { id: 'buckler', slot: 'offHand', condition: 0, weight: 4 },
  ],
};

const first = resolvePlayerEquipmentCondition(fixture);
const second = resolvePlayerEquipmentCondition(fixture);
assert.deepEqual(first, second);
assert.equal(first.activeAttackKind, 'heavy');
assert.equal(first.encumbranceBand, 'moderate');
assert.equal(first.brokenCount, 1);
assert.ok(first.warnings.includes('chest:repair-recommended'));
assert.ok(first.warnings.includes('offhand:broken'));
assert.ok(first.attackMultiplier < 1);
assert.ok(first.defenseMultiplier < 1);
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(first.items));

const director = createPlayerEquipmentConditionDirector({ historyLimit: 2 });
const receiptA = director.evaluate(fixture);
const receiptB = director.evaluate({ ...fixture, items: fixture.items.slice(0, 1) });
const receiptC = director.evaluate({ ...fixture, items: [] });
assert.equal(validatePlayerEquipmentCondition(receiptA), true);
assert.equal(director.snapshot().history.length, 2);
assert.equal(receiptC.sequence, receiptB.sequence + 1);
assert.ok(Object.isFrozen(receiptA.condition));

director.dispose();
assert.deepEqual(director.evaluate(fixture), { accepted: false, reason: 'disposed', sequence: receiptC.sequence });
assert.equal(director.snapshot().disposed, true);
console.log('Kızıl Ufuk equipment condition director checks passed.');
