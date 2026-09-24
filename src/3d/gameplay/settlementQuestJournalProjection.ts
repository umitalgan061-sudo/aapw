const STATUS_ORDER = Object.freeze(['available', 'active', 'completed', 'failed', 'unknown']);

function asText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asFinite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeStatus(value) {
  const status = asText(value, 'unknown').toLowerCase();
  return STATUS_ORDER.includes(status) ? status : 'unknown';
}

function normalizeObjective(objective, index) {
  const id = asText(objective?.id, `objective-${index + 1}`);
  const target = Math.max(0, asFinite(objective?.target ?? objective?.required, 0));
  const progress = Math.min(target || Number.POSITIVE_INFINITY, Math.max(0, asFinite(objective?.progress ?? objective?.current, 0)));
  const completed = objective?.completed === true || (target > 0 && progress >= target);
  return Object.freeze({
    id,
    title: asText(objective?.title ?? objective?.label, id),
    progress,
    target,
    completed,
    state: completed ? 'completed' : progress > 0 ? 'in-progress' : 'not-started',
  });
}

function normalizeQuest(quest, index) {
  const id = asText(quest?.id, `quest-${index + 1}`);
  const objectives = Array.isArray(quest?.objectives)
    ? quest.objectives.map(normalizeObjective).sort((a, b) => a.id.localeCompare(b.id))
    : [];
  const completedCount = objectives.filter((objective) => objective.completed).length;
  const status = normalizeStatus(quest?.status ?? quest?.state);
  return Object.freeze({
    id,
    title: asText(quest?.title ?? quest?.name, id),
    status,
    objectives: Object.freeze(objectives),
    completedCount,
    objectiveCount: objectives.length,
    completion: objectives.length === 0 ? status === 'completed' ? 1 : 0 : completedCount / objectives.length,
    source: asText(quest?.source, 'settlement'),
  });
}

function stableSignature(quests) {
  return quests.map((quest) => `${quest.id}:${quest.status}:${quest.completedCount}/${quest.objectiveCount}:${quest.objectives.map((objective) => `${objective.id}=${objective.progress}/${objective.target}`).join(',')}`).join('|');
}

export function createSettlementQuestJournalProjection(input = {}) {
  const rawQuests = Array.isArray(input.quests) ? input.quests : [];
  const quests = rawQuests.map(normalizeQuest).sort((a, b) => a.id.localeCompare(b.id));
  const active = quests.filter((quest) => quest.status === 'active');
  const readyToTurnIn = active.filter((quest) => quest.objectiveCount > 0 && quest.completedCount === quest.objectiveCount);
  const completed = quests.filter((quest) => quest.status === 'completed');
  const projection = {
    version: 1,
    settlementId: asText(input.settlementId, 'unknown-settlement'),
    quests: Object.freeze(quests),
    activeCount: active.length,
    readyToTurnInCount: readyToTurnIn.length,
    completedCount: completed.length,
    readyToTurnInIds: Object.freeze(readyToTurnIn.map((quest) => quest.id)),
    signature: stableSignature(quests),
    failClosed: rawQuests.length === 0 && input.quests != null,
  };
  return deepFreeze(projection);
}

export function isSettlementQuestJournalProjection(value) {
  return Boolean(value && value.version === 1 && typeof value.settlementId === 'string' && Array.isArray(value.quests) && typeof value.signature === 'string');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
