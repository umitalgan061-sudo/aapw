/**
 * Deterministic third-person camera intent over the existing player movement/combat authority.
 * Presentation-only: no camera, scene, player or mixer mutation occurs here.
 */
// @ts-nocheck

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 4) => Number(finite(value).toFixed(digits));

export const PLAYER_CAMERA_INTENT_VERSION = 1;
export const PLAYER_CAMERA_MODES = Object.freeze(['explore', 'combat', 'guard', 'dodge', 'hit-stagger']);

function normalizeMode(motion = {}, combat = {}) {
  const state = String(motion.state || 'idle');
  if (state === 'hit-stagger' || state === 'guard-break') return 'hit-stagger';
  if (state === 'dodge') return 'dodge';
  if (Boolean(combat.guarding) || state === 'guard' || state === 'parry') return 'guard';
  if (String(combat.attackKind || 'none') !== 'none' || state.startsWith('attack-')) return 'combat';
  return 'explore';
}

function canonicalKey(intent) {
  return [
    intent.mode,
    intent.grounded ? 1 : 0,
    intent.lockOn.targetId || '-',
    intent.shoulder,
    intent.distance.toFixed(3),
    intent.height.toFixed(3),
    intent.lookSensitivity.toFixed(3),
    intent.recenterSpeed.toFixed(3),
    intent.fov.toFixed(3),
  ].join('|');
}

export function composePlayerThirdPersonCameraIntent({ motion = {}, combat = {}, lockOn = {}, input = {}, profile = {} } = {}) {
  const mode = normalizeMode(motion, combat);
  const grounded = Boolean(motion.isGrounded ?? true);
  const targetId = typeof lockOn.targetId === 'string' && lockOn.targetId.length > 0 ? lockOn.targetId : null;
  const shoulder = input.shoulder === 'left' ? 'left' : 'right';
  const moveMagnitude = clamp(input.moveMagnitude ?? Math.hypot(finite(input.moveX), finite(input.moveZ)), 0, 1);
  const speedMps = Math.max(0, finite(motion.speedMps));
  const ranged = Boolean(profile.ranged);
  const guardBias = mode === 'guard' ? 0.12 : mode === 'dodge' ? -0.05 : 0;
  const combatBias = mode === 'combat' ? 0.08 : mode === 'hit-stagger' ? 0.16 : 0;
  const distance = clamp(4.8 - Math.min(1.2, speedMps * 0.08) - combatBias + guardBias, 3.2, 5.6);
  const height = clamp(1.65 + (ranged ? 0.12 : 0) + (mode === 'hit-stagger' ? 0.08 : 0), 1.4, 2.2);
  const fov = clamp(58 + Math.min(8, speedMps * 0.9) + (ranged ? 2 : 0), 55, 72);
  const lookSensitivity = clamp(0.8 + (moveMagnitude * 0.15) + (targetId ? 0.1 : 0), 0.65, 1.15);
  const recenterSpeed = clamp(mode === 'dodge' ? 9 : mode === 'hit-stagger' ? 3.5 : targetId ? 6.5 : 4.2, 2, 10);
  const intent = {
    version: PLAYER_CAMERA_INTENT_VERSION,
    mode,
    grounded,
    shoulder,
    distance: round(distance),
    height: round(height),
    fov: round(fov),
    lookSensitivity: round(lookSensitivity),
    recenterSpeed: round(recenterSpeed),
    moveMagnitude: round(moveMagnitude),
    lockOn: Object.freeze({
      active: Boolean(targetId),
      targetId,
      snapYaw: Boolean(targetId && (mode === 'combat' || mode === 'guard')),
      preserveTargetThroughDodge: Boolean(targetId && mode === 'dodge'),
    }),
    diagnostics: Object.freeze({
      speedMps: round(speedMps),
      ranged,
      cameraSafe: grounded || mode === 'dodge' || mode === 'hit-stagger',
    }),
  };
  return Object.freeze({ ...intent, replayKey: canonicalKey(intent) });
}

export function isPlayerThirdPersonCameraIntent(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.version !== PLAYER_CAMERA_INTENT_VERSION || !PLAYER_CAMERA_MODES.includes(value.mode)) return false;
  if (typeof value.replayKey !== 'string' || value.lockOn == null || value.diagnostics == null) return false;
  if (value.replayKey !== canonicalKey(value)) return false;
  return Object.isFrozen(value) && Object.isFrozen(value.lockOn) && Object.isFrozen(value.diagnostics);
}
