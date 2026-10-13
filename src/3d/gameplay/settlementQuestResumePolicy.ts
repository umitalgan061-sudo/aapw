const SERVICES = new Set(['blacksmith','tavern','market','farm','barracks','stable','house','gate']);
const REASONS = new Set(['ready','quest-complete','condition-blocked','stage-blocked','invalid-input']);
const finiteRevision = (value) => Number.isInteger(value) && value >= 0 && value <= 999999;
export function isSettlementQuestResumeContract(value) {
  try {
    if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false;
    if (!SERVICES.has(value.serviceId) || !REASONS.has(value.reason)) return false;
    if (!Array.isArray(value.completedStepIds)) return false;
    if (value.completedCount !== value.completedStepIds.length || !finiteRevision(value.progressRevision)) return false;
    return value.completedStepIds.every((id, index, list) => typeof id === 'string' && (index === 0 || list[index - 1] < id));
  } catch {
    return false;
  }
}
