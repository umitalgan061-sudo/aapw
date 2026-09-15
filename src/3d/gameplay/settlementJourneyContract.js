const ACTION_ORDER = Object.freeze([
  'enter',
  'talk',
  'trade',
  'craft',
  'equip',
  'acceptQuest',
  'advanceQuest',
  'travel',
  'rest',
  'save',
  'exit',
]);

const DEFAULT_REASONS = Object.freeze({
  outsideSettlement: 'outside-settlement',
  defeated: 'defeated',
  unavailable: 'unavailable',
  missingCapability: 'missing-capability',
  missingTarget: 'missing-target',
  blockedByPrevious: 'blocked-by-previous',
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = canonical(value[key]);
    return out;
  }, {});
}

export function stableSerialize(value) {
  return JSON.stringify(canonical(value));
}

function capabilitySet(input) {
  const source = Array.isArray(input) ? input : Object.keys(input || {}).filter((key) => input[key]);
  return new Set(source.map((value) => text(value).toLowerCase()).filter(Boolean));
}

function normalizeNode(input, index) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    id: text(source.id, `node-${index + 1}`),
    label: text(source.label, `Settlement step ${index + 1}`),
    role: text(source.role, 'settlement'),
    target: text(source.target),
    action: text(source.action),
    completed: bool(source.completed),
    available: bool(source.available, true),
    capability: text(source.capability),
  };
}

function normalizeNodes(input) {
  const nodes = Array.isArray(input) ? input.slice(0, 32) : [];
  return nodes.map(normalizeNode);
}

function actionReason({ action, state, node, capabilities }) {
  if (action === 'enter') return state.insideSettlement ? DEFAULT_REASONS.unavailable : '';
  if (action === 'exit') return state.insideSettlement ? '' : DEFAULT_REASONS.outsideSettlement;
  if (!state.insideSettlement) return DEFAULT_REASONS.outsideSettlement;
  if (state.defeated) return DEFAULT_REASONS.defeated;
  if (node && node.completed && action === 'advanceQuest') return DEFAULT_REASONS.unavailable;
  if (node && node.available === false) return DEFAULT_REASONS.unavailable;
  if (node && node.capability && !capabilities.has(node.capability.toLowerCase())) {
    return DEFAULT_REASONS.missingCapability;
  }
  if (['talk', 'trade', 'craft', 'equip', 'acceptQuest', 'advanceQuest'].includes(action) && !node) {
    return DEFAULT_REASONS.missingTarget;
  }
  return '';
}

function candidateForAction(action, nodes) {
  const preferred = {
    talk: ['npc', 'tavern'],
    trade: ['market', 'blacksmith'],
    craft: ['blacksmith'],
    acceptQuest: ['questgiver', 'tavern'],
    advanceQuest: ['questgiver', 'gate'],
    travel: ['gate', 'stable'],
    rest: ['tavern', 'house'],
    save: ['house', 'tavern'],
  }[action] || [];
  return nodes.find((node) => preferred.includes(node.role) && !node.completed)
    || nodes.find((node) => !node.completed)
    || nodes[0]
    || null;
}

export function buildSettlementJourneyContract(snapshot = {}) {
  const state = {
    insideSettlement: bool(snapshot.insideSettlement),
    defeated: bool(snapshot.defeated),
    saveEnabled: bool(snapshot.saveEnabled, true),
    currentNodeId: text(snapshot.currentNodeId),
    settlementId: text(snapshot.settlementId, 'unknown-settlement'),
    playerLevel: Math.max(0, Math.floor(finite(snapshot.playerLevel, 1))),
  };
  const nodes = normalizeNodes(snapshot.nodes);
  const capabilities = capabilitySet(snapshot.capabilities);
  const requested = Array.isArray(snapshot.actions) && snapshot.actions.length
    ? snapshot.actions
    : ACTION_ORDER;
  const seen = new Set();
  const actions = requested.map((value) => text(value)).filter((action) => {
    if (!ACTION_ORDER.includes(action) || seen.has(action)) return false;
    seen.add(action);
    return true;
  }).sort((a, b) => ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b));

  const rows = actions.map((action, index) => {
    const node = candidateForAction(action, nodes);
    const disabledBySave = action === 'save' && !state.saveEnabled;
    const reason = disabledBySave ? 'save-disabled' : actionReason({ action, state, node, capabilities });
    return {
      index,
      action,
      nodeId: node ? node.id : '',
      role: node ? node.role : '',
      available: reason === '',
      reason,
      label: action === 'enter' ? 'Enter settlement' : action === 'exit' ? 'Leave settlement' : action,
    };
  });

  const completed = nodes.filter((node) => node.completed).length;
  const current = nodes.find((node) => node.id === state.currentNodeId) || null;
  const availableRows = rows.filter((row) => row.available);
  const result = {
    version: 1,
    state,
    capabilities: Array.from(capabilities).sort(),
    nodes,
    rows,
    summary: {
      nodeCount: nodes.length,
      completedNodes: completed,
      remainingNodes: Math.max(0, nodes.length - completed),
      availableActions: availableRows.length,
      blockedActions: rows.length - availableRows.length,
      currentNodeId: current ? current.id : '',
      primaryAction: availableRows[0] ? availableRows[0].action : '',
    },
  };
  result.fingerprint = stableSerialize(result);
  return freeze(result);
}

export function isSettlementJourneyContract(value) {
  return Boolean(value && value.version === 1 && Array.isArray(value.rows) && value.summary);
}

export { ACTION_ORDER };
