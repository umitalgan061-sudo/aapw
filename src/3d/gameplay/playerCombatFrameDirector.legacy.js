const ACTIONS = Object.freeze(['lightAttack', 'heavyAttack', 'block', 'parry', 'dodge', 'lockOn']);
const OUTCOMES = Object.freeze(['hit', 'blocked', 'parried', 'dodged', 'staggered', 'guard-break', 'defeated', 'miss']);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const stableId = (value, fallback) => String(value ?? fallback).trim() || fallback;

const normalizeIntent = (intent, sequence) => {
  const action = stableId(intent?.action, 'none');
  return {
    action,
    accepted: ACTIONS.includes(action),
    sequence: Math.max(0, Math.floor(finite(intent?.sequence, sequence))),
    strength: clamp(intent?.strength, 0, 1),
    targetId: intent?.targetId == null ? null : stableId(intent.targetId, 'target'),
  };
};

const normalizeOutcome = (outcome, sequence) => ({
  outcome: OUTCOMES.includes(outcome?.outcome) ? outcome.outcome : 'miss',
  sequence: Math.max(0, Math.floor(finite(outcome?.sequence, sequence))),
  targetId: outcome?.targetId == null ? null : stableId(outcome.targetId, 'target'),
  damage: clamp(outcome?.damage, 0, 9999),
  poiseDamage: clamp(outcome?.poiseDamage, 0, 9999),
  timestamp: Math.max(0, finite(outcome?.timestamp, 0)),
});

export function createPlayerCombatFrameDirector({
  readInput,
  resolveTarget,
  resolveHit,
  applyResources,
  resolveAnimation,
  resolveEquipment,
  maxIntents = 8,
  maxOutcomes = 16,
} = {}) {
  const state = {
    frame: 0,
    sequence: 0,
    intents: [],
    outcomes: [],
    disposed: false,
  };

  const call = (fn, args, fallback) => {
    try { return typeof fn === 'function' ? fn(args) : fallback; } catch { return fallback; }
  };

  const pushBounded = (list, value, limit) => {
    list.push(value);
    if (list.length > Math.max(1, Math.floor(finite(limit, 1)))) list.splice(0, list.length - Math.max(1, Math.floor(finite(limit, 1))));
  };

  const step = (input = {}) => {
    if (state.disposed) return { disposed: true, frame: state.frame, intents: [], outcomes: [] };
    state.frame += 1;
    const rawIntent = call(readInput, { ...input, frame: state.frame }, input.intent ?? {});
    const intent = normalizeIntent(rawIntent, state.sequence++);
    if (intent.accepted) pushBounded(state.intents, intent, maxIntents);

    const target = call(resolveTarget, { input, intent, frame: state.frame }, null);
    const animation = call(resolveAnimation, { input, intent, target, frame: state.frame }, { action: 'idle', locomotionWeight: 1, attackWeight: 0, reactionWeight: 0 });
    const equipment = call(resolveEquipment, { input, intent, target, frame: state.frame }, null);
    const resources = call(applyResources, { input, intent, target, frame: state.frame }, null);
    const rawOutcome = call(resolveHit, { input, intent, target, frame: state.frame }, null);
    const outcome = rawOutcome ? normalizeOutcome(rawOutcome, state.sequence++) : null;
    if (outcome) pushBounded(state.outcomes, outcome, maxOutcomes);

    return {
      frame: state.frame,
      intent,
      target,
      animation,
      equipment,
      resources,
      outcome,
      snapshot: snapshot(),
    };
  };

  const snapshot = () => ({
    frame: state.frame,
    intentCount: state.intents.length,
    outcomeCount: state.outcomes.length,
    intents: state.intents.map((entry) => ({ ...entry })),
    outcomes: state.outcomes.map((entry) => ({ ...entry })),
  });

  const reset = () => {
    state.frame = 0;
    state.sequence = 0;
    state.intents.length = 0;
    state.outcomes.length = 0;
  };

  const dispose = () => {
    state.disposed = true;
    reset();
  };

  return Object.freeze({ step, snapshot, reset, dispose });
}

export { ACTIONS, OUTCOMES };
