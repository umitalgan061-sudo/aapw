import { strict as assert } from 'node:assert';
import { createSettlementCampaignEventBridge, createSettlementCampaignRequest, SETTLEMENT_CAMPAIGN_EVENT_NAMES } from '../src/3d/gameplay/settlementCampaignEventBridge.js';

let checks = 0;
const equal = (a, b, m) => { assert.equal(a, b, m); checks += 1; };
const ok = (v, m) => { assert.ok(v, m); checks += 1; };
const listeners = new Map();
const emitted = [];
const bus = {
  on(name, handler) {
    const set = listeners.get(name) ?? new Set();
    set.add(handler); listeners.set(name, set);
    return () => set.delete(handler);
  },
  emit(name, payload) {
    emitted.push([name, payload]);
    for (const handler of listeners.get(name) ?? []) handler(payload);
  },
};
const calls = [];
const runtime = {
  open: (service, panel) => { calls.push(['open', service, panel]); return { activeService: { id: service }, panel }; },
  setPanel: panel => { calls.push(['panel', panel]); return { panel }; },
  execute: async (action, input) => { calls.push(['execute', action, input.requestId]); return { ok: true, action, requestId: input.requestId }; },
  close: () => { calls.push(['close']); return { activeService: null }; },
  save: async input => { calls.push(['save', input.requestId]); return { ok: true, action: 'save' }; },
  reset: () => { calls.push(['reset']); return { ok: true }; },
  getViewModel: () => ({ version: 1, contentVersion: 2 }),
  manifest: () => ({ digest: 'deadbeef' }),
  evaluateDialogue: conditions => ({ ok: true, checks: conditions }),
  getObjective: id => ({ id }),
  importState: state => ({ ok: true, state }),
  dispose: () => { calls.push(['dispose']); return { ok: true }; },
};
const bridge = createSettlementCampaignEventBridge({ bus, runtime, requestLimit: 8, now: () => 42 });

let result = await bridge.handle(createSettlementCampaignRequest('open', { requestId: '1', serviceId: 'blacksmith', panel: 'craft' }));
equal(result.ok, true, 'open-ok'); equal(result.requestId, '1', 'open-id'); ok(calls.some(call => call[0] === 'open'), 'open-handler');
result = await bridge.handle(createSettlementCampaignRequest('execute', { requestId: '2', action: 'craft', input: { recipeId: 'iron_sword' } }));
equal(result.ok, true, 'execute-ok'); ok(emitted.some(([name]) => name === SETTLEMENT_CAMPAIGN_EVENT_NAMES.response), 'response-event'); ok(emitted.some(([name]) => name === SETTLEMENT_CAMPAIGN_EVENT_NAMES.action), 'action-event');
result = await bridge.handle(createSettlementCampaignRequest('dialogue', { requestId: '3', input: { conditions: ['flag_01'] } }));
equal(result.ok, true, 'dialogue-ok');
result = await bridge.handle(createSettlementCampaignRequest('objective', { requestId: '4', input: { objectiveId: 'settlement-objective-01' } }));
equal(result.ok, true, 'objective-ok');
result = await bridge.handle(createSettlementCampaignRequest('manifest', { requestId: '5' }));
equal(result.data.digest, 'deadbeef', 'manifest-digest');
result = await bridge.handle(createSettlementCampaignRequest('save', { requestId: '6', input: { slot: 'test' } }));
equal(result.ok, true, 'save-ok');
result = await bridge.handle(createSettlementCampaignRequest('restore', { requestId: '7', input: { state: { version: 1, activeService: 'tavern' } } }));
equal(result.ok, true, 'restore-ok'); ok(emitted.some(([name]) => name === SETTLEMENT_CAMPAIGN_EVENT_NAMES.restored), 'restore-event');
result = await bridge.handle(createSettlementCampaignRequest('wat', { requestId: '8' }));
equal(result.ok, false, 'unknown-request-fails'); equal(result.code, 'unknown-request-type', 'unknown-request-code');
result = await bridge.handle(createSettlementCampaignRequest('execute', { requestId: '2', action: 'craft' }));
equal(result.ok, false, 'duplicate-fails'); equal(result.code, 'duplicate-request', 'duplicate-code');
result = await bridge.handle({ version: 2, requestId: '9', type: 'state' }); equal(result.ok, false, 'version-fails'); equal(result.code, 'unsupported-version', 'version-code');
result = await bridge.handle({ type: 'state' }); equal(result.ok, false, 'missing-id-fails'); equal(result.code, 'missing-request-id', 'missing-id-code');
bridge.dispose(); equal(bridge.isDisposed(), true, 'disposed'); result = await bridge.handle({ version: 1, requestId: '10', type: 'state' }); equal(result.code, 'disposed', 'disposed-request');
ok(calls.some(call => call[0] === 'dispose'), 'runtime-disposed');
console.log(`SETTLEMENT_CAMPAIGN_EVENT_BRIDGE_OK checks=${checks} emitted=${emitted.length} calls=${calls.length}`);
