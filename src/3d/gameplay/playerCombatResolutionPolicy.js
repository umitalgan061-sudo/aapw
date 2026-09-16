/**
 * Deterministic combat resolution policy for the shipped player combat path.
 *
 * This is an adapter over caller-owned contact observations and the existing equipment
 * profile. It does not mutate player state, health, poise, scene objects, timers, or mixers.
 *
 * @module gameplay/playerCombatResolutionPolicy
 */

const MAX_EVENTS = 32;
const MAX_NUMBER = 1000;
const MIN_NUMBER = 0;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeId = (value, fallback = 'contact') => {
  const id = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, 96);
  return id || fallback;
};
const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};

const OUTCOME_MULTIPLIERS = freezeDeep({
  hit: { damage: 1, poise: 1, stamina: 0 },
  guarded: { damage: 0, poise: 0.35, stamina: 0.55 },
  parried: { damage: 0, poise: 0, stamina: 0.25 },
  dodged: { damage: 0, poise: 0, stamina: 0 },
  missed: { damage: 0, poise: 0, stamina: 0 },
});

function normalizeOutcome(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'block' || normalized === 'blocked' || normalized === 'guard') return 'guarded';
  if (normalized === 'perfect-guard' || normalized === 'perfect_guard') return 'parried';
  if (normalized === 'evaded' || normalized === 'dodge') return 'dodged';
  return Object.hasOwn(OUTCOME_MULTIPLIERS, normalized) ? normalized : 'missed';
}

function normalizeContacts(contacts) {
  return (Array.isArray(contacts) ? contacts : []).slice(0, MAX_EVENTS).map((contact, index) => ({
    id: normalizeId(contact?.id, `contact-${index + 1}`),
    outcome: normalizeOutcome(contact?.outcome),
    damage: clamp(finiteOr(contact?.damage, 0), MIN_NUMBER, MAX_NUMBER),
    poise: clamp(finiteOr(contact?.poise, 0), MIN_NUMBER, MAX_NUMBER),
    stamina: clamp(finiteOr(contact?.stamina, 0), MIN_NUMBER, MAX_NUMBER),
    distance: clamp(finiteOr(contact?.distance, Number.POSITIVE_INFINITY), MIN_NUMBER, MAX_NUMBER),
    angle: clamp(finiteOr(contact?.angle, 180), 0, 180),
    sequence: Math.max(0, Math.floor(finiteOr(contact?.sequence, index))),
  })).sort((a, b) => a.sequence - b.sequence || a.distance - b.distance || a.id.localeCompare(b.id));
}

function readProfile(profile = {}) {
  return {
    damageMultiplier: clamp(finiteOr(profile.damageMultiplier, 1), 0.1, 4),
    poiseMultiplier: clamp(finiteOr(profile.poiseMultiplier, 1), 0.1, 4),
    guardDamageMultiplier: clamp(finiteOr(profile.guardDamageMultiplier, 1), 0.1, 2),
    staminaMultiplier: clamp(finiteOr(profile.staminaMultiplier, 1), 0.1, 3),
  };
}

export function resolvePlayerCombatResolution({ contacts = [], equipmentProfile = {}, maxHistory = 16 } = {}) {
  const profile = readProfile(equipmentProfile);
  const normalized = normalizeContacts(contacts);
  const events = normalized.map((contact) => {
    const multiplier = OUTCOME_MULTIPLIERS[contact.outcome];
    const guardScale = contact.outcome === 'guarded' || contact.outcome === 'parried' ? profile.guardDamageMultiplier : 1;
    return freezeDeep({
      ...contact,
      resolvedDamage: clamp(contact.damage * multiplier.damage * profile.damageMultiplier * guardScale, MIN_NUMBER, MAX_NUMBER),
      resolvedPoise: clamp(contact.poise * multiplier.poise * profile.poiseMultiplier, MIN_NUMBER, MAX_NUMBER),
      resolvedStamina: clamp(contact.stamina * multiplier.stamina * profile.staminaMultiplier, MIN_NUMBER, MAX_NUMBER),
      accepted: contact.outcome === 'hit' || contact.outcome === 'guarded' || contact.outcome === 'parried',
    });
  });
  const totals = events.reduce((result, event) => {
    result.damage += event.resolvedDamage;
    result.poise += event.resolvedPoise;
    result.stamina += event.resolvedStamina;
    result.accepted += event.accepted ? 1 : 0;
    return result;
  }, { damage: 0, poise: 0, stamina: 0, accepted: 0 });
  return freezeDeep({
    version: 1,
    events,
    totals: freezeDeep({
      damage: clamp(totals.damage, MIN_NUMBER, MAX_NUMBER),
      poise: clamp(totals.poise, MIN_NUMBER, MAX_NUMBER),
      stamina: clamp(totals.stamina, MIN_NUMBER, MAX_NUMBER),
      accepted: totals.accepted,
    }),
    profile,
    historyLimit: clamp(Math.floor(finiteOr(maxHistory, 16)), 1, MAX_EVENTS),
  });
}

export function validatePlayerCombatResolution(resolution) {
  if (!resolution || resolution.version !== 1 || !Array.isArray(resolution.events)) return false;
  if (!resolution.totals || resolution.events.length > MAX_EVENTS) return false;
  return resolution.events.every((event) => (
    typeof event.id === 'string' &&
    Object.hasOwn(OUTCOME_MULTIPLIERS, event.outcome) &&
    Number.isFinite(event.resolvedDamage) &&
    Number.isFinite(event.resolvedPoise) &&
    Number.isFinite(event.resolvedStamina)
  ));
}

export function createPlayerCombatResolutionPolicy({ equipmentProfile = {}, maxHistory = 16 } = {}) {
  let disposed = false;
  let serial = 0;
  const history = [];
  return {
    resolve(input = {}) {
      if (disposed) return null;
      const result = resolvePlayerCombatResolution({ ...input, equipmentProfile: input.equipmentProfile ?? equipmentProfile, maxHistory });
      const receipt = freezeDeep({ serial: ++serial, ...result });
      history.push(receipt);
      while (history.length > Math.min(maxHistory, MAX_EVENTS)) history.shift();
      return receipt;
    },
    snapshot() { return freezeDeep({ disposed, serial, history: history.slice() }); },
    dispose() { disposed = true; history.length = 0; },
  };
}
