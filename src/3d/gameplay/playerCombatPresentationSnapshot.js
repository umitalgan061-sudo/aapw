/**
 * Read-only projection for HUD/VFX/SFX/animation consumers.
 * It never mutates the existing player controller or owns combat state.
 * @module gameplay/playerCombatPresentationSnapshot
 */

const ACTIONS = new Set(['idle', 'walk', 'sprint', 'exhausted', 'airborne', 'guard', 'dodge', 'parry', 'guard-break', 'hit-stagger', 'attack-light', 'attack-heavy']);
const OUTCOMES = new Set(['none', 'hit', 'guard', 'parry', 'dodge', 'guard-break', 'hit-stagger', 'defeated', 'miss']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;

function normalizeAction(state) {
  const value = text(state, 'idle');
  if (ACTIONS.has(value)) return value;
  if (value === 'attack') return 'attack-light';
  return value.startsWith('attack-heavy') ? 'attack-heavy' : value.startsWith('attack-') ? 'attack-light' : 'idle';
}

function normalizeOutcome(value) {
  const normalized = text(value, 'none').toLowerCase();
  return OUTCOMES.has(normalized) ? normalized : 'none';
}

function normalizeVector(value) {
  return Object.freeze({ x: finite(value?.x), y: finite(value?.y), z: finite(value?.z) });
}

export function createPlayerCombatPresentationSnapshot(input = {}) {
  const motion = input.motion ?? input.player?.getMotionState?.() ?? input.player?.object3D?.userData?.playerMotion ?? {};
  const equipment = input.equipment ?? {};
  const target = input.target ?? null;
  const feedback = input.feedback ?? {};
  const stamina = Math.max(0, finite(motion.stamina));
  const maxStamina = Math.max(1, finite(motion.maxStamina, 100));
  const poise = Math.max(0, finite(motion.poise));
  const maxPoise = Math.max(1, finite(motion.maxPoise, 100));
  const attackKind = text(motion.attackKind, 'none');
  const action = normalizeAction(motion.state);
  const outcome = normalizeOutcome(feedback.outcome ?? motion.defenseResult);
  const targetId = typeof target?.id === 'string' && target.id.trim() ? target.id.trim() : null;
  const snapshot = {
    version: 1,
    action,
    locomotion: Object.freeze({ speedMps: Math.max(0, finite(motion.speedMps)), grounded: motion.isGrounded !== false, sprintExhausted: Boolean(motion.sprintExhausted) }),
    resources: Object.freeze({ stamina, maxStamina, staminaRatio: clamp(stamina / maxStamina, 0, 1), poise, maxPoise, poiseRatio: clamp(poise / maxPoise, 0, 1) }),
    attack: Object.freeze({ kind: attackKind === 'light' || attackKind === 'heavy' ? attackKind : 'none', phase: text(motion.attackPhase, 'none'), comboStep: clamp(Math.floor(finite(motion.attackComboStep)), 0, 3), active: Boolean(motion.attackActive), remainingSeconds: Math.max(0, finite(motion.attackRemaining)) }),
    defense: Object.freeze({ guarding: Boolean(motion.guarding), parryWindowSeconds: Math.max(0, finite(motion.parryWindowRemaining)), dodgeInvulnerable: Boolean(motion.isDodgeInvulnerable), result: outcome }),
    equipment: Object.freeze({ weaponId: text(equipment.weaponId, null), armorSetId: text(equipment.armorSetId, null), mainHandSocket: text(equipment.mainHandSocket, 'mainHand'), offHandSocket: text(equipment.offHandSocket, 'offHand') }),
    target: Object.freeze({ id: targetId, locked: Boolean(target?.locked), distanceMeters: targetId ? Math.max(0, finite(target.distanceMeters)) : null, facingDot: targetId ? clamp(finite(target.facingDot), -1, 1) : null }),
    feedback: Object.freeze({ outcome, serial: Math.max(0, Math.floor(finite(feedback.serial))), intensity: clamp(Math.max(0, finite(feedback.intensity, outcome === 'none' ? 0 : 1)), 0, 1), cue: text(feedback.cue, outcome === 'none' ? null : outcome) }),
    position: normalizeVector(motion.position),
  };
  return Object.freeze(snapshot);
}

export function serializePlayerCombatPresentationSnapshot(input = {}) {
  return JSON.stringify(createPlayerCombatPresentationSnapshot(input));
}

export function validatePlayerCombatPresentationSnapshot(snapshot) {
  const value = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const finiteNumbers = [value.resources?.staminaRatio, value.resources?.poiseRatio, value.attack?.remainingSeconds, value.feedback?.intensity];
  const valid = value.version === 1 && ACTIONS.has(value.action) && finiteNumbers.every(Number.isFinite) && value.resources.staminaRatio >= 0 && value.resources.staminaRatio <= 1 && value.resources.poiseRatio >= 0 && value.resources.poiseRatio <= 1 && value.attack.comboStep >= 0 && value.attack.comboStep <= 3;
  return Object.freeze({ valid, finite: finiteNumbers.every(Number.isFinite), normalized: value.action === normalizeAction(value.action), readOnly: true });
}
