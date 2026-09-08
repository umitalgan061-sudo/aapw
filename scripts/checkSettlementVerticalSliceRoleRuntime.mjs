import {
  buildCanonicalSettlementInteractionDefinition,
  buildSettlementRoleNode,
  describeSettlementRole,
  getSettlementRoleDefaults,
  listSettlementRoles,
  roleSupportsAction,
  validateSettlementRoleDefinition,
} from '../src/3d/gameplay/settlementVerticalSliceRoles.js';
import {
  buildSettlementInteractionRail,
  createSettlementVerticalSlice,
  fingerprintSettlementContext,
  settlementNodeKindLabel,
} from '../src/3d/gameplay/settlementVerticalSlice.js';

const failures = [];
let passed = 0;
function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}
function same(a, b, message) {
  assert(JSON.stringify(a) === JSON.stringify(b), message);
}

const settlementId = 'existing-canonical-settlement';
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

const definition = buildCanonicalSettlementInteractionDefinition({
  settlementId,
  entryNodeId: 'settlement-entry',
  entryLabel: 'Kuzey Yerleşimi',
  roles: ['blacksmith', 'tavern', 'market', 'farm', 'barracks', 'stable', 'house', 'gate'],
  maxVisibleActions: 8,
  maxHistory: 20,
});

const context = {
  settlementId: 'caller-supplied-id-that-must-not-win',
  distance: 2,
  flags: { 'road-open': true, rested: true, signed: true, 'market-open': true },
  items: { 'market-token': 2, iron: 12, wood: 8, feed: 6 },
  reputation: { town: 15, smith: 10 },
  questProgress: { shipment: { state: 'active', step: 2, completed: false } },
  capabilities: {
    settlement: true,
    door: true,
    dialogue: true,
    trade: true,
    crafting: true,
    quest: true,
    travel: true,
    persistence: true,
  },
};

const validation = validateSettlementRoleDefinition(definition);
assert(validation.ok, 'canonical role definition validates');
assert(definition.nodes[0].id === 'settlement-entry', 'entry node is explicit');
assert(definition.nodes[0].kind === 'settlement', 'entry node is settlement kind');
assert(definition.settlementId === settlementId, 'definition uses canonical settlement identity');
assert(validation.roleCount === 8, 'all eight role blueprints are represented');
assert(definition.nodes.length === 9, 'entry plus eight service roles are represented');

const allRoles = listSettlementRoles();
assert(allRoles.length === 8, 'catalog exposes all eight role types');

const slice = createSettlementVerticalSlice({ definition, handlers });
assert(slice.currentNode().id === 'settlement-entry', 'runtime starts on settlement entry');
assert(slice.availableActions(context).includes('enter'), 'settlement entry exposes enter');
assert(slice.availableActions(context).includes('travel'), 'settlement entry exposes travel');
assert(slice.availableActions(context).includes('save'), 'settlement entry exposes save');

// Canonical settlement identity wins over caller spoofing.
calls.length = 0;
let result = slice.execute('enter', { doorId: 'north-gate' }, context);
assert(result.ok, 'entry handler succeeds');
assert(calls[0][1].settlementId === settlementId, 'handler receives definition settlement id');
assert(calls[0][1].doorId === 'north-gate', 'handler preserves door id');

// Every authored role can become a runtime node and retains its role contract.
for (const role of allRoles) {
  const defaults = getSettlementRoleDefaults(role);
  const node = buildSettlementRoleNode(role, { id: `${role}-runtime`, metadata: { runtimeProof: true } });
  assert(Boolean(defaults), `${role} defaults exist for runtime proof`);
  assert(node.id === `${role}-runtime`, `${role} runtime node keeps id`);
  assert(node.role === role, `${role} runtime node keeps role`);
  assert(node.metadata.runtimeProof === true, `${role} runtime metadata remains scalar`);
  assert(node.actions.length > 0, `${role} runtime node exposes actions`);
  assert(describeSettlementRole(role).kind === defaults.kind, `${role} description agrees with defaults`);
  assert(node.kind === defaults.kind, `${role} node kind agrees with defaults`);
}

