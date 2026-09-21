/**
 * Deterministic intent arbitration for living-world actors.
 *
 * This module does not execute behavior. It selects a semantic intent from already observed
 * stimuli, actor capabilities and current state, then returns an immutable receipt for existing
 * reaction/faction/fauna controllers to consume.
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value, min)));

export const LIVING_WORLD_INTENTS = freeze([
  'idle', 'investigate', 'alert', 'regroup', 'flee', 'pursue', 'defend', 'attack', 'assist',
  'search', 'retreat', 'seek-shelter', 'socialize', 'gather', 'patrol', 'recover', 'observe',
]);

export const LIVING_WORLD_INTENT_ARBITER_POLICY = freeze({
  id: 'living-world-intent-arbiter-2026-09-v1',
  maxCandidates: 16,
  minConfidence: 0.12,
  tieBreakOrder: freeze(['defend', 'flee', 'attack', 'pursue', 'regroup', 'alert', 'investigate', 'assist', 'retreat', 'seek-shelter', 'patrol', 'search', 'gather', 'socialize', 'observe', 'recover', 'idle']),
  baseUtility: freeze({
    idle: 0.1, investigate: 0.45, alert: 0.55, regroup: 0.55, flee: 0.7, pursue: 0.65,
    defend: 0.72, attack: 0.8, assist: 0.6, search: 0.42, retreat: 0.62, 'seek-shelter': 0.64,
    socialize: 0.28, gather: 0.35, patrol: 0.38, recover: 0.5, observe: 0.3,
  }),
});

const kindToIntents = freeze({
  combat: ['attack', 'defend', 'pursue', 'retreat'],
  damage: ['defend', 'retreat', 'recover', 'assist'],
  death: ['alert', 'flee', 'regroup', 'investigate'],
  alarm: ['alert', 'regroup', 'investigate'],
  noise: ['investigate', 'observe', 'search'],
  fire: ['flee', 'seek-shelter', 'alert'],
  weather: ['seek-shelter', 'recover', 'observe'],
  resource: ['gather', 'search', 'assist'],
  threat: ['flee', 'defend', 'attack', 'alert'],
  sighting: ['observe', 'investigate', 'pursue', 'alert'],
  territory: ['defend', 'patrol', 'alert'],
  social: ['socialize', 'assist', 'regroup'],
  quest: ['search', 'investigate', 'assist'],
  environment: ['observe', 'search', 'seek-shelter'],
  unknown: ['observe', 'alert'],
});

function statePenalty(intent, state = {}) {
  const stamina = clamp(state.staminaRatio, 1);
  const health = clamp(state.healthRatio, 1);
  if (health < 0.2 && ['attack', 'pursue'].includes(intent)) return -0.4;
  if (stamina < 0.15 && ['attack', 'pursue', 'patrol'].includes(intent)) return -0.25;
  if (state.defeated && intent !== 'recover') return -1;
  if (state.isProtected && intent === 'flee') return -0.1;
  return 0;
}

function capabilityBonus(intent, capabilities = {}) {
  if (intent === 'attack' && capabilities.canAttack === false) return -1;
  if (intent === 'assist' && capabilities.canAssist === false) return -1;
  if (intent === 'gather' && capabilities.canGather === false) return -1;
  if (intent === 'socialize' && capabilities.canSocialize === false) return -1;
  if (intent === 'seek-shelter' && capabilities.canShelter === false) return -1;
  if (intent === 'pursue' && capabilities.canPursue === false) return -1;
  return 0;
}

function stimulusIntentBoost(intent, stimulus) {
  if (!stimulus) return 0;
  const matching = kindToIntents[stimulus.kind] || kindToIntents.unknown;
  if (matching.includes(intent)) return clamp(stimulus.salience || stimulus.confidence * stimulus.intensity) * 0.8;
  return 0;
}

export function enumerateIntentCandidates(stimuli = [], options = {}) {
  const set = new Set(['idle']);
  for (const stimulus of (Array.isArray(stimuli) ? stimuli : []).slice(0, LIVING_WORLD_INTENT_ARBITER_POLICY.maxCandidates * 2)) {
    for (const intent of kindToIntents[stimulus?.kind] || kindToIntents.unknown) set.add(intent);
  }
  for (const intent of options.additionalIntents || []) if (LIVING_WORLD_INTENTS.includes(intent)) set.add(intent);
  return [...set].slice(0, options.maxCandidates || LIVING_WORLD_INTENT_ARBITER_POLICY.maxCandidates);
}

export function scoreLivingWorldIntent(intent, stimuli = [], state = {}, capabilities = {}, options = {}) {
  if (!LIVING_WORLD_INTENTS.includes(intent)) return -1;
  const policy = { ...LIVING_WORLD_INTENT_ARBITER_POLICY, ...(options.policy || {}) };
  let score = finite(policy.baseUtility[intent], 0.1);
  score += statePenalty(intent, state);
  score += capabilityBonus(intent, capabilities);
  const rankedStimuli = Array.isArray(stimuli) ? stimuli : [];
  for (const stimulus of rankedStimuli.slice(0, policy.maxCandidates)) score += stimulusIntentBoost(intent, stimulus);
  if (state.currentIntent === intent) score += clamp(options.stickyBonus, 0, 0.25);
  if (state.inCombat && ['attack', 'defend', 'flee', 'retreat'].includes(intent)) score += 0.1;
  if (state.nearHome && intent === 'seek-shelter') score += 0.08;
  return clamp(score, -1, 2);
}

export function arbitrateLivingWorldIntent({ stimuli = [], state = {}, capabilities = {}, options = {} } = {}) {
  const candidates = enumerateIntentCandidates(stimuli, options);
  const scored = candidates.map((intent) => ({ intent, score: scoreLivingWorldIntent(intent, stimuli, state, capabilities, options) }));
  scored.sort((a, b) => {
    const delta = b.score - a.score;
    if (Math.abs(delta) > 1e-9) return delta;
    const ai = LIVING_WORLD_INTENT_ARBITER_POLICY.tieBreakOrder.indexOf(a.intent);
    const bi = LIVING_WORLD_INTENT_ARBITER_POLICY.tieBreakOrder.indexOf(b.intent);
    return ai - bi || a.intent.localeCompare(b.intent);
  });
  const selected = scored[0] || { intent: 'idle', score: 0 };
  const confidence = clamp(selected.score / 2);
  return freeze({
    intent: confidence >= LIVING_WORLD_INTENT_ARBITER_POLICY.minConfidence ? selected.intent : 'idle',
    confidence,
    score: selected.score,
    candidates: freeze(scored.slice(0, LIVING_WORLD_INTENT_ARBITER_POLICY.maxCandidates).map((value) => freeze(value))),
  });
}

export function validateIntentDecision(decision) {
  return Boolean(decision && LIVING_WORLD_INTENTS.includes(decision.intent) && Number.isFinite(decision.confidence) && decision.confidence >= 0 && decision.confidence <= 1);
}
