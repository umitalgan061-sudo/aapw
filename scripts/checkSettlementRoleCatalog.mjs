import {
  buildCanonicalSettlementInteractionDefinition,
  buildSettlementRoleNode,
  buildSettlementRoleNodes,
  createSettlementRoleSlice,
  describeSettlementRole,
  getSettlementRoleActionHints,
  getSettlementRoleDefaults,
  isSettlementRole,
  listSettlementRoles,
  roleBlueprintFingerprint,
  roleRequiresCapability,
  roleSupportsAction,
  validateSettlementRoleDefinition,
} from '../src/3d/gameplay/settlementVerticalSliceRoles.js';

const failures = [];
let passed = 0;
function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}

const expected = {
  blacksmith: { kind: 'crafting', capability: 'crafting', actions: ['craft', 'trade', 'back'] },
  tavern: { kind: 'interior', capability: 'dialogue', actions: ['talk', 'interact', 'back'] },
  market: { kind: 'vendor', capability: 'trade', actions: ['trade', 'back'] },
  farm: { kind: 'interior', capability: 'trade', actions: ['interact', 'trade', 'travel', 'back'] },
  barracks: { kind: 'interior', capability: 'dialogue', actions: ['talk', 'interact', 'back'] },
  stable: { kind: 'interior', capability: 'travel', actions: ['interact', 'travel', 'back'] },
  house: { kind: 'interior', capability: 'persistence', actions: ['interact', 'talk', 'save', 'back'] },
  gate: { kind: 'door', capability: 'door', actions: ['enter', 'exit', 'travel', 'back'] },
};

// Every role has a stable default contract.
const roles = listSettlementRoles();
assert(roles.length === 8, 'eight authored settlement role blueprints exist');
for (const role of roles) {
  const defaults = getSettlementRoleDefaults(role);
  const expectedRole = expected[role];
  assert(Boolean(defaults), `defaults exist for ${role}`);
  assert(defaults.kind === expectedRole.kind, `${role} keeps authored node kind`);
  assert(defaults.capability === expectedRole.capability, `${role} keeps authored capability`);
  assert(JSON.stringify(defaults.actions) === JSON.stringify(expectedRole.actions), `${role} keeps authored action list`);
  assert(isSettlementRole(role), `${role} is recognized`);
  assert(roleRequiresCapability(role) === expectedRole.capability, `${role} reports its capability`);
  assert(describeSettlementRole(role).label === defaults.label, `${role} description retains label`);
  assert(Object.keys(getSettlementRoleActionHints(role)).length > 0, `${role} has UX action hints`);
  assert(roleBlueprintFingerprint(role) === roleBlueprintFingerprint(role), `${role} fingerprint is deterministic`);
}

assert(!isSettlementRole('invented-city'), 'invented geography is not silently treated as a role');
assert(getSettlementRoleDefaults('invented-city') === null, 'unknown role returns no defaults');
assert(describeSettlementRole('invented-city') === null, 'unknown role has no description');
assert(roleRequiresCapability('invented-city') === '', 'unknown role has no capability');
assert(!roleSupportsAction('market', 'craft'), 'market does not claim crafting');
assert(roleSupportsAction('blacksmith', 'craft'), 'blacksmith supports crafting');
assert(roleSupportsAction('market', 'trade'), 'market supports trade');
assert(roleSupportsAction('stable', 'travel'), 'stable supports travel');
assert(roleSupportsAction('house', 'save'), 'house supports save');
assert(!roleSupportsAction('gate', 'trade'), 'gate does not claim trade');

// Node builder preserves caller identity while applying role defaults.
for (const role of roles) {
  const node = buildSettlementRoleNode(role, { id: `${role}-001`, metadata: { authored: true } });
  assert(node.id === `${role}-001`, `${role} builder preserves explicit id`);
  assert(node.role === role, `${role} builder retains role marker`);
  assert(node.metadata.role === role, `${role} metadata contains role`);
  assert(node.metadata.authored === true, `${role} metadata keeps scalar caller metadata`);
  assert(node.actions.length > 0, `${role} builder creates usable actions`);
}

// Explicit overrides remain bounded and sanitized.
const market = buildSettlementRoleNode('market', {
  id: 'market-main',
  label: 'Ana Pazar',
  actions: ['trade', 'trade', 'unknown', 'back'],
  capability: 'trade',
  gates: [
    { type: 'item', itemId: 'market-token', quantity: 2 },
    { type: 'unsupported', key: 'ignored' },
  ],
});
assert(market.label === 'Ana Pazar', 'explicit market label is preserved');
assert(JSON.stringify(market.actions) === JSON.stringify(['trade', 'back']), 'market action override removes duplicates and unsupported actions');
assert(market.gates.length === 2, 'market builder keeps capability and explicit gate');
assert(market.gates[0].type === 'capability', 'default capability gate comes first');
assert(market.gates[1].type === 'item', 'explicit item gate remains second');

