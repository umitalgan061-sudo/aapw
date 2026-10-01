/**
 * Deterministic save/load checkpoint projection for settlement UX.
 * The existing settlement runtime remains authoritative for persistence.
 */

export const SETTLEMENT_SAVE_CHECKPOINT_VERSION = 1;
export const SETTLEMENT_SAVE_CHECKPOINT_LIMITS = Object.freeze({
  slots: 8,
  quests: 32,
  history: 16,
  text: 96,
});

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_SAVE_CHECKPOINT_LIMITS.text) : fallback;
};
const integer = (value, min, max, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function digest(value) {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function normalizeQuestMap(raw) {
  const quests = {};
  for (const [id, value] of Object.entries(raw ?? {}).slice(0, SETTLEMENT_SAVE_CHECKPOINT_LIMITS.quests)) {
    const record = value && typeof value === 'object' ? value : {};
    quests[text(id)] = {
      state: text(record.state, 'unknown'),
      step: integer(record.step, 0, 999, 0),
      completed: Boolean(record.completed),
      rewardClaimed: Boolean(record.rewardClaimed),
    };
  }
  return quests;
}

export function normalizeSettlementCheckpoint(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const inventory = {};
  for (const [id, quantity] of Object.entries(source.inventory ?? {}).slice(0, 96)) {
    inventory[text(id)] = integer(quantity, 0, 9999, 0);
  }
  return {
    schemaVersion: integer(source.schemaVersion, 1, 999, 1),
    savedAt: integer(source.savedAt, 0, 9999999999999, 0),
    slotId: text(source.slotId, 'settlement-autosave'),
    settlementId: text(source.settlementId, 'settlement'),
    locationId: text(source.locationId),
    copper: integer(source.copper, 0, 999999, 0),
    fatigue: Math.max(0, Math.min(100, finite(source.fatigue, 0))),
    health: Math.max(0, Math.min(100, finite(source.health, 100))),
    inventory,
    equipment: Object.fromEntries(Object.entries(source.equipment ?? {}).slice(0, 24).map(([id, item]) => [text(id), text(item)])),
    quests: normalizeQuestMap(source.quests),
    perks: [...new Set((Array.isArray(source.perks) ? source.perks : []).map((id) => text(id)).filter(Boolean))].slice(0, 24),
    route: (Array.isArray(source.route) ? source.route : []).map((id) => text(id)).filter(Boolean).slice(-SETTLEMENT_SAVE_CHECKPOINT_LIMITS.history),
  };
}

export function createSettlementSaveCheckpointPlanner(options = {}) {
  const current = normalizeSettlementCheckpoint(options.currentState);
  const stored = Array.isArray(options.slots) ? options.slots.slice(0, SETTLEMENT_SAVE_CHECKPOINT_LIMITS.slots).map(normalizeSettlementCheckpoint) : [];
  const canSave = options.canSave !== false && current.health > 0;
  const reason = canSave ? '' : current.health <= 0 ? 'player-defeated' : 'save-disabled';
  const latest = stored.slice().sort((a, b) => b.savedAt - a.savedAt || a.slotId.localeCompare(b.slotId))[0] ?? null;
  const delta = latest ? {
    copper: current.copper - latest.copper,
    fatigue: Number((current.fatigue - latest.fatigue).toFixed(3)),
    questChanges: Object.keys({ ...latest.quests, ...current.quests }).filter((id) => stable(latest.quests[id]) !== stable(current.quests[id])).length,
    inventoryChanges: Object.keys({ ...latest.inventory, ...current.inventory }).filter((id) => (latest.inventory[id] ?? 0) !== (current.inventory[id] ?? 0)).length,
  } : { copper: 0, fatigue: 0, questChanges: 0, inventoryChanges: 0 };
  const result = {
    version: SETTLEMENT_SAVE_CHECKPOINT_VERSION,
    canSave,
    reason,
    slotId: text(options.slotId, 'settlement-autosave'),
    current,
    latest,
    delta,
    summary: {
      settlementId: current.settlementId,
      locationId: current.locationId,
      questCount: Object.keys(current.quests).length,
      completedQuestCount: Object.values(current.quests).filter((quest) => quest.completed).length,
      inventoryKinds: Object.keys(current.inventory).length,
      routeLength: current.route.length,
    },
  };
  result.digest = digest(result);
  return freeze(result);
}

export function serializeSettlementSaveCheckpoint(value) {
  return stable(value);
}
