import { EventBus } from '../src/3d/eventBus.js';
import {
  SETTLEMENT_SLICE_EVENTS,
  buildSettlementSliceActionEvent,
  buildSettlementSliceStateEvent,
  createSettlementVerticalSliceEventBridge,
  normalizeSettlementSliceActionRequest,
  settlementSliceEventActionIsSupported,
  settlementSliceEventNames,
  validateSettlementSliceEventPayload,
} from '../src/3d/gameplay/settlementVerticalSliceEvents.js';
import { createSettlementVerticalSlice } from '../src/3d/gameplay/settlementVerticalSlice.js';

const failures = [];
let passed = 0;
function assert(condition, message) { if (condition) passed += 1; else failures.push(message); }
function same(a, b, message) { assert(JSON.stringify(a) === JSON.stringify(b), message); }

const calls = [];
const handlers = {
  enterSettlement: (payload) => { calls.push(['enter', payload]); return { ok: true, message: 'entered' }; },
  exitSettlement: (payload) => { calls.push(['exit', payload]); return { ok: true, message: 'exited' }; },
  interact: (payload) => { calls.push(['interact', payload]); return { ok: true, message: 'interacted' }; },
  talk: (payload) => { calls.push(['talk', payload]); return { ok: true, message: 'talked' }; },
  trade: (payload) => { calls.push(['trade', payload]); return { ok: true, message: 'traded' }; },
  craft: (payload) => { calls.push(['craft', payload]); return { ok: true, message: 'crafted' }; },
  acceptQuest: (payload) => { calls.push(['acceptQuest', payload]); return { ok: true, message: 'accepted' }; },
  advanceQuest: (payload) => { calls.push(['advanceQuest', payload]); return { ok: true, message: 'advanced' }; },
  travel: (payload) => { calls.push(['travel', payload]); return { ok: true, message: 'traveled' }; },
  save: (payload) => { calls.push(['save', payload]); return { ok: true, message: 'saved' }; },
};
const definition = {
  id: 'event-slice', settlementId: 'event-settlement', entryNodeId: 'entry',
  nodes: [
    { id: 'entry', kind: 'settlement', actions: ['enter', 'travel', 'save'] },
    { id: 'market', kind: 'vendor', actions: ['trade', 'back'] },
    { id: 'forge', kind: 'crafting', actions: ['craft', 'back'] },
    { id: 'door', kind: 'door', actions: ['exit', 'back'], gates: [{ type: 'proximity', distance: 4 }] },
  ],
};
const context = {
  settlementId: 'caller-id', distance: 2, flags: {}, items: {}, reputation: {}, questProgress: {},
  capabilities: { settlement: true, door: true, dialogue: true, trade: true, crafting: true, quest: true, travel: true, persistence: true },
};

const slice = createSettlementVerticalSlice({ definition, handlers });
const bus = new EventBus();
const received = { opened: [], state: [], result: [], nodeResult: [], saveResult: [], restoreResult: [], resetResult: [], closed: [] };
for (const [key, eventName] of Object.entries({
  opened: SETTLEMENT_SLICE_EVENTS.OPENED,
  state: SETTLEMENT_SLICE_EVENTS.STATE,
  result: SETTLEMENT_SLICE_EVENTS.RESULT,
  nodeResult: SETTLEMENT_SLICE_EVENTS.NODE_RESULT,
  saveResult: SETTLEMENT_SLICE_EVENTS.SAVE_RESULT,
  restoreResult: SETTLEMENT_SLICE_EVENTS.RESTORE_RESULT,
  resetResult: SETTLEMENT_SLICE_EVENTS.RESET_RESULT,
  closed: SETTLEMENT_SLICE_EVENTS.CLOSED,
})) bus.on(eventName, (payload) => received[key].push(payload));
const bridge = createSettlementVerticalSliceEventBridge({ bus, slice, getContext: () => context });

assert(!bridge.isClosed(), 'bridge starts open');
assert(bridge.version === 1, 'bridge version is explicit');
assert(settlementSliceEventNames().length === 15, 'request and response events are distinct');
assert(settlementSliceEventActionIsSupported('trade'), 'trade is supported');
assert(!settlementSliceEventActionIsSupported('teleport'), 'unknown action is rejected');

bus.emit(SETTLEMENT_SLICE_EVENTS.OPEN, { requestId: 'open-1', openedAt: 12, context });
assert(received.opened.length === 1, 'open response emitted once');
assert(received.opened[0].settlementId === 'event-settlement', 'open response uses canonical settlement');
assert(received.state.length === 1 && received.state[0].reason === 'open', 'open emits state once');

bus.emit(SETTLEMENT_SLICE_EVENTS.NODE, { requestId: 'node-market', nodeId: 'market', context });
assert(received.nodeResult.length === 1 && received.nodeResult[0].ok === true, 'node response succeeds once');
assert(received.nodeResult[0].nodeId === 'market', 'node response identifies market');
assert(slice.currentNode().id === 'market', 'market becomes active');

calls.length = 0;
bus.emit(SETTLEMENT_SLICE_EVENTS.ACTION, { requestId: 'trade-1', action: 'trade', payload: { offerId: 'grain', quantity: 2 }, context, expectedNodeId: 'market' });
assert(calls.length === 1 && calls[0][0] === 'trade', 'trade delegates once');
assert(calls[0][1].settlementId === 'event-settlement', 'trade receives canonical settlement');
assert(received.result[0].ok === true && received.result[0].requestId === 'trade-1', 'trade result correlates request');

