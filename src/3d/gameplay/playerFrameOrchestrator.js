/**
 * Deterministic frame orchestrator for the shipped player/combat/equipment stack.
 *
 * This is a composition boundary, not a second gameplay framework: callers inject the
 * existing directors/rules and keep ownership of state mutation, scene, animation mixer,
 * input listeners, timers, assets and material placement.
 *
 * @module gameplay/playerFrameOrchestrator
 */

const clamp = (value, min, max, fallback = min) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};

const call = (fn, payload, fallback) => {
  try { return typeof fn === 'function' ? fn(payload) : fallback; } catch { return fallback; }
};

const digest = (value) => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export function createPlayerFrameOrchestrator({
  readInput,
  resolveMovement,
  resolveCombat,
  resolveAnimation,
  resolveEquipment,
  resolvePresentation,
  maxHistory = 24,
} = {}) {
  const state = { frame: 0, sequence: 0, disposed: false, history: [] };
  const limit = Math.max(1, Math.floor(clamp(maxHistory, 1, 128, 24)));

  const snapshot = () => freezeDeep({
    frame: state.frame,
    sequence: state.sequence,
    historySize: state.history.length,
    lastDigest: state.history.at(-1)?.digest ?? null,
  });

  const step = (input = {}) => {
    if (state.disposed) return freezeDeep({ disposed: true, frame: state.frame, sequence: state.sequence, stages: {} });
    state.frame += 1;
    const frame = state.frame;
    const intent = call(readInput, { input, frame, sequence: state.sequence }, input.intent ?? {});
    const movement = call(resolveMovement, { input, intent, frame, sequence: state.sequence }, null);
    const combat = call(resolveCombat, { input, intent, movement, frame, sequence: state.sequence }, null);
    const animation = call(resolveAnimation, { input, intent, movement, combat, frame, sequence: state.sequence }, null);
    const equipment = call(resolveEquipment, { input, intent, movement, combat, animation, frame, sequence: state.sequence }, null);
    const presentation = call(resolvePresentation, { input, intent, movement, combat, animation, equipment, frame, sequence: state.sequence }, null);
    state.sequence += 1;

    const result = freezeDeep({
      disposed: false,
      frame,
      sequence: state.sequence,
      stages: freezeDeep({ intent, movement, combat, animation, equipment, presentation }),
    });
    const entry = freezeDeep({ frame, sequence: state.sequence, digest: digest(result), result });
    state.history.push(entry);
    if (state.history.length > limit) state.history.splice(0, state.history.length - limit);
    return result;
  };

  const replayDigest = () => digest(state.history.map((entry) => ({ frame: entry.frame, sequence: entry.sequence, digest: entry.digest })));
  const history = () => state.history.map((entry) => entry.result);
  const reset = () => { state.frame = 0; state.sequence = 0; state.history.length = 0; };
  const dispose = () => { state.disposed = true; reset(); };

  return Object.freeze({ step, snapshot, history, replayDigest, reset, dispose });
}

export { digest };
