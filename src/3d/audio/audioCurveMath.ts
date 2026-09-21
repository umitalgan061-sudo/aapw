// @ts-nocheck
/**
 * Reusable bounded audio curve math.
 *
 * Audio systems repeatedly need smoothstep, attack/release, equal-power crossfades and distance curves.
 * Keeping them here avoids subtly different hand-written curves across soundscape, ducking and music.
 * All operations are pure and numerically bounded for headless determinism.
 */

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function lerp(a, b, t) { const x = clamp(finiteOr(t, 0)); return finiteOr(a, 0) + (finiteOr(b, 0) - finiteOr(a, 0)) * x; }
export function inverseLerp(a, b, value) { const low = finiteOr(a, 0); const high = finiteOr(b, 1); if (high === low) return 0; return clamp((finiteOr(value, low) - low) / (high - low)); }
export function smoothstep(a, b, value) { const t = inverseLerp(a, b, value); return t * t * (3 - 2 * t); }
export function smootherstep(a, b, value) { const t = inverseLerp(a, b, value); return t * t * t * (t * (t * 6 - 15) + 10); }
export function exponentialApproach(current, target, deltaSeconds, timeConstant = 0.2) { const dt = Math.max(0, finiteOr(deltaSeconds, 0)); const tau = Math.max(0.001, finiteOr(timeConstant, 0.2)); return lerp(current, target, 1 - Math.exp(-dt / tau)); }
export function equalPowerPan(position) { const p = clamp(finiteOr(position, 0), -1, 1); const angle = (p + 1) * Math.PI * 0.25; return { left: Math.cos(angle), right: Math.sin(angle) }; }
export function equalPowerCrossfade(progress) { const t = clamp(finiteOr(progress, 0)); const angle = t * Math.PI * 0.5; return { out: Math.cos(angle), in: Math.sin(angle) }; }
export function distanceCurve(distance, near = 1, far = 100) { const normalized = inverseLerp(Math.max(0, near), Math.max(near + 0.001, far), Math.max(0, finiteOr(distance, far))); return Math.pow(1 - normalized, 1.6); }
export function attackRelease(current, target, deltaSeconds, attackSeconds = 0.05, releaseSeconds = 0.2) { const attack = finiteOr(attackSeconds, 0.05); const release = finiteOr(releaseSeconds, 0.2); const tau = target > current ? attack : release; return exponentialApproach(current, target, deltaSeconds, tau); }
export function boundedSine(phase, amplitude = 1, offset = 0) { return finiteOr(offset, 0) + Math.sin(finiteOr(phase, 0)) * clamp(finiteOr(amplitude, 1), 0, 1); }
export function triangleWave(phase) { const x = (finiteOr(phase, 0) / (Math.PI * 2)) % 1; const t = x < 0 ? x + 1 : x; return 1 - 4 * Math.abs(t - 0.5); }
export function curveMathConstants() { return Object.freeze({ min: 0, max: 1 }); }
