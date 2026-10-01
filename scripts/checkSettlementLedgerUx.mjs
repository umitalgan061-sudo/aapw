import assert from 'node:assert/strict';
import { createSettlementLedgerUx } from '../src/3d/gameplay/settlementLedgerUx.js';

const ux = createSettlementLedgerUx({ rowLimit: 2 });
const snapshot = {
	transactionCount: 3,
	lifetimeSpentCopper: 27,
	recentTransactions: [
		{ sequence: 1, offerId: 'ration', itemId: 'field-ration', quantity: 1, spentCopper: 5, balanceCopper: 35 },
		{ sequence: 2, offerId: 'whetstone', itemId: 'whetstone', quantity: 1, spentCopper: 12, balanceCopper: 28 },
		{ sequence: 3, offerId: 'kit', itemId: 'maintenance-kit', quantity: 1, spentCopper: 10, balanceCopper: 18 },
	],
};

const view = ux.present(snapshot);
assert.equal(view.transactionCount, 3);
assert.equal(view.lifetimeSpentCopper, 27);
assert.equal(view.rows.length, 2);
assert.equal(view.rows[0].sequence, 2);
assert.match(view.rows[1].label, /maintenance-kit/);
assert.equal(view.empty, false);
assert.equal(view.statusText, '2 son işlem · 27 bakır harcandı');

const malformed = ux.present({ recentTransactions: [null, {}, { sequence: 0, offerId: 'x', itemId: 'y' }] });
assert.equal(malformed.empty, false);
assert.equal(malformed.rows.length, 1);
assert.equal(malformed.rows[0].sequence, 1);

const empty = ux.present({});
assert.equal(empty.empty, true);
assert.equal(empty.rows.length, 0);
assert.equal(empty.statusText, 'Henüz işlem yok');

assert.deepEqual(ux.present(snapshot), ux.present(snapshot), 'same ledger snapshot must render deterministically');
console.log('PASS checkSettlementLedgerUx: bounded deterministic ledger rows and empty-state presentation verified.');
