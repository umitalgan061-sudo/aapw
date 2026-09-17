/**
 * Deterministic hurtbox/contact envelope for the shipped player combat path.
 *
 * This is a pure adapter over caller-owned hitbox, hurtbox, health, poise and scene systems.
 * It never creates colliders, traverses Three.js objects, mutates player state or applies damage.
 *
 * @module gameplay/playerHurtboxContactEnvelope
 */

const MAX_CONTACTS = 32;
const MAX_ID_LENGTH = 96;
const MAX_NUMBER = 1000;
const MIN_NUMBER = 0;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizeId(value, fallback = 'unknown') {
  const id = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, MAX_ID_LENGTH);
  return id || fallback;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function normalizePoint(point) {
  if (!point || typeof point !== 'object') return null;
  return freezeDeep({
    x: clamp(finiteOr(point.x), -MAX_NUMBER, MAX_NUMBER),
    y: clamp(finiteOr(point.y), -MAX_NUMBER, MAX_NUMBER),
    z: clamp(finiteOr(point.z), -MAX_NUMBER, MAX_NUMBER),
  });
}

function normalizeContact(contact, index) {
  if (!contact || typeof contact !== 'object') return null;
  const kind = String(contact.kind ?? 'hit').trim().toLowerCase();
  if (!['hit', 'guarded', 'parried', 'dodged', 'missed'].includes(kind)) return null;
  const phase = String(contact.phase ?? 'active').trim().toLowerCase();
  if (!['startup', 'active', 'recovery', 'unknown'].includes(phase)) return null;
  const distance = clamp(finiteOr(contact.distance, Infinity), 0, MAX_NUMBER);
  const angle = clamp(finiteOr(contact.angle), -180, 180);
  const rawDamage = clamp(finiteOr(contact.damage), 0, MAX_NUMBER);
  const rawPoise = clamp(finiteOr(contact.poiseDamage), 0, MAX_NUMBER);
  return freezeDeep({
    index,
    contactId: normalizeId(contact.contactId, `contact-${index}`),
    attackerId: normalizeId(contact.attackerId),
    targetId: normalizeId(contact.targetId, 'player'),
    kind,
    phase,
    distance,
    angle,
    damage: kind === 'hit' ? rawDamage : 0,
    poiseDamage: kind === 'hit' || kind === 'guarded' ? rawPoise : 0,
    point: normalizePoint(contact.point),
    socket: normalizeId(contact.socket, 'unknown'),
  });
}

function stableSortContacts(contacts) {
  return [...contacts].sort((a, b) =>
    a.distance - b.distance ||
    a.angle - b.angle ||
    a.contactId.localeCompare(b.contactId) ||
    a.index - b.index
  );
}

export function createPlayerHurtboxContactEnvelope(options = {}) {
  const maxContacts = clamp(Math.trunc(finiteOr(options.maxContacts, MAX_CONTACTS)), 1, MAX_CONTACTS);
  let disposed = false;
  let serial = 0;
  let history = [];

  const build = (input = {}) => {
    if (disposed) return null;
    const contacts = Array.isArray(input.contacts) ? input.contacts : [];
    const normalized = contacts.map(normalizeContact).filter(Boolean).slice(0, maxContacts);
    const ordered = stableSortContacts(normalized);
    const totals = ordered.reduce((acc, contact) => {
      acc.hit += contact.kind === 'hit' ? 1 : 0;
      acc.guarded += contact.kind === 'guarded' ? 1 : 0;
      acc.parried += contact.kind === 'parried' ? 1 : 0;
      acc.dodged += contact.kind === 'dodged' ? 1 : 0;
      acc.damage += contact.damage;
      acc.poiseDamage += contact.poiseDamage;
      return acc;
    }, { hit: 0, guarded: 0, parried: 0, dodged: 0, damage: 0, poiseDamage: 0 });

    const receipt = freezeDeep({
      serial: ++serial,
      source: normalizeId(input.source, 'player-combat'),
      active: Boolean(input.active),
      contacts: ordered,
      totals: freezeDeep({
        hit: totals.hit,
        guarded: totals.guarded,
        parried: totals.parried,
        dodged: totals.dodged,
        damage: clamp(totals.damage, 0, MAX_NUMBER * maxContacts),
        poiseDamage: clamp(totals.poiseDamage, 0, MAX_NUMBER * maxContacts),
      }),
    });
    history = [...history, receipt].slice(-maxContacts);
    return receipt;
  };

  return Object.freeze({
    build,
    snapshot() {
      return freezeDeep({ disposed, serial, history: [...history] });
    },
    dispose() {
      disposed = true;
      history = [];
    },
  });
}

export function validatePlayerHurtboxContactEnvelope(receipt) {
  if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'missing-receipt' };
  if (!Number.isInteger(receipt.serial) || receipt.serial < 1) return { ok: false, reason: 'invalid-serial' };
  if (!Array.isArray(receipt.contacts) || !receipt.totals) return { ok: false, reason: 'invalid-shape' };
  if (receipt.contacts.length > MAX_CONTACTS) return { ok: false, reason: 'contact-limit-exceeded' };
  if (receipt.contacts.some((contact) => !contact.contactId || !contact.targetId)) {
    return { ok: false, reason: 'invalid-contact' };
  }
  return { ok: true, contactCount: receipt.contacts.length, serial: receipt.serial };
}
