import { previewSettlementAction, previewSettlementPanel } from '../src/3d/gameplay/settlementActionPreview.js';

const failures = [];
const ok = (condition, label) => { if (!condition) failures.push(label); };
const snapshot = {
  copper: 120,
  fatigue: 10,
  perks: ['roadwise', 'merchant_road'],
  inventory: { iron_ore: 2, coal: 2, leather: 2, herb: 3 },
};

const tradeA = previewSettlementAction({ action: 'buy', input: { itemId: 'bread', quantity: 2 }, snapshot });
const tradeB = previewSettlementAction({ action: 'buy', input: { itemId: 'bread', quantity: 2 }, snapshot });
ok(tradeA.ok === true, 'trade-ready');
ok(JSON.stringify(tradeA) === JSON.stringify(tradeB), 'trade-deterministic');
ok(tradeA.requestMutation === false, 'trade-read-only');

const craft = previewSettlementAction({ action: 'craft', input: { recipeId: 'iron_sword' }, snapshot });
ok(craft.ok === true, 'craft-ready');
ok(craft.recipe?.id === 'iron_sword', 'craft-recipe');
ok(craft.craftCheck?.ok === true, 'craft-check');

const travel = previewSettlementAction({ action: 'travel', input: { routeId: 'north_gate' }, snapshot });
ok(travel.ok === true, 'travel-ready');
ok(travel.travel?.cost >= 0, 'travel-cost');

const insufficient = previewSettlementAction({ action: 'buy', input: { itemId: 'iron_sword', quantity: 99 }, snapshot });
ok(insufficient.ok === false && insufficient.reason === 'insufficient-copper', 'insufficient-copper');

const missing = previewSettlementAction({ action: 'craft', input: { recipeId: 'iron_sword' }, snapshot: { ...snapshot, inventory: { iron_ore: 1 } } });
ok(missing.ok === false, 'missing-materials');
ok(missing.requestMutation === false, 'missing-read-only');

const invalid = previewSettlementAction({ action: 'travel', input: { routeId: 'not-a-route' }, snapshot });
ok(invalid.ok === false && invalid.reason === 'unknown-route', 'invalid-route');

const before = JSON.stringify(snapshot);
previewSettlementPanel('trade', { snapshot, activeService: 'market' });
previewSettlementPanel('craft', { snapshot, activeService: 'blacksmith' });
previewSettlementPanel('travel', { snapshot, activeService: 'gate' });
ok(JSON.stringify(snapshot) === before, 'panel-read-only');

const badPanel = previewSettlementPanel('unknown', { snapshot });
ok(badPanel.ok === false && badPanel.reason === 'unknown-panel', 'invalid-panel');

if (failures.length) {
  console.error(`SETTLEMENT_ACTION_PREVIEW_FAIL ${failures.join(',')}`);
  process.exit(1);
}
console.log('SETTLEMENT_ACTION_PREVIEW_OK', JSON.stringify({
  trade: tradeA.quote?.total,
  craft: craft.recipe?.id,
  travel: travel.travel?.cost,
  checks: 13,
}));