// Role catalog assembly is deterministic and deduplicated.
const built = buildSettlementRoleNodes({
  roles: ['market', 'market', 'blacksmith', 'invented', 'tavern'],
  market: { id: 'm', label: 'Pazar' },
  blacksmith: { id: 'b', label: 'Ocak' },
  tavern: { id: 't', label: 'Han' },
});
assert(built.length === 3, 'role catalog removes duplicate and unknown roles');
assert(built[0].role === 'market', 'role catalog preserves requested deterministic order');
assert(built[1].role === 'blacksmith', 'role catalog keeps second requested role');
assert(built[2].role === 'tavern', 'role catalog keeps third requested role');

const all = buildSettlementRoleNodes({});
assert(all.length === 8, 'default role catalog contains all supported roles');
assert(new Set(all.map((node) => node.role)).size === 8, 'default role catalog has unique roles');

// Generic canonical interaction definition keeps settlement identity explicit.
const canonical = buildCanonicalSettlementInteractionDefinition({
  settlementId: 'existing-settlement-001',
  entryNodeId: 'entry-001',
  entryLabel: 'Meclis Meydanı',
  roles: ['blacksmith', 'tavern', 'market'],
});
assert(canonical.settlementId === 'existing-settlement-001', 'canonical definition retains caller settlement id');
assert(canonical.entryNodeId === 'entry-001', 'canonical definition retains caller entry node');
assert(canonical.nodes[0].kind === 'settlement', 'canonical definition starts at settlement entry');
assert(canonical.nodes.length === 4, 'canonical definition has entry plus three requested roles');
assert(canonical.nodes[1].role === 'blacksmith', 'canonical role order follows requested order');
assert(canonical.nodes[2].role === 'tavern', 'canonical second role follows requested order');
assert(canonical.nodes[3].role === 'market', 'canonical third role follows requested order');

const canonicalValidation = validateSettlementRoleDefinition(canonical);
assert(canonicalValidation.ok, 'canonical role definition validates');
assert(canonicalValidation.nodeCount === 4, 'canonical validation counts nodes');
assert(canonicalValidation.roleCount === 3, 'canonical validation counts role nodes');

// createSettlementRoleSlice returns a validated definition without creating a second manager.
const sliceResult = createSettlementRoleSlice({
  settlementId: 'existing-settlement-001',
  roles: ['blacksmith', 'tavern'],
});
assert(sliceResult.ok, 'role slice factory returns valid role slice definition');
assert(sliceResult.definition.settlementId === 'existing-settlement-001', 'role slice keeps settlement identity');
assert(sliceResult.validation.ok, 'role slice includes validation evidence');

// Invalid role node is reported, not silently accepted.
const bad = validateSettlementRoleDefinition({
  settlementId: 'bad',
  nodes: [
    { id: 'entry', kind: 'vendor', actions: ['trade'] },
    { id: 'entry', kind: 'vendor', actions: ['trade'] },
  ],
});
assert(!bad.ok, 'invalid role definition is rejected');
assert(bad.errors.includes('first-node-not-settlement'), 'role definition validates settlement entry boundary');
assert(bad.errors.some((error) => error.startsWith('duplicate-node:')), 'role definition reports duplicate node ids');

// Per-role capability semantics stay distinct.
const capabilityPairs = [
  ['blacksmith', 'crafting'],
  ['tavern', 'dialogue'],
  ['market', 'trade'],
  ['farm', 'trade'],
  ['barracks', 'dialogue'],
  ['stable', 'travel'],
  ['house', 'persistence'],
  ['gate', 'door'],
];
for (const [role, capability] of capabilityPairs) {
  assert(roleRequiresCapability(role) === capability, `${role} owns only its expected capability`);
}

// Role fingerprints change when authored identity or gate data changes.
const marketA = roleBlueprintFingerprint('market', { id: 'market-a' });
const marketB = roleBlueprintFingerprint('market', { id: 'market-b' });
assert(marketA !== marketB, 'role blueprint fingerprint reflects authored identity');
const gatedA = roleBlueprintFingerprint('market', { gates: [{ type: 'flag', key: 'open' }] });
const gatedB = roleBlueprintFingerprint('market', { gates: [{ type: 'flag', key: 'closed' }] });
assert(gatedA !== gatedB, 'role blueprint fingerprint reflects authored gate differences');

if (failures.length) {
  console.error(`[settlement-role-catalog] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`[settlement-role-catalog] PASS: ${passed} role catalog assertions.`);
