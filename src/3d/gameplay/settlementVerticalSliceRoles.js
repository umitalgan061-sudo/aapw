/**
 * Canonical settlement-role blueprints for the vertical slice coordinator.
 *
 * These are role contracts, not new settlements and not a second settlement manager.
 * A caller supplies its real settlement id, node ids and existing authoritative handlers.
 * The blueprints describe the expected interaction affordances for blacksmith, tavern,
 * market, farm, barracks, stable, house/cabin and gate/road roles.
 */

export const SETTLEMENT_ROLE_VERSION = 1;

const ROLE_NAMES = Object.freeze([
  'blacksmith',
  'tavern',
  'market',
  'farm',
  'barracks',
  'stable',
  'house',
  'gate',
]);

const ROLE_DEFAULTS = Object.freeze({
  blacksmith: Object.freeze({ kind: 'crafting', label: 'Demirci', actions: ['craft', 'trade', 'back'], capability: 'crafting' }),
  tavern: Object.freeze({ kind: 'interior', label: 'Han', actions: ['talk', 'interact', 'back'], capability: 'dialogue' }),
  market: Object.freeze({ kind: 'vendor', label: 'Pazar', actions: ['trade', 'back'], capability: 'trade' }),
  farm: Object.freeze({ kind: 'interior', label: 'Çiftlik', actions: ['interact', 'trade', 'travel', 'back'], capability: 'trade' }),
  barracks: Object.freeze({ kind: 'interior', label: 'Kışla', actions: ['talk', 'interact', 'back'], capability: 'dialogue' }),
  stable: Object.freeze({ kind: 'interior', label: 'Ahır', actions: ['interact', 'travel', 'back'], capability: 'travel' }),
  house: Object.freeze({ kind: 'interior', label: 'Ev', actions: ['interact', 'talk', 'save', 'back'], capability: 'persistence' }),
  gate: Object.freeze({ kind: 'door', label: 'Kapı', actions: ['enter', 'exit', 'travel', 'back'], capability: 'door' }),
});

const ROLE_ACTION_HINTS = Object.freeze({
  blacksmith: Object.freeze({ craft: 'Tarif seç', trade: 'Çekiç/alışveriş', back: 'Ocaktan ayrıl' }),
  tavern: Object.freeze({ talk: 'Han görevlisiyle konuş', interact: 'Dinlen/etkileş', back: 'Handan ayrıl' }),
  market: Object.freeze({ trade: 'Al/sat', back: 'Pazardan ayrıl' }),
  farm: Object.freeze({ interact: 'Üretimi incele', trade: 'Mahsul alışverişi', travel: 'Tarlaya ilerle', back: 'Çiftlikten ayrıl' }),
  barracks: Object.freeze({ talk: 'Nöbetçiyle konuş', interact: 'Kışlayı incele', back: 'Kışladan ayrıl' }),
  stable: Object.freeze({ interact: 'Binekleri incele', travel: 'Seyahat hazırlığı', back: 'Ahırdan ayrıl' }),
  house: Object.freeze({ interact: 'Evi incele', talk: 'Sakinle konuş', save: 'Dinlen ve kaydet', back: 'Evden ayrıl' }),
  gate: Object.freeze({ enter: 'İçeri gir', exit: 'Dışarı çık', travel: 'Yola bağlan', back: 'Geri dön' }),
});

const CAPABILITIES = new Set([
  'settlement',
  'door',
  'dialogue',
  'trade',
  'crafting',
  'quest',
  'travel',
  'persistence',
]);

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 96) : fallback;
}

function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function normalizeAction(action) {
  const normalized = clean(action);
  const allowed = new Set(['enter', 'exit', 'interact', 'talk', 'trade', 'craft', 'acceptQuest', 'advanceQuest', 'travel', 'save', 'back']);
  return allowed.has(normalized) ? normalized : '';
}

