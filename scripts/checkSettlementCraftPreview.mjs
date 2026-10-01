import assert from 'node:assert/strict';
import { buildSettlementCraftPreview } from '../src/3d/gameplay/settlementCraftPreview.ts';

const recipe = {
  id: 'iron_sword', label: 'Demir Kılıç', station: 'blacksmith',
  ingredients: { coal: 1, iron_ore: 3 }, xp: 40, minutes: 12, qualityBase: 0.72,
};
const items = {
  iron_ore: { id: 'iron_ore', label: 'Demir Cevheri', buy: 6 },
  coal: { id: 'coal', label: 'Kömür', buy: 4 },
};
const resolveItem = (id) => items[id] ?? null;

const ready = buildSettlementCraftPreview({ recipe, resolveItem, inventory: { iron_ore: 3, coal: 1 }, copper: 22, skillLevel: 3 });
assert.equal(ready.ok, true);
assert.equal(ready.reason, 'ready');
assert.deepEqual(ready.rows.map((row) => row.itemId), ['coal', 'iron_ore']);
assert.equal(ready.totalIngredientValue, 22);
assert.equal(Object.isFrozen(ready), true);
assert.equal(Object.isFrozen(ready.rows), true);

const missing = buildSettlementCraftPreview({ recipe, resolveItem, inventory: { iron_ore: 1, coal: 1 }, copper: 999 });
assert.equal(missing.reason, 'missing-ingredients');
assert.equal(missing.rows.find((row) => row.itemId === 'iron_ore')?.missing, 2);

const closed = buildSettlementCraftPreview({ recipe, resolveItem, inventory: { iron_ore: 3, coal: 1 }, copper: 22, stationAvailable: false });
assert.equal(closed.reason, 'station-unavailable');

const unknownItem = buildSettlementCraftPreview({ recipe, resolveItem: () => null, inventory: { iron_ore: 3, coal: 1 }, copper: 999 });
assert.equal(unknownItem.reason, 'missing-item-definition');
assert.deepEqual(unknownItem.missingItemIds, ['coal', 'iron_ore']);

const replayA = buildSettlementCraftPreview({ recipe, resolveItem, inventory: { coal: 1, iron_ore: 3 }, copper: 22, skillLevel: 3 });
const replayB = buildSettlementCraftPreview({ recipe, resolveItem, inventory: { iron_ore: 3, coal: 1 }, copper: 22, skillLevel: 3 });
assert.equal(replayA.signature, replayB.signature);
assert.deepEqual(replayA, replayB);

const source = { iron_ore: 3, coal: 1 };
buildSettlementCraftPreview({ recipe, resolveItem, inventory: source, copper: 22 });
assert.deepEqual(source, { iron_ore: 3, coal: 1 });

console.log('settlement craft preview checks passed');
