/**
 * Read-only dialogue consequence preview over the existing settlement rules/content.
 * The authoritative dialogue evaluator and state mutator remain caller-owned.
 */
import { getSettlementDialogueCondition, getSettlementUxMessage } from './settlementCampaignContent.js';
import { evaluateDialogueConditions, normalizeRpgSnapshot } from './settlementCampaignRules.js';

export const SETTLEMENT_DIALOGUE_CONSEQUENCE_PREVIEW_VERSION = 1;
const LIMITS = Object.freeze({ choices: 16, text: 160, effects: 8 });
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, LIMITS.text) : fallback;
};
const integer = (value, min, max, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback;
};
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const digest = (value) => {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
};
const normalizeChoice = (raw, index) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const conditions = Array.isArray(source.conditions) ? source.conditions.slice(0, 8).map((id) => text(id)).filter(Boolean) : [];
  const effects = Array.isArray(source.effects) ? source.effects.slice(0, LIMITS.effects).map((effect) => {
    const item = effect && typeof effect === 'object' ? effect : {};
    return { type: text(item.type, 'unknown'), target: text(item.target), amount: integer(item.amount, -999, 999, 0) };
  }) : [];
  return { id: text(source.id, `choice-${index + 1}`), label: text(source.label, `Seçenek ${index + 1}`), conditions, effects, terminal: Boolean(source.terminal) };
};
const summarizeEffect = (effect) => {
  if (effect.type === 'copper') return effect.amount >= 0 ? `+${effect.amount} bakır` : `${effect.amount} bakır`;
  if (effect.type === 'reputation') return effect.amount >= 0 ? `+${effect.amount} itibar` : `${effect.amount} itibar`;
  if (effect.type === 'xp') return effect.amount >= 0 ? `+${effect.amount} XP` : `${effect.amount} XP`;
  if (effect.type === 'flag') return effect.target ? `İşaret: ${effect.target}` : 'İşaret güncellenecek';
  if (effect.type === 'quest') return effect.target ? `Görev: ${effect.target}` : 'Görev ilerlemesi';
  return effect.target ? `${effect.type}: ${effect.target}` : effect.type;
};
function conditionLabels(ids) {
  return ids.map((id) => {
    const condition = getSettlementDialogueCondition(id);
    return condition ? text(condition.label, id) : id;
  });
}
function buildPreview(rawDialogue = {}, rawSnapshot = {}) {
  const dialogue = rawDialogue && typeof rawDialogue === 'object' ? rawDialogue : {};
  const snapshot = normalizeRpgSnapshot(rawSnapshot);
  const choices = (Array.isArray(dialogue.choices) ? dialogue.choices : []).slice(0, LIMITS.choices).map(normalizeChoice);
  const rows = choices.map((choice, index) => {
    const evaluation = evaluateDialogueConditions(choice.conditions, snapshot);
    const available = evaluation?.ok === true;
    const effects = choice.effects.map(summarizeEffect);
    return {
      index,
      id: choice.id,
      label: choice.label,
      available,
      status: available ? 'available' : 'blocked',
      reason: available ? '' : text(evaluation?.reason, 'conditions-required'),
      conditions: conditionLabels(choice.conditions),
      effects,
      terminal: choice.terminal,
    };
  });
  const available = rows.filter((row) => row.available);
  const blocked = rows.filter((row) => !row.available);
  const projection = {
    version: SETTLEMENT_DIALOGUE_CONSEQUENCE_PREVIEW_VERSION,
    dialogueId: text(dialogue.id, 'settlement-dialogue'),
    title: text(dialogue.title, 'Yerleşim konuşması'),
    prompt: text(dialogue.prompt, getSettlementUxMessage('dialogue-prompt') || 'Bir seçim yap.'),
    choices: rows,
    availableCount: available.length,
    blockedCount: blocked.length,
    terminalAvailable: available.some((row) => row.terminal),
    nextChoiceId: available[0]?.id ?? '',
    summary: `${available.length} açık, ${blocked.length} kilitli seçenek`,
  };
  projection.digest = digest(projection);
  return freeze(projection);
}

export function previewSettlementDialogueConsequences(dialogue, snapshot) {
  return buildPreview(dialogue, snapshot);
}

export function serializeSettlementDialogueConsequencePreview(dialogue, snapshot) {
  return stable(previewSettlementDialogueConsequences(dialogue, snapshot));
}
