import {
  normalizeSettlementServiceOutcome,
  validateSettlementServiceOutcomeReceipt,
} from '../src/3d/gameplay/settlementServiceOutcomeReceipt.ts';

const source = {
  settlementId: 'winterhold',
  service: 'blacksmith',
  action: 'craft',
  outcome: 'completed',
  receiptKey: 'winterhold:blacksmith:craft:17',
  timestamp: 1700000000,
  copperDelta: -25,
  experienceDelta: 12,
  itemDeltas: [
    { itemId: 'iron-ingot', quantityDelta: -2 },
    { itemId: 'steel-sword', quantityDelta: 1 },
    { itemId: 'iron-ingot', quantityDelta: -1 },
  ],
  questIds: ['q-2', 'q-1', 'q-2'],
};
const first = normalizeSettlementServiceOutcome(source);
const second = normalizeSettlementServiceOutcome({ ...source, itemDeltas: [...source.itemDeltas].reverse(), questIds: [...source.questIds].reverse() });
if (first.signature !== second.signature) throw new Error('receipt signature is not deterministic');
if (first.itemDeltas[0].itemId !== 'iron-ingot' || first.itemDeltas[0].quantityDelta !== -2) throw new Error('item normalization failed');
if (first.questIds.join(',') !== 'q-1,q-2') throw new Error('quest normalization failed');
if (!Object.isFrozen(first) || !Object.isFrozen(first.itemDeltas) || !Object.isFrozen(first.questIds)) throw new Error('receipt is not deeply frozen');
if (!validateSettlementServiceOutcomeReceipt(first).ok) throw new Error('receipt validation failed');
const tampered = { ...first, copperDelta: 999 };
if (validateSettlementServiceOutcomeReceipt(tampered).ok) throw new Error('tampered receipt accepted');
const malformed = normalizeSettlementServiceOutcome({ service: 'unknown', action: 'teleport', outcome: 'mystery' });
if (malformed.service !== 'tavern' || malformed.action !== 'rest' || malformed.outcome !== 'failed') throw new Error('fail-closed defaults failed');
console.log(JSON.stringify({ ok: true, suite: 'settlement-service-outcome-receipt', signature: first.signature }));