function normalizeGate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = clean(raw.type);
  if (type === 'capability') {
    const capability = clean(raw.capability);
    if (!CAPABILITIES.has(capability)) return null;
    return Object.freeze({ type, capability, reason: clean(raw.reason, 'capability-unavailable') });
  }
  if (type === 'item') {
    const itemId = clean(raw.itemId);
    return itemId ? Object.freeze({ type, itemId, quantity: clamp(raw.quantity, 1, 9999, 1), reason: clean(raw.reason, 'item-required') }) : null;
  }
  if (type === 'flag') {
    const key = clean(raw.key);
    return key ? Object.freeze({ type, key, expected: raw.expected !== false, reason: clean(raw.reason, 'flag-required') }) : null;
  }
  if (type === 'reputation') {
    const factionId = clean(raw.factionId);
    return factionId ? Object.freeze({ type, factionId, minimum: clamp(raw.minimum, -9999, 9999, 0), reason: clean(raw.reason, 'reputation-too-low') }) : null;
  }
  if (type === 'quest') {
    const questId = clean(raw.questId);
    if (!questId) return null;
    const states = Array.isArray(raw.states) ? raw.states.map((entry) => clean(entry)).filter(Boolean).slice(0, 8) : ['completed'];
    return Object.freeze({ type, questId, states: Object.freeze(states.length ? states : ['completed']), reason: clean(raw.reason, 'quest-required') });
  }
  if (type === 'proximity') {
    return Object.freeze({ type, distance: Math.max(0, Number(raw.distance) || 0), reason: clean(raw.reason, 'too-far') });
  }
  return null;
}

function normalizeNode(raw, fallbackRole) {
  const role = clean(raw?.role, fallbackRole);
  const defaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.market;
  const actions = Array.isArray(raw?.actions)
    ? [...new Set(raw.actions.map(normalizeAction).filter(Boolean))]
    : defaults.actions.slice();
  const gates = Array.isArray(raw?.gates) ? raw.gates.map(normalizeGate).filter(Boolean).slice(0, 8) : [];
  const metadata = {};
  if (raw?.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
    for (const [key, value] of Object.entries(raw.metadata).slice(0, 12)) {
      const k = clean(key);
      if (!k) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') metadata[k] = value;
    }
  }
  return Object.freeze({
    id: clean(raw?.id, `${role}-node`),
    kind: clean(raw?.kind, defaults.kind),
    label: clean(raw?.label, defaults.label),
    role,
    actions: Object.freeze(actions.slice(0, 12)),
    gates: Object.freeze(gates),
    metadata: Object.freeze(metadata),
  });
}

export function listSettlementRoles() {
  return Object.freeze(ROLE_NAMES.slice());
}

export function getSettlementRoleDefaults(role) {
  const key = clean(role);
  const defaults = ROLE_DEFAULTS[key];
  if (!defaults) return null;
  return Object.freeze({
    role: key,
    kind: defaults.kind,
    label: defaults.label,
    actions: Object.freeze(defaults.actions.slice()),
    capability: defaults.capability,
  });
}

export function getSettlementRoleActionHints(role) {
  const key = clean(role);
  const hints = ROLE_ACTION_HINTS[key];
  return hints ? Object.freeze({ ...hints }) : Object.freeze({});
}

export function buildSettlementRoleNode(role, options = {}) {
  const key = clean(role);
  const defaults = ROLE_DEFAULTS[key];
  if (!defaults) return null;
  const requestedCapability = clean(options.capability, defaults.capability);
  const gates = Array.isArray(options.gates) ? options.gates.slice() : [];
  if (requestedCapability) gates.unshift({ type: 'capability', capability: requestedCapability });
  return normalizeNode({
    role: key,
    id: options.id,
    kind: options.kind || defaults.kind,
    label: options.label || defaults.label,
    actions: options.actions || defaults.actions,
    gates,
    metadata: {
      role: key,
      service: key,
      ...(options.metadata || {}),
    },
  }, key);
}

