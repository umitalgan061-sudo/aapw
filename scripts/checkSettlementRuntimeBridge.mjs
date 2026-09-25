import assert from 'node:assert/strict';
import { createSettlementRuntimeBridge, isSettlementRuntimeActionResult } from '../src/3d/gameplay/settlementRuntimeBridge.ts';

const events = [];
const eventTarget = { dispatchEvent(event) { events.push(event); } };
const calls = [];
const slice = {
  snapshot() { return { settlementId: 'umit', nodeId: 'gate', nodeKind: 'door', actions: ['enter'], visited: ['gate'] }; },
  execute(action) { calls.push(action); return { ok: action === 'enter', reason: action === 'enter' ? '' : 'action-unavailable', nodeId: 'interior' }; },
};

const bridge = createSettlementRuntimeBridge({ slice, eventTarget, context: { capabilities: { enter: true } } });
const result = bridge.dispatch('enter');
assert.equal(result.ok, true);
assert.equal(result.nodeId, 'interior');
assert.equal(calls[0], 'enter');
assert.equal(events[0].type, 'aapw:settlement-runtime-action-result');
assert.equal(isSettlementRuntimeActionResult(result), true);
assert.equal(Object.isFrozen(result.snapshot), true);

const blocked = bridge.dispatch('trade');
assert.equal(blocked.ok, false);
assert.equal(blocked.reason, 'action-unavailable');
assert.equal(events.length, 2);
assert.deepEqual(bridge.getContext(), { capabilities: { enter: true } });

console.log('settlement runtime bridge proof: 8 checks passed');