calls.length = 0;
bus.emit(SETTLEMENT_SLICE_EVENTS.ACTION, { requestId: 'stale', action: 'trade', context, expectedNodeId: 'forge' });
assert(calls.length === 0, 'stale action is not dispatched');
assert(received.result[1].reason === 'stale-node', 'stale action has stale-node reason');
bus.emit(SETTLEMENT_SLICE_EVENTS.ACTION, { requestId: 'bad', action: 'teleport', context });
assert(received.result[2].reason === 'unsupported-action', 'unsupported action is rejected');

bus.emit(SETTLEMENT_SLICE_EVENTS.NODE, { requestId: 'missing-node', context });
assert(received.nodeResult[1].ok === false && received.nodeResult[1].reason === 'missing-node-id', 'missing node is rejected');
assert(slice.currentNode().id === 'market', 'missing node leaves current node unchanged');

bus.emit(SETTLEMENT_SLICE_EVENTS.SAVE, { requestId: 'save-1', context });
assert(received.saveResult.length === 1 && received.saveResult[0].ok === true, 'save response succeeds');
assert(received.saveResult[0].nodeId === 'market', 'save response has market node');
assert(received.saveResult[0].historyLength >= 0, 'save response exposes history length');
const saved = slice.exportSnapshot(context);

bus.emit(SETTLEMENT_SLICE_EVENTS.NODE, { requestId: 'node-forge', nodeId: 'forge', context });
assert(slice.currentNode().id === 'forge', 'forge becomes active');
bus.emit(SETTLEMENT_SLICE_EVENTS.RESTORE, { requestId: 'restore-1', snapshot: saved, context });
assert(received.restoreResult.length === 1 && received.restoreResult[0].ok === true, 'restore response succeeds');
assert(received.restoreResult[0].nodeId === 'market', 'restore response identifies saved node');
assert(slice.currentNode().id === 'market', 'restore returns to saved node');
bus.emit(SETTLEMENT_SLICE_EVENTS.RESTORE, { requestId: 'restore-bad', snapshot: null, context });
assert(received.restoreResult[1].ok === false, 'malformed restore is rejected');
assert(slice.currentNode().id === 'market', 'malformed restore preserves state');

bus.emit(SETTLEMENT_SLICE_EVENTS.RESET, { requestId: 'reset-1', context });
assert(received.resetResult.length === 1 && received.resetResult[0].ok === true, 'reset response succeeds');
assert(slice.currentNode().id === 'entry', 'reset returns to entry');
assert(received.state.some((entry) => entry.reason === 'reset'), 'reset emits state');

bus.emit(SETTLEMENT_SLICE_EVENTS.CLOSE, { requestId: 'close-1', reason: 'leaving-settlement' });
assert(received.closed.length === 1, 'close response emitted once');
assert(received.closed[0].reason === 'leaving-settlement', 'close reason preserved');
assert(bridge.isClosed(), 'bridge is closed');
assert(bridge.close().alreadyClosed === true, 'close is idempotent');
const resultCount = received.result.length;
bus.emit(SETTLEMENT_SLICE_EVENTS.ACTION, { requestId: 'after-close', action: 'trade', context });
assert(received.result.length === resultCount, 'closed bridge ignores future request');

const normalizedA = normalizeSettlementSliceActionRequest({ action: 'trade', requestId: 'r', payload: { quantity: 2, offerId: 'ore' }, context });
const normalizedB = normalizeSettlementSliceActionRequest({ context, payload: { offerId: 'ore', quantity: 2 }, requestId: 'r', action: 'trade' });
same(normalizedA, normalizedB, 'action normalization is deterministic');
assert(validateSettlementSliceEventPayload({ action: 'trade' }, SETTLEMENT_SLICE_EVENTS.ACTION).ok, 'valid action payload passes');
assert(!validateSettlementSliceEventPayload({ action: 'teleport' }, SETTLEMENT_SLICE_EVENTS.ACTION).ok, 'unsupported action payload fails');
assert(!validateSettlementSliceEventPayload({}, SETTLEMENT_SLICE_EVENTS.NODE).ok, 'node validation requires id');
assert(!validateSettlementSliceEventPayload({}, SETTLEMENT_SLICE_EVENTS.RESTORE).ok, 'restore validation requires snapshot');
const stateEvent = buildSettlementSliceStateEvent({ sliceId: 'x', settlementId: 's', nodeId: 'n', nodeKind: 'vendor', actions: ['trade'], fingerprint: 'abcd' }, 'test');
assert(stateEvent.version === 1 && stateEvent.actions === 'trade', 'state helper is versioned and bounded');
const actionEvent = buildSettlementSliceActionEvent('trade', { ok: false, reason: 'denied', nodeId: 'market' }, 'request-9');
assert(actionEvent.requestId === 'request-9' && actionEvent.reason === 'denied', 'action helper preserves failure');

const fragileSlice = createSettlementVerticalSlice({ definition, handlers });
const fragileBus = new EventBus();
let fragileStates = 0;
fragileBus.on(SETTLEMENT_SLICE_EVENTS.STATE, () => { fragileStates += 1; });
const fragileBridge = createSettlementVerticalSliceEventBridge({ bus: fragileBus, slice: fragileSlice, getContext: () => { throw new Error('context unavailable'); } });
fragileBus.emit(SETTLEMENT_SLICE_EVENTS.OPEN, { openedAt: Number.NaN });
assert(fragileStates === 1, 'context provider failure stays inside EventBus boundary');
fragileBridge.close();

if (failures.length) {
  console.error(`[settlement-vertical-slice-events] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`[settlement-vertical-slice-events] PASS: ${passed} shared EventBus runtime assertions.`);
