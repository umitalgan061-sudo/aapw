/**
 * Deterministic animation-event schedule for the existing player combat pipeline.
 * This module is a pure timing projection; it does not own AnimationMixer/state mutation.
 */

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const id = (value, fallback = 'unknown') => String(value ?? fallback).trim() || fallback;

const EVENT_TIMES = Object.freeze({
  light: Object.freeze({ windup: 0.18, active: 0.34, recover: 0.68 }),
  heavy: Object.freeze({ windup: 0.34, active: 0.58, recover: 1.08 }),
  dodge: Object.freeze({ windup: 0.06, active: 0.12, recover: 0.42 }),
  guard: Object.freeze({ windup: 0.04, active: 0.1, recover: 0.16 }),
  parry: Object.freeze({ windup: 0.03, active: 0.08, recover: 0.2 }),
  rangedRelease: Object.freeze({ windup: 0.22, active: 0.28, recover: 0.5 }),
});

const normalizeAction = (action) => {
  const value = id(action, 'none').toLowerCase();
  return Object.prototype.hasOwnProperty.call(EVENT_TIMES, value) ? value : 'none';
};

export function buildPlayerAnimationEventSchedule(input = {}) {
  const action = normalizeAction(input.action);
  const duration = clamp(finite(input.duration, EVENT_TIMES[action]?.recover ?? 0), 0, 10);
  const progress = clamp(finite(input.progress, 0), 0, 1);
  const speed = clamp(finite(input.speed, 1), 0.1, 4);
  const profile = EVENT_TIMES[action];
  if (!profile) {
    return Object.freeze({
      action: 'none', progress, duration, speed,
      events: Object.freeze([]),
      activeEvent: 'none',
      complete: true,
      reason: 'unsupported-action',
    });
  }
  const scaled = Object.fromEntries(Object.entries(profile).map(([name, time]) => [name, clamp(time / speed, 0, duration || 10)]));
  const events = [
    { name: 'windup', time: scaled.windup },
    { name: 'active', time: scaled.active },
    { name: 'recover', time: scaled.recover },
  ].map((event) => Object.freeze(event));
  const elapsed = duration * progress;
  const activeEvent = elapsed < scaled.windup ? 'windup' : elapsed < scaled.active ? 'active' : elapsed < scaled.recover ? 'recover' : 'complete';
  return Object.freeze({
    action, progress, duration, speed,
    events: Object.freeze(events),
    activeEvent,
    complete: activeEvent === 'complete',
    reason: 'scheduled',
  });
}

export function serializePlayerAnimationEventSchedule(input = {}) {
  return JSON.stringify(buildPlayerAnimationEventSchedule(input));
}
