/**
 * Bounded presentation budget for player combat feedback.
 *
 * This adapter consumes already-resolved combat outcomes/signals and produces a
 * deterministic VFX/SFX/haptics budget for existing consumers. It owns no scene,
 * renderer, audio graph, input, combat state, damage, or asset lifecycle.
 *
 * @module gameplay/playerCombatFeedbackBudget
 */

export const PLAYER_COMBAT_FEEDBACK_BUDGET_VERSION = '2026-09-16-v1';

export const PLAYER_COMBAT_FEEDBACK_LIMITS = Object.freeze({
  maxEvents: 12,
  maxTextLength: 48,
  maxIntensity: 1,
  maxDurationSeconds: 1.5,
  maxCooldownSeconds: 2,
});

const TYPES = new Set(['hit', 'blocked', 'parried', 'dodged', 'staggered', 'defeated', 'miss', 'warning']);
const CHANNELS = Object.freeze(['vfx', 'sfx', 'haptics']);

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function text(value, fallback = '') {
  const output = typeof value === 'string' ? value : fallback;
  return output.slice(0, PLAYER_COMBAT_FEEDBACK_LIMITS.maxTextLength);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeType(value) {
  return TYPES.has(value) ? value : 'warning';
}

function channelEnabled(value) {
  return value !== false;
}

function normalizeEvent(event = {}, index = 0) {
  const type = normalizeType(event.type ?? event.outcome);
  const baseIntensity = clamp(finite(event.intensity, type === 'hit' || type === 'parried' ? 0.8 : 0.45), 0, 1);
  const duration = clamp(finite(event.durationSeconds ?? event.duration, 0.22), 0.02, PLAYER_COMBAT_FEEDBACK_LIMITS.maxDurationSeconds);
  const cooldown = clamp(finite(event.cooldownSeconds, 0.12), 0, PLAYER_COMBAT_FEEDBACK_LIMITS.maxCooldownSeconds);
  const channels = CHANNELS.filter((channel) => channelEnabled(event[channel]));
  return Object.freeze({
    id: text(event.id ?? `${type}-${index}`, `${type}-${index}`),
    type,
    sequence: Math.max(0, Math.floor(finite(event.sequence, index))),
    atSeconds: Math.max(0, finite(event.atSeconds)),
    intensity: round(baseIntensity),
    durationSeconds: round(duration),
    cooldownSeconds: round(cooldown),
    channels: Object.freeze(channels),
    effectKey: text(event.effectKey ?? event.vfxKey, `combat-${type}`) || `combat-${type}`,
    soundKey: text(event.soundKey ?? event.sfxKey, `combat-${type}`) || `combat-${type}`,
    hapticKey: text(event.hapticKey, type === 'dodged' ? 'light' : 'medium') || 'medium',
  });
}

function compareEvents(left, right) {
  return left.atSeconds - right.atSeconds || left.sequence - right.sequence || left.id.localeCompare(right.id);
}

export function createPlayerCombatFeedbackBudget(events = [], nowSeconds = 0, options = {}) {
  const list = Array.isArray(events) ? events : [];
  const limit = clamp(Math.floor(finite(options.maxEvents, PLAYER_COMBAT_FEEDBACK_LIMITS.maxEvents)), 0, PLAYER_COMBAT_FEEDBACK_LIMITS.maxEvents);
  const cooldownFloor = clamp(finite(options.cooldownFloorSeconds, 0), 0, PLAYER_COMBAT_FEEDBACK_LIMITS.maxCooldownSeconds);
  const now = Math.max(0, finite(nowSeconds));
  const normalized = list.map((event, index) => normalizeEvent(event, index)).sort(compareEvents);
  const selected = [];
  const lastByChannel = new Map();
  for (const event of normalized) {
    if (selected.length >= limit) break;
    const acceptedChannels = event.channels.filter((channel) => {
      const previous = lastByChannel.get(channel);
      return previous === undefined || event.atSeconds - previous >= Math.max(cooldownFloor, event.cooldownSeconds);
    });
    if (acceptedChannels.length === 0) continue;
    for (const channel of acceptedChannels) lastByChannel.set(channel, event.atSeconds);
    selected.push(Object.freeze({ ...event, channels: Object.freeze(acceptedChannels) }));
  }
  const active = selected.filter((event) => now - event.atSeconds <= event.durationSeconds);
  return Object.freeze({
    version: PLAYER_COMBAT_FEEDBACK_BUDGET_VERSION,
    nowSeconds: round(now),
    count: active.length,
    events: Object.freeze(active),
  });
}

export function summarizePlayerCombatFeedbackBudget(packet = {}) {
  const events = Array.isArray(packet.events) ? packet.events : [];
  const channelCounts = Object.fromEntries(CHANNELS.map((channel) => [channel, 0]));
  for (const event of events) for (const channel of event.channels ?? []) if (channel in channelCounts) channelCounts[channel] += 1;
  return Object.freeze({
    version: text(packet.version, PLAYER_COMBAT_FEEDBACK_BUDGET_VERSION),
    count: events.length,
    channelCounts: Object.freeze(channelCounts),
    peakIntensity: round(events.reduce((peak, event) => Math.max(peak, finite(event.intensity)), 0)),
    types: Object.freeze([...new Set(events.map((event) => event.type))]),
  });
}

export function validatePlayerCombatFeedbackBudget(packet = {}) {
  const failures = [];
  if (packet.version !== PLAYER_COMBAT_FEEDBACK_BUDGET_VERSION) failures.push('version');
  if (!Number.isFinite(packet.nowSeconds) || packet.nowSeconds < 0) failures.push('nowSeconds');
  if (!Array.isArray(packet.events) || packet.events.length > PLAYER_COMBAT_FEEDBACK_LIMITS.maxEvents) failures.push('events');
  for (const event of packet.events ?? []) {
    if (!TYPES.has(event.type)) failures.push('type');
    if (!Number.isFinite(event.intensity) || event.intensity < 0 || event.intensity > 1) failures.push('intensity');
    if (!Array.isArray(event.channels) || event.channels.some((channel) => !CHANNELS.includes(channel))) failures.push('channels');
  }
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze([...new Set(failures)]) });
}

export function auditPlayerCombatFeedbackBudget() {
  const packet = createPlayerCombatFeedbackBudget([
    { type: 'hit', atSeconds: 0, sequence: 2, intensity: 2, vfx: true, sfx: true, haptics: true },
    { type: 'blocked', atSeconds: 0.05, sequence: 3, vfx: true, sfx: true, haptics: true },
    { type: 'dodged', atSeconds: 0.2, sequence: 4, vfx: true, sfx: false, haptics: true },
  ], 0.2, { cooldownFloorSeconds: 0.1 });
  const validation = validatePlayerCombatFeedbackBudget(packet);
  return Object.freeze({ version: PLAYER_COMBAT_FEEDBACK_BUDGET_VERSION, ok: validation.ok && packet.count >= 1, validation, summary: summarizePlayerCombatFeedbackBudget(packet) });
}

export function getPlayerCombatFeedbackBudgetLimits() {
  return Object.freeze({ ...PLAYER_COMBAT_FEEDBACK_LIMITS });
}
