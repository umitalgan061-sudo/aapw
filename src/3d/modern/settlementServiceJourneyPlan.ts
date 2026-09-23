export const SETTLEMENT_JOURNEY_STAGES = Object.freeze(['enter', 'service', 'departure', 'resume']);
export const SETTLEMENT_SERVICE_IDS = Object.freeze(['blacksmith', 'tavern', 'market', 'farm', 'barracks', 'stable']);
export const SETTLEMENT_ACTIONS = Object.freeze(['craft', 'repair', 'rest', 'trade', 'gather', 'train', 'travel']);

const asText = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const asFinite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const uniqueSorted = (values) => [...new Set((Array.isArray(values) ? values : []).map((value) => asText(value)).filter(Boolean))].sort();
const freeze = (value) => Object.freeze(value);

const actionForService = Object.freeze({
  blacksmith: Object.freeze(['craft', 'repair']),
  tavern: Object.freeze(['rest', 'trade']),
  market: Object.freeze(['trade']),
  farm: Object.freeze(['gather', 'rest']),
  barracks: Object.freeze(['train', 'rest']),
  stable: Object.freeze(['travel', 'rest']),
});

const stageIndex = (stage) => SETTLEMENT_JOURNEY_STAGES.indexOf(stage);
const isKnownService = (serviceId) => SETTLEMENT_SERVICE_IDS.includes(serviceId);
const isKnownAction = (action) => SETTLEMENT_ACTIONS.includes(action);

export function normalizeSettlementJourneyInput(input = {}) {
  const serviceId = asText(input.serviceId, '');
  const action = asText(input.action, '');
  const currentStage = SETTLEMENT_JOURNEY_STAGES.includes(input.currentStage) ? input.currentStage : 'enter';
  const questIds = uniqueSorted(input.questIds);
  const completedQuestIds = uniqueSorted(input.completedQuestIds);
  const missingQuestIds = questIds.filter((questId) => !completedQuestIds.includes(questId));
  return freeze({
    settlementId: asText(input.settlementId, 'settlement'),
    serviceId,
    action,
    currentStage,
    serviceOpen: input.serviceOpen !== false,
    accessGranted: input.accessGranted !== false,
    playerAvailable: input.playerAvailable !== false,
    destinationKnown: input.destinationKnown !== false,
    questIds,
    completedQuestIds,
    missingQuestIds,
    visitCount: clamp(Math.floor(asFinite(input.visitCount, 0)), 0, 999999),
    interactionSequence: clamp(Math.floor(asFinite(input.interactionSequence, 0)), 0, 999999),
  });
}

function fail(input, reason, detail = {}) {
  return freeze({
    allowed: false,
    reason,
    stage: input.currentStage,
    settlementId: input.settlementId,
    serviceId: input.serviceId,
    action: input.action,
    nextStage: input.currentStage,
    ...detail,
  });
}

export function createSettlementServiceJourneyPlan(input = {}) {
  const normalized = normalizeSettlementJourneyInput(input);
  if (!isKnownService(normalized.serviceId)) return fail(normalized, 'unknown-service');
  if (!isKnownAction(normalized.action)) return fail(normalized, 'unknown-action');
  if (normalized.currentStage === 'enter' && !normalized.accessGranted) return fail(normalized, 'access-denied', { nextStage: 'enter' });
  if (normalized.currentStage === 'enter' && !normalized.playerAvailable) return fail(normalized, 'player-unavailable', { nextStage: 'enter' });
  if (normalized.currentStage === 'service' && !normalized.serviceOpen) return fail(normalized, 'service-closed', { nextStage: 'departure' });
  if (!actionForService[normalized.serviceId].includes(normalized.action)) return fail(normalized, 'action-unavailable');
  if (normalized.missingQuestIds.length > 0) return fail(normalized, 'quest-locked', { missingQuestIds: normalized.missingQuestIds });
  if (normalized.action === 'travel' && !normalized.destinationKnown) return fail(normalized, 'destination-unknown');
  const nextStage = normalized.currentStage === 'enter' ? 'service' : normalized.currentStage === 'service' ? 'departure' : normalized.currentStage === 'departure' ? 'resume' : 'resume';
  const visitCount = normalized.currentStage === 'enter' ? normalized.visitCount + 1 : normalized.visitCount;
  const interactionSequence = normalized.interactionSequence + 1;
  return freeze({
    allowed: true,
    reason: 'allowed',
    stage: normalized.currentStage,
    nextStage,
    settlementId: normalized.settlementId,
    serviceId: normalized.serviceId,
    action: normalized.action,
    visitCount,
    interactionSequence,
    missingQuestIds: normalized.missingQuestIds,
    receiptKey: [normalized.settlementId, normalized.serviceId, normalized.action, normalized.currentStage, visitCount, interactionSequence].join(':'),
  });
}

export function applySettlementServiceJourneyPlan(state = {}, plan = {}) {
  if (!plan || plan.allowed !== true) return freeze({ applied: false, reason: 'plan-blocked', state: freeze({ ...state }) });
  const next = {
    ...state,
    settlementId: asText(plan.settlementId, asText(state.settlementId, 'settlement')),
    activeStage: asText(plan.nextStage, 'resume'),
    activeServiceId: asText(plan.serviceId, ''),
    lastAction: asText(plan.action, ''),
    visitCount: clamp(Math.floor(asFinite(plan.visitCount, asFinite(state.visitCount, 0))), 0, 999999),
    interactionSequence: clamp(Math.floor(asFinite(plan.interactionSequence, asFinite(state.interactionSequence, 0))), 0, 999999),
    lastReceiptKey: asText(plan.receiptKey, ''),
  };
  return freeze({ applied: true, reason: 'applied', state: freeze(next) });
}
