/**
 * Deterministic settlement interaction-focus model.
 * Composes the existing read-only campaign UI model; owns no state, DOM or handlers.
 */
import { createSettlementCampaignUiModel } from './settlementCampaignUiModel.js';

export const SETTLEMENT_FOCUS_VERSION = 1;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const text = (value, fallback = '') => {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, 120) : fallback;
};
const uniq = (items = []) => [...new Set(items.filter(Boolean))];

function rankAction(action, intent, preferred = []) {
  const index = preferred.indexOf(action.action);
  const intentScore = intent === action.intent ? 20 : 0;
  return intentScore + (index < 0 ? 0 : 10 - index);
}

function sectionForIntent(intent) {
  return ({ dialogue: 'talk', economy: 'trade', crafting: 'craft', travel: 'travel', survival: 'rest', progression: 'train', quest: 'advanceQuest', persistence: 'save' })[intent] || 'interact';
}

export function createSettlementInteractionFocus(runtime, options = {}) {
  const ui = createSettlementCampaignUiModel(runtime);
  const preferred = uniq(options.preferredActions || []);
  const maxActions = clamp(options.maxActions ?? 6, 1, 12);

  function build() {
    const model = ui.build();
    const serviceIntent = model.service?.domain?.split('-')[0] || 'interaction';
    const targetAction = sectionForIntent(serviceIntent);
    const actions = model.actions
      .map((action) => ({ ...action, score: rankAction(action, serviceIntent, preferred) + (action.action === targetAction ? 8 : 0) }))
      .sort((a, b) => b.score - a.score || a.action.localeCompare(b.action))
      .slice(0, maxActions)
      .map(({ score, ...action }) => action);
    const blocked = actions.filter((action) => action.enabled === false).map((action) => action.action);
    const panelCounts = Object.fromEntries(Object.entries(model.panels || {}).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0]));
    return Object.freeze({
      version: SETTLEMENT_FOCUS_VERSION,
      runtimeVersion: model.runtimeVersion,
      revision: model.revision,
      service: model.service,
      headline: text(model.header?.title, 'Yerleşim'),
      prompt: text(model.header?.subtitle, 'Bir etkileşim seç.'),
      primaryIntent: serviceIntent,
      actions,
      blockedActions: blocked,
      panelCounts,
      focus: actions[0] ? { action: actions[0].action, section: actions[0].section, intent: actions[0].intent } : null,
      status: { copper: Number(model.status?.copper) || 0, fatigue: Number(model.status?.fatigue) || 0, health: Number(model.status?.health) || 0 },
      feedback: model.feedback || null,
    });
  }

  return Object.freeze({ build, describeQuest: ui.describeQuest, describeDialogue: ui.describeDialogue, describeRecipe: ui.describeRecipe, describeTravel: ui.describeTravel });
}
