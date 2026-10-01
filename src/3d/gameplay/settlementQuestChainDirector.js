const DEFAULT_MAX_STEPS = 8;
const ALLOWED_TYPES = new Set(['talk', 'trade', 'craft', 'travel', 'rest', 'save', 'interact']);

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function bool(value) {
  return value === true;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function normalizeNode(node, index) {
  const id = text(node?.id, `settlement-step-${index + 1}`);
  const type = ALLOWED_TYPES.has(node?.type) ? node.type : 'interact';
  const requiredFlag = text(node?.requiredFlag);
  const requiredQuest = text(node?.requiredQuest);
  const requiredItem = text(node?.requiredItem);
  const requiredSkill = text(node?.requiredSkill);
  const requiredDialogueChoice = text(node?.requiredDialogueChoice);
  const requiredDependency = text(node?.dependsOn);
  const completionReceipt = text(node?.completionReceipt);
  const requiredReputation = finite(node?.requiredReputation, 0);
  const requiredSkillLevel = Math.max(0, finite(node?.requiredSkillLevel));
  const requiredItemCount = Math.max(0, Math.floor(finite(node?.requiredItemCount, requiredItem ? 1 : 0)));
  const requiredGold = Math.max(0, Math.floor(finite(node?.requiredGold, 0)));
  return {
    id,
    type,
    title: text(node?.title, id),
    summary: text(node?.summary),
    service: text(node?.service, type),
    order: Math.max(0, finite(node?.order, index)),
    requiredFlag,
    requiredQuest,
    requiredItem,
    requiredItemCount,
    requiredGold,
    requiredSkill,
    requiredSkillLevel,
    requiredDialogueChoice,
    requiredDependency,
    requiredReputation,
    completionReceipt,
  };
}

function hasItem(items, itemId, count) {
  if (!itemId || count <= 0) return true;
  return finite(items?.[itemId]) >= count;
}

function hasSkill(skills, skillId, level) {
  if (!skillId) return true;
  return finite(skills?.[skillId]) >= level;
}

function isComplete(node, state) {
  if (state.completedSteps?.[node.id] === true) return true;
  if (state.completedServices?.[node.service] === true) return true;
  if (node.completionReceipt && state.receipts?.[node.completionReceipt] === true) return true;
  return false;
}

function blockedReason(node, state, completedIds) {
  if (node.requiredDependency && completedIds.has(node.requiredDependency) === false) return `dependency-incomplete:${node.requiredDependency}`;
  if (node.requiredFlag && state.flags?.[node.requiredFlag] !== true) return `missing-flag:${node.requiredFlag}`;
  if (node.requiredQuest && state.quests?.[node.requiredQuest] !== 'complete') return `quest-not-complete:${node.requiredQuest}`;
  if (node.requiredDialogueChoice && state.dialogueChoices?.[node.requiredDialogueChoice] !== true) return `dialogue-choice-missing:${node.requiredDialogueChoice}`;
  if (finite(state.reputation?.[node.service], 0) < node.requiredReputation) return `reputation-too-low:${node.service}`;
  if (!hasItem(state.items, node.requiredItem, node.requiredItemCount)) return `missing-item:${node.requiredItem}`;
  if (finite(state.gold, 0) < node.requiredGold) return `insufficient-gold:${node.requiredGold}`;
  if (!hasSkill(state.skills, node.requiredSkill, node.requiredSkillLevel)) return `skill-too-low:${node.requiredSkill}`;
  if (node.type === 'trade' && state.services?.trade !== true) return 'trade-unavailable';
  if (node.type === 'craft' && state.services?.craft !== true) return 'crafting-unavailable';
  if (node.type === 'travel' && state.services?.travel !== true) return 'travel-unavailable';
  if (node.type === 'rest' && state.services?.rest !== true) return 'rest-unavailable';
  return null;
}

export function createSettlementQuestChainDirector(options = {}) {
  const maxSteps = Math.min(DEFAULT_MAX_STEPS, Math.max(1, Math.floor(finite(options.maxSteps, DEFAULT_MAX_STEPS))));
  const nodes = Array.isArray(options.nodes) ? options.nodes.map(normalizeNode).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) : [];

  function evaluate(input = {}) {
    const state = input.state && typeof input.state === 'object' ? input.state : {};
    const insideSettlement = bool(input.insideSettlement);
    const alive = input.alive !== false;
    const visibleNodes = insideSettlement && alive ? nodes.slice(0, maxSteps) : [];
    const completedIds = new Set(visibleNodes.filter((node) => isComplete(node, state)).map((node) => node.id));
    const rows = visibleNodes.map((node) => {
      const complete = completedIds.has(node.id);
      const reason = complete ? null : blockedReason(node, state, completedIds);
      return { ...node, complete, available: !complete && !reason, blockedReason: reason };
    });
    const available = rows.filter((row) => row.available);
    const next = available[0] || rows.find((row) => !row.complete) || null;
    const completedCount = rows.filter((row) => row.complete).length;
    const result = {
      settlementId: text(input.settlementId, 'unknown-settlement'),
      insideSettlement,
      alive,
      totalSteps: rows.length,
      completedSteps: completedCount,
      complete: rows.length > 0 && completedCount === rows.length,
      nextStepId: next?.id || null,
      rows,
      fingerprint: stable({ settlementId: text(input.settlementId, 'unknown-settlement'), rows }),
    };
    return freezeDeep(clone(result));
  }

  return Object.freeze({ evaluate });
}

export const settlementQuestChainDirectorInternals = Object.freeze({ normalizeNode, blockedReason, stable });
