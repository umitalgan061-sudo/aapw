import { createSettlementMarketTransactionReceipt, isSettlementMarketTransactionReceipt } from '../src/3d/gameplay/settlementMarketTransactionReceipt.ts';

const ok = (condition, label) => { if (!condition) throw new Error(`FAIL:${label}`); };
const equal = (actual, expected, label) => ok(actual === expected, `${label}:${actual}!==${expected}`);

const buy = createSettlementMarketTransactionReceipt({
  serviceId: 'market', action: 'buy', itemId: 'bread', quantity: 4, direction: 'buy', unitPrice: 3,
  copperBefore: 100, copperAfter: 88, stockBefore: 10, stockAfter: 6, inventoryBefore: 0, inventoryAfter: 4,
  requestId: 'r-buy', sequence: 1
});
equal(buy.ok, true, 'buy-ok');
equal(buy.total, 12, 'buy-total');
equal(buy.copperDelta, -12, 'buy-copper-delta');
equal(buy.stockDelta, -4, 'buy-stock-delta');
equal(buy.inventoryDelta, 4, 'buy-inventory-delta');
ok(Object.isFrozen(buy), 'buy-frozen');
ok(isSettlementMarketTransactionReceipt(buy), 'buy-guard');

const sell = createSettlementMarketTransactionReceipt({
  serviceId: 'market', action: 'sell', itemId: 'bread', quantity: 2, direction: 'sell', unitPrice: 1,
  copperBefore: 10, copperAfter: 12, stockBefore: 2, stockAfter: 4, inventoryBefore: 4, inventoryAfter: 2,
  requestId: 'r-sell', sequence: 2
});
equal(sell.ok, true, 'sell-ok');
equal(sell.total, 2, 'sell-total');
equal(sell.copperDelta, 2, 'sell-copper-delta');

const reordered = createSettlementMarketTransactionReceipt({
  sequence: 2, requestId: 'r-sell', inventoryAfter: 2, inventoryBefore: 4, stockAfter: 4, stockBefore: 2,
  copperAfter: 12, copperBefore: 10, unitPrice: 1, direction: 'sell', quantity: 2, itemId: 'bread', action: 'sell', serviceId: 'market'
});
equal(reordered.signature, sell.signature, 'deterministic-signature');

equal(createSettlementMarketTransactionReceipt({ ...buy, copperAfter: 100 }).reason, 'invalid-ledger', 'ledger-gate');
equal(createSettlementMarketTransactionReceipt({ ...buy, direction: 'barter' }).reason, 'invalid-direction', 'direction-gate');
equal(createSettlementMarketTransactionReceipt({ ...buy, quantity: 0 }).reason, 'invalid-quantity', 'quantity-gate');
equal(createSettlementMarketTransactionReceipt({ ...buy, serviceId: 'tavern' }).reason, 'unsupported-service', 'service-gate');

const input = { serviceId: 'market', action: 'buy', itemId: 'bread', quantity: 1, direction: 'buy', unitPrice: 2, copperBefore: 5, copperAfter: 3, stockBefore: 1, stockAfter: 0, inventoryBefore: 0, inventoryAfter: 1 };
const before = JSON.stringify(input);
createSettlementMarketTransactionReceipt(input);
equal(JSON.stringify(input), before, 'caller-input-stable');

console.log('PASS settlement market transaction receipt');
