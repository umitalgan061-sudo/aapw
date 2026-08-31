import assert from 'node:assert/strict';
import { createInteractionEconomyState } from '../src/3d/gameplay/interactionEconomy.js';

const economy = createInteractionEconomyState(0);
const hostileSave = economy.snapshot();
hostileSave.copper = 2;
hostileSave.ledger.creditedSourceIds = [
  'expedition-contract:older-unique',
  ...Array.from({ length: 70 }, () => ' expedition-contract:watch '),
  '',
  null,
  ` ${'x'.repeat(100)} `,
];
hostileSave.ledger.recentCredits = [{
  sequence: 1,
  sourceId: 'expedition-contract:receipt-only',
  label: 'Receipt-only provenance',
  creditedCopper: 2,
  balanceCopper: 2,
}];

const restored = createInteractionEconomyState();
restored.restore(hostileSave);
const snapshot = restored.snapshot();
assert.deepEqual(snapshot.ledger.creditedSourceIds, [
  'expedition-contract:older-unique',
  'expedition-contract:watch',
  'x'.repeat(80),
  'expedition-contract:receipt-only',
]);
assert.equal(restored.credit(1, { sourceId: 'expedition-contract:older-unique' }).reason, 'duplicate-credit-source');
assert.equal(restored.credit(1, { sourceId: ' expedition-contract:watch ' }).reason, 'duplicate-credit-source');
assert.equal(restored.credit(1, { sourceId: `${'x'.repeat(100)}` }).reason, 'duplicate-credit-source');
assert.equal(restored.credit(2, { sourceId: 'expedition-contract:receipt-only' }).reason, 'duplicate-credit-source');
assert.deepEqual(restored.snapshot(), snapshot, 'duplicate-source rejection after hostile restore must be wallet/ledger atomic');

console.log('Interaction credit source ledger restore PASS');