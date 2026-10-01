import assert from 'node:assert/strict';
import {
  createSettlementCheckpoint,
  restoreSettlementCheckpoint,
  serializeSettlementCheckpoint,
} from '../src/3d/gameplay/settlementRuntimeCheckpoint.js';

const source = createSettlementCheckpoint({
  settlementId: 'winterfell-harbor',
  sliceId: 'settlement-vertical-slice',
  nodeId: 'forge',
  visited: ['market', 'forge', 'market'],
  historyLength: 7,
  history: [
    { sequence: 5, action: 'trade', nodeId: 'market', result: 'ok', message: 'sold' },
    { sequence: 6, action: 'craft', nodeId: 'forge', result: 'ok', message: 'forged' },
  ],
  metadata: { panel: 'blacksmith', dirty: true, ignored: { nested: true } },
});

assert.equal(source.version, 1);
assert.deepEqual(source.visited, ['forge', 'market']);
assert.equal(source.metadata.ignored, undefined);
assert.equal(source.fingerprint, createSettlementCheckpoint(source).fingerprint);

const serialized = serializeSettlementCheckpoint(source);
const restored = restoreSettlementCheckpoint(serialized, {
  settlementId: 'winterfell-harbor',
  sliceId: 'settlement-vertical-slice',
});
assert.equal(restored.ok, true);
assert.deepEqual(restored.checkpoint, source);

assert.equal(restoreSettlementCheckpoint('{bad-json}').reason, 'invalid-json');
assert.equal(restoreSettlementCheckpoint({ version: 99 }).reason, 'unsupported-version');
assert.equal(restoreSettlementCheckpoint(serialized, { settlementId: 'other' }).reason, 'settlement-mismatch');
assert.equal(restoreSettlementCheckpoint(serialized, { sliceId: 'other' }).reason, 'slice-mismatch');

console.log('Settlement runtime checkpoint contract: PASS');
