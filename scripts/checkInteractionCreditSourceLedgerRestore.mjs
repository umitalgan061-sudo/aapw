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
for (let index = 0; index < 61; index += 1) assert.equal(restored.credit(1, { sourceId: `expedition-contract:filler-${index}` }).ok, true);
const boundedSources = restored.snapshot().ledger.creditedSourceIds;
assert.equal(boundedSources.length, 64, 'credit provenance ledger must remain bounded after restore');
assert.equal(boundedSources.includes('expedition-contract:older-unique'), false, 'oldest provenance should evict first at the hard limit');
assert.equal(boundedSources[0], 'expedition-contract:watch', 'bounded restore must evict exactly one oldest source, not over-evict');
assert.equal(boundedSources.at(-1), 'expedition-contract:filler-60');

console.log('Interaction credit source ledger restore PASS');