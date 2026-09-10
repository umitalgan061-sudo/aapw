import { strict as assert } from 'node:assert';
import { createSettlementCampaignRuntime } from '../src/3d/gameplay/settlementCampaignRuntime.js';

let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };

const graph = [
  { id: 'settlement', kind: 'settlement', label: 'Kuzey Yerleşimi', actions: ['enter'], capabilities: { door: true } },
  { id: 'tavern', kind: 'npc', label: 'Han Sahibi', actions: ['talk', 'rest'], capabilities: { dialogue: true } },
];
const state = {
  version: 1,
  copper: 20,
  fatigue: 0,
  health: 100,
  maxHealth: 100,
  locationId: 'settlement',
  settlementId: 'north-settlement',
  inventory: {},
  equipment: {},
  quests: {},
  skills: {},
  perks: [],
  flags: {},
};
const events = [];
const runtime = createSettlementCampaignRuntime({
  definition: { id: 'disposal-probe', settlementId: 'north-settlement', entryNodeId: 'settlement', nodes: graph },
  readState: () => state,
  handlers: {
    enterSettlement: async payload => ({ ok: true, action: payload.action, nodeId: payload.node.id }),
    talk: async payload => ({ ok: true, action: 'talk', nodeId: payload.node.id }),
  },
  now: () => 100 + events.length,
  onEvent: event => events.push(event),
});

equal(runtime.isDisposed(), false, 'runtime-starts-active');
const before = runtime.manifest();
ok(before && typeof before.digest === 'string' && before.digest.length > 0, 'manifest-before-dispose');
const opened = runtime.open('tavern', 'talk');
equal(opened.activeService.id, 'tavern', 'open-before-dispose');
const action = await runtime.execute('talk', { requestId: 'dispose-talk-1' });
equal(action.ok, true, 'action-before-dispose');

runtime.dispose();
equal(runtime.isDisposed(), true, 'runtime-disposed');
const disposedExecute = await runtime.execute('talk', { requestId: 'dispose-talk-2' });
equal(disposedExecute.ok, false, 'disposed-execute-fails-closed');
equal(disposedExecute.code, 'disposed', 'disposed-execute-code');
const disposedView = runtime.getViewModel();
equal(disposedView.activeService, null, 'disposed-view-clears-service');
equal(disposedView.route.length, 0, 'disposed-view-clears-route');
const disposedManifest = runtime.manifest();
ok(disposedManifest && typeof disposedManifest.digest === 'string', 'disposed-manifest-remains-readable');
equal(disposedManifest.digest, before.digest, 'disposed-manifest-stays-stable');

action.then(() => {});
for (const event of events) {
  ok(event && typeof event.name === 'string', 'event-name');
  ok(Number.isFinite(event.at), 'event-time');
  ok(Number.isInteger(event.revision), 'event-revision');
}
console.log(`SETTLEMENT_CAMPAIGN_RUNTIME_DISPOSAL_OK checks=${checks} events=${events.length} digest=${before.digest}`);
