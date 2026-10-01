const OUTCOMES = Object.freeze(['hit', 'blocked', 'parried', 'dodged', 'staggered', 'guard-break', 'defeated', 'miss']);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const stableId = (value) => value == null ? null : String(value).trim() || null;

const normalizeOutcome = (outcome, serial) => ({
  outcome: OUTCOMES.includes(outcome?.outcome) ? outcome.outcome : 'miss',
  sequence: Math.max(0, Math.floor(finite(outcome?.sequence, serial))),
  targetId: stableId(outcome?.targetId),
  damage: clamp(outcome?.damage, 0, 9999),
  poiseDamage: clamp(outcome?.poiseDamage, 0, 9999),
  remainingHealth: clamp(outcome?.remainingHealth, 0, 9999),
  timestamp: Math.max(0, finite(outcome?.timestamp, 0)),
});

export function createPlayerCombatOutcomeLedger({ maxEntries = 24, maxTargets = 8 } = {}) {
  const state = { disposed: false, serial: 0, entries: [], targets: new Map() };
  const limit = () => Math.max(1, Math.floor(finite(maxEntries, 24)));
  const targetLimit = () => Math.max(1, Math.floor(finite(maxTargets, 8)));

  const record = (rawOutcome = {}) => {
    if (state.disposed) return null;
    const entry = normalizeOutcome(rawOutcome, state.serial++);
    state.entries.push(entry);
    if (state.entries.length > limit()) state.entries.splice(0, state.entries.length - limit());
    if (entry.targetId) {
      state.targets.set(entry.targetId, entry);
      while (state.targets.size > targetLimit()) state.targets.delete(state.targets.keys().next().value);
    }
    return { ...entry };
  };

  const latestForTarget = (targetId) => {
    if (state.disposed) return null;
    const entry = state.targets.get(stableId(targetId));
    return entry ? { ...entry } : null;
  };

  const summarize = () => {
    const counts = Object.fromEntries(OUTCOMES.map((name) => [name, 0]));
    for (const entry of state.entries) counts[entry.outcome] += 1;
    return Object.freeze({
      disposed: state.disposed,
      entryCount: state.entries.length,
      targetCount: state.targets.size,
      counts,
      latest: state.entries.at(-1) ? { ...state.entries.at(-1) } : null,
    });
  };

  const snapshot = () => Object.freeze({
    ...summarize(),
    entries: state.entries.map((entry) => ({ ...entry })),
    targets: [...state.targets.entries()].map(([targetId, entry]) => ({ targetId, ...entry })),
  });

  const reset = () => {
    if (state.disposed) return;
    state.serial = 0;
    state.entries.length = 0;
    state.targets.clear();
  };

  const dispose = () => {
    state.disposed = true;
    state.serial = 0;
    state.entries.length = 0;
    state.targets.clear();
  };

  return Object.freeze({ record, latestForTarget, summarize, snapshot, reset, dispose });
}

export { OUTCOMES };