export function buildSettlementRoleNodes(config = {}) {
  const roles = Array.isArray(config.roles) && config.roles.length ? config.roles : ROLE_NAMES;
  const nodes = [];
  const seen = new Set();
  for (const role of roles.slice(0, 8)) {
    const key = clean(role);
    if (!ROLE_NAMES.includes(key) || seen.has(key)) continue;
    const node = buildSettlementRoleNode(key, config[key] || {});
    if (!node) continue;
    seen.add(key);
    nodes.push(node);
  }
  return Object.freeze(nodes);
}

export function buildCanonicalSettlementInteractionDefinition(config = {}) {
  const settlementId = clean(config.settlementId, 'settlement');
  const sliceId = clean(config.sliceId, `${settlementId}-roles`);
  const entryNodeId = clean(config.entryNodeId, `${settlementId}-entry`);
  const entry = {
    id: entryNodeId,
    kind: 'settlement',
    label: clean(config.entryLabel, 'Yerleşim'),
    actions: ['enter', 'interact', 'travel', 'save'],
    metadata: { role: 'settlement-entry', service: 'settlement' },
  };
  const nodes = [entry, ...buildSettlementRoleNodes(config)];
  return Object.freeze({
    id: sliceId,
    settlementId,
    entryNodeId,
    nodes: Object.freeze(nodes),
    limits: Object.freeze({
      maxVisibleActions: clamp(config.maxVisibleActions, 1, 8, 8),
      maxHistory: clamp(config.maxHistory, 1, 32, 32),
    }),
  });
}

export function validateSettlementRoleDefinition(definition = {}) {
  const errors = [];
  if (!clean(definition.settlementId)) errors.push('missing-settlement-id');
  if (!Array.isArray(definition.nodes) || !definition.nodes.length) errors.push('missing-nodes');
  const ids = new Set();
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  for (const [index, node] of nodes.entries()) {
    const normalized = normalizeNode(node, 'role');
    if (ids.has(normalized.id)) errors.push(`duplicate-node:${normalized.id}`);
    ids.add(normalized.id);
    if (!NODE_KINDS.includes(normalized.kind)) errors.push(`unsupported-kind:${normalized.kind}`);
    if (!normalized.actions.length) errors.push(`missing-actions:${normalized.id}`);
    if (index === 0 && normalized.kind !== 'settlement') errors.push('first-node-not-settlement');
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    nodeCount: nodes.length,
    roleCount: nodes.filter((node) => ROLE_NAMES.includes(node.role)).length,
  });
}

const NODE_KINDS = new Set(['settlement', 'interior', 'door', 'npc', 'vendor', 'crafting', 'quest', 'travel', 'save']);

export function createSettlementRoleSlice({ settlementId, handlers, roles, options } = {}) {
  const definition = buildCanonicalSettlementInteractionDefinition({ settlementId, roles, ...(options || {}) });
  const validation = validateSettlementRoleDefinition(definition);
  if (!validation.ok) return { ok: false, reason: 'invalid-role-definition', errors: validation.errors, definition };
  return { ok: true, definition, validation };
}

export function describeSettlementRole(role) {
  const key = clean(role);
  const defaults = getSettlementRoleDefaults(key);
  if (!defaults) return null;
  return Object.freeze({
    role: key,
    label: defaults.label,
    kind: defaults.kind,
    capability: defaults.capability,
    actions: defaults.actions,
    hints: getSettlementRoleActionHints(key),
  });
}

export function roleSupportsAction(role, action) {
  const defaults = ROLE_DEFAULTS[clean(role)];
  return Boolean(defaults && defaults.actions.includes(normalizeAction(action)));
}

export function roleRequiresCapability(role) {
  return getSettlementRoleDefaults(role)?.capability || '';
}

export function isSettlementRole(role) {
  return ROLE_NAMES.includes(clean(role));
}

export function roleBlueprintFingerprint(role, options = {}) {
  const blueprint = buildSettlementRoleNode(role, options);
  if (!blueprint) return 'invalid-role';
  return hashBlueprint(blueprint);
}

function hashBlueprint(value) {
  const stable = stableValue(value);
  let hash = 2166136261;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableValue(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
}
