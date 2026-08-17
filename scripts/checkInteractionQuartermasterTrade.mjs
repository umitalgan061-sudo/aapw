import assert from 'node:assert/strict';
import {
	QUARTERMASTER_NPC_ID,
	QUARTERMASTER_OFFERS,
	STARTING_COPPER,
	buildQuartermasterText,
	createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';
import {
	INTERACTION_ITEMS,
	createInteractionInventoryState,
} from '../src/3d/gameplay/interactionConfig.js';

assert.equal(QUARTERMASTER_NPC_ID, 'stannis-guard-1');
assert.equal(STARTING_COPPER, 40);
assert.equal(QUARTERMASTER_OFFERS.length, 2);

const inventory = createInteractionInventoryState();
const economy = createInteractionEconomyState();
const grant = (itemId, quantity, provenance) => inventory.grant(itemId, quantity, provenance);

const ration = QUARTERMASTER_OFFERS[0];
const whetstone = QUARTERMASTER_OFFERS[1];
assert.equal(INTERACTION_ITEMS[ration.itemId]?.stackLimit, 5);
assert.equal(INTERACTION_ITEMS[whetstone.itemId]?.stackLimit, 3);

let result = economy.purchase(ration, grant);
assert.equal(result.ok, true);
assert.equal(result.balanceCopper, 34);
assert.equal(inventory.snapshot().items.find((item) => item.itemId === ration.itemId)?.quantity, 1);
assert.deepEqual(
	inventory.snapshot().items.find((item) => item.itemId === ration.itemId)?.provenance,
	[{ sourceType: 'vendor', sourceId: QUARTERMASTER_NPC_ID }],
);

result = economy.purchase(whetstone, grant);
assert.equal(result.ok, true);
assert.equal(result.balanceCopper, 22);
assert.equal(inventory.snapshot().items.find((item) => item.itemId === whetstone.itemId)?.quantity, 1);

// Stack cap rejects a purchase without charging the player.
for (let index = 0; index < 4; index += 1) economy.purchase(ration, grant);
assert.equal(inventory.snapshot().items.find((item) => item.itemId === ration.itemId)?.quantity, 5);
const beforeFullAttempt = economy.snapshot().copper;
result = economy.purchase(ration, grant);
assert.equal(result.ok, false);
assert.equal(result.reason, 'inventory-full');
assert.equal(economy.snapshot().copper, beforeFullAttempt);

// Insufficient funds also fail without inventory mutation.
const poorEconomy = createInteractionEconomyState(5);
const poorInventory = createInteractionInventoryState();
result = poorEconomy.purchase(ration, (...args) => poorInventory.grant(...args));
assert.equal(result.ok, false);
assert.equal(result.reason, 'insufficient-funds');
assert.equal(poorEconomy.snapshot().copper, 5);
assert.equal(poorInventory.snapshot().items.length, 0);

// Save/restore is deterministic and malformed/legacy state falls back to the starting purse.
const saved = economy.snapshot();
const restored = createInteractionEconomyState(0);
restored.restore(saved);
assert.deepEqual(restored.snapshot(), saved);
restored.restore({ copper: -50 });
assert.equal(restored.snapshot().copper, STARTING_COPPER);
restored.restore(null);
assert.equal(restored.snapshot().copper, STARTING_COPPER);

const text = buildQuartermasterText({ copper: 17 }, QUARTERMASTER_OFFERS, 'Satın alma tamamlandı.');
assert.match(text, /Dragonstone Levazımcısı/);
assert.match(text, /Kese: 17 bakır/);
assert.match(text, /saha azığı — 6 bakır/);
assert.match(text, /bileği taşı — 12 bakır/);
assert.match(text, /Satın alma tamamlandı/);

console.log('PASS checkInteractionQuartermasterTrade: deterministic purse, purchase, stack-cap, provenance, persistence and shop text verified.');
