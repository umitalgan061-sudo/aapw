const SERVICES = Object.freeze(['blacksmith','tavern','market','farm','barracks','stable','house','gate']);
const STAGES = Object.freeze(['approach','inside','service','departure','resume']);
const ACTIONS = Object.freeze(['enter','talk','craft','trade','rest','travel','exit']);
const uniqSorted = (xs) => [...new Set(xs)].sort();
function createSettlementServiceIntent(input) {
  if (!input || typeof input !== 'object') return Object.freeze({ status: 'invalid-input', intentKey: 'invalid-input' });
  const serviceId = SERVICES.includes(input.serviceId) ? input.serviceId : null;
  const stage = STAGES.includes(input.stage) ? input.stage : null;
  const availableActions = Array.isArray(input.availableActions) ? uniqSorted(input.availableActions.filter((x) => ACTIONS.includes(x))) : null;
  const activeQuestIds = Array.isArray(input.activeQuestIds) ? uniqSorted(input.activeQuestIds.filter((x) => typeof x === 'string')) : null;
  const completedQuestIds = Array.isArray(input.completedQuestIds) ? uniqSorted(input.completedQuestIds.filter((x) => typeof x === 'string')) : null;
  const interactionCount = Number.isInteger(input.interactionCount) ? Math.min(999, Math.max(0, input.interactionCount)) : null;
  if (!serviceId || !stage || !availableActions || !activeQuestIds || !completedQuestIds || interactionCount === null) return Object.freeze({ status: 'invalid-input', intentKey: 'invalid-input' });
  const nextAction = availableActions[0] ?? 'exit';
  const status = stage === 'service' && nextAction !== 'exit' ? 'ready' : stage === 'resume' ? 'resume-ready' : 'stage-blocked';
  const intentKey = [serviceId, stage, status, nextAction, availableActions.join(','), activeQuestIds.join(','), completedQuestIds.join(','), interactionCount].join('|');
  return Object.freeze({ status, serviceId, stage, nextAction, availableActions: Object.freeze(availableActions), activeQuestIds: Object.freeze(activeQuestIds), completedQuestIds: Object.freeze(completedQuestIds), interactionCount, intentKey });
}
function isSettlementServiceIntent(value) {
  try {
    if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false;
    const expected = createSettlementServiceIntent(value);
    return expected.intentKey === value.intentKey && expected.status === value.status && expected.nextAction === value.nextAction;
  } catch { return false; }
}
export { createSettlementServiceIntent, isSettlementServiceIntent, SERVICES, STAGES, ACTIONS };
