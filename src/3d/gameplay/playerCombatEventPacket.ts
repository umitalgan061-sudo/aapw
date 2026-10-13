/**
 * Deterministic runtime packet over the shipped player combat event boundary.
 *
 * This adapter consumes already-emitted `aapw:player-attack-window` and
 * `aapw:player-combat-feedback` payloads without owning player state, scene,
 * mixer, health, stamina, poise, sockets or inventory mutation.
 */

const EVENT_KINDS = Object.freeze(['attack-window', 'combat-feedback']);
const ATTACK_PHASES = Object.freeze(['start', 'active-start', 'active-end', 'interrupted', 'complete']);
const OUTCOMES = Object.freeze(['none', 'hit', 'blocked', 'parried', 'dodged', 'staggered', 'guard-break']);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const asText = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const round = (value, digits = 4) => Number(finite(value, 0).toFixed(digits));

function normalizePosition(input) {
  const source = input && typeof input === 'object' ? input : {};
  return Object.freeze({ x: round(source.x, 3), y: round(source.y, 3), z: round(source.z, 3) });
}

function normalizeFacing(input) {
  const source = input && typeof input === 'object' ? input : {};
  const x = round(source.x, 4);
  const z = round(source.z, 4);
  const length = Math.hypot(x, z);
  if (length <= 0) return Object.freeze({ x: 0, z: 1 });
  return Object.freeze({ x: round(x / length, 4), z: round(z / length, 4) });
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizePlayerCombatEvent(eventKind, payload = {}) {
  const kind = EVENT_KINDS.includes(eventKind) ? eventKind : 'none';
  const source = payload && typeof payload === 'object' ? payload : {};
  if (kind === 'attack-window') {
    const phase = ATTACK_PHASES.includes(source.phase) ? source.phase : 'complete';
    return Object.freeze({
      kind,
      serial: Math.max(0, Math.floor(finite(source.serial, 0))),
      phase,
      attackKind: source.kind === 'heavy' ? 'heavy' : source.kind === 'light' ? 'light' : 'none',
      comboStep: clamp(Math.floor(finite(source.comboStep, 0)), 0, 3),
      active: Boolean(source.active),
      stamina: clamp(round(source.stamina, 2), 0, 100),
      reachMeters: clamp(round(source.reachMeters, 3), 0, 5),
      damageScale: clamp(round(source.damageScale, 3), 0, 6),
      commitRemainingMeters: clamp(round(source.commitRemainingMeters, 3), 0, 3),
      position: normalizePosition(source.position),
      facing: normalizeFacing(source.facing),
    });
  }
  if (kind === 'combat-feedback') {
    const outcome = OUTCOMES.includes(source.outcome) ? source.outcome : 'none';
    return Object.freeze({
      kind,
      serial: Math.max(0, Math.floor(finite(source.serial, 0))),
      outcome,
      rawAmount: clamp(round(source.rawAmount, 4), 0, 100000),
      appliedAmount: clamp(round(source.appliedAmount, 4), 0, 100000),
      blockedAmount: clamp(round(source.blockedAmount, 4), 0, 100000),
      stamina: clamp(round(source.stamina, 2), 0, 100),
      poise: clamp(round(source.poise, 2), 0, 100),
      state: asText(source.state, 'neutral'),
      position: normalizePosition(source.position),
    });
  }
  return Object.freeze({ kind: 'none' });
}

export function buildPlayerCombatEventPacket(events = [], { maxEvents = 24 } = {}) {
  const source = Array.isArray(events) ? events : [];
  const boundedMax = clamp(Math.floor(finite(maxEvents, 24)), 1, 64);
  const normalized = source
    .map((entry) => normalizePlayerCombatEvent(entry?.eventKind, entry?.payload))
    .filter((entry) => entry.kind !== 'none')
    .slice(-boundedMax);
  const latestAttack = [...normalized].reverse().find((entry) => entry.kind === 'attack-window') ?? null;
  const latestFeedback = [...normalized].reverse().find((entry) => entry.kind === 'combat-feedback') ?? null;
  const activeAttack = latestAttack?.active === true && latestAttack.phase === 'active-start';
  const dominantOutcome = latestFeedback?.outcome ?? 'none';
  const replayPayload = JSON.stringify({ events: normalized, activeAttack, dominantOutcome });
  return Object.freeze({
    version: 1,
    events: Object.freeze(normalized),
    latestAttack,
    latestFeedback,
    activeAttack,
    dominantOutcome,
    eventCount: normalized.length,
    replayKey: `combat-event:${hashText(replayPayload)}`,
  });
}

export function isPlayerCombatEventPacket(value) {
  return Boolean(value && typeof value === 'object'
    && value.version === 1
    && Array.isArray(value.events)
    && typeof value.replayKey === 'string'
    && typeof value.activeAttack === 'boolean'
    && typeof value.dominantOutcome === 'string'
    && Number.isInteger(value.eventCount));
}
