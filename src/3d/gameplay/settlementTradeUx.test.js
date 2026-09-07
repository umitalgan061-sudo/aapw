import assert from 'node:assert/strict';
import { buildSettlementSellQuotes, buildSettlementTradeActionIntent, buildSettlementTradePanel } from './settlementTradeUx.js';

const offers = [
  { id: 'ration', itemId: 'field-ration', label: 'Saha azığı', priceCopper: 6, stockLimit: 4 },
  { id: 'stone', itemId: 'whetstone', label: 'Bileği taşı', priceCopper: 12, stockLimit: 2 },
];
const panel = buildSettlementTradePanel({
  economySnapshot: { copper: 10, stockByOffer: { ration: 2, stone: 0 } },
  inventorySnapshot: { items: [{ itemId: 'field-ration', name: 'Saha azığı', quantity: 2 }, { itemId: 'whetstone', name: 'Bileği taşı', quantity: 1 }] },
  offers,
  service: { serviceId: 'dragonstone-market' },
});
const repeatedPanel = buildSettlementTradePanel({
  economySnapshot: { copper: 10, stockByOffer: { ration: 2, stone: 0 } },
  inventorySnapshot: { items: [{ itemId: 'field-ration', name: 'Saha azığı', quantity: 2 }, { itemId: 'whetstone', name: 'Bileği taşı', quantity: 1 }] },
  offers,
  service: { serviceId: 'dragonstone-market' },
});
assert.equal(panel.snapshotFingerprint, repeatedPanel.snapshotFingerprint);
assert.equal(panel.primaryAction, 'buy');
assert.equal(panel.buyQuotes.find((quote) => quote.offerId === 'ration').available, true);
assert.equal(panel.buyQuotes.find((quote) => quote.offerId === 'stone').reason, 'out-of-stock');
assert.equal(panel.sellQuotes.find((quote) => quote.itemId === 'field-ration').totalSellCopper, 6);
const buyIntent = buildSettlementTradeActionIntent(panel, { action: 'buy', offerId: 'ration', expectedFingerprint: panel.snapshotFingerprint });
assert.equal(buyIntent.ok, true);
assert.equal(buyIntent.expectedCopper, 6);
assert.equal(buildSettlementTradeActionIntent(panel, { action: 'sell', itemId: 'whetstone', quantity: 1 }).expectedCopper, 6);
assert.equal(buildSettlementTradeActionIntent(panel, { action: 'sell', itemId: 'whetstone', quantity: 2 }).ok, false);
assert.equal(buildSettlementTradeActionIntent(panel, { action: 'scrap', itemId: 'whetstone' }).reason, 'unsupported-action');
assert.equal(buildSettlementTradeActionIntent(panel, { action: 'buy', offerId: 'ration', expectedFingerprint: 'stale' }).reason, 'stale-trade-snapshot');
assert.equal(buildSettlementSellQuotes({ items: [] }, offers).length, 0);
console.log(JSON.stringify({ ok: true, serviceId: panel.serviceId, primaryAction: panel.primaryAction, snapshotFingerprint: panel.snapshotFingerprint }));
