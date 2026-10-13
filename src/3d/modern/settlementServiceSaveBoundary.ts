export const SETTLEMENT_SERVICE_SAVE_SCHEMA = 'settlement-service-save/v1';

const SERVICE_IDS = Object.freeze(['blacksmith', 'tavern', 'market', 'farm', 'barracks', 'stable']);
const ACTIONS = Object.freeze(['craft', 'repair', 'rest', 'trade', 'gather', 'train', 'travel']);

const finiteInt = (value, fallback = 0, min = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.floor(parsed)) : fallback;
};

const cleanId = (value, fallback) => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const sortedUniqueStrings = (values) => [...new Set((Array.isArray(values) ? values : [])
  .map((value) => String(value ?? '').trim())
  .filter(Boolean))].sort();

const cloneAndFreeze = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, nested] of Object.entries(value)) output[key] = cloneAndFreeze(nested);
    return Object.freeze(output);
  }
  return value;
};

export function normalizeSettlementServiceSave(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const servicesSource = source.services && typeof source.services === 'object' && !Array.isArray(source.services)
    ? source.services
    : {};
  const services = {};

  for (const serviceId of SERVICE_IDS) {
    const service = servicesSource[serviceId] && typeof servicesSource[serviceId] === 'object'
      ? servicesSource[serviceId]
      : {};
    const actionSource = Array.isArray(service.availableActions) ? service.availableActions : [];
    services[serviceId] = {
      open: service.open !== false,
      questIds: sortedUniqueStrings(service.questIds),
      completedQuestIds: sortedUniqueStrings(service.completedQuestIds),
      availableActions: [...new Set(actionSource.map((action) => String(action ?? '').trim())
        .filter((action) => ACTIONS.includes(action)))].sort((left, right) => ACTIONS.indexOf(left) - ACTIONS.indexOf(right)),
      visitCount: finiteInt(service.visitCount),
      lastInteractionSequence: finiteInt(service.lastInteractionSequence),
    };
  }

  const normalized = {
    schema: SETTLEMENT_SERVICE_SAVE_SCHEMA,
    settlementId: cleanId(source.settlementId, 'unknown-settlement'),
    activeServiceId: SERVICE_IDS.includes(source.activeServiceId) ? source.activeServiceId : null,
    copper: finiteInt(source.copper),
    inventoryItemIds: sortedUniqueStrings(source.inventoryItemIds),
    completedQuestIds: sortedUniqueStrings(source.completedQuestIds),
    services,
    interactionSequence: finiteInt(source.interactionSequence),
  };

  return cloneAndFreeze(normalized);
}

export function createSettlementServiceSaveEnvelope(input = {}) {
  const snapshot = normalizeSettlementServiceSave(input);
  const serialized = JSON.stringify(snapshot);
  let checksum = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    checksum ^= serialized.charCodeAt(index);
    checksum = Math.imul(checksum, 16777619) >>> 0;
  }
  return Object.freeze({ schema: SETTLEMENT_SERVICE_SAVE_SCHEMA, checksum, snapshot });
}

export function restoreSettlementServiceSaveEnvelope(envelope = {}) {
  const candidate = envelope && typeof envelope === 'object' && !Array.isArray(envelope) ? envelope : {};
  const restored = createSettlementServiceSaveEnvelope(candidate.snapshot);
  const checksumMatches = Number(candidate.checksum) === restored.checksum;
  return Object.freeze({
    ok: checksumMatches && candidate.schema === SETTLEMENT_SERVICE_SAVE_SCHEMA,
    reason: checksumMatches ? 'restored' : 'checksum-mismatch',
    envelope: restored,
  });
}

export function isSettlementServiceSaveEnvelope(value) {
  return Boolean(value && value.schema === SETTLEMENT_SERVICE_SAVE_SCHEMA && value.snapshot);
}

export const SETTLEMENT_SERVICE_SAVE_SERVICE_IDS = SERVICE_IDS;
export const SETTLEMENT_SERVICE_SAVE_ACTIONS = ACTIONS;
