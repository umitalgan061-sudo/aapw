import assert from 'node:assert/strict';
import { createSettlementInteractionTelemetry } from '../src/3d/gameplay/settlementInteractionTelemetry.js';

const source = { build: () => ({ version: 4, revision: 7, settlementId: 'north-hamlet', nodeId: 'blacksmith', service: { id: 'blacksmith' }, history: [
  { sequence: 1, action: 'enter', nodeId: 'door', result: 'ok' },
  { sequence: 2, action: 'craft', nodeId: 'smithing', result: 'blocked', reason: 'missing-materials' },
  { sequence: 3, action: 'trade', nodeId: 'vendor', result: 'ok' },
] }) };
const telemetry = createSettlementInteractionTelemetry(source);
const first = telemetry.build();
const second = telemetry.build();
assert.deepEqual(first, second);
assert.equal(first.counts.total, 3);
assert.equal(first.counts.ok, 2);
assert.equal(first.counts.blocked, 1);
assert.equal(first.counts.byAction.craft, 1);
assert.equal(first.lastEvent.action, 'trade');
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.events), true);
assert.equal(Object.isFrozen(first.events[0]), true);
assert.equal(telemetry.serialize(), JSON.stringify(first));
const malformed = createSettlementInteractionTelemetry({ build: () => ({ version: 'x', history: [{ action: null, sequence: 'bad' }] }) }).build();
assert.equal(malformed.sourceVersion, 0);
assert.equal(malformed.events[0].action, 'interact');
assert.equal(malformed.events[0].sequence, 1);
console.log('Settlement interaction telemetry checks passed.');
