/**
 * Presentation signal sanitizer for player animation effects.
 *
 * Converts untrusted presentation requests into a deterministic, bounded read-only packet.
 * It does not dispatch events, allocate assets, mutate player state, or own combat/movement.
 *
 * @module gameplay/playerAnimationSignalSanitizer
 */

export interface PlayerAnimationSignalInput { readonly [key: string]: unknown; readonly type?: unknown; readonly sequence?: unknown; readonly atSeconds?: unknown; readonly intensity?: unknown; readonly phase?: unknown; readonly foot?: unknown; readonly materialKey?: unknown; readonly confidence?: unknown; readonly action?: unknown; readonly semanticState?: unknown; readonly variant?: unknown; readonly from?: unknown; readonly to?: unknown; readonly reason?: unknown; }
export interface PlayerAnimationSignal { readonly [key: string]: unknown; readonly type: PlayerAnimationSignalType; readonly sequence: number; readonly atSeconds: number; readonly intensity?: number; readonly phase?: number; }
export const PLAYER_ANIMATION_SIGNAL_TYPES = Object.freeze(['footstep', 'transition', 'action-start', 'action-end', 'surface-change', 'presentation-warning'] as const);
export type PlayerAnimationSignalType = typeof PLAYER_ANIMATION_SIGNAL_TYPES[number];

export const PLAYER_ANIMATION_SIGNAL_SANITIZER_VERSION = '2026-09-15-v1';

export const PLAYER_ANIMATION_SIGNAL_LIMITS = Object.freeze({
  maxSignals: 8,
  maxTextLength: 64,
  maxIntensity: 1,
  minIntensity: 0,
  maxLifetimeSeconds: 2.5,
});

const ALLOWED_TYPES = new Set<PlayerAnimationSignalType>(PLAYER_ANIMATION_SIGNAL_TYPES);

const finite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;

};

const clamp = (value: unknown, min: number, max: number): number => {

  return Math.max(min, Math.min(max, finite(value, min)));
};

const text = (value: unknown, fallback = ''): string => {
  const output = typeof value === 'string' ? value : fallback;
  return output.slice(0, PLAYER_ANIMATION_SIGNAL_LIMITS.maxTextLength);

};

const round = (value: unknown, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

const sanitizeType = (value: unknown): PlayerAnimationSignalType => {
  return ALLOWED_TYPES.has(value as PlayerAnimationSignalType) ? value as PlayerAnimationSignalType : 'presentation-warning';
};

export function sanitizePlayerAnimationSignal(signal: PlayerAnimationSignalInput = {}): PlayerAnimationSignal {
  const type = sanitizeType(signal.type);
  const warnings: string[] = [];
  if (type === 'presentation-warning' && signal.type !== type) warnings.push('unknown-type');
  const output: Record<string, unknown> = {
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
  return Object.freeze(output) as PlayerAnimationSignal;
}

export function sanitizePlayerAnimationSignalBatch(signals: readonly PlayerAnimationSignalInput[] = [], limit: unknown = PLAYER_ANIMATION_SIGNAL_LIMITS.maxSignals): readonly PlayerAnimationSignal[] {
  const list = Array.isArray(signals) ? signals : [];
  const max = clamp(Math.floor(finite(limit, PLAYER_ANIMATION_SIGNAL_LIMITS.maxSignals)), 0, PLAYER_ANIMATION_SIGNAL_LIMITS.maxSignals);
  return Object.freeze(list.slice(0, max).map((signal) => sanitizePlayerAnimationSignal(signal)));
}

export function validatePlayerAnimationSignal(signal: unknown): Readonly<{ ok: boolean; failures: readonly string[] }> {
  const value = signal && typeof signal === 'object' ? signal as Partial<PlayerAnimationSignal> : {};
  const failures: string[] = [];
  if (!ALLOWED_TYPES.has(value.type as PlayerAnimationSignalType)) failures.push('type');
  if (!Number.isInteger(value.sequence) || Number(value.sequence ?? -1) < 0) failures.push('sequence');
  if (!Number.isFinite(value.atSeconds) || Number(value.atSeconds ?? -1) < 0) failures.push('atSeconds');
  if (value.type === 'footstep' && (!Number.isFinite(value.intensity) || Number(value.intensity ?? -1) < 0 || Number(value.intensity ?? -1) > 1)) failures.push('intensity');
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

export function filterPlayerAnimationSignalsByLifetime(signals: readonly PlayerAnimationSignal[] = [], nowSeconds: unknown = 0, lifetimeSeconds: unknown = PLAYER_ANIMATION_SIGNAL_LIMITS.maxLifetimeSeconds): readonly PlayerAnimationSignal[] {
  const now = Math.max(0, finite(nowSeconds));
  const lifetime = clamp(finite(lifetimeSeconds, PLAYER_ANIMATION_SIGNAL_LIMITS.maxLifetimeSeconds), 0, PLAYER_ANIMATION_SIGNAL_LIMITS.maxLifetimeSeconds);
  return Object.freeze((Array.isArray(signals) ? signals : []).filter((signal) => now - finite(signal?.atSeconds) <= lifetime).map((signal) => Object.freeze({ ...signal })));
}

export function createPlayerAnimationSignalPacket(signals: readonly PlayerAnimationSignalInput[] = [], nowSeconds: unknown = 0) {
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

export function getPlayerAnimationSignalTypes(): readonly PlayerAnimationSignalType[] {
  return Object.freeze([...ALLOWED_TYPES]);
}

export function isPlayerAnimationSignalType(value: unknown): value is PlayerAnimationSignalType {
  return ALLOWED_TYPES.has(value as PlayerAnimationSignalType);
}

export function getPlayerAnimationSignalLimits() {
  return Object.freeze({ ...PLAYER_ANIMATION_SIGNAL_LIMITS });
}
