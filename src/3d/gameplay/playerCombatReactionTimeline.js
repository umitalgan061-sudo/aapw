/**
 * Deterministic combat-reaction timeline for the existing player combat/animation stack.
 *
 * Ownership boundary:
 * - player.js / combat director own authoritative state and damage.
 * - animation director owns mixer/action application.
 * - this module only turns an accepted combat outcome into bounded presentation windows.
 * - no DOM, Three.js, input, scene, asset, material, or timer ownership.
 */

const MAX_EVENTS = 24;
const MAX_DURATION_MS = 1800;
const MAX_INTENSITY = 1;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const key = (value) => String(value ?? '').trim().toLowerCase();
const freeze = (value) => Object.freeze(value);

const REACTIONS = freeze({
  hit: freeze({ animation: 'hit_react', durationMs: 220, haptic: 'light', vfx: 'impact', sfx: 'hit' }),
  'hit-stagger': freeze({ animation: 'stagger', durationMs: 420, haptic: 'medium', vfx: 'impact_heavy', sfx: 'stagger' }),
  parry: freeze({ animation: 'parry_react', durationMs: 260, haptic: 'medium', vfx: 'parry_spark', sfx: 'parry' }),
  'guard-break': freeze({ animation: 'guard_break', durationMs: 620, haptic: 'heavy', vfx: 'guard_break', sfx: 'guard_break' }),
  dodge: freeze({ animation: 'dodge_recover', durationMs: 180, haptic: 'light', vfx: 'dust', sfx: 'cloth' }),
  defeat: freeze({ animation: 'defeat', durationMs: 1200, haptic: 'heavy', vfx: 'defeat', sfx: 'defeat' }),
});

const normalizeOutcome = (outcome = {}) => {
  const reaction = key(outcome.reaction || outcome.kind || 'hit');
  const spec = REACTIONS[reaction] || REACTIONS.hit;
  return freeze({
    reaction,
    accepted: outcome.accepted !== false,
    targetId: String(outcome.targetId ?? ''),
    sourceId: String(outcome.sourceId ?? 'player'),
    sequence: Math.max(0, Math.floor(finite(outcome.sequence, 0))),
    timestamp: Math.max(0, finite(outcome.timestamp, 0)),
    intensity: clamp(outcome.intensity, 0, MAX_INTENSITY),
    blocked: outcome.blocked === true,
    defeated: outcome.defeated === true,
    spec,
  });
};

export function createPlayerCombatReactionTimeline({ maxEvents = MAX_EVENTS } = {}) {
  const history = [];
  const limit = Math.max(1, Math.min(MAX_EVENTS, Math.floor(finite(maxEvents, MAX_EVENTS))));
  let disposed = false;
  let serial = 0;

  const snapshot = (extra = {}) => freeze({
    disposed,
    serial,
    size: history.length,
    history: freeze(history.slice()),
    ...extra,
  });

  return freeze({
    push(outcome) {
      if (disposed) return snapshot({ accepted: false, reason: 'disposed' });
      const normalized = normalizeOutcome(outcome);
      if (!normalized.accepted) return snapshot({ accepted: false, reason: 'rejected', reaction: normalized.reaction });
      serial += 1;
      const durationMs = clamp(normalized.spec.durationMs * (0.65 + normalized.intensity * 0.35), 1, MAX_DURATION_MS);
      const event = freeze({
        serial,
        reaction: normalized.reaction,
        animation: normalized.spec.animation,
        haptic: normalized.spec.haptic,
        vfx: normalized.spec.vfx,
        sfx: normalized.spec.sfx,
        durationMs,
        intensity: normalized.intensity,
        targetId: normalized.targetId,
        sourceId: normalized.sourceId,
        sequence: normalized.sequence,
        timestamp: normalized.timestamp,
        blocked: normalized.blocked,
        defeated: normalized.defeated,
        window: freeze({ startMs: normalized.timestamp, endMs: normalized.timestamp + durationMs }),
      });
      history.push(event);
      while (history.length > limit) history.shift();
      return snapshot({ accepted: true, event });
    },
    snapshot,
    dispose() {
      disposed = true;
      history.length = 0;
      return snapshot({ accepted: false, reason: 'disposed' });
    },
  });
}

export function validatePlayerCombatReactionEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (!REACTIONS[event.reaction]) return false;
  if (!Number.isInteger(event.serial) || event.serial < 1) return false;
  if (!Number.isFinite(event.durationMs) || event.durationMs < 1 || event.durationMs > MAX_DURATION_MS) return false;
  if (!Number.isFinite(event.intensity) || event.intensity < 0 || event.intensity > MAX_INTENSITY) return false;
  if (!event.window || event.window.endMs < event.window.startMs) return false;
  return true;
}

export const PLAYER_COMBAT_REACTION_LIMITS = freeze({ maxEvents: MAX_EVENTS, maxDurationMs: MAX_DURATION_MS });
