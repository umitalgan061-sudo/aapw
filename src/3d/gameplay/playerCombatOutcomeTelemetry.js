const OUTCOMES = new Set(['hit', 'blocked', 'parried', 'dodged', 'staggered', 'guard-break', 'defeated', 'miss']);
const MAX_EVENTS = 32;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createPlayerCombatOutcomeTelemetry(options = {}) {
  const maxEvents = clamp(Math.trunc(finite(options.maxEvents, MAX_EVENTS)), 1, MAX_EVENTS);
  const events = [];
  let sequence = 0;

  function record(input = {}) {
    const outcome = OUTCOMES.has(input.outcome) ? input.outcome : 'miss';
    const event = {
      sequence: ++sequence,
      outcome,
      amount: clamp(finite(input.amount), 0, 9999),
      staminaCost: clamp(finite(input.staminaCost), 0, 9999),
      poiseDamage: clamp(finite(input.poiseDamage), 0, 9999),
      targetId: typeof input.targetId === 'string' ? input.targetId.slice(0, 80) : null,
      attackSerial: Math.max(0, Math.trunc(finite(input.attackSerial))),
      comboStep: clamp(Math.trunc(finite(input.comboStep)), 0, 9),
      timestampMs: Math.max(0, Math.trunc(finite(input.timestampMs))),
    };
    events.push(event);
    while (events.length > maxEvents) events.shift();
    return { ...event };
  }

  function snapshot() {
    const totals = { hit: 0, blocked: 0, parried: 0, dodged: 0, staggered: 0, 'guard-break': 0, defeated: 0, miss: 0 };
    let damage = 0;
    let poiseDamage = 0;
    for (const event of events) {
      totals[event.outcome] += 1;
      damage += event.amount;
      poiseDamage += event.poiseDamage;
    }
    return {
      maxEvents,
      count: events.length,
      totals,
      damage: Number(damage.toFixed(3)),
      poiseDamage: Number(poiseDamage.toFixed(3)),
      events: events.map((event) => ({ ...event })),
    };
  }

  function reset() {
    events.length = 0;
  }

  return Object.freeze({ record, snapshot, reset });
}

export { OUTCOMES };