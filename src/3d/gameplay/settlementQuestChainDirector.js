const DEFAULT_MAX_STEPS = 8;
const ALLOWED_TYPES = new Set(['talk', 'trade', 'craft', 'travel', 'rest', 'save', 'interact']);
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const text = (v, fallback = '') => typeof v === 'string' ? v : fallback;
const clone = (v) => JSON.parse(JSON.stringify(v));
function freezeDeep(v) { if (!v || typeof v !== 'object' || Object.isFrozen(v)) return v; Object.freeze(v); for (const child of Object.values(v)) freezeDeep(child); return v; }
function stable(v) { if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`; if (!v || typeof v !== 'object') return JSON.stringify(v); return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`; }
function normalizeNode(node, index) {
  const id = text(node?.id, `settlement-step-${index + 1}`);
  const type = ALLOWED_TYPES.has(node?.type) ? node.type : 'interact';
  const requiredItem = text(node?.requiredItem);
  return { id, type, title: text(node?.title, id), summary: text(node?.summary), service: text(node?.service, type), order: Math.max(0, finite(node?.order, index)), requiredFlag: text(node?.requiredFlag), requiredQuest: text(node?.requiredQuest), requiredItem, requiredItemCount: Math.max(0, Math.floor(finite(node?.requiredItemCount, requiredItem ? 1 : 0))), requiredGold: Math.max(0, Math.floor(finite(node?.requiredGold))), requiredSkill: text(node?.requiredSkill), requiredSkillLevel: Math.max(0, finite(node?.requiredSkillLevel)), requiredDialogueChoice: text(node?.requiredDialogueChoice), requiredDependency: text(node?.dependsOn), requiredReputation: finite(node?.requiredReputation), completionReceipt: text(node?.completionReceipt) };
}
function hasItem(items, id, count) { return !id || count <= 0 || finite(items?.[id]) >= count; }
function hasSkill(skills, id, level) { return !id || finite(skills?.[id]) >= level; }
function isComplete(node, state) { return state.completedSteps?.[node.id] === true || state.completedServices?.[node.service] === true || (node.completionReceipt && state.receipts?.[node.completionReceipt] === true); }
function blockedReason(node, state, completedIds) {
  if (node.requiredDependency && !completedIds.has(node.requiredDependency)) return `dependency-incomplete:${node.requiredDependency}`;
  if (node.requiredFlag && state.flags?.[node.requiredFlag] !== true) return `missing-flag:${node.requiredFlag}`;
  if (node.requiredQuest && state.quests?.[node.requiredQuest] !== 'complete') return `quest-not-complete:${node.requiredQuest}`;
  if (node.requiredDialogueChoice && state.dialogueChoices?.[node.requiredDialogueChoice] !== true) return `dialogue-choice-missing:${node.requiredDialogueChoice}`;
  if (finite(state.reputation?.[node.service]) < node.requiredReputation) return `reputation-too-low:${node.service}`;
  if (!hasItem(state.items, node.requiredItem, node.requiredItemCount)) return `missing-item:${node.requiredItem}`;
  if (finite(state.gold) < node.requiredGold) return `insufficient-gold:${node.requiredGold}`;
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
    const insideSettlement = input.insideSettlement === true;
    const alive = input.alive !== false;
    const visibleNodes = insideSettlement && alive ? nodes.slice(0, maxSteps) : [];
    const completedIds = new Set(visibleNodes.filter((node) => isComplete(node, state)).map((node) => node.id));
    const rows = visibleNodes.map((node) => { const complete = completedIds.has(node.id); const reason = complete ? null : blockedReason(node, state, completedIds); return { ...node, complete, available: !complete && !reason, blockedReason: reason }; });
    const next = rows.find((row) => row.available) || rows.find((row) => !row.complete) || null;
    const result = { settlementId: text(input.settlementId, 'unknown-settlement'), insideSettlement, alive, totalSteps: rows.length, completedSteps: rows.filter((row) => row.complete).length, complete: rows.length > 0 && rows.every((row) => row.complete), nextStepId: next?.id || null, rows };
    return freezeDeep(clone({ ...result, fingerprint: stable({ settlementId: result.settlementId, rows }) }));
  }
  return Object.freeze({ evaluate });
}
export const settlementQuestChainDirectorInternals = Object.freeze({ normalizeNode, blockedReason, stable });
