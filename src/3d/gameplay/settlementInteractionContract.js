/**
 * Canonical interaction contract for the authored settlement vertical slice.
 *
 * This module only translates an existing content journey plus caller-owned runtime
 * observations into bounded interaction steps. It does not execute handlers or mutate
 * quest, inventory, economy, crafting, travel, persistence, NPC, scene, or placement state.
 */

export const SETTLEMENT_INTERACTION_CONTRACT_VERSION = 1;

const ACTIONS = Object.freeze({
  gate: Object.freeze(['enter', 'exit']),
  market: Object.freeze(['trade']),
  tavern: Object.freeze(['talk', 'rest', 'acceptQuest']),
  blacksmith: Object.freeze(['craft', 'trade']),
  farm: Object.freeze(['interact', 'trade']),
  barracks: Object.freeze(['talk', 'interact']),
  stable: Object.freeze(['travel']),
  house: Object.freeze(['talk', 'save']),
});

const REQUIRED_CAPABILITIES = Object.freeze({
  enter: 'insideSettlement',
  exit: 'insideSettlement',
  trade: 'insideSettlement',
  talk: 'insideSettlement',
  rest: 'insideSettlement',
  acceptQuest: 'insideSettlement',
  craft: 'insideSettlement',
  interact: 'insideSettlement',
  travel: 'insideSettlement',
  save: 'insideSettlement',
});

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 96) : fallback;
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function bool(value) {
  return value === true;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function digest(value) {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function roleActions(role) {
  return ACTIONS[role] || [];
}

function normalizeRuntime(runtime = {}) {
  const capabilities = runtime.capabilities && typeof runtime.capabilities === 'object'
    ? runtime.capabilities
    : {};
  return Object.freeze({
    insideSettlement: bool(capabilities.insideSettlement ?? runtime.insideSettlement),
    defeated: bool(runtime.defeated),
    saveEnabled: runtime.saveEnabled !== false,
    fatigue: Math.max(0, finite(runtime.fatigue, 0)),
    health: Math.max(0, finite(runtime.health, 1)),
  });
}

function actionReason(action, runtime) {
  if (runtime.defeated) return 'player-defeated';
  if (REQUIRED_CAPABILITIES[action] === 'insideSettlement' && !runtime.insideSettlement) return 'outside-settlement';
  if (action === 'save' && !runtime.saveEnabled) return 'save-disabled';
  if (action === 'rest' && runtime.health <= 0) return 'invalid-health';
  return '';
}

export function listSettlementInteractionActions(role) {
  return Object.freeze(roleActions(text(role)).slice());
}

export function buildSettlementInteractionContract(journey, runtime = {}) {
  const normalizedRuntime = normalizeRuntime(runtime);
  const beats = Array.isArray(journey?.beats) ? journey.beats.slice(0, 8) : [];
  const steps = [];
  for (const [index, beat] of beats.entries()) {
    const role = text(beat?.role);
    const targetId = text(beat?.targetId, `${role || 'service'}-node`);
    const actions = roleActions(role);
    for (const action of actions) {
      const reason = actionReason(action, normalizedRuntime);
      steps.push(Object.freeze({
        index: steps.length,
        beatIndex: index,
        role,
        targetId,
        action,
        available: !reason,
        blockingReason: reason,
        questHook: text(beat?.questHook),
        rewardHook: text(beat?.rewardHook),
        fatigueBand: normalizedRuntime.fatigue >= 80 ? 'high' : normalizedRuntime.fatigue >= 45 ? 'medium' : 'low',
      }));
    }
  }
  const available = steps.filter((step) => step.available);
  const primary = available[0] || steps[0] || null;
  const result = {
    version: SETTLEMENT_INTERACTION_CONTRACT_VERSION,
    settlementId: text(journey?.settlementId, 'settlement'),
    chapter: text(journey?.chapter, 'custom'),
    runtime: normalizedRuntime,
    stepCount: steps.length,
    availableCount: available.length,
    blockedCount: steps.length - available.length,
    primaryAction: primary ? `${primary.role}:${primary.action}` : '',
    steps: Object.freeze(steps),
    digest: digest({ journey, runtime: normalizedRuntime, steps }),
  };
  return deepFreeze(result);
}

export function serializeSettlementInteractionContract(contract) {
  return stable(contract && typeof contract === 'object' ? contract : {});
}

export function validateSettlementInteractionContract(contract) {
  const errors = [];
  if (contract?.version !== SETTLEMENT_INTERACTION_CONTRACT_VERSION) errors.push('unsupported-version');
  if (!text(contract?.settlementId)) errors.push('missing-settlement-id');
  if (!Array.isArray(contract?.steps)) errors.push('missing-steps');
  for (const [index, step] of (contract?.steps || []).entries()) {
    if (!text(step?.role)) errors.push(`missing-role:${index}`);
    if (!text(step?.action)) errors.push(`missing-action:${index}`);
    if (step?.available === true && text(step?.blockingReason)) errors.push(`available-with-block:${index}`);
    if (step?.available !== true && !text(step?.blockingReason)) errors.push(`blocked-without-reason:${index}`);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), stepCount: Array.isArray(contract?.steps) ? contract.steps.length : 0 });
}