function assertRoleRuntime(role, expectedActions, probe = {}) {
  const nodeId = `${role}-node`;
  result = slice.setNode(nodeId, context);
  assert(result.ok, `${role} node is reachable`);
  assert(slice.currentNode().role === role, `${role} node retains role identity`);
  const rail = buildSettlementInteractionRail(slice, context);
  assert(rail.ok, `${role} rail builds`);
  assert(rail.node.id === nodeId, `${role} rail retains node id`);
  assert(rail.node.kindLabel === settlementNodeKindLabel(slice.currentNode().kind), `${role} rail kind label is stable`);
  for (const action of expectedActions) {
    assert(rail.actions.some((item) => item.action === action), `${role} rail exposes ${action}`);
    assert(roleSupportsAction(role, action), `${role} role declares support for ${action}`);
  }
  const available = slice.availableActions(context);
  for (const action of expectedActions) assert(available.includes(action), `${role} availability includes ${action}`);
  if (!probe.action) return;
  calls.length = 0;
  const actionResult = slice.execute(probe.action, probe.payload || {}, context);
  assert(actionResult.ok, `${role} ${probe.action} execution succeeds`);
  assert(calls.length === 1, `${role} ${probe.action} delegates once`);
  assert(calls[0][1].settlementId === settlementId, `${role} ${probe.action} gets canonical settlement id`);
  if (probe.payload?.targetId) assert(calls[0][1].targetId === probe.payload.targetId, `${role} preserves target id`);
}

assertRoleRuntime('blacksmith', ['craft', 'trade', 'back'], { action: 'craft', payload: { recipeId: 'iron-knife' } });
assertRoleRuntime('tavern', ['talk', 'interact', 'back'], { action: 'talk', payload: { npcId: 'innkeeper' } });
assertRoleRuntime('market', ['trade', 'back'], { action: 'trade', payload: { offerId: 'salt', quantity: 2 } });
assertRoleRuntime('farm', ['interact', 'trade', 'travel', 'back'], { action: 'trade', payload: { offerId: 'grain', quantity: 3 } });
assertRoleRuntime('barracks', ['talk', 'interact', 'back'], { action: 'talk', payload: { npcId: 'captain' } });
assertRoleRuntime('stable', ['interact', 'travel', 'back'], { action: 'travel', payload: { destinationId: 'east-road' } });
assertRoleRuntime('house', ['interact', 'talk', 'save', 'back'], { action: 'save', payload: { slotId: 'home-1' } });
assertRoleRuntime('gate', ['enter', 'exit', 'travel', 'back'], { action: 'exit', payload: { gateId: 'north-gate' } });

// Role-specific capability failures stop execution before authoritative handler dispatch.
const capabilityCases = [
  ['blacksmith', 'craft', 'crafting'],
  ['tavern', 'talk', 'dialogue'],
  ['market', 'trade', 'trade'],
  ['farm', 'trade', 'trade'],
  ['barracks', 'talk', 'dialogue'],
  ['stable', 'travel', 'travel'],
  ['house', 'save', 'persistence'],
  ['gate', 'exit', 'door'],
];
for (const [role, action, capability] of capabilityCases) {
  slice.setNode(`${role}-node`, context);
  calls.length = 0;
  const denied = slice.execute(action, {}, { ...context, capabilities: { ...context.capabilities, [capability]: false } });
  assert(!denied.ok && denied.reason === 'action-unavailable', `${role} ${action} is denied without ${capability}`);
  assert(calls.length === 0, `${role} ${action} does not reach handler without ${capability}`);
}

// Gate failures are local to the role and do not poison the active location.
slice.setNode('market-node', context);
result = slice.setNode('market-node', { ...context, items: { 'market-token': 0 } });
assert(!result.ok && result.reason === 'item-required', 'market item gate blocks access');
assert(slice.currentNode().id === 'market-node', 'failed market transition keeps current node');

slice.setNode('tavern-node', context);
result = slice.setNode('tavern-node', { ...context, reputation: { town: 4 } });
assert(!result.ok && result.reason === 'reputation-too-low', 'tavern reputation gate blocks access');
assert(slice.currentNode().id === 'tavern-node', 'failed tavern transition keeps current node');

