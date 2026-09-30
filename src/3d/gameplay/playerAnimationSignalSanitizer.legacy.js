/**
 * Presentation signal sanitizer for player animation effects.
 *
 * Converts untrusted presentation requests into a deterministic, bounded read-only packet.
 * It does not dispatch events, allocate assets, mutate player state, or own combat/movement.
 *
 * @module gameplay/playerAnimationSignalSanitizer
 */

export const PLAYER_ANIMATION_SIGNAL_SANITIZER_VERSION = '2026-09-15-v1';

export const PLAYER_ANIMATION_SIGNAL_LIMITS = Object.freeze({
  maxSignals: 8,
  maxTextLength: 64,
  maxIntensity: 1,
  minIntensity: 0,
  maxLifetimeSeconds: 2.5,
});

const ALLOWED_TYPES = new Set(['footstep', 'transition', 'action-start', 'action-end', 'surface-change', 'presentation-warning']);

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function text(value, fallback = '') {
  const output = typeof value === 'string' ? value : fallback;
  return output.slice(0, PLAYER_ANIMATION_SIGNAL_LIMITS.maxTextLength);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sanitizeType(value) {
  return ALLOWED_TYPES.has(value) ? value : 'presentation-warning';
}

export function sanitizePlayerAnimationSignal(signal = {}) {
  const type = sanitizeType(signal.type);
  const warnings = [];
  if (type === 'presentation-warning' && signal.type !== type) warnings.push('unknown-type');
  const output = {
    type,
    sequence: Math.max(0, Math.floor(finite(signal.sequence))),
    atSeconds: Math.max(0, finite(signal.atSeconds)),
  };
  if (type === 'footstep') {
    output.foot = signal.foot === 'left' || signal.foot === 'right' ? signal.foot : 'left';
    output.materialKey = text(signal.materialKey, 'generic') || 'generic';
    output.intensity = round(clamp(finite(signal.intensity, 0), PLAYER_ANIMATION_SIGNAL_LIMITS.minIntensity, PLAYER_ANIMATION_SIGNAL_LIMITS.maxIntensity));
    output.phase = round(((finite(signal.phase) % 1) + 1) % 1);
  } else if (type === 'transition') {
    output.from = text(signal.from, 'idle') || 'idle';
    output.to = text(signal.to, 'idle') || 'idle';
    output.reason = text(signal.reason, 'transition') || 'transition';
  } else if (type === 'action-start' || type === 'action-end') {
    output.action = text(signal.action ?? signal.semanticState, 'none') || 'none';
    output.variant = text(signal.variant, 'default') || 'default';
  } else if (type === 'surface-change') {
    output.from = text(signal.from, 'generic') || 'generic';
    output.to = text(signal.to, 'generic') || 'generic';
    output.confidence = round(clamp(finite(signal.confidence, 0), 0, 1));
  }
  if (warnings.length) output.warnings = [...new Set(warnings)];
  return Object.freeze(output);
}

export function sanitizePlayerAnimationSignalBatch(signals = [], limit = PLAYER_ANIMATION_SIGNAL_LIMITS.maxSignals) {
  const list = Array.isArray(signals) ? signals : [];
  const max = clamp(Math.floor(finite(limit, PLAYER_ANIMATION_SIGNAL_LIMITS.maxSignals)), 0, PLAYER_ANIMATION_SIGNAL_LIMITS.maxSignals);
  return Object.freeze(list.slice(0, max).map((signal) => sanitizePlayerAnimationSignal(signal)));
}

export function validatePlayerAnimationSignal(signal = {}) {
  const value = signal && typeof signal === 'object' ? signal : {};
  const failures = [];
  if (!ALLOWED_TYPES.has(value.type)) failures.push('type');
  if (!Number.isInteger(value.sequence) || value.sequence < 0) failures.push('sequence');
  if (!Number.isFinite(value.atSeconds) || value.atSeconds < 0) failures.push('atSeconds');
  if (value.type === 'footstep' && (!Number.isFinite(value.intensity) || value.intensity < 0 || value.intensity > 1)) failures.push('intensity');
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

export function filterPlayerAnimationSignalsByLifetime(signals = [], nowSeconds = 0, lifetimeSeconds = PLAYER_ANIMATION_SIGNAL_LIMITS.maxLifetimeSeconds) {
  const now = Math.max(0, finite(nowSeconds));
  const lifetime = clamp(finite(lifetimeSeconds, PLAYER_ANIMATION_SIGNAL_LIMITS.maxLifetimeSeconds), 0, PLAYER_ANIMATION_SIGNAL_LIMITS.maxLifetimeSeconds);
  return Object.freeze((Array.isArray(signals) ? signals : []).filter((signal) => now - finite(signal?.atSeconds) <= lifetime).map((signal) => Object.freeze({ ...signal })));
}

export function createPlayerAnimationSignalPacket(signals = [], nowSeconds = 0) {
  const sanitized = sanitizePlayerAnimationSignalBatch(signals);
  const live = filterPlayerAnimationSignalsByLifetime(sanitized, nowSeconds);
  const warnings = live.filter((signal) => signal.type === 'presentation-warning').length;
  return Object.freeze({
    version: PLAYER_ANIMATION_SIGNAL_SANITIZER_VERSION,
    count: live.length,
    warningCount: warnings,
    signals: live,
  });
}

export function auditPlayerAnimationSignalSanitizer() {
  const sample = sanitizePlayerAnimationSignal({ type: 'footstep', sequence: -1, intensity: 2, phase: 3, materialKey: 'stone' });
  const validation = validatePlayerAnimationSignal(sample);
  return Object.freeze({
    version: PLAYER_ANIMATION_SIGNAL_SANITIZER_VERSION,
    ok: validation.ok && sample.intensity === 1 && sample.sequence === 0,
    validation,
    limits: PLAYER_ANIMATION_SIGNAL_LIMITS,
  });
}

export function getPlayerAnimationSignalTypes() {
  return Object.freeze([...ALLOWED_TYPES]);
}

export function isPlayerAnimationSignalType(value) {
  return ALLOWED_TYPES.has(value);
}

export function getPlayerAnimationSignalLimits() {
  return Object.freeze({ ...PLAYER_ANIMATION_SIGNAL_LIMITS });
}
