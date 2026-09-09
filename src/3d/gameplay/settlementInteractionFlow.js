/**
 * Settlement interaction flow projection.
 * Builds a bounded, deterministic enter -> interact -> objective -> service flow
 * for existing settlement callers without owning quest, inventory, economy,
 * crafting, travel, persistence, NPC or scene state.
 */

export const SETTLEMENT_INTERACTION_FLOW_VERSION = 1;
const MAX_STEPS = 8;
const MAX_TEXT = 120;

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, MAX_TEXT) : fallback;
};
const bool = (value) => value === true;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const STEP_DEFS = Object.freeze([
  { id: 'enter-settlement', kind: 'enter', label: 'Yerleşime gir', requires: () => true },
  { id: 'open-door', kind: 'door', label: 'İç mekân kapısını aç', requires: context => bool(context.inSettlement) && bool(context.doorAvailable) },
  { id: 'meet-service-npc', kind: 'npc', label: 'Hizmet sağlayıcıyla konuş', requires: context => bool(context.inSettlement) && bool(context.npcAvailable) },
  { id: 'review-quest', kind: 'quest', label: 'Görevi gözden geçir', requires: context => bool(context.inSettlement) && bool(context.questAvailable) },
  { id: 'use-service', kind: 'service', label: 'Yerleşim hizmetini kullan', requires: context => bool(context.inSettlement) && bool(context.serviceAvailable) },
  { id: 'complete-objective', kind: 'objective', label: 'Yerleşim hedefini tamamla', requires: context => bool(context.inSettlement) && bool(context.objectiveReady) },
  { id: 'save-progress', kind: 'save', label: 'İlerlemeni kaydet', requires: context => bool(context.inSettlement) && bool(context.canSave) },
  { id: 'leave-settlement', kind: 'exit', label: 'Yerleşimden ayrıl', requires: context => bool(context.inSettlement) },
]);

function normalizeContext(input = {}) {
  return {
    inSettlement: bool(input.inSettlement),
    doorAvailable: bool(input.doorAvailable),
    npcAvailable: bool(input.npcAvailable),
    questAvailable: bool(input.questAvailable),
    serviceAvailable: bool(input.serviceAvailable),
    objectiveReady: bool(input.objectiveReady),
    canSave: bool(input.canSave),
    fatigue: Math.max(0, finite(input.fatigue)),
    copper: Math.max(0, finite(input.copper)),
  };
}

function freezeStep(step) {
  return Object.freeze({
    id: text(step.id),
    kind: text(step.kind, 'info'),
    label: text(step.label, step.id),
    state: text(step.state, 'blocked'),
    reason: text(step.reason, 'unavailable'),
    actionable: bool(step.actionable),
  });
}

export function buildSettlementInteractionFlow(input = {}) {
  const context = normalizeContext(input);
  const steps = STEP_DEFS.slice(0, MAX_STEPS).map((definition, index) => {
    const available = definition.requires(context);
    const state = available ? (index === 0 || context.inSettlement ? 'available' : 'blocked') : 'blocked';
    const reason = available ? 'ready' : (definition.kind === 'enter' ? 'already-inside-or-entry-owned' : 'context-gate');
    return freezeStep({
      ...definition,
      state,
      reason,
      actionable: available,
    });
  });
  const actionable = steps.filter(step => step.actionable);
  const blockers = steps.filter(step => !step.actionable);
  const fatigueBand = context.fatigue >= 80 ? 'high' : context.fatigue >= 40 ? 'medium' : 'low';
  return Object.freeze({
    version: SETTLEMENT_INTERACTION_FLOW_VERSION,
    context: Object.freeze(context),
    steps: Object.freeze(steps),
    actionableCount: actionable.length,
    blockedCount: blockers.length,
    fatigueBand,
    summary: Object.freeze({
      headline: context.inSettlement ? 'Yerleşim etkileşim akışı hazır' : 'Yerleşime giriş bekleniyor',
      nextAction: text(actionable[0]?.label, 'Yerleşim bağlamı gerekli'),
      copper: context.copper,
    }),
  });
}

export function serializeSettlementInteractionFlow(flow) {
  return JSON.stringify(flow ?? buildSettlementInteractionFlow());
}