slice.setNode('gate-node', context);
result = slice.setNode('gate-node', { ...context, distance: 4.01 });
assert(!result.ok && result.reason === 'too-far', 'gate proximity gate blocks access');
assert(slice.currentNode().id === 'gate-node', 'failed gate transition keeps current node');

// Quest content can join the same coordinator; quest storage remains external.
const questNode = {
  id: 'quest-node',
  kind: 'quest',
  label: 'Kayıp Kervan',
  role: 'quest',
  actions: ['acceptQuest', 'advanceQuest', 'back'],
  gates: [
    { type: 'quest', questId: 'shipment', states: ['active'] },
    { type: 'flag', key: 'signed', expected: true },
  ],
};
const questFlowDefinition = {
  ...definition,
  nodes: [...definition.nodes, questNode],
};
const questSlice = createSettlementVerticalSlice({ definition: questFlowDefinition, handlers });
assert(questSlice.setNode('quest-node', context).ok, 'quest node can join settlement slice');
result = questSlice.execute('advanceQuest', { questId: 'shipment' }, context);
assert(result.ok, 'quest advance delegates through same settlement coordinator');
result = questSlice.setNode('quest-node', { ...context, flags: { ...context.flags, signed: false } });
assert(!result.ok && result.reason === 'flag-required', 'quest flag condition blocks advancement');
result = questSlice.setNode('quest-node', { ...context, questProgress: { shipment: { state: 'failed', completed: false } } });
assert(!result.ok && result.reason === 'quest-required', 'quest state condition blocks failed quest');

// Persistence round-trip from a service role preserves bounded state.
slice.setNode('house-node', context);
slice.execute('interact', { targetId: 'hearth' }, context);
slice.execute('save', { slotId: 'home-2' }, context);
const saved = slice.exportSnapshot(context);
assert(saved.version === 1, 'saved snapshot has explicit version');
assert(saved.settlementId === settlementId, 'saved snapshot uses canonical settlement identity');
assert(saved.history.length <= 20, 'saved history is bounded by definition');
assert(saved.currentNodeId === 'house-node', 'saved snapshot stores service role node');
const restored = createSettlementVerticalSlice({ definition, handlers });
result = restored.importSnapshot(saved, context);
assert(result.ok, 'service-role snapshot restores');
assert(restored.currentNode().id === 'house-node', 'service-role snapshot restores current role');
same(saved, restored.exportSnapshot(context), 'service-role snapshot round trip is deterministic');

// Capability loss while restoring a role recovers safely to the settlement entry.
result = restored.importSnapshot(saved, { ...context, capabilities: { ...context.capabilities, persistence: false } });
assert(!result.ok && result.recovered, 'gated saved role recovers');
assert(restored.currentNode().id === 'settlement-entry', 'gated saved role recovers to entry');

// Context fingerprints stay stable regardless of object key order.
const fpA = fingerprintSettlementContext({ flags: { a: true, b: false }, items: { iron: 2, wood: 3 }, reputation: { town: 8 } });
const fpB = fingerprintSettlementContext({ reputation: { town: 8 }, items: { wood: 3, iron: 2 }, flags: { b: false, a: true } });
assert(fpA === fpB, 'role runtime context fingerprint is deterministic');

// Failed transitions must not move an entry node when a gate rejects.
const isolated = createSettlementVerticalSlice({
  definition: buildCanonicalSettlementInteractionDefinition({ settlementId: 'gate-test', roles: ['market'], entryNodeId: 'entry' }),
  handlers,
});
assert(isolated.currentNode().id === 'entry', 'isolated test begins at entry');
const before = isolated.snapshot({ settlementId: 'gate-test' });
const failed = isolated.setNode('market-node', { settlementId: 'gate-test', items: { 'market-token': 0 }, capabilities: context.capabilities });
assert(!failed.ok, 'isolated market gate rejects missing token');
const after = isolated.snapshot({ settlementId: 'gate-test' });
assert(before.nodeId === after.nodeId, 'failed transition keeps active node stable');

if (failures.length) {
  console.error(`[settlement-role-runtime] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`[settlement-role-runtime] PASS: ${passed} settlement role runtime assertions.`);
