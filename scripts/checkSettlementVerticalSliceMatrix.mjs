import {
  createSettlementVerticalSlice,
  evaluateSettlementGate,
  evaluateSettlementGates,
  fingerprintSettlementContext,
  normalizeSettlementContext,
  summarizeSettlementSlice,
  validateSettlementSliceDefinition,
  buildSettlementInteractionRail,
  describeSettlementAction,
} from '../src/3d/gameplay/settlementVerticalSlice.js';

const failures = [];
let passed = 0;

function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}

function same(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function baseContext(overrides = {}) {
  return {
    flags: { open: true, signed: true, road: true, ...(overrides.flags || {}) },
    items: { key: 2, iron: 8, cloth: 4, ...(overrides.items || {}) },
    reputation: { town: 20, forge: 12, ...(overrides.reputation || {}) },
    questProgress: {
      caravan: { state: 'active', step: 2, completed: false, rewardClaimed: false },
      finished: { state: 'done', step: 4, completed: true, rewardClaimed: true },
      ...(overrides.questProgress || {}),
    },
    capabilities: {
      settlement: true,
      door: true,
      dialogue: true,
      trade: true,
      crafting: true,
      quest: true,
      travel: true,
      persistence: true,
      ...(overrides.capabilities || {}),
    },
    distance: overrides.distance ?? 2,
    locationId: overrides.locationId || 'market-square',
    settlementId: overrides.settlementId || 'whiteharbor-market',
  };
}

const handlers = {
  enterSettlement: () => ({ ok: true, message: 'entered' }),
  exitSettlement: () => ({ ok: true, message: 'exited' }),
  interact: () => ({ ok: true, message: 'interacted' }),
  talk: () => ({ ok: true, message: 'talked' }),
  trade: () => ({ ok: true, message: 'traded' }),
  craft: () => ({ ok: true, message: 'crafted' }),
  acceptQuest: () => ({ ok: true, message: 'accepted' }),
  advanceQuest: () => ({ ok: true, message: 'advanced' }),
  travel: () => ({ ok: true, message: 'traveled' }),
  save: () => ({ ok: true, message: 'saved' }),
};

const definition = {
  id: 'whiteharbor-market',
  settlementId: 'whiteharbor-market',
  entryNodeId: 'square',
  nodes: [
    { id: 'square', kind: 'settlement', label: 'Market Square', actions: ['enter', 'interact', 'travel', 'save'] },
    { id: 'hall', kind: 'interior', label: 'Market Hall', actions: ['exit', 'talk', 'trade', 'back'] },
    { id: 'forge', kind: 'crafting', label: 'Forge', actions: ['craft', 'back'] },
    { id: 'broker', kind: 'vendor', label: 'Market Broker', actions: ['trade', 'back'], gates: [{ type: 'item', itemId: 'key', quantity: 1 }] },
    { id: 'chronicler', kind: 'npc', label: 'Chronicler', actions: ['talk', 'acceptQuest'], gates: [{ type: 'reputation', factionId: 'town', minimum: 10 }] },
    { id: 'quest', kind: 'quest', label: 'Missing Caravan', actions: ['advanceQuest'], gates: [{ type: 'quest', questId: 'caravan', states: ['active'] }, { type: 'flag', key: 'signed', expected: true }] },
    { id: 'road', kind: 'travel', label: 'Caravan Road', actions: ['travel'], gates: [{ type: 'flag', key: 'road', expected: true }] },
    { id: 'gate', kind: 'door', label: 'West Gate', actions: ['exit'], gates: [{ type: 'proximity', distance: 5 }] },
    { id: 'save', kind: 'save', label: 'Save Desk', actions: ['save'], gates: [{ type: 'capability', capability: 'persistence' }] },
  ],
};

// Flag matrix.
for (const expected of [true, false]) {
  for (const actual of [true, false, 0, 1, '', 'yes']) {
    const result = evaluateSettlementGate(
      { type: 'flag', key: 'open', expected },
      baseContext({ flags: { open: actual } }),
    );
    const matches = Boolean(actual) === expected;
    assert(result.ok === matches, `flag matrix expected=${expected} actual=${String(actual)}`);
  }
}

// Item quantity matrix: boundaries, missing item and finite normalization.
for (const required of [1, 2, 5, 9999]) {
  for (const owned of [0, 1, 2, 4, 5, 9999, Infinity, Number.NaN, -5]) {
    const result = evaluateSettlementGate(
      { type: 'item', itemId: 'iron', quantity: required },
      baseContext({ items: { iron: owned } }),
    );
    const normalized = Number.isFinite(owned) && owned > 0 ? Math.min(9999, Math.trunc(owned)) : 0;
    assert(result.ok === (normalized >= required), `item matrix required=${required} owned=${String(owned)}`);
  }
}

// Reputation matrix.
for (const minimum of [-10, 0, 5, 10, 20, 9999]) {
  for (const actual of [-20, -10, 0, 4, 5, 10, 20, 9999, Infinity]) {
    const result = evaluateSettlementGate(
      { type: 'reputation', factionId: 'town', minimum },
      baseContext({ reputation: { town: actual } }),
    );
    const normalized = Number.isFinite(actual) ? Math.min(9999, Math.max(-9999, actual)) : 0;
    assert(result.ok === (normalized >= minimum), `reputation matrix minimum=${minimum} actual=${String(actual)}`);
  }
}

// Quest state matrix.
for (const state of ['active', 'inactive', 'done', 'failed', 'unknown']) {
  for (const completed of [false, true]) {
    const result = evaluateSettlementGate(
      { type: 'quest', questId: 'caravan', states: ['active'] },
      baseContext({ questProgress: { caravan: { state, completed } } }),
    );
    assert(result.ok === (state === 'active'), `quest active matrix state=${state} completed=${completed}`);
  }
}
assert(evaluateSettlementGate(
  { type: 'quest', questId: 'finished', states: ['completed'] },
  baseContext(),
).ok, 'completed quest fallback accepts completed=true');
assert(!evaluateSettlementGate(
  { type: 'quest', questId: 'missing', states: ['completed'] },
  baseContext(),
).ok, 'missing quest progress rejects');

// Capability matrix: only explicit false disables an injected capability; missing/falsy legacy values
// stay enabled so existing callers that omit optional capability maps remain backward-compatible.
const capabilityGroups = [
  ['door', ['enter', 'exit']],
  ['settlement', ['enter', 'exit']],
  ['dialogue', ['talk', 'interact']],
  ['trade', ['trade']],
  ['crafting', ['craft']],
  ['quest', ['acceptQuest', 'advanceQuest']],
  ['travel', ['travel']],
  ['persistence', ['save']],
];
for (const [capability, actions] of capabilityGroups) {
  const actionSet = new Set(actions);
  const disabledSlice = createSettlementVerticalSlice({
    definition: { id: `cap-${capability}`, settlementId: `cap-${capability}`, entryNodeId: 'node', nodes: [{ id: 'node', kind: 'settlement', actions: [...new Set([...actions, 'back'])] }] },
    handlers,
  });
  const available = disabledSlice.availableActions(baseContext({
    settlementId: `cap-${capability}`,
    capabilities: { [capability]: false },
  }));
  for (const action of actionSet) assert(!available.includes(action), `capability=${capability} explicit false hides ${action}`);

  for (const value of [undefined, null, 0, '', 'false', true, 1, 'yes']) {
    const legacySlice = createSettlementVerticalSlice({
      definition: { id: `legacy-${capability}-${String(value)}`, settlementId: `legacy-${capability}`, entryNodeId: 'node', nodes: [{ id: 'node', kind: 'settlement', actions: [...new Set([...actions, 'back'])] }] },
      handlers,
    });
    const legacyContext = baseContext({ settlementId: `legacy-${capability}` });
    const capabilitiesOverride = { [capability]: value };
    if (value === undefined) {
      delete capabilitiesOverride[capability];
    }
    const legacyAvailable = legacySlice.availableActions({ ...legacyContext, capabilities: { ...legacyContext.capabilities, ...capabilitiesOverride } });
    for (const action of actionSet) assert(legacyAvailable.includes(action), `capability=${capability} legacy value=${String(value)} remains available`);
  }
}

// Capability gates use the same explicit-false contract and never leak truthy coercion surprises.
for (const value of [false, undefined, null, 0, '', 'yes']) {
  const result = evaluateSettlementGate(
    { type: 'capability', capability: 'trade' },
    baseContext({ capabilities: { trade: value } }),
  );
  assert(result.ok === (value !== false), `capability gate explicit-false contract value=${String(value)}`);
}

// Every supported action delegates with the canonical handler identity.
for (const [action, handlerName] of Object.entries({
  enter: 'enterSettlement',
  exit: 'exitSettlement',
  interact: 'interact',
  talk: 'talk',
  trade: 'trade',
  craft: 'craft',
  acceptQuest: 'acceptQuest',
  advanceQuest: 'advanceQuest',
  travel: 'travel',
  save: 'save',
})) {
  const calls = [];
  const actionHandlers = { ...handlers, [handlerName]: (payload) => { calls.push(payload); return { ok: true }; } };
  const slice = createSettlementVerticalSlice({
    definition: { id: `action-${action}`, settlementId: `action-${action}`, entryNodeId: 'node', nodes: [{ id: 'node', kind: 'settlement', actions: [action] }] },
    handlers: actionHandlers,
  });
  const result = slice.execute(action, { targetId: `${action}-target` }, baseContext({ settlementId: `action-${action}` }));
  assert(result.ok, `${action} action succeeds`);
  assert(calls.length === 1, `${action} invokes its handler once`);
  assert(calls[0].settlementId === `action-${action}`, `${action} handler receives authoritative settlement id`);
  assert(calls[0].nodeId === 'node', `${action} handler receives current node id`);
  assert(calls[0].targetId === `${action}-target`, `${action} preserves target payload`);
}

// Action description semantics.
for (const [action, kind] of [
  ['enter', 'movement'],
  ['exit', 'movement'],
  ['interact', 'dialogue'],
  ['talk', 'dialogue'],
  ['trade', 'trade'],
  ['craft', 'crafting'],
  ['acceptQuest', 'quest'],
  ['advanceQuest', 'quest'],
  ['travel', 'travel'],
  ['save', 'persistence'],
  ['back', 'navigation'],
]) {
  const descriptor = describeSettlementAction(action, { targetId: `${action}-target` });
  assert(descriptor.kind === kind, `descriptor classifies ${action} as ${kind}`);
  assert(descriptor.targetId === `${action}-target`, `descriptor retains target for ${action}`);
}

// Interaction rail is bounded, localized and deterministic.
{
  const slice = createSettlementVerticalSlice({
    definition: {
      id: 'rail-matrix',
      settlementId: 'rail-matrix',
      entryNodeId: 'node',
      nodes: [{
        id: 'node',
        kind: 'settlement',
        label: 'Meydan',
        actions: ['enter', 'interact', 'trade', 'craft', 'save'],
      }],
    },
    handlers,
  });
  const first = buildSettlementInteractionRail(slice, baseContext({ settlementId: 'rail-matrix' }));
  const second = buildSettlementInteractionRail(slice, baseContext({ settlementId: 'rail-matrix' }));
  assert(first.ok, 'rail is generated');
  assert(first.actions.length <= 8, 'rail action count is bounded');
  assert(first.node.kindLabel === 'Yerleşim', 'rail node kind is localized');
  same(first, second, 'rail output is deterministic');
}

// Definition validation matrices.
for (const nodeKind of [
  'settlement', 'interior', 'door', 'npc', 'vendor', 'crafting', 'quest', 'travel', 'save',
]) {
  const result = validateSettlementSliceDefinition({
    id: `valid-${nodeKind}`,
    settlementId: `valid-${nodeKind}`,
    entryNodeId: 'n',
    nodes: [{ id: 'n', kind: nodeKind, actions: ['back'] }],
  });
  assert(result.ok, `valid kind ${nodeKind} passes validation`);
}

for (const invalidAction of ['hack', 'teleport', 'delete', '', null]) {
  const result = validateSettlementSliceDefinition({
    id: `invalid-${String(invalidAction)}`,
    settlementId: 'invalid-action',
    entryNodeId: 'n',
    nodes: [{ id: 'n', kind: 'settlement', actions: ['interact', invalidAction] }],
  });
  assert(!result.ok || !result.errors.some((entry) => entry.includes('unsupported-action') === false), `invalid action does not become trusted: ${String(invalidAction)}`);
}

// Context fingerprint invariance under object key ordering.
const contextA = normalizeSettlementContext({
  flags: { b: true, a: false },
  items: { iron: 4, wood: 2 },
  reputation: { town: 4 },
});
const contextB = normalizeSettlementContext({
  reputation: { town: 4 },
  items: { wood: 2, iron: 4 },
  flags: { a: false, b: true },
});
assert(fingerprintSettlementContext(contextA) === fingerprintSettlementContext(contextB), 'context fingerprint ignores key order');

// Empty and malformed inputs must remain safe.
for (const malformed of [null, undefined, 0, '', [], 'not-an-object']) {
  const normalized = normalizeSettlementContext(malformed);
  assert(normalized && typeof normalized === 'object', `malformed context ${String(malformed)} normalizes safely`);
  const gate = evaluateSettlementGate({ type: 'flag', key: 'open' }, malformed);
  assert(!gate.ok, `malformed context ${String(malformed)} fails required flag safely`);
}

// Multi-gate failure ordering is stable.
for (let run = 0; run < 10; run += 1) {
  const result = evaluateSettlementGates([
    { type: 'flag', key: 'open', reason: 'closed' },
    { type: 'item', itemId: 'iron', quantity: 99, reason: 'iron-missing' },
    { type: 'reputation', factionId: 'town', minimum: 999, reason: 'trust-low' },
  ], baseContext({ flags: { open: false }, items: { iron: 0 }, reputation: { town: 0 } }));
  same(result.reasons, ['closed', 'iron-missing', 'trust-low'], `gate failure order is deterministic run=${run}`);
}

// Settlement summary stays useful for evidence and never invents node kinds.
const summary = summarizeSettlementSlice(definition);
assert(summary.nodeCount === definition.nodes.length, 'summary node count matches definition');
assert(summary.actionCount > summary.nodeCount, 'summary captures multiple interactions');
assert(summary.gateCount === 7, 'summary gate count matches authored definition');
assert(summary.kinds.settlement === 1, 'summary reports settlement kind');
assert(summary.kinds.vendor === 1, 'summary reports vendor kind');
assert(summary.kinds.crafting === 1, 'summary reports crafting kind');

// Persistence matrix: restore validates node accessibility, not transient action capability.
// A hall without its own gate remains restorable when dialogue becomes unavailable.
{
  const slice = createSettlementVerticalSlice({ definition, handlers });
  slice.transitionTo('interior', 'hall', baseContext());
  slice.execute('talk', {}, baseContext());
  const saved = slice.exportSnapshot(baseContext());
  const restored = createSettlementVerticalSlice({ definition, handlers });
  const ok = restored.importSnapshot(saved, baseContext());
  assert(ok.ok, 'valid snapshot imports');
  assert(restored.currentNode().id === 'hall', 'valid snapshot restores current node');
  const dialogueLoss = restored.importSnapshot(saved, baseContext({ capabilities: { dialogue: false } }));
  assert(dialogueLoss.ok && !dialogueLoss.recovered, 'temporary dialogue capability loss does not gate an ungated hall');
  assert(restored.currentNode().id === 'hall', 'temporary action capability loss keeps restored node');
}

{
  const slice = createSettlementVerticalSlice({ definition, handlers });
  const unknown = slice.importSnapshot({ version: 1, sliceId: definition.id, currentNodeId: 'never-existed' }, baseContext());
  assert(!unknown.ok && unknown.recovered, 'unknown snapshot node recovers');
  assert(slice.currentNode().id === 'square', 'unknown snapshot recovery is deterministic');
  const wrongVersion = slice.importSnapshot({ version: 2, sliceId: definition.id, currentNodeId: 'hall' }, baseContext());
  assert(!wrongVersion.ok && wrongVersion.reason === 'unsupported-snapshot-version', 'unsupported snapshot version is rejected');
  const wrongSlice = slice.importSnapshot({ version: 1, sliceId: 'other', currentNodeId: 'hall' }, baseContext());
  assert(!wrongSlice.ok && wrongSlice.reason === 'snapshot-slice-mismatch', 'snapshot slice mismatch is rejected');
}

// A node-level capability gate still recovers when the required service becomes unavailable.
for (const value of [false, undefined, null, 0, '', 'enabled']) {
  const gatedDefinition = {
    id: `gated-cap-${String(value)}`,
    settlementId: 'gated-capability',
    entryNodeId: 'entry',
    nodes: [
      { id: 'entry', kind: 'settlement', actions: ['interact', 'back'] },
      { id: 'service', kind: 'vendor', actions: ['trade', 'back'], gates: [{ type: 'capability', capability: 'trade' }] },
    ],
  };
  const slice = createSettlementVerticalSlice({ definition: gatedDefinition, handlers });
  const context = baseContext({ settlementId: 'gated-capability', capabilities: { trade: value } });
  const result = slice.setNode('service', context);
  assert(result.ok === (value !== false), `node capability gate follows explicit-false semantics value=${String(value)}`);
  assert(slice.currentNode().id === (value !== false ? 'service' : 'entry'), `node capability gate recovery position value=${String(value)}`);
}

if (failures.length) {
  console.error(`[settlement-vertical-slice-matrix] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`[settlement-vertical-slice-matrix] PASS: ${passed} deterministic matrix assertions.`);
