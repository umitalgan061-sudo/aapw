import {
  createSettlementActionIntentBridge,
  serializeSettlementActionIntentBridge,
} from '../src/3d/gameplay/settlementActionIntentBridge.js';

const ok = (value, label) => { if (!value) throw new Error(`FAIL:${label}`); };
const equal = (a, b, label) => { if (a !== b) throw new Error(`FAIL:${label}:${a}!==${b}`); };

const input = [
  { action: 'trade', nodeId: 'market', nodeKind: 'market', capabilities: { trade: true }, priority: 4 },
  { action: 'travel', nodeId: 'gate', nodeKind: 'gate', capabilities: { travel: false }, priority: 8 },
  { action: 'smith', nodeId: 'blacksmith', nodeKind: 'blacksmith', capabilities: { craft: true }, priority: 2 },
  { action: 'wat', nodeId: 'market', nodeKind: 'market' },
];
const first = createSettlementActionIntentBridge(input);
const second = createSettlementActionIntentBridge(input);
equal(first.digest, second.digest, 'deterministic-digest');
equal(first.accepted[0].actionId, 'trade', 'priority-order');
equal(first.accepted[1].actionId, 'smith', 'priority-order-2');
equal(first.blocked[0].reason, 'missing-travel', 'capability-block');
equal(first.blocked[1].reason, 'unknown-action', 'unknown-action');
ok(Object.isFrozen(first) && Object.isFrozen(first.accepted[0]), 'deep-freeze');
equal(serializeSettlementActionIntentBridge(first), serializeSettlementActionIntentBridge(second), 'stable-serialization');
const malformed = createSettlementActionIntentBridge(null, { maxIntents: 0 });
equal(malformed.summary.inspected, 0, 'malformed-fallback');
console.log('settlement-action-intent: PASS');
