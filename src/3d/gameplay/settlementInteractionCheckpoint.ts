const SERVICES = new Set(['blacksmith', 'tavern', 'market', 'farm', 'barracks', 'stable', 'house', 'gate']);
const STAGES = new Set(['approach', 'inside', 'service', 'departure', 'resume']);
const ACTIONS = new Set(['enter', 'talk', 'craft', 'repair', 'rest', 'trade', 'gather', 'train', 'travel', 'exit']);
const REASONS = new Set(['ready', 'service-closed', 'access-blocked', 'quest-blocked', 'action-unavailable', 'invalid-input']);

const clampInt = (value, min = 0, max = 999) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

const normalizeIdList = (value) => [...new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()) : [])].sort();
const normalizeActionList = (value) => [...new Set(Array.isArray(value) ? value.filter((action) => ACTIONS.has(action)) : [])].sort();
const stableKey = (parts) => {
  let hash = 2166136261;
  for (const char of parts.join('|')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

export function createSettlementInteractionCheckpoint(input = {}) {
  try {
    const serviceId = SERVICES.has(input.serviceId) ? input.serviceId : null;
    const stage = STAGES.has(input.stage) ? input.stage : null;
    const requestedAction = ACTIONS.has(input.requestedAction) ? input.requestedAction : null;
    const availableActions = normalizeActionList(input.availableActions);
    const missingQuestIds = normalizeIdList(input.missingQuestIds);
    const visitCount = clampInt(input.visitCount, 0, 9999);
    const interactionSequence = clampInt(input.interactionSequence, 0, 999999);
    const serviceOpen = input.serviceOpen === true;
    const accessAllowed = input.accessAllowed !== false;
    const questSatisfied = input.questSatisfied !== false;
    const actionAllowed = Boolean(requestedAction && availableActions.includes(requestedAction));
    const reason = !serviceId || !stage || !requestedAction ? 'invalid-input'
      : !serviceOpen ? 'service-closed'
      : !accessAllowed ? 'access-blocked'
      : !questSatisfied || missingQuestIds.length ? 'quest-blocked'
      : !actionAllowed ? 'action-unavailable'
      : 'ready';
    const ready = reason === 'ready';
    const checkpoint = {
      serviceId,
      stage,
      requestedAction,
      availableActions,
      missingQuestIds,
      visitCount,
      interactionSequence,
      serviceOpen,
      accessAllowed,
      questSatisfied,
      actionAllowed,
      ready,
      reason,
    };
    checkpoint.checkpointKey = stableKey([
      serviceId ?? 'null', stage ?? 'null', requestedAction ?? 'null', availableActions.join(','),
      missingQuestIds.join(','), String(visitCount), String(interactionSequence), String(serviceOpen),
      String(accessAllowed), String(questSatisfied), String(actionAllowed), reason,
    ]);
    return deepFreeze(checkpoint);
  } catch {
    return deepFreeze({ serviceId: null, stage: null, requestedAction: null, availableActions: [], missingQuestIds: [], visitCount: 0, interactionSequence: 0, serviceOpen: false, accessAllowed: false, questSatisfied: false, actionAllowed: false, ready: false, reason: 'invalid-input', checkpointKey: '00000000' });
  }
}

export function isSettlementInteractionCheckpoint(value) {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false;
  if (value.serviceId !== null && !SERVICES.has(value.serviceId)) return false;
  if (value.stage !== null && !STAGES.has(value.stage)) return false;
  if (value.requestedAction !== null && !ACTIONS.has(value.requestedAction)) return false;
  if (!Array.isArray(value.availableActions) || !Array.isArray(value.missingQuestIds)) return false;
  if (value.availableActions.some((action, index, list) => !ACTIONS.has(action) || (index > 0 && list[index - 1] >= action))) return false;
  if (value.missingQuestIds.some((id, index, list) => typeof id !== 'string' || (index > 0 && list[index - 1] >= id))) return false;
  if (!REASONS.has(value.reason) || typeof value.checkpointKey !== 'string') return false;
  if (typeof value.ready !== 'boolean' || typeof value.actionAllowed !== 'boolean') return false;
  if (value.ready !== (value.reason === 'ready') || value.actionAllowed !== Boolean(value.requestedAction && value.availableActions.includes(value.requestedAction))) return false;
  const expected = createSettlementInteractionCheckpoint(value);
  return expected.checkpointKey === value.checkpointKey && expected.reason === value.reason;
}
