import {
  buildSettlementInteractionRail,
  createSettlementVerticalSlice,
  evaluateSettlementGate,
  evaluateSettlementGates,
  fingerprintSettlementContext,
  normalizeSettlementContext,
  settlementActionLabel,
  settlementNodeKindLabel,
  summarizeSettlementSlice,
  validateSettlementSliceDefinition,
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

const def = {
  id: 'canonical-settlement-flow',
  settlementId: 'canonical-settlement',
  entryNodeId: 'square',
  limits: { maxVisibleActions: 6, maxHistory: 12 },
  nodes: [
    { id: 'square', kind: 'settlement', label: 'Settlement Square', actions: ['enter', 'interact', 'travel', 'save'] },
    { id: 'hall', kind: 'interior', label: 'Settlement Hall', actions: ['talk', 'trade', 'back'], gates: [{ type: 'capability', capability: 'dialogue' }] },
    { id: 'forge', kind: 'crafting', label: 'Blacksmith', actions: ['craft', 'back'], gates: [{ type: 'capability', capability: 'crafting' }] },
    { id: 'door', kind: 'door', label: 'West Door', actions: ['exit', 'back'], gates: [{ type: 'proximity', distance: 4 }] },
    { id: 'vendor', kind: 'vendor', label: 'Market Vendor', actions: ['trade', 'back'], gates: [{ type: 'item', itemId: 'market-token', quantity: 1 }] },
    { id: 'keeper', kind: 'npc', label: 'Inn Keeper', actions: ['talk', 'acceptQuest'], gates: [{ type: 'reputation', factionId: 'town', minimum: 5 }] },
    { id: 'quest', kind: 'quest', label: 'Lost Shipment', actions: ['advanceQuest', 'back'], gates: [{ type: 'quest', questId: 'shipment', states: ['active'] }, { type: 'flag', key: 'shipment-note', expected: true }] },
    { id: 'road', kind: 'travel', label: 'Caravan Road', actions: ['travel', 'back'], gates: [{ type: 'flag', key: 'road-open', expected: true }] },
    { id: 'save', kind: 'save', label: 'Save Desk', actions: ['save', 'back'], gates: [{ type: 'capability', capability: 'persistence' }] },
  ],
};

function ctx(overrides = {}) {
  return {
    settlementId: 'spoofed-by-caller',
    locationId: 'square',
    distance: overrides.distance ?? 2,
    flags: { 'shipment-note': true, 'road-open': true, ...(overrides.flags || {}) },
    items: { 'market-token': 1, iron: 4, ...(overrides.items || {}) },
    reputation: { town: 8, ...(overrides.reputation || {}) },
    questProgress: { shipment: { state: 'active', step: 1, completed: false, rewardClaimed: false }, ...(overrides.questProgress || {}) },
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
  };
}

// Basic authored definition sanity.
const validation = validateSettlementSliceDefinition(def);
assert(validation.ok, 'journey definition is valid');
assert(validation.nodeCount === 9, 'journey definition has nine nodes');
assert(validation.actionCount > 15, 'journey definition has meaningful action surface');
assert(validation.errors.length === 0, 'journey definition has no validation errors');

const summary = summarizeSettlementSlice(def);
assert(summary.kinds.crafting === 1, 'summary includes blacksmith role');
assert(summary.kinds.vendor === 1, 'summary includes market vendor role');
assert(summary.kinds.quest === 1, 'summary includes quest role');
assert(summary.gateCount === 9, 'summary includes authored gates');

// Start at settlement square.
let slice = createSettlementVerticalSlice({ definition: def, handlers });
assert(slice.currentNode().id === 'square', 'journey starts at square');
assert(slice.availableActions(ctx()).includes('enter'), 'square exposes entry');
assert(slice.availableActions(ctx()).includes('travel'), 'square exposes travel');
assert(slice.availableActions(ctx()).includes('save'), 'square exposes save');

// Enter action delegates exactly once.
calls.length = 0;
let result = slice.execute('enter', { doorId: 'front-door' }, ctx());
assert(result.ok, 'enter succeeds');
assert(calls.length === 1, 'enter invokes one handler');
assert(calls[0][0] === 'enter', 'enter uses entry handler');
assert(calls[0][1].settlementId === 'canonical-settlement', 'enter uses definition settlement id');
assert(calls[0][1].doorId === 'front-door', 'enter preserves door id');

// Move into interior.
result = slice.transitionTo('interior', 'hall', ctx());
assert(result.ok, 'transition to hall succeeds');
assert(slice.currentNode().id === 'hall', 'hall is active');
const hallRail = buildSettlementInteractionRail(slice, ctx());
assert(hallRail.ok, 'hall rail builds');
assert(hallRail.node.kind === 'interior', 'hall rail reports interior');
assert(hallRail.actions.some((entry) => entry.action === 'trade'), 'hall rail contains trade');
assert(hallRail.actions.some((entry) => entry.action === 'talk'), 'hall rail contains talk');

// Trade path.
calls.length = 0;
result = slice.execute('trade', { offerId: 'wool-roll', quantity: 2 }, ctx());
assert(result.ok, 'hall trade succeeds');
assert(calls[0][1].offerId === 'wool-roll', 'trade carries offer id');
assert(calls[0][1].quantity === 2, 'trade carries bounded quantity');
assert(calls[0][1].nodeId === 'hall', 'trade receives active node');

// Missing trading capability blocks the action before handler dispatch.
calls.length = 0;
const blockedTrade = slice.execute('trade', { offerId: 'ore' }, ctx({ capabilities: { trade: false } }));
assert(!blockedTrade.ok, 'trade fails when capability is missing');
assert(blockedTrade.reason === 'action-unavailable', 'trade failure is capability-safe');
assert(calls.length === 0, 'blocked trade never reaches authoritative handler');

// Move to vendor and test item gate.
result = slice.transitionTo('vendor', 'vendor', ctx());
assert(result.ok, 'vendor transition succeeds with token');
assert(slice.availableActions(ctx()).includes('trade'), 'vendor exposes trade');
result = slice.transitionTo('vendor', 'vendor', ctx({ items: { 'market-token': 0 } }));
assert(!result.ok, 'vendor transition rejects missing token');
assert(result.reason === 'item-required', 'vendor reports item gate');
assert(slice.currentNode().id === 'vendor', 'failed transition preserves current vendor node');

// Move to keeper and exercise reputation threshold boundaries.
result = slice.transitionTo('npc', 'keeper', ctx());
assert(result.ok, 'keeper transition succeeds');
assert(slice.availableActions(ctx()).includes('acceptQuest'), 'keeper exposes quest acceptance');
result = slice.transitionTo('npc', 'keeper', ctx({ reputation: { town: 4.999 } }));
assert(!result.ok && result.reason === 'reputation-too-low', 'keeper rejects below threshold');
result = slice.transitionTo('npc', 'keeper', ctx({ reputation: { town: 5 } }));
assert(result.ok, 'keeper accepts exact reputation boundary');

// Quest node requires active quest and supporting flag.
result = slice.transitionTo('quest', 'quest', ctx());
assert(result.ok, 'quest node transition succeeds');
assert(slice.availableActions(ctx()).includes('advanceQuest'), 'quest exposes advance action');
result = slice.execute('advanceQuest', { questId: 'shipment' }, ctx());
assert(result.ok, 'quest advance delegates');
result = slice.transitionTo('quest', 'quest', ctx({ flags: { 'shipment-note': false } }));
assert(!result.ok && result.reason === 'flag-required', 'quest note flag gates advancement');
result = slice.transitionTo('quest', 'quest', ctx({ questProgress: { shipment: { state: 'failed', completed: false } } }));
assert(!result.ok && result.reason === 'quest-required', 'failed quest state does not advance');

// Completed quest is accepted by an explicit completed gate.
result = evaluateSettlementGate(
  { type: 'quest', questId: 'shipment', states: ['completed'] },
  ctx({ questProgress: { shipment: { state: 'done', completed: true } } }),
);
assert(result.ok, 'completed quest gate recognizes completed=true');

// Blacksmith path and crafting capability boundary.
result = slice.transitionTo('crafting', 'forge', ctx());
assert(result.ok, 'forge transition succeeds');
calls.length = 0;
result = slice.execute('craft', { recipeId: 'tempered-knife' }, ctx());
assert(result.ok, 'craft delegates');
assert(calls[0][0] === 'craft', 'craft uses crafting handler');
assert(calls[0][1].recipeId === 'tempered-knife', 'craft carries recipe id');
result = slice.execute('craft', { recipeId: 'tempered-knife' }, ctx({ capabilities: { crafting: false } }));
assert(!result.ok && result.reason === 'capability-unavailable', 'craft is blocked without crafting capability');

// Travel path: road gate and destination forwarding.
result = slice.transitionTo('travel', 'road', ctx());
assert(result.ok, 'road transition succeeds');
calls.length = 0;
result = slice.execute('travel', { destinationId: 'ridge-farm', travelMode: 'caravan' }, ctx());
assert(result.ok, 'travel delegates');
assert(calls[0][1].destinationId === 'ridge-farm', 'travel carries destination id');
assert(calls[0][1].travelMode === 'caravan', 'travel preserves mode metadata');
result = slice.transitionTo('travel', 'road', ctx({ flags: { 'road-open': false } }));
assert(!result.ok && result.reason === 'flag-required', 'closed road blocks travel');

// Door path: proximity is checked against caller context.
result = slice.transitionTo('door', 'door', ctx({ distance: 4 }));
assert(result.ok, 'door accepts exact proximity boundary');
result = slice.transitionTo('door', 'door', ctx({ distance: 4.001 }));
assert(!result.ok && result.reason === 'too-far', 'door rejects outside proximity');
calls.length = 0;
result = slice.execute('exit', {}, ctx({ distance: 2 }));
assert(result.ok, 'door exit delegates');
assert(calls[0][0] === 'exit', 'exit uses exit handler');

// Save flow and persistence capability.
result = slice.transitionTo('save', 'save', ctx());
assert(result.ok, 'save node transition succeeds');
calls.length = 0;
result = slice.execute('save', { slotId: 'manual-1' }, ctx());
assert(result.ok, 'save delegates');
assert(calls[0][1].slotId === 'manual-1', 'save preserves slot id');
result = slice.execute('save', {}, ctx({ capabilities: { persistence: false } }));
assert(!result.ok && result.reason === 'capability-unavailable', 'save is blocked without persistence capability');

// Persistence round-trip from a non-entry node.
result = slice.transitionTo('interior', 'hall', ctx());
assert(result.ok, 'return to hall before snapshot');
slice.execute('talk', { npcId: 'keeper' }, ctx());
const saved = slice.exportSnapshot(ctx());
assert(saved.currentNodeId === 'hall', 'export stores current node');
assert(saved.history.length <= 12, 'export history is bounded');
const restored = createSettlementVerticalSlice({ definition: def, handlers });
result = restored.importSnapshot(saved, ctx());
assert(result.ok, 'snapshot restores');
assert(restored.currentNode().id === 'hall', 'snapshot restores hall');
same(saved, restored.exportSnapshot(ctx()), 'snapshot round-trip remains deterministic');

// Snapshot recovery when current context gates the saved node.
result = restored.importSnapshot(saved, ctx({ capabilities: { dialogue: false } }));
assert(!result.ok && result.recovered, 'gated saved node recovers');
assert(restored.currentNode().id === 'square', 'gated saved node recovers to entry');

// Unknown node recovery.
result = restored.importSnapshot({ version: 1, sliceId: def.id, currentNodeId: 'unknown' }, ctx());
assert(!result.ok && result.recovered, 'unknown saved node recovers');
assert(restored.currentNode().id === 'square', 'unknown saved node uses entry');

// Invalid version and slice id are not trusted.
result = restored.importSnapshot({ version: 9, sliceId: def.id, currentNodeId: 'hall' }, ctx());
assert(!result.ok && result.reason === 'unsupported-snapshot-version', 'unknown version rejected');
result = restored.importSnapshot({ version: 1, sliceId: 'other', currentNodeId: 'hall' }, ctx());
assert(!result.ok && result.reason === 'snapshot-slice-mismatch', 'wrong slice rejected');

// History cap is enforced in the long-session case.
const bounded = createSettlementVerticalSlice({
  definition: { id: 'history', settlementId: 'history', entryNodeId: 'n', limits: { maxHistory: 4 }, nodes: [{ id: 'n', kind: 'settlement', actions: ['interact'] }] },
  handlers: { interact: () => ({ ok: true }) },
});
for (let index = 0; index < 20; index += 1) bounded.execute('interact', { index }, ctx({ settlementId: 'history' }));
const history = bounded.exportSnapshot(ctx({ settlementId: 'history' })).history;
assert(history.length === 4, 'history remains bounded after repeated interaction');
assert(history[0].sequence === 17, 'history eviction keeps newest sequence');
assert(history[3].sequence === 20, 'history ends with newest sequence');

// Label and kind helpers are stable for authored UI.
for (const [action, label] of Object.entries({
  enter: 'İçeri gir', exit: 'Dışarı çık', interact: 'Etkileş', talk: 'Konuş', trade: 'Takas', craft: 'Üret',
  acceptQuest: 'Görevi kabul et', advanceQuest: 'Görevi ilerlet', travel: 'Yola çık', save: 'Oyunu kaydet', back: 'Geri dön',
})) assert(settlementActionLabel(action) === label, `action label is stable for ${action}`);
for (const [kind, label] of Object.entries({
  settlement: 'Yerleşim', interior: 'İç mekân', door: 'Kapı', npc: 'Karakter', vendor: 'Satıcı', crafting: 'Üretim', quest: 'Görev', travel: 'Seyahat', save: 'Kayıt',
})) assert(settlementNodeKindLabel(kind) === label, `node kind label is stable for ${kind}`);
assert(settlementActionLabel('future-action') === 'future-action', 'unknown action label falls back to identifier');
assert(settlementNodeKindLabel('future-kind') === 'future-kind', 'unknown node label falls back to identifier');

// Context normalization edge cases.
const normalized = normalizeSettlementContext({
  flags: { on: 1, off: 0 },
  items: { iron: 3.9, negative: -5, huge: 999999 },
  reputation: { town: 11.5, other: Infinity },
  capabilities: { trade: false },
  distance: Number.NaN,
});
assert(normalized.flags.on === true && normalized.flags.off === false, 'flags normalize predictably');
assert(normalized.items.iron === 3, 'fractional item quantity truncates');
assert(normalized.items.negative === undefined, 'negative item quantity is removed');
assert(normalized.items.huge === 9999, 'item quantity is capped');
assert(normalized.reputation.other === 0, 'non-finite reputation falls back safely');
assert(normalized.capabilities.trade === false, 'explicit capability false is retained');
assert(normalized.distance === 0, 'non-finite distance normalizes to zero');

// Fingerprint determinism for reordered objects.
const fpA = fingerprintSettlementContext({ flags: { b: true, a: false }, items: { x: 1, y: 2 }, reputation: { town: 5 } });
const fpB = fingerprintSettlementContext({ reputation: { town: 5 }, items: { y: 2, x: 1 }, flags: { a: false, b: true } });
assert(fpA === fpB, 'context fingerprint ignores key ordering');

// Multi-gate result order and reason retention.
const multi = evaluateSettlementGates([
  { type: 'flag', key: 'open', reason: 'closed' },
  { type: 'item', itemId: 'iron', quantity: 99, reason: 'no-iron' },
  { type: 'reputation', factionId: 'town', minimum: 99, reason: 'low-trust' },
], ctx({ flags: { open: false }, items: { iron: 0 }, reputation: { town: 1 } }));
same(multi.reasons, ['closed', 'no-iron', 'low-trust'], 'multi-gate failures preserve authored order');
assert(!multi.ok, 'multi-gate result fails when any gate fails');

// All core node kinds can be rendered into a deterministic rail.
for (const node of def.nodes) {
  const isolated = createSettlementVerticalSlice({ definition: { ...def, entryNodeId: node.id }, handlers });
  const rail = buildSettlementInteractionRail(isolated, ctx());
  assert(rail.node.id === node.id, `rail can render ${node.kind}`);
  assert(rail.node.kind === node.kind, `rail keeps kind for ${node.kind}`);
}

// Empty definition is safe.
const empty = createSettlementVerticalSlice({ definition: { id: 'empty', settlementId: 'empty', nodes: [] }, handlers });
assert(empty.currentNode() === null, 'empty definition has no current node');
assert(empty.availableActions().length === 0, 'empty definition exposes no actions');
const emptyResult = empty.execute('enter', {}, ctx({ settlementId: 'empty' }));
assert(!emptyResult.ok && emptyResult.reason === 'action-unavailable', 'empty definition rejects action safely');

// Throwing handler never escapes into the caller.
const throwing = createSettlementVerticalSlice({
  definition: { id: 'throwing', settlementId: 'throwing', entryNodeId: 'n', nodes: [{ id: 'n', kind: 'settlement', actions: ['interact'] }] },
  handlers: { interact: () => { throw new Error('hidden runtime failure'); } },
});
const thrown = throwing.execute('interact', {}, ctx({ settlementId: 'throwing' }));
assert(!thrown.ok && thrown.reason === 'handler-threw', 'throwing handler is captured');

// Authoritative failure response is preserved.
const denied = createSettlementVerticalSlice({
  definition: { id: 'denied', settlementId: 'denied', entryNodeId: 'n', nodes: [{ id: 'n', kind: 'settlement', actions: ['interact'] }] },
  handlers: { interact: () => ({ ok: false, reason: 'owner-blocked', message: 'Kapalı.' }) },
});
const deniedResult = denied.execute('interact', {}, ctx({ settlementId: 'denied' }));
assert(!deniedResult.ok && deniedResult.reason === 'owner-blocked', 'authoritative failure reason is retained');
assert(deniedResult.message === 'Kapalı.', 'authoritative message is retained');

// Input payload must not be mutated by handler injection.
const payload = { targetId: 'vendor-1' };
const mutating = createSettlementVerticalSlice({
  definition: { id: 'immutability', settlementId: 'immutability', entryNodeId: 'n', nodes: [{ id: 'n', kind: 'settlement', actions: ['interact'] }] },
  handlers: { interact: (received) => { received.internalOnly = true; return { ok: true }; } },
});
mutating.execute('interact', payload, ctx({ settlementId: 'immutability' }));
assert(payload.internalOnly === undefined, 'caller payload remains unmodified');

if (failures.length) {
  console.error(`[settlement-vertical-slice-journey] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`[settlement-vertical-slice-journey] PASS: ${passed} end-to-end journey assertions.`);
