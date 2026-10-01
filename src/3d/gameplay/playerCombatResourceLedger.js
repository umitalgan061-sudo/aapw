/**
 * Deterministic stamina/poise ledger over caller-owned combat events.
 * Does not mutate player state, scene objects, inventory or AnimationMixer.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback = 100) => Math.max(1, finite(value, fallback));

const EVENT_COSTS = Object.freeze({
  light: Object.freeze({ stamina: 12, poise: 0 }),
  heavy: Object.freeze({ stamina: 24, poise: 0 }),
  dodge: Object.freeze({ stamina: 28, poise: 0 }),
  guard: Object.freeze({ stamina: 4, poise: 0 }),
  parry: Object.freeze({ stamina: 8, poise: 0 }),
  rangedRelease: Object.freeze({ stamina: 10, poise: 0 }),
  hit: Object.freeze({ stamina: 0, poise: 0 }),
  blocked: Object.freeze({ stamina: 0, poise: 0 }),
  staggered: Object.freeze({ stamina: 0, poise: 18 }),
  guardBreak: Object.freeze({ stamina: 0, poise: 32 }),
});

const normalizeEvent = (event = {}) => {
  const type = typeof event.type === 'string' && EVENT_COSTS[event.type] ? event.type : 'hit';
  return Object.freeze({
    type,
    staminaCost: Math.max(0, finite(event.staminaCost, EVENT_COSTS[type].stamina)),
    poiseDamage: Math.max(0, finite(event.poiseDamage, EVENT_COSTS[type].poise)),
    source: typeof event.source === 'string' && event.source ? event.source : 'unknown',
  });
};

export function createPlayerCombatResourceLedger({ maxStamina = 100, maxPoise = 100, stamina = maxStamina, poise = maxPoise, maxEvents = 32 } = {}) {
  const limits = Object.freeze({ maxStamina: positive(maxStamina), maxPoise: positive(maxPoise), maxEvents: Math.max(1, Math.floor(finite(maxEvents, 32))) });
  const state = { stamina: clamp(finite(stamina, limits.maxStamina), 0, limits.maxStamina), poise: clamp(finite(poise, limits.maxPoise), 0, limits.maxPoise), events: [] };

  const snapshot = () => Object.freeze({
    stamina: Number(state.stamina.toFixed(4)),
    poise: Number(state.poise.toFixed(4)),
    staminaRatio: Number((state.stamina / limits.maxStamina).toFixed(6)),
    poiseRatio: Number((state.poise / limits.maxPoise).toFixed(6)),
    exhausted: state.stamina <= 0,
    staggered: state.poise <= 0,
    eventCount: state.events.length,
    lastEvent: state.events.at(-1) || null,
  });

  return Object.freeze({
    apply(eventInput = {}) {
      const event = normalizeEvent(eventInput);
      const before = snapshot();
      state.stamina = clamp(state.stamina - event.staminaCost, 0, limits.maxStamina);
      state.poise = clamp(state.poise - event.poiseDamage, 0, limits.maxPoise);
      state.events.push(Object.freeze({ ...event, before, after: snapshot() }));
      while (state.events.length > limits.maxEvents) state.events.shift();
      return snapshot();
    },
    recover({ stamina = 0, poise = 0 } = {}) {
      state.stamina = clamp(state.stamina + Math.max(0, finite(stamina, 0)), 0, limits.maxStamina);
      state.poise = clamp(state.poise + Math.max(0, finite(poise, 0)), 0, limits.maxPoise);
      return snapshot();
    },
    reset() {
      state.stamina = limits.maxStamina;
      state.poise = limits.maxPoise;
      state.events.length = 0;
      return snapshot();
    },
    read() { return snapshot(); },
    readHistory() { return Object.freeze(state.events.slice()); },
    serialize() { return JSON.stringify({ limits, snapshot: snapshot(), events: state.events }); },
  });
}

export function previewPlayerCombatResourceLedger({ events = [], ...options } = {}) {
  const ledger = createPlayerCombatResourceLedger(options);
  for (const event of Array.isArray(events) ? events : []) ledger.apply(event);
  return ledger.read();
}
