/**
 * Read-only interaction plan over the canonical settlement role blueprints.
 * The existing settlement runtime remains authoritative for execution/mutation.
 */

const ACTION_ORDER = Object.freeze([
  'enter', 'exit', 'interact', 'talk', 'trade', 'craft',
  'acceptQuest', 'advanceQuest', 'travel', 'save', 'back',
]);

const ROLE_ACTIONS = Object.freeze({
  blacksmith: ['craft', 'trade', 'back'],
  tavern: ['talk', 'interact', 'back'],
  market: ['trade', 'back'],
  farm: ['interact', 'trade', 'travel', 'back'],
  barracks: ['talk', 'interact', 'back'],
  stable: ['interact', 'travel', 'back'],
  house: ['interact', 'talk', 'save', 'back'],
  gate: ['enter', 'exit', 'travel', 'back'],
  settlement: ['enter', 'interact', 'travel', 'save'],
});

const SERVICE_CAPABILITY = Object.freeze({
  blacksmith: 'crafting',
  tavern: 'dialogue',
  market: 'trade',
  farm: 'trade',
  barracks: 'dialogue',
  stable: 'travel',
  house: 'persistence',
  gate: 'door',
  settlement: 'settlement',
});

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 96) : fallback;
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) freeze(entry);
  return value;
}

function normalizeCapabilities(input) {
  if (!Array.isArray(input)) return new Set();
  return new Set(input.map((value) => text(value)).filter(Boolean).slice(0, 16));
}

function normalizeRoleNode(raw, index) {
  const role = text(raw?.role, raw?.kind === 'settlement' ? 'settlement' : 'market');
  const id = text(raw?.id, `${role}-${index + 1}`);
  const configured = Array.isArray(raw?.actions) ? raw.actions : ROLE_ACTIONS[role] || [];
  const actions = [...new Set(configured.map((action) => text(action)).filter((action) => ACTION_ORDER.includes(action)))];
  return { id, role, label: text(raw?.label, role), actions, capability: text(raw?.capability, SERVICE_CAPABILITY[role] || '') };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hash(value) {
  let result = 2166136261;
  const source = stableStringify(value);
  for (let index = 0; index < source.length; index += 1) {
    result ^= source.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

export function buildSettlementRoleInteractionPlan({ definition, capabilities, insideSettlement = true, defeated = false, saveEnabled = true, health = 100, maxRows = 32 } = {}) {
  const rows = Array.isArray(definition?.nodes) ? definition.nodes.slice(0, 32).map(normalizeRoleNode) : [];
  const capabilitySet = normalizeCapabilities(capabilities);
  const healthy = Number.isFinite(Number(health)) && Number(health) > 0;
  const blockedByPlayer = !insideSettlement || defeated || !healthy;
  const planRows = [];

  for (const node of rows) {
    const serviceReady = !node.capability || capabilitySet.has(node.capability);
    const actions = node.actions.slice().sort((a, b) => ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b));
    for (const action of actions) {
      let available = true;
      let reason = '';
      if (blockedByPlayer) { available = false; reason = !insideSettlement ? 'outside-settlement' : defeated ? 'player-defeated' : 'player-unhealthy'; }
      else if (!serviceReady) { available = false; reason = 'capability-unavailable'; }
      else if (action === 'save' && !saveEnabled) { available = false; reason = 'save-disabled'; }
      planRows.push({ nodeId: node.id, role: node.role, label: node.label, action, available, reason, capability: node.capability });
      if (planRows.length >= clampInt(maxRows, 1, 64, 32)) break;
    }
    if (planRows.length >= clampInt(maxRows, 1, 64, 32)) break;
  }

  const available = planRows.filter((row) => row.available);
  const blocked = planRows.filter((row) => !row.available);
  const output = {
    version: 1,
    settlementId: text(definition?.settlementId, 'settlement'),
    insideSettlement: bool(insideSettlement, true),
    defeated: bool(defeated),
    saveEnabled: bool(saveEnabled, true),
    health: Number.isFinite(Number(health)) ? Math.max(0, Number(health)) : 0,
    rows: planRows,
    summary: { total: planRows.length, available: available.length, blocked: blocked.length, primaryAction: available[0]?.action || '' },
  };
  output.digest = hash(output);
  return freeze(output);
}

export function serializeSettlementRoleInteractionPlan(plan) {
  return stableStringify(plan || {});
}
