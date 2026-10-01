/**
 * Deterministic dialogue choice planner for the existing settlement campaign rules.
 * Presentation-only: authoritative dialogue/quest state and handler execution remain external.
 */
import { evaluateDialogueConditions } from './settlementCampaignRules.js';

export const SETTLEMENT_DIALOGUE_PLANNER_VERSION = 1;
const text = (value, fallback = '') => { const v = String(value ?? '').trim(); return v ? v.slice(0, 160) : fallback; };
const integer = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(Number.isFinite(Number(value)) ? Number(value) : fallback)));
const freeze = value => Object.freeze(value);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

export function planSettlementDialogue(dialogue = {}, snapshot = {}) {
  const source = dialogue && typeof dialogue === 'object' ? dialogue : {};
  const choices = (Array.isArray(source.choices) ? source.choices : []).slice(0, 8).map((choice, index) => {
    const item = choice && typeof choice === 'object' ? choice : {};
    const conditions = Array.isArray(item.conditions) ? item.conditions.slice(0, 8).map(text).filter(Boolean) : [];
    const evaluation = evaluateDialogueConditions(conditions, snapshot);
    return {
      id: text(item.id, `choice-${index + 1}`),
      label: text(item.label, 'Continue'),
      action: text(item.action, 'talk'),
      conditions: [...conditions],
      available: evaluation.ok,
      reason: evaluation.ok ? '' : text(evaluation.checks.find(check => !check.ok)?.reason, 'condition-required'),
      checks: clone(evaluation.checks),
      terminal: item.terminal === true,
    };
  });
  const available = choices.filter(choice => choice.available).length;
  const blocked = choices.length - available;
  return freeze({
    version: SETTLEMENT_DIALOGUE_PLANNER_VERSION,
    dialogueId: text(source.id, 'settlement-dialogue'),
    speaker: text(source.speaker, 'Settlement contact'),
    prompt: text(source.prompt, 'Choose a response'),
    choices: freeze(choices.map(choice => freeze(choice))),
    availableCount: available,
    blockedCount: blocked,
    hasAvailableChoice: available > 0,
    summary: `${available}/${choices.length} choices available`,
  });
}

export function getAvailableSettlementDialogueChoices(dialogue, snapshot) {
  return planSettlementDialogue(dialogue, snapshot).choices.filter(choice => choice.available);
}

export function serializeSettlementDialoguePlan(plan) {
  const value = plan && typeof plan === 'object' ? plan : planSettlementDialogue();
  return JSON.stringify({
    version: integer(value.version, 1, 99, 1),
    dialogueId: text(value.dialogueId),
    speaker: text(value.speaker),
    prompt: text(value.prompt),
    choices: Array.isArray(value.choices) ? value.choices.map(choice => ({ id: text(choice.id), available: choice.available === true, reason: text(choice.reason), terminal: choice.terminal === true })) : [],
    availableCount: integer(value.availableCount, 0, 8, 0),
    blockedCount: integer(value.blockedCount, 0, 8, 0),
  });
}
